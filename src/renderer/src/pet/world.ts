import type { CatColor, CatCounts, PetDefinition } from './types'
import { CatEngine } from './engine'
import { PetView } from './view'
import bowlPng from '../assets/bowl.png'

interface CatInstance {
  color: CatColor
  engine: CatEngine
  view: PetView
  lastKey: string
}

/** On-screen display size of the bowl (the art is a 64px frame). */
const BOWL_SIZE = 76

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

  private bowl: HTMLImageElement | null = null
  private bowlX = 0
  private onBowlMoveCb: ((x: number) => void) | null = null
  private onBowlRemoveCb: (() => void) | null = null

  private capturing = false
  private down = false
  private dragging = false
  private downX = 0
  private active: CatInstance | null = null
  /** True while the current pointer gesture is dragging the bowl (not a cat). */
  private bowlActive = false
  private bowlGrabDx = 0
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
    this.removeBowl()
    this.trash.remove()
  }

  onDelete(cb: () => void): void {
    this.onDeleteCb = cb
  }

  /** Called when the bowl is dropped at a new floor x (persist it). */
  onBowlMove(cb: (x: number) => void): void {
    this.onBowlMoveCb = cb
  }

  /** Called when the bowl is dropped on the trash (disable it in config). */
  onBowlRemove(cb: () => void): void {
    this.onBowlRemoveCb = cb
  }

  /**
   * Reconcile the bowl element to match config: create/remove it and reposition
   * to `x` (or screen center when null). x is clamped into the visible floor so a
   * stale/off-screen saved value can't hide the bowl.
   */
  setBowl(enabled: boolean, x: number | null): void {
    if (!enabled) {
      this.removeBowl()
      return
    }
    if (!this.bowl) {
      const img = document.createElement('img')
      img.className = 'bowl'
      img.src = bowlPng
      img.draggable = false
      this.stage.appendChild(img)
      this.bowl = img
    }
    const target = x === null ? (window.innerWidth - BOWL_SIZE) / 2 : x
    this.bowlX = this.clampBowlX(target)
    this.bowl.style.left = `${this.bowlX}px`
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

  private removeBowl(): void {
    if (!this.bowl) return
    this.bowl.remove()
    this.bowl = null
    // If the bowl was being dragged when it was removed (e.g. setBowl(false) fired
    // mid-gesture from a config-change echo), abort the gesture so flags/trash
    // don't get stuck.
    if (this.bowlActive) {
      this.bowlActive = false
      this.down = false
      this.dragging = false
      this.trash.classList.remove('visible', 'hot')
      // Re-evaluate click-through: nothing is under the cursor any more.
      if (this.capturing) {
        this.capturing = false
        window.petApi.setIgnoreMouseEvents(true)
      }
    }
  }

  private clampBowlX = (x: number): number =>
    Math.max(0, Math.min(window.innerWidth - BOWL_SIZE, x))

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
    const bowlUnder = (cx: number, cy: number): boolean => {
      if (!this.bowl) return false
      const r = this.bowl.getBoundingClientRect()
      return cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom
    }
    /** Whether the cursor is over any interactive object (cat or bowl). */
    const overInteractive = (cx: number, cy: number): boolean =>
      catUnder(cx, cy) !== null || bowlUnder(cx, cy)

    const onPointerDown = (e: PointerEvent): void => {
      // Cats keep priority over the bowl (preserves existing cat hit behavior).
      const c = catUnder(e.clientX, e.clientY)
      if (c) {
        this.down = true
        this.dragging = false
        this.downX = e.clientX
        this.active = c
        return
      }
      if (this.bowl && bowlUnder(e.clientX, e.clientY)) {
        this.down = true
        this.dragging = false
        this.downX = e.clientX
        this.bowlActive = true
        this.bowlGrabDx = e.clientX - this.bowlX
      }
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
      if (this.down && this.bowlActive && this.bowl) {
        if (!this.dragging && Math.abs(e.clientX - this.downX) > 4) {
          this.dragging = true
          this.trash.classList.add('visible')
        }
        if (this.dragging) {
          this.bowlX = this.clampBowlX(e.clientX - this.bowlGrabDx)
          this.bowl.style.left = `${this.bowlX}px`
          setCapture(true)
          this.trash.classList.toggle('hot', overTrash(e.clientX, e.clientY))
        }
        return
      }
      setCapture(overInteractive(e.clientX, e.clientY))
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
      } else if (this.down && this.bowlActive) {
        // Handle even if this.bowl is null (removeBowl() may have nulled it
        // mid-drag via setBowl(false)) — we still need to clean up trash/flags.
        if (this.dragging) {
          if (this.bowl && overTrash(e.clientX, e.clientY)) {
            this.removeBowl()
            this.onBowlRemoveCb?.()
          } else if (this.bowl) {
            this.onBowlMoveCb?.(this.bowlX)
          }
          this.trash.classList.remove('visible', 'hot')
        }
        // A plain click on the bowl is inert in Phase A (no feeding yet).
      }
      this.down = false
      this.dragging = false
      this.active = null
      this.bowlActive = false
      setCapture(overInteractive(e.clientX, e.clientY))
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
