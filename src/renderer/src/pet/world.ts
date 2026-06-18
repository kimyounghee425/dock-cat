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

/**
 * A pellet dropped on the floor. `assignedCat` is the single cat sent to eat it
 * (null = waiting for a free cat). Both timers are kept so destroy()/removal can
 * cancel them cleanly. (FD4/FD5)
 */
interface Pellet {
  el: HTMLImageElement
  x: number
  assignedCat: CatInstance | null
  expireTimer: ReturnType<typeof setTimeout>
  /** True once the TTL fade started; blocks (re)assignment during the fade-out. */
  expiring: boolean
  /**
   * Timeout id for the 400 ms fade-removal step, set only while expiring.
   * Stored so destroy() / removePellet() can cancel it if the world tears down
   * during the fade window (fix for issue #3). (FD5)
   */
  fadeTimer: ReturnType<typeof setTimeout> | null
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

/** Max pellets allowed on the floor at once; a 6th evicts the oldest. (FD5) */
const MAX_PELLETS = 5

/** A floor pellet auto-expires this many ms after being dropped if uneaten. (FD5) */
const PELLET_TTL_MS = 30_000

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
  /** Pellets resting on the floor, oldest first (FIFO for max-5 eviction). */
  private pellets: Pellet[] = []
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
    // pointerdown is on window (not the stage): the stage and the held pellet are
    // both pointer-events:none, so a click over an empty (high) area never reaches
    // a stage listener — its target is #root, the stage's PARENT, which doesn't
    // bubble down. window catches it regardless, so dropping food works anywhere.
    window.addEventListener('pointerdown', this.onPointerDown)
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
    window.removeEventListener('pointerdown', this.onPointerDown)
    window.removeEventListener('pointermove', this.onPointerMove)
    window.removeEventListener('pointerup', this.onPointerUp)
    window.removeEventListener('keydown', this.onKeyDown)
    this.clearFeeding() // drop any held pellet + release feeding targets
    this.clearPellets() // remove floor pellets, clear timers + cancel any eats
    for (const c of this.cats) {
      c.engine.dispose() // D8: stop the actor + unsubscribe
      c.view.destroy()
    }
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
    // FD4: any cat that was eating is now asleep — free its pellet so another
    // (awake) cat can be assigned to it instead.
    for (const p of this.pellets) {
      if (p.assignedCat && p.assignedCat.engine.isAsleep()) p.assignedCat = null
    }
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
    // FD4: if this cat was assigned to a pellet and mid-eat, cancelEat() first so
    // the orphaned onEatenCb closure is dropped before we lose the reference.
    // Then null the assignment so the pellet becomes reassignable.
    for (const p of this.pellets) {
      if (p.assignedCat === cat) {
        cat.engine.cancelEat() // drops onEatenCb; no-op if not eating
        p.assignedCat = null
      }
    }
    cat.engine.dispose() // D8: stop the actor + unsubscribe
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
    const center = this.def.displaySize / 2
    // Every awake/feeding cat within range gathers; the rest are released.
    const inRange = this.cats.filter(
      (c) => c.engine.isFreeToEat() && Math.abs(c.engine.x + center - cursorX) <= FOOD_RADIUS
    )
    const gathering = new Set(inRange)
    for (const c of this.cats) {
      if (!gathering.has(c)) c.engine.setFoodTarget(null)
    }
    // Fan the gatherers out around the cursor (sorted by current x so they don't
    // cross over) instead of stacking on the same spot — otherwise N cats pile
    // onto one x and look like a single cat.
    inRange.sort((a, b) => a.engine.x - b.engine.x)
    const spacing = this.def.displaySize * 0.7
    const n = inRange.length
    inRange.forEach((c, i) => {
      const offset = (i - (n - 1) / 2) * spacing
      c.engine.setFoodTarget(cursorX + offset)
    })
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

