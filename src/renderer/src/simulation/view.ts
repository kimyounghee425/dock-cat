import type { Anim } from './types'
import { spriteDestY, spriteHitRect, type Box, type Rect } from './geometry'

// 픽셀을 "불투명"으로 칠 최소 알파(0-255). 안티에일리어싱 가장자리의 거의 투명한
// 픽셀을 히트박스/바닥선에서 제외하기 위한 컷오프.
const ALPHA_OPAQUE_THRESHOLD = 10

export type HitRect = Rect

// 렌더 어댑터: shared canvas에 스프라이트 현재 프레임을 nearest-neighbour로 그린다.
// left/right가 별도 row라 미러링 없음. 가장 아래 불투명 row(lowestRow)를 바닥에 맞추고,
// 불투명 bounding box를 히트테스트용으로 노출한다.
export class PetView {
  private sharedCtx: CanvasRenderingContext2D
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

  constructor(sharedCtx: CanvasRenderingContext2D, frameSize: number, displaySize: number, sheetUrl: string) {
    this.sharedCtx = sharedCtx
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
    this.draw()
  }

  setPosition(x: number, y: number): void {
    this.x = x
    this.y = y
  }

  destroy(): void {
    // 오프스크린 canvas는 DOM에 없으므로 별도 정리 불필요.
  }

  getHitRect(): HitRect {
    const F = this.frameSize
    const box = this.contentBox ?? { x: 0, y: 0, w: F, h: F }
    return spriteHitRect(this.x, this.y, box, this.lowestRow, this.scale, window.innerHeight)
  }

  private draw(): void {
    if (!this.img || !this.anim) return
    const F = this.frameSize
    const D = F * this.scale

    // 오프스크린: contentBox 측정
    this.ctx.clearRect(0, 0, F, F)
    this.ctx.drawImage(this.img, this.frameIdx * F, this.anim.row * F, F, F, 0, 0, F, F)
    const key = `${this.anim.row}:${this.frameIdx}`
    if (this.frameCache.has(key)) {
      this.contentBox = this.frameCache.get(key)!
    } else {
      this.measure()
      this.frameCache.set(key, this.contentBox)
    }

    // shared canvas: 좌표 계산 후 렌더
    const destY = spriteDestY(this.y, this.lowestRow, this.scale, window.innerHeight)
    this.sharedCtx.drawImage(this.img, this.frameIdx * F, this.anim.row * F, F, F, this.x, destY, D, D)
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
