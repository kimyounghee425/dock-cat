import { ANIM, DISPLAY, FRAME } from '../pets/cat'
import type { CatColor, CatCounts } from './types'
import { CatEngine } from './engine'
import { PetView } from './view'

interface CatInstance {
  color: CatColor
  engine: CatEngine
  view: PetView
  lastKey: string
}

/**
 * Manages every cat on screen: spawning/removing per color counts, a single
 * rAF loop ticking all of them, centralized click-through + drag handling so
 * the cats don't fight over the mouse, and a center trash target for deletion.
 */
export class PetWorld {
  private stage: HTMLElement
  private sheets: Record<CatColor, string>
  private sleepAfterSec: number
  private cats: CatInstance[] = []
  private trash: HTMLDivElement
  private onDeleteCb: (() => void) | null = null
  private noWake = false

  private capturing = false
  private down = false
  private dragging = false
  private downX = 0
  private active: CatInstance | null = null
  private last = performance.now()

  constructor(stage: HTMLElement, sheets: Record<CatColor, string>, sleepAfterSec: number) {
    this.stage = stage
    this.sheets = sheets
    this.sleepAfterSec = sleepAfterSec

    this.trash = document.createElement('div')
    this.trash.className = 'trash'
    this.trash.innerHTML = '<span class="trash-emoji">🗑</span><span class="trash-label"></span>'
    stage.appendChild(this.trash)

    this.bindPointer()
    requestAnimationFrame((t) => this.frame(t))
  }

  onDelete(cb: () => void): void {
    this.onDeleteCb = cb
  }

  /** Text shown on the trash when a cat hovers over it. */
  setTrashLabel(text: string): void {
    const label = this.trash.querySelector('.trash-label')
    if (label) label.textContent = text
  }

  setSleepAfter(sec: number): void {
    this.sleepAfterSec = sec
    for (const c of this.cats) c.engine.setSleepAfter(sec)
  }

  setNoWake(on: boolean): void {
    this.noWake = on
    for (const c of this.cats) c.engine.setNoWake(on)
  }

  /** Put every cat to sleep immediately. */
  sleepAll(): void {
    for (const c of this.cats) c.engine.sleepNow()
  }

  /** Reconcile live cats to match the requested per-color counts. */
  setCounts(counts: CatCounts): void {
    const colors: CatColor[] = ['ginger', 'grey', 'white']
    for (const color of colors) {
      let have = this.cats.filter((c) => c.color === color).length
      while (have < counts[color]) {
        this.spawn(color)
        have++
      }
      while (have > counts[color]) {
        const victim = [...this.cats].reverse().find((c) => c.color === color)
        if (victim) this.destroy(victim)
        have--
      }
    }
  }

  getCounts(): CatCounts {
    const counts: CatCounts = { ginger: 0, grey: 0, white: 0 }
    for (const c of this.cats) counts[c.color]++
    return counts
  }

  // --- internals ---
  private getMaxX = (): number => Math.max(0, window.innerWidth - DISPLAY)

  private spawn(color: CatColor): void {
    const engine = new CatEngine({
      startX: Math.random() * this.getMaxX(),
      getMaxX: this.getMaxX,
      sleepAfter: this.sleepAfterSec
    })
    engine.setNoWake(this.noWake)
    const view = new PetView(this.stage, FRAME, DISPLAY, this.sheets[color])
    this.cats.push({ color, engine, view, lastKey: '' })
  }

  private destroy(cat: CatInstance): void {
    cat.view.destroy()
    this.cats = this.cats.filter((c) => c !== cat)
  }

  private bindPointer(): void {
    const setCapture = (on: boolean): void => {
      if (on === this.capturing) return
      this.capturing = on
      window.petApi.setIgnoreMouseEvents(!on)
    }
    const catUnder = (cx: number, cy: number): CatInstance | null => {
      // topmost (last drawn) first
      for (let i = this.cats.length - 1; i >= 0; i--) {
        const r = this.cats[i].view.getHitRect()
        if (cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom) return this.cats[i]
      }
      return null
    }
    const overTrash = (cx: number, cy: number): boolean => {
      const r = this.trash.getBoundingClientRect()
      return cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom
    }

    this.stage.addEventListener('pointerdown', (e) => {
      const c = catUnder(e.clientX, e.clientY)
      if (!c) return
      this.down = true
      this.dragging = false
      this.downX = e.clientX
      this.active = c
    })

    window.addEventListener('pointermove', (e) => {
      if (this.down && this.active) {
        if (!this.dragging && Math.abs(e.clientX - this.downX) > 4) {
          this.dragging = true
          this.active.engine.startDrag()
          this.trash.classList.add('visible')
        }
        if (this.dragging) {
          this.active.engine.dragTo(e.clientX - DISPLAY / 2)
          setCapture(true)
          this.trash.classList.toggle('hot', overTrash(e.clientX, e.clientY))
        }
        return
      }
      setCapture(catUnder(e.clientX, e.clientY) !== null)
    })

    window.addEventListener('pointerup', (e) => {
      if (this.down && this.active) {
        if (this.dragging) {
          if (overTrash(e.clientX, e.clientY)) {
            this.destroy(this.active)
            this.onDeleteCb?.()
          } else {
            this.active.engine.endDrag()
          }
          this.trash.classList.remove('visible', 'hot')
        } else {
          this.active.engine.click()
        }
      }
      this.down = false
      this.dragging = false
      this.active = null
      setCapture(catUnder(e.clientX, e.clientY) !== null)
    })
  }

  private frame(now: number): void {
    const dt = Math.min(0.05, (now - this.last) / 1000)
    this.last = now
    for (const c of this.cats) {
      c.engine.tick(dt)
      if (c.engine.animKey !== c.lastKey) {
        c.view.setAnimation(ANIM[c.engine.animKey])
        c.lastKey = c.engine.animKey
      }
      c.view.tick(dt)
      c.view.setPosition(c.engine.x, c.engine.y)
    }
    requestAnimationFrame((t) => this.frame(t))
  }
}
