import type { PetDefinition, Pose, SpriteAnimation } from './types'

export interface HitRect {
  left: number
  top: number
  right: number
  bottom: number
}

/**
 * Render adapter: draws the current pose's animation frame from a sprite sheet
 * onto a crisp (nearest-neighbour) canvas. Knows the asset format; the engine
 * does not. Swapping the sheet (e.g. color change) is just setSheet().
 */
export class PetView {
  private el: HTMLDivElement
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private def: PetDefinition

  private img: HTMLImageElement | null = null
  private anim: SpriteAnimation
  private frameIdx = 0
  private acc = 0
  /** Visual mirror applied to the canvas (sprite art faces left at +1). */
  private renderFlip: 1 | -1 = 1
  /** Bounding box of the currently drawn pixels, in native sprite coords. */
  private contentBox: { x: number; y: number; w: number; h: number } | null = null
  private scale: number

  constructor(stage: HTMLElement, def: PetDefinition, sheetUrl: string) {
    this.def = def
    this.anim = def.animations.idle
    this.scale = def.displaySize / def.frameSize

    this.el = document.createElement('div')
    this.el.className = 'pet'
    this.el.style.width = `${def.displaySize}px`
    this.el.style.height = `${def.displaySize}px`

    this.canvas = document.createElement('canvas')
    this.canvas.width = def.frameSize
    this.canvas.height = def.frameSize
    this.canvas.className = 'pet-canvas'
    this.canvas.style.width = `${def.displaySize}px`
    this.canvas.style.height = `${def.displaySize}px`

    this.el.append(this.canvas)
    stage.appendChild(this.el)

    this.ctx = this.canvas.getContext('2d')!
    this.ctx.imageSmoothingEnabled = false

    this.setSheet(sheetUrl)
  }

  /** Swap the sprite sheet (colorway). Animation/pose state is preserved. */
  setSheet(url: string): void {
    const img = new Image()
    img.onload = () => {
      this.img = img
      this.draw()
    }
    img.src = url
  }

  setPose(pose: Pose): void {
    this.el.dataset.pose = pose
    const next = this.def.animations[pose]
    if (next !== this.anim) {
      this.anim = next
      this.frameIdx = 0
      this.acc = 0
    }
  }

  /** Advance the current animation by dt seconds and redraw. */
  tick(dt: number): void {
    this.acc += dt
    const step = 1 / this.anim.fps
    while (this.acc >= step) {
      this.acc -= step
      if (this.frameIdx + 1 < this.anim.frames) {
        this.frameIdx++
      } else if (this.anim.loop) {
        this.frameIdx = 0
      }
    }
    this.draw()
  }

  setTransform(x: number, flip: 1 | -1): void {
    // The sprite art faces LEFT by default, so moving right (flip=1) must mirror.
    this.renderFlip = flip === 1 ? -1 : 1
    this.el.style.transform = `translateX(${x}px)`
    this.canvas.style.transform = `scaleX(${this.renderFlip})`
  }

  /** Screen-space box of the actual drawn pixels (not the padded canvas). */
  getHitRect(): HitRect {
    const rect = this.canvas.getBoundingClientRect()
    const F = this.def.frameSize
    const s = rect.width / F
    const b = this.contentBox
    if (!b) return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
    // Account for the horizontal mirror when facing right.
    const localX = this.renderFlip === 1 ? b.x : F - (b.x + b.w)
    const left = rect.left + localX * s
    const top = rect.top + b.y * s
    return { left, top, right: left + b.w * s, bottom: top + b.h * s }
  }

  onClick(handler: () => void): void {
    this.canvas.addEventListener('click', handler)
  }

  private draw(): void {
    if (!this.img) return
    const F = this.def.frameSize
    this.ctx.clearRect(0, 0, F, F)
    this.ctx.drawImage(this.img, this.frameIdx * F, this.anim.row * F, F, F, 0, 0, F, F)
    this.measure()
  }

  /** Compute the opaque bounding box of the current frame for hit-testing. */
  private measure(): void {
    const F = this.def.frameSize
    const data = this.ctx.getImageData(0, 0, F, F).data
    let minx = F,
      miny = F,
      maxx = -1,
      maxy = -1
    for (let y = 0; y < F; y++) {
      for (let x = 0; x < F; x++) {
        if (data[(y * F + x) * 4 + 3] > 10) {
          if (x < minx) minx = x
          if (x > maxx) maxx = x
          if (y < miny) miny = y
          if (y > maxy) maxy = y
        }
      }
    }
    this.contentBox = maxx >= 0 ? { x: minx, y: miny, w: maxx - minx + 1, h: maxy - miny + 1 } : null

    // Align the lowest opaque pixel to the floor so every pose stands at the
    // same ground line (poses have different foot heights within the frame).
    if (maxy >= 0) {
      const emptyBelow = F - 1 - maxy
      this.canvas.style.bottom = `${-emptyBelow * this.scale}px`
    }
  }
}