  /**
   * Drop a floor pellet at cursor x (bottom-anchored). Enforces the max-5 cap by
   * evicting the oldest (which reverts its eater), arms the 30s expiry timer, and
   * immediately tries to assign the nearest free cat. (FD5)
   */
  private dropPellet(cursorX: number, cursorY: number): void {
    // Enforce the cap BEFORE adding so we never momentarily exceed it.
    while (this.pellets.length >= MAX_PELLETS) {
      this.removePellet(this.pellets[0]) // oldest first (FIFO)
    }
    const x = Math.max(0, Math.min(window.innerWidth, cursorX))
    const el = document.createElement('img')
    el.className = 'pellet-floor'
    el.src = pelletPng
    el.draggable = false
    el.style.left = `${x - PELLET_SIZE / 2}px`
    // Drop animation: start at the cursor height, then fall to the floor (슝).
    const restTop = window.innerHeight - PELLET_SIZE
    const dy = Math.min(0, cursorY - restTop)
    el.style.transition = 'none'
    el.style.transform = `translateY(${dy}px)`
    this.stage.appendChild(el)
    requestAnimationFrame(() => {
      el.style.transition = '' // back to the stylesheet (opacity + transform)
      el.style.transform = 'translateY(0)'
    })
    const pellet: Pellet = {
      el,
      x,
      assignedCat: null,
      expireTimer: setTimeout(() => this.expirePellet(pellet), PELLET_TTL_MS),
      expiring: false,
      fadeTimer: null  // set by expirePellet() once the 30 s TTL fires
    }
    this.pellets.push(pellet)
    this.assignPellets()
  }

  /**
   * For every unassigned pellet, try to send the nearest free awake cat to eat
   * it. A cat already assigned to another pellet (or eating) is skipped, so no
   * double-assignment (FD4). Called when a pellet drops and every frame so a
   * pellet that couldn't be assigned yet gets picked up once a cat frees.
   */
  private assignPellets(): void {
    // Build the taken-cats set once and update it incrementally as we assign,
    // so O(P) instead of O(P²) and each newly-assigned cat is excluded for
    // subsequent pellets in the same pass.
    const taken = new Set<CatInstance>(
      this.pellets.map((p) => p.assignedCat).filter((c): c is CatInstance => c !== null)
    )
    for (const pellet of this.pellets) {
      if (pellet.assignedCat || pellet.expiring) continue
      let best: CatInstance | null = null
      let bestDist = Infinity
      for (const c of this.cats) {
        if (!c.engine.isFreeToEat() || taken.has(c)) continue
        const catX = c.engine.x + this.def.displaySize / 2
        const dist = Math.abs(catX - pellet.x)
        if (dist < bestDist) {
          bestDist = dist
          best = c
        }
      }
      if (best) {
        pellet.assignedCat = best
        taken.add(best) // exclude from subsequent pellets in this pass
        // On eat completion: remove the pellet (also frees the cat ref). The
        // engine resets itself to autonomous before firing this.
        best.engine.goEat(pellet.x, () => this.removePellet(pellet))
      }
      // No free cat → leave unassigned; a later assignPellets() tick retries.
    }
  }

  /**
   * Remove a floor pellet: clear its expiry timer, tell its assigned cat to stop
   * eating (revert cleanly), drop it from the array, and detach the element. Safe
   * to call once per pellet. (FD4/FD5)
   */
  private removePellet(pellet: Pellet): void {
    const idx = this.pellets.indexOf(pellet)
    if (idx === -1) return // already removed
    this.pellets.splice(idx, 1)
    clearTimeout(pellet.expireTimer)
    // Cancel the fade-removal timer if destroy() runs during the 400 ms window
    // so the callback never fires on a dead world. (fix #3)
    if (pellet.fadeTimer !== null) clearTimeout(pellet.fadeTimer)
    // If a cat was mid-eat on this pellet, revert it (the eat completion callback
    // won't fire because we removed the pellet first). When the pellet was
    // removed BY that callback the cat has already reset itself, so cancelEat is
    // a no-op (mode is no longer 'eating').
    if (pellet.assignedCat) pellet.assignedCat.engine.cancelEat()
    pellet.el.remove()
  }

