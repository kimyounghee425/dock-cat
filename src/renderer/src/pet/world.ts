import type { CatColor, CatCounts, PetDefinition } from './types'
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
  private def: PetDefinition
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

  private rafId = 0
  private alive = true
  private onPointerDown: (e: PointerEvent) => void
  private onPointerMove: (e: PointerEvent) => void
  private onPointerUp: (e: PointerEvent) => void

  constructor(
    stage: HTMLElement,
    def: PetDefinition,
    sheets: Record<CatColor, string>,
    sleepAfterSec: number
  ) {
    this.stage = stage
    this.def = def
    this.sheets = sheets
    this.sleepAfterSec = sleepAfterSec

    this.trash = document.createElement('div')
    this.trash.className = 'trash'
    this.trash.innerHTML = '<span class="trash-emoji">🗑</span><span class="trash-label"></span>'
    stage.appendChild(this.trash)

    const handlers = this.bindPointer()
    this.onPointerDown = handlers.onPointerDown
    this.onPointerMove = handlers.onPointerMove
    this.onPointerUp = handlers.onPointerUp
    this.stage.addEventListener('pointerdown', this.onPointerDown)
    window.addEventListener('pointermove', this.onPointerMove)
    window.addEventListener('pointerup', this.onPointerUp)

    this.rafId = requestAnimationFrame((t) => this.frame(t))
  }

  /**
   * Tear down everything this world created: stop the rAF loop, remove the
   * pointer listeners, and detach every cat + the trash from the DOM. Safe to
   * call more than once.
   */
  destroy(): void {
    if (!this.alive) return
    this.alive = false
    cancelAnimationFrame(this.rafId)
    this.stage.removeEventListener('pointerdown', this.onPointerDown)
    window.removeEventListener('pointermove', this.onPointerMove)
    window.removeEventListener('pointerup', this.onPointerUp)
    for (const c of this.cats) c.view.destroy()
    this.cats = []
    this.trash.remove()
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

  /** Wake every sleeping cat immediately. */
  wakeAll(): void {
    for (const c of this.cats) c.engine.wakeNow()
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
        if (victim) this.removeCat(victim)
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
  private getMaxX = (): number => Math.max(0, window.innerWidth - this.def.displaySize)

  private spawn(color: CatColor): void {
    const engine = new CatEngine({
      def: this.def,
      startX: Math.random() * this.getMaxX(),
      getMaxX: this.getMaxX,
      sleepAfter: this.sleepAfterSec
    })
    engine.setNoWake(this.noWake)
    const view = new PetView(this.stage, this.def.frameSize, this.def.displaySize, this.sheets[color])
    this.cats.push({ color, engine, view, lastKey: '' })
  }

  private removeCat(cat: CatInstance): void {
    cat.view.destroy()
    this.cats = this.cats.filter((c) => c !== cat)
  }

  private bindPointer(): {
    onPointerDown: (e: PointerEvent) => void
    onPointerMove: (e: PointerEvent) => void
    onPointerUp: (e: PointerEvent) => void
  } {
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

    const onPointerDown = (e: PointerEvent): void => {
      const c = catUnder(e.clientX, e.clientY)
      if (!c) return
      this.down = true
      this.dragging = false
      this.downX = e.clientX
      this.active = c
    }

    const onPointerMove = (e: PointerEvent): void => {
      if (this.down && this.active) {
        if (!this.dragging && Math.abs(e.clientX - this.downX) > 4) {
          this.dragging = true
          this.active.engine.startDrag()
          this.trash.classList.add('visible')
        }
        if (this.dragging) {
          this.active.engine.dragTo(e.clientX - this.def.displaySize / 2)
          setCapture(true)
          this.trash.classList.toggle('hot', overTrash(e.clientX, e.clientY))
        }
        return
      }
      setCapture(catUnder(e.clientX, e.clientY) !== null)
    }

    const onPointerUp = (e: PointerEvent): void => {
      if (this.down && this.active) {
        if (this.dragging) {
          if (overTrash(e.clientX, e.clientY)) {
            this.removeCat(this.active)
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
    }

    return { onPointerDown, onPointerMove, onPointerUp }
  }

  private frame(now: number): void {
    if (!this.alive) return
    const dt = Math.min(0.05, (now - this.last) / 1000)
    this.last = now
    for (const c of this.cats) {
      c.engine.tick(dt)
      if (c.engine.animKey !== c.lastKey) {
        const anim = this.def.anim[c.engine.animKey]
        if (anim) c.view.setAnimation(anim)
        c.lastKey = c.engine.animKey
      }
      c.view.tick(dt)
      c.view.setPosition(c.engine.x, c.engine.y)
    }
    this.rafId = requestAnimationFrame((t) => this.frame(t))
  }
}
