import type { Anim } from './types'

export interface HitRect {
  left: number
  top: number
  right: number
  bottom: number
}

/**
 * Render adapter: draws the current animation frame from the sprite sheet onto
 * a crisp (nearest-neighbour) canvas. Left/right are separate rows, so nothing
 * is mirrored. Each frame the lowest opaque pixel is aligned to the floor and
 * the opaque bounding box is exposed for hit-testing.
 */
export class PetView {
  private el: HTMLDivElement
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private frameSize: number
  private scale: number

  private img: HTMLImageElement | null = null
  private anim: Anim | null = null
  private frameIdx = 0
  private acc = 0
  private contentBox: { x: number; y: number; w: number; h: number } | null = null

  constructor(stage: HTMLElement, frameSize: number, displaySize: number, sheetUrl: string) {
    this.frameSize = frameSize
    this.scale = displaySize / frameSize

    this.el = document.createElement('div')
    this.el.className = 'pet'
    this.el.style.width = `${displaySize}px`
    this.el.style.height = `${displaySize}px`

    this.canvas = document.createElement('canvas')
    this.canvas.width = frameSize
    this.canvas.height = frameSize
    this.canvas.className = 'pet-canvas'
    this.canvas.style.width = `${displaySize}px`
    this.canvas.style.height = `${displaySize}px`

    this.el.append(this.canvas)
    stage.appendChild(this.el)

    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })!
    this.ctx.imageSmoothingEnabled = false

    this.setSheet(sheetUrl)
  }

  setSheet(url: string): void {
    const img = new Image()
    img.onload = () => {
      this.img = img
      this.computeFloor()
      this.draw()
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
    this.el.style.transform = `translate(${x}px, ${-y}px)`
  }

  /** Remove this cat's element from the DOM. */
  destroy(): void {
    this.el.remove()
  }

  getHitRect(): HitRect {
    const rect = this.canvas.getBoundingClientRect()
    const b = this.contentBox
    if (!b) return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
    const s = rect.width / this.frameSize
    const left = rect.left + b.x * s
    const top = rect.top + b.y * s
    return { left, top, right: left + b.w * s, bottom: top + b.h * s }
  }

  private draw(): void {
    if (!this.img || !this.anim) return
    const F = this.frameSize
    this.ctx.clearRect(0, 0, F, F)
    this.ctx.drawImage(this.img, this.frameIdx * F, this.anim.row * F, F, F, 0, 0, F, F)
    this.measure()
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
        if (data[(y * F + x) * 4 + 3] > 10) {
          if (x < minx) minx = x
          if (x > maxx) maxx = x
          if (y < miny) miny = y
          if (y > maxy) maxy = y
        }
      }
    }
    this.contentBox = maxx < 0 ? null : { x: minx, y: miny, w: maxx - minx + 1, h: maxy - miny + 1 }
  }

  /**
   * Align the floor once per animation using the lowest opaque pixel across ALL
   * frames. Doing it per-frame made wagging tails / shifting limbs bounce the
   * whole sprite; a per-animation offset keeps a stable ground line.
   */
  private computeFloor(): void {
    if (!this.img || !this.anim) return
    const F = this.frameSize
    let lowest = -1
    for (let f = 0; f < this.anim.frames; f++) {
      this.ctx.clearRect(0, 0, F, F)
      this.ctx.drawImage(this.img, f * F, this.anim.row * F, F, F, 0, 0, F, F)
      const data = this.ctx.getImageData(0, 0, F, F).data
      for (let y = F - 1; y > lowest; y--) {
        let opaque = false
        for (let x = 0; x < F; x++) {
          if (data[(y * F + x) * 4 + 3] > 10) {
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
    if (lowest >= 0) this.canvas.style.bottom = `${-(F - 1 - lowest) * this.scale}px`
    this.draw()
  }
}
