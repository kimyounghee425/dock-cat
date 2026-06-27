import type { Anim } from './types'
import { spriteHitRect, type Box, type Rect } from './geometry'

const ALPHA_OPAQUE_THRESHOLD = 10

export type HitRect = Rect

export interface RenderState {
  animRow: number
  frameIdx: number
  lowestRow: number
}

// 렌더 어댑터: 픽셀 측정(contentBox / lowestRow)과 히트박스 노출을 담당.
// 실제 화면 드로잉은 WebGLRenderer가 전담 — 이 클래스는 DOM에 아무것도 추가하지 않는다.
export class PetView {
  // 픽셀 측정(measure/computeFloor)만을 위한 오프스크린 canvas — DOM에 추가하지 않음.
  private offscreen: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private frameSize: number
  private scale: number

  private img: HTMLImageElement | null = null
  private anim: Anim | null = null
  private frameIdx = 0
  private acc = 0
  private contentBox: Box | null = null
  // 애니마다 모든 프레임을 통틀어 가장 아래 불투명 row(0-indexed). 바닥 정렬 기준.
  private lowestRow = 0
  private x = 0
  private y = 0

  // key: "row:frameIdx" → contentBox 캐시 (getImageData 런타임 호출 제거)
  private frameCache = new Map<string, Box | null>()
  // key: "row:frames" → lowestRow 캐시
  private floorCache = new Map<string, number>()

  constructor(frameSize: number, displaySize: number, sheetUrl: string) {
    this.frameSize = frameSize
    this.scale = displaySize / frameSize

    this.offscreen = document.createElement('canvas')
    this.offscreen.width = frameSize
    this.offscreen.height = frameSize
    this.ctx = this.offscreen.getContext('2d', { willReadFrequently: true })!
    this.ctx.imageSmoothingEnabled = false

    this.setSheet(sheetUrl)
  }

  setSheet(url: string): void {
    const img = new Image()
    img.onload = () => {
      this.img = img
      this.computeFloor()
    }
    img.src = url
  }

  setAnimation(anim: Anim): void {
    if (anim === this.anim) return
    this.anim = anim
    this.frameIdx = 0
    this.acc = 0
    this.computeFloor()
  }

  tick(dt: number): void {
    if (!this.anim) return
    this.acc += dt
    const step = 1 / this.anim.fps
    while (this.acc >= step) {
      this.acc -= step
      this.frameIdx = (this.frameIdx + 1) % this.anim.frames
    }
    this.updateContentBox()
  }

  setPosition(x: number, y: number): void {
    this.x = x
    this.y = y
  }

  destroy(): void {
    // 오프스크린 canvas는 DOM에 없으므로 별도 정리 불필요.
  }

  // WebGLRenderer가 드로잉에 필요한 상태. 이미지·애니메이션 미설정 시 null.
  getRenderState(): RenderState | null {
    if (!this.anim) return null
    return { animRow: this.anim.row, frameIdx: this.frameIdx, lowestRow: this.lowestRow }
  }

  getHitRect(): HitRect {
    const F = this.frameSize
    const box = this.contentBox ?? { x: 0, y: 0, w: F, h: F }
    return spriteHitRect(this.x, this.y, box, this.lowestRow, this.scale, window.innerHeight)
  }

  // 오프스크린 canvas에 현재 프레임을 그려 contentBox를 갱신(캐시).
  // 화면 렌더링은 WebGLRenderer가 담당하므로 여기선 측정만 한다.
  private updateContentBox(): void {
    if (!this.img || !this.anim) return
    const F = this.frameSize
    this.ctx.clearRect(0, 0, F, F)
    this.ctx.drawImage(this.img, this.frameIdx * F, this.anim.row * F, F, F, 0, 0, F, F)
    const key = `${this.anim.row}:${this.frameIdx}`
    if (this.frameCache.has(key)) {
      this.contentBox = this.frameCache.get(key)!
    } else {
      this.measure()
      this.frameCache.set(key, this.contentBox)
    }
  }

  private measure(): void {
    const F = this.frameSize
    const data = this.ctx.getImageData(0, 0, F, F).data
    let minx = F,
      miny = F,
      maxx = -1,
      maxy = -1
    for (let y = 0; y < F; y++) {
      for (let x = 0; x < F; x++) {
        if (data[(y * F + x) * 4 + 3] > ALPHA_OPAQUE_THRESHOLD) {
          if (x < minx) minx = x
          if (x > maxx) maxx = x
          if (y < miny) miny = y
          if (y > maxy) maxy = y
        }
      }
    }
    this.contentBox = maxx < 0 ? null : { x: minx, y: miny, w: maxx - minx + 1, h: maxy - miny + 1 }
  }

  // 모든 프레임에 걸친 가장 아래 불투명 row를 애니당 한 번 계산한다. 프레임마다
  // 하면 꼬리/팔다리 움직임에 스프라이트 전체가 들썩인다 — 애니당 기준이라야 안정적.
  private computeFloor(): void {
    if (!this.img || !this.anim) return
    const F = this.frameSize
    const key = `${this.anim.row}:${this.anim.frames}`
    if (this.floorCache.has(key)) {
      this.lowestRow = this.floorCache.get(key)!
      return
    }
    let lowest = -1
    for (let f = 0; f < this.anim.frames; f++) {
      this.ctx.clearRect(0, 0, F, F)
      this.ctx.drawImage(this.img, f * F, this.anim.row * F, F, F, 0, 0, F, F)
      const data = this.ctx.getImageData(0, 0, F, F).data
      for (let y = F - 1; y > lowest; y--) {
        let opaque = false
        for (let x = 0; x < F; x++) {
          if (data[(y * F + x) * 4 + 3] > ALPHA_OPAQUE_THRESHOLD) {
            opaque = true
            break
          }
        }
        if (opaque) {
          lowest = y
          break
        }
      }
    }
    this.lowestRow = lowest >= 0 ? lowest : F - 1
    this.floorCache.set(key, this.lowestRow)
  }
}