  /** 30s TTL elapsed: fade the pellet out (FD11), then remove it. */
  private expirePellet(pellet: Pellet): void {
    if (this.pellets.indexOf(pellet) === -1 || pellet.expiring) return
    pellet.expiring = true // block reassignment while it fades out
    // Visual feedback: fade, then remove after the CSS transition (400 ms).
    pellet.el.classList.add('pellet-floor--expiring')
    // Free its eater immediately so the cat doesn't keep eating a fading pellet.
    if (pellet.assignedCat) {
      pellet.assignedCat.engine.cancelEat()
      pellet.assignedCat = null
    }
    // Store the id so removePellet / destroy() can cancel it if the world tears
    // down during the fade window — prevents callback on a dead world. (fix #3)
    pellet.fadeTimer = setTimeout(() => this.removePellet(pellet), 400)
  }

  /** Remove every floor pellet + clear timers + revert eaters (destroy/teardown). */
  private clearPellets(): void {
    // Copy first: removePellet mutates this.pellets.
    for (const pellet of [...this.pellets]) this.removePellet(pellet)
  }

  /** Free any pellet assigned to this cat (used before drag overrides its eat). */
  private unassignCat(cat: CatInstance): void {
    for (const p of this.pellets) {
      if (p.assignedCat === cat) p.assignedCat = null
    }
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
      // --- While holding food, a click drops a pellet (or ends the hold if it
      // lands on the bowl). We record the down position + whether it started on
      // the bowl here; onPointerUp decides click vs drag and acts. ---
      if (this.holdingFood) {
        this.down = true
        this.dragging = false
        this.downX = e.clientX
        this.active = null
        // Reuse bowlActive to remember "this click began on the bowl" so the up
        // handler can end the hold instead of dropping a pellet there.
        this.bowlActive = this.bowl !== null && bowlUnder(e.clientX, e.clientY)
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
          // FD4: grabbing a cat that was going to / eating a pellet frees that
          // pellet so it can be reassigned (startDrag clears the cat's eat state).
          this.unassignCat(this.active)
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
      // --- While holding food: a click drops a pellet; clicking the bowl ends
      // the hold. ---
      // Holding end-condition (chosen): each clean click while holding drops one
      // floor pellet and KEEPS holding (PRD "무한 공급·여러개"), so the user can
      // rapidly drop several. The hold ends only via (a) clicking the bowl again
      // or (b) ESC. onPointerMove returns early while holding, so this.dragging is
      // always false here — there is no drag-to-reposition gesture mid-hold.
      if (this.holdingFood && this.down) {
        const startedOnBowl = this.bowlActive
        // If the click ended on the bowl too, treat it as "put the food back" →
        // end the hold. Otherwise drop a pellet at the cursor x and keep holding.
        if (startedOnBowl && this.bowl && bowlUnder(e.clientX, e.clientY)) {
          this.clearFeeding()
        } else {
          this.dropPellet(e.clientX, e.clientY)
          // Stay in holding mode: refresh the gather pass for the cats that are
          // still begging the (unchanged) cursor position.
          this.updateFoodTargets(e.clientX)
        }
        this.down = false
        this.dragging = false
        this.bowlActive = false
        // Keep capture while still holding so subsequent clicks/moves register.
        setCapture(this.holdingFood ? true : overInteractive(e.clientX, e.clientY))
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
    // Retry assignment for any pellet still waiting for a free cat (a cat may
    // have just finished eating, woken, or been put down). Cheap no-op when no
    // pellet is unassigned. (FD4 re-attempt-each-tick)
    if (this.pellets.some((p) => !p.assignedCat && !p.expiring)) this.assignPellets()
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
