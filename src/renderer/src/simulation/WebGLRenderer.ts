import type { CatColor } from './types'
import { spriteDestY } from './geometry'

export interface SpriteRenderInfo {
  color: CatColor
  x: number
  y: number        // engine y (0 = 바닥, 위로 증가)
  animRow: number
  frameIdx: number
  lowestRow: number
}

const VERT = /* glsl */ `#version 300 es
in vec2 aVertex;
in vec2 aPos;
in vec2 aUV;
uniform vec2 uScreen;
uniform vec2 uSprite;
uniform vec2 uFrameUV;
out vec2 vUV;
void main() {
  vec2 px = aPos + aVertex * uSprite;
  vec2 ndc = px / uScreen * 2.0 - 1.0;
  ndc.y = -ndc.y;
  gl_Position = vec4(ndc, 0.0, 1.0);
  vUV = aUV + aVertex * uFrameUV;
}`

const FRAG = /* glsl */ `#version 300 es
precision mediump float;
in vec2 vUV;
uniform sampler2D uTex;
out vec4 fragColor;
void main() {
  fragColor = texture(uTex, vUV);
}`

const COLORS: CatColor[] = ['ginger', 'grey', 'white']

interface TextureInfo {
  tex: WebGLTexture
  cols: number
  rows: number
}

export class WebGLRenderer {
  readonly canvas: HTMLCanvasElement
  private gl: WebGL2RenderingContext
  private program: WebGLProgram
  private vao: WebGLVertexArrayObject
  private posBuf: WebGLBuffer
  private uvBuf: WebGLBuffer
  private posData: Float32Array
  private uvData: Float32Array
  private textures = new Map<CatColor, TextureInfo>()
  private scale: number
  private frameSize: number
  private uScreen: WebGLUniformLocation
  private uFrameUV: WebGLUniformLocation

  constructor(stage: HTMLElement, frameSize: number, displaySize: number, maxInstances: number) {
    this.frameSize = frameSize
    this.scale = displaySize / frameSize

    this.canvas = document.createElement('canvas')
    this.canvas.width = window.innerWidth
    this.canvas.height = window.innerHeight
    this.canvas.style.cssText = 'position:fixed;top:0;left:0;pointer-events:none;'
    stage.appendChild(this.canvas)

    const gl = this.canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: false })
    if (!gl) throw new Error('WebGL2 not supported')
    this.gl = gl

    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    gl.clearColor(0, 0, 0, 0)

    this.program = this.buildProgram(VERT, FRAG)
    gl.useProgram(this.program)

    this.uScreen  = gl.getUniformLocation(this.program, 'uScreen')!
    this.uFrameUV = gl.getUniformLocation(this.program, 'uFrameUV')!
    gl.uniform1i(gl.getUniformLocation(this.program, 'uTex'), 0)
    gl.uniform2f(gl.getUniformLocation(this.program, 'uSprite')!, displaySize, displaySize)
    gl.uniform2f(this.uScreen, this.canvas.width, this.canvas.height)
    gl.viewport(0, 0, this.canvas.width, this.canvas.height)

    this.posData = new Float32Array(maxInstances * 2)
    this.uvData  = new Float32Array(maxInstances * 2)

    // TRIANGLE_STRIP quad: TL(0,0) TR(1,0) BL(0,1) BR(1,1)
    const quad = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1])

    this.vao = gl.createVertexArray()!
    gl.bindVertexArray(this.vao)

    const quadBuf = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf)
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW)
    this.setAttrib('aVertex', 2, 0)

    this.posBuf = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf)
    gl.bufferData(gl.ARRAY_BUFFER, this.posData, gl.DYNAMIC_DRAW)
    this.setAttrib('aPos', 2, 1)

    this.uvBuf = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuf)
    gl.bufferData(gl.ARRAY_BUFFER, this.uvData, gl.DYNAMIC_DRAW)
    this.setAttrib('aUV', 2, 1)

    gl.bindVertexArray(null)
  }

  async loadTexture(color: CatColor, url: string): Promise<void> {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = reject
      i.src = url
    })
    const { gl } = this
    const tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    this.textures.set(color, {
      tex,
      cols: img.width  / this.frameSize,
      rows: img.height / this.frameSize,
    })
  }

  // 색상별 최대 3번 drawArraysInstanced. 텍스처가 아직 로드 안 된 색상은 건너뜀.
  render(sprites: ReadonlyArray<SpriteRenderInfo>, screenHeight: number): void {
    const { gl } = this
    gl.clear(gl.COLOR_BUFFER_BIT)
    if (sprites.length === 0) return
    gl.bindVertexArray(this.vao)

    for (const color of COLORS) {
      const ti = this.textures.get(color)
      if (!ti) continue

      let n = 0
      for (const s of sprites) {
        if (s.color !== color) continue
        this.posData[n * 2]     = s.x
        this.posData[n * 2 + 1] = spriteDestY(s.y, s.lowestRow, this.scale, screenHeight)
        this.uvData[n * 2]      = s.frameIdx / ti.cols
        this.uvData[n * 2 + 1]  = s.animRow  / ti.rows
        n++
      }
      if (n === 0) continue

      gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf)
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.posData.subarray(0, n * 2))
      gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuf)
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.uvData.subarray(0, n * 2))

      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, ti.tex)
      gl.uniform2f(this.uFrameUV, 1 / ti.cols, 1 / ti.rows)

      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n)
    }

    gl.bindVertexArray(null)
  }

  resize(): void {
    const { canvas, gl } = this
    canvas.width  = window.innerWidth
    canvas.height = window.innerHeight
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.useProgram(this.program)
    gl.uniform2f(this.uScreen, canvas.width, canvas.height)
  }

  destroy(): void {
    this.canvas.remove()
  }

  private setAttrib(name: string, size: number, divisor: number): void {
    const { gl } = this
    const loc = gl.getAttribLocation(this.program, name)
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0)
    if (divisor > 0) gl.vertexAttribDivisor(loc, divisor)
  }

  private buildProgram(vertSrc: string, fragSrc: string): WebGLProgram {
    const { gl } = this
    const vert = this.compileShader(gl.VERTEX_SHADER, vertSrc)
    const frag = this.compileShader(gl.FRAGMENT_SHADER, fragSrc)
    const prog = gl.createProgram()!
    gl.attachShader(prog, vert)
    gl.attachShader(prog, frag)
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(`Shader link: ${gl.getProgramInfoLog(prog)}`)
    }
    gl.deleteShader(vert)
    gl.deleteShader(frag)
    return prog
  }

  private compileShader(type: number, src: string): WebGLShader {
    const { gl } = this
    const s = gl.createShader(type)!
    gl.shaderSource(s, src)
    gl.compileShader(s)
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error(`Shader compile: ${gl.getShaderInfoLog(s)}`)
    }
    return s
  }
}
