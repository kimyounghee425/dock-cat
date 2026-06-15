import type { CatColor, CatCounts, PetDefinition } from './types'
import { CatEngine } from './engine'
import { PetView } from './view'
import bowlPng from '../assets/bowl.png'
import pelletPng from '../assets/pellet.png'

interface CatInstance {
  color: CatColor
  engine: CatEngine
  view: PetView
  lastKey: string
}

/** On-screen display size of the bowl (the art is a 64px frame). */
const BOWL_SIZE = 76

/** On-screen size of a food pellet (cursor-attached / floor). */
const PELLET_SIZE = 20

/**
 * Horizontal reach (left/right of the cursor) within which an awake cat will
 * notice held food and hop over to beg. Not user-configurable (per PRD).
 */
const FOOD_RADIUS = 350

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
  /** True while the current pointer gesture is repositioning the bowl (not feeding). */
  private bowlActive = false
  private bowlGrabDx = 0

  /**
   * Click-toggle holding state: true from the moment the user clicks the bowl
   * (without dragging) until they click anywhere again or press ESC. Independent
   * of the pointer-down gesture — persists across multiple pointer events.
   */
  private holdingFood = false
  /** Cursor-attached pellet element shown while holdingFood is true. */
  private heldPellet: HTMLImageElement | null = null
  /** ESC key handler registered once in the constructor, removed in destroy(). */
  private onKeyDown: (e: KeyboardEvent) => void
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

    // ESC registered once here; the handler no-ops when holdingFood is false.
    this.onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || !this.holdingFood) return
      this.clearFeeding()
      // We don't know the cursor position from a keydown event. Drop capture
      // unconditionally; the next pointermove will restore it if the cursor is
      // over a pet or bowl.
      if (this.capturing) {
        this.capturing = false
        window.petApi.setIgnoreMouseEvents(true)
      }
    }
    window.addEventListener('keydown', this.onKeyDown)

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
    window.removeEventListener('keydown', this.onKeyDown)
    this.clearFeeding() // drop any held pellet + release feeding targets
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
    // If the bowl was being dragged or was the source of an active food-hold
    // when it was removed (e.g. setBowl(false) fired mid-gesture from a
    // config-change echo), abort so flags/trash/feeding don't get stuck.
    // holdingFood is a click-toggle that outlives a single gesture, so we
    // always cancel it when the bowl disappears — no bowl means no feeding.
    const wasActive = this.bowlActive || this.holdingFood
    if (this.bowlActive) {
      this.bowlActive = false
      this.down = false
      this.dragging = false
      this.trash.classList.remove('visible', 'hot')
    }
    if (this.holdingFood) {
      this.clearFeeding() // sets holdingFood = false, removes pellet, nulls targets
    }
    if (wasActive && this.capturing) {
      this.capturing = false
      window.petApi.setIgnoreMouseEvents(true)
    }
  }

  private clampBowlX = (x: number): number =>
    Math.max(0, Math.min(window.innerWidth - BOWL_SIZE, x))

  /**
   * Toggle food-hold ON: create the cursor-attached pellet at the click point,
   * mark holdingFood, and do the first gather pass. Called on a clean bowl click
   * (pointerup with no drag). The pellet then follows on every pointermove via
   * updateFeed().
   */
  private startFeed(x: number, y: number): void {
    this.holdingFood = true
    if (!this.heldPellet) {
      const img = document.createElement('img')
      img.className = 'pellet'
      img.src = pelletPng
      img.draggable = false
      this.stage.appendChild(img)
      this.heldPellet = img
    }
    this.positionPellet(x, y)
    this.updateFoodTargets(x)
  }

  /** Follow the cursor with the pellet and recompute who's gathering. */
  private updateFeed(x: number, y: number): void {
    if (this.heldPellet) this.positionPellet(x, y)
    this.updateFoodTargets(x)
  }

  private positionPellet(x: number, y: number): void {
    if (!this.heldPellet) return
    this.heldPellet.style.left = `${x - PELLET_SIZE / 2}px`
    this.heldPellet.style.top = `${y - PELLET_SIZE / 2}px`
  }

  /**
   * Tell each awake cat within FOOD_RADIUS of the cursor x to gather at it;
   * everyone else (out of range or asleep) gets released. Sleeping cats no-op
   * inside the engine, so this is membership-by-x only. Recomputed every move.
   */
  private updateFoodTargets(cursorX: number): void {
    for (const c of this.cats) {
      // Compare against the cat's sprite center for a fair radius test.
      const catX = c.engine.x + this.def.displaySize / 2
      if (Math.abs(catX - cursorX) <= FOOD_RADIUS) {
        c.engine.setFoodTarget(cursorX)
      } else {
        c.engine.setFoodTarget(null)
      }
    }
  }

  /**
   * End the food-hold toggle: remove the cursor pellet, release every cat, tear
   * down the ESC listener, and release capture (unless something else still
   * needs it — the caller is responsible for re-evaluating setCapture after
   * this if needed).
   */
  private clearFeeding(): void {
    this.holdingFood = false
    if (this.heldPellet) {
      this.heldPellet.remove()
      this.heldPellet = null
    }
    // ESC listener stays registered (single permanent listener in constructor).
    for (const c of this.cats) c.engine.setFoodTarget(null)
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
    const bowlUnder = (cx: number, cy: number): boolean => {
      if (!this.bowl) return false
      const r = this.bowl.getBoundingClientRect()
      return cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom
    }
    /** Whether the cursor is over any interactive object (cat or bowl). */
    const overInteractive = (cx: number, cy: number): boolean =>
      catUnder(cx, cy) !== null || bowlUnder(cx, cy)

    const onPointerDown = (e: PointerEvent): void => {
      // --- While holding food, a click anywhere (not a drag) ends the hold. ---
      // We record the down position here; onPointerUp decides click vs drag.
      if (this.holdingFood) {
        this.down = true
        this.dragging = false
        this.downX = e.clientX
        this.active = null
        this.bowlActive = false
        // Don't let bowl or cat logic below run — the gesture belongs to feeding.
        return
      }

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
        // Bowl gesture starts as potentially a drag (reposition) OR a click
        // (toggle food-hold). We don't know yet — wait for pointermove/up to
        // decide. bowlActive is set on first move past the threshold; if the
        // pointer goes up without crossing it, it's a click → start holding.
        this.bowlActive = true
        this.bowlGrabDx = e.clientX - this.bowlX
      }
    }

    const onPointerMove = (e: PointerEvent): void => {
      // --- Holding food: pellet tracks cursor, cats gather. ---
      if (this.holdingFood) {
        this.updateFeed(e.clientX, e.clientY)
        // Keep capture so cursor moves register even over transparent areas.
        setCapture(true)
        return
      }

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
          // Crossed the drag threshold: this is a reposition gesture, not a
          // food-pick click. Lock in bowl-drag mode.
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
      // --- While holding food: any pointer-up ends the hold. ---
      // onPointerMove never sets this.dragging while holdingFood (the holdingFood
      // branch returns early), so this.dragging is always false here — both a
      // clean click and a drag-then-release while holding arrive as !dragging and
      // end the hold identically. No stuck state possible.
      if (this.holdingFood && this.down) {
        // Phase C hook: drop a floor pellet at e.clientX and assign nearest free cat.
        this.clearFeeding()
        setCapture(overInteractive(e.clientX, e.clientY))
        this.down = false
        this.dragging = false
        return
      }

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
          // Drag ended: reposition or trash the bowl (Phase A behavior intact).
          if (this.bowl && overTrash(e.clientX, e.clientY)) {
            this.removeBowl()
            this.onBowlRemoveCb?.()
          } else if (this.bowl) {
            this.onBowlMoveCb?.(this.bowlX)
          }
          this.trash.classList.remove('visible', 'hot')
        } else {
          // Clean click on the bowl (no drag): toggle food-hold ON.
          // Cats start gathering; ESC (permanent listener) or next click cancels.
          this.startFeed(e.clientX, e.clientY)
          setCapture(true)
        }
      }

      this.down = false
      this.dragging = false
      this.active = null
      this.bowlActive = false
      if (!this.holdingFood) {
        setCapture(overInteractive(e.clientX, e.clientY))
      }
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
