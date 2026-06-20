import type { CatColor, CatCounts, PetDefinition } from './types'
import { CatEngine } from './engine'
import { PetView } from './view'
import { clampX, pickTopmost, pointInRect } from './geometry'
import { assignNearestFree, computeGather } from './feeding-logic'
import { reduce, type Effect, type GestureState } from './gesture'
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

  /** Whether we're currently capturing the pointer (click-through OFF). */
  private capturing = false
  /**
   * The pointer-gesture state, owned by the pure reducer in gesture.ts. All
   * decision logic (drag-vs-click, bowl drag-vs-pick, food-hold toggle, ESC,
   * bowl-removed) lives there; this class only reads live rects, dispatches
   * events, and executes the returned effects. The `holding`/`holdingPressed`
   * variants are the food-hold toggle that persists across press/release cycles.
   */
  private gesture: GestureState<CatInstance> = { kind: 'idle' }
  /** Cursor-attached pellet element shown while holding food. */
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

    // ESC registered once here; the reducer no-ops when not holding food. We
    // don't know the cursor position from a keydown, so the reducer drops capture
    // unconditionally; the next pointermove restores it if over a pet or bowl.
    this.onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      this.dispatch({ type: 'ESC' })
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
      // Cancel any in-flight bowl gesture / food-hold (a config echo can fire
      // mid-gesture), then tear down the element.
      this.dispatch({ type: 'BOWL_REMOVED' })
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

  /**
   * DOM/config teardown of the bowl element only. Cancelling any in-flight bowl
   * gesture / food-hold (trash, capture, feeding) is handled by the gesture
   * reducer via the BOWL_REMOVED event — dispatched by external removal triggers
   * (setBowl(false)) so a config echo mid-gesture doesn't leave flags stuck.
   */
  private removeBowl(): void {
    if (!this.bowl) return
    this.bowl.remove()
    this.bowl = null
  }

  private clampBowlX = (x: number): number => clampX(x, 0, window.innerWidth - BOWL_SIZE)

  /**
   * Toggle food-hold ON: create the cursor-attached pellet at the click point,
   * mark holdingFood, and do the first gather pass. Called on a clean bowl click
   * (pointerup with no drag). The pellet then follows on every pointermove via
   * updateFeed().
   */
  private startFeed(x: number, y: number): void {
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
    const spacing = this.def.displaySize * 0.7
    // Pure core decides membership (free + within FOOD_RADIUS of the cursor) and
    // the fan-out target x for each gatherer; sprite CENTER x is the convention.
    const targets = computeGather(
      this.cats.map((c) => ({ x: c.engine.x + center, free: c.engine.isFreeToEat() })),
      cursorX,
      FOOD_RADIUS,
      spacing
    )
    // Release everyone who isn't gathering, then send each gatherer to its spot.
    const gathering = new Set(targets.map((t) => t.index))
    this.cats.forEach((c, i) => {
      if (!gathering.has(i)) c.engine.setFoodTarget(null)
    })
    for (const t of targets) this.cats[t.index].engine.setFoodTarget(t.targetX)
  }

  /**
   * End the food-hold toggle: remove the cursor pellet, release every cat, tear
   * down the ESC listener, and release capture (unless something else still
   * needs it — the caller is responsible for re-evaluating setCapture after
   * this if needed).
   */
  private clearFeeding(): void {
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
    const center = this.def.displaySize / 2
    // Pure core does the nearest-free-cat pass with an incremental taken-set
    // (no double-assignment, deterministic tie-break), over plain {x, free} /
    // {x, assignedCatIndex, expiring} data. Sprite CENTER x is the convention.
    const assignments = assignNearestFree(
      this.cats.map((c) => ({ x: c.engine.x + center, free: c.engine.isFreeToEat() })),
      this.pellets.map((p) => ({
        x: p.x,
        assignedCatIndex: p.assignedCat ? this.cats.indexOf(p.assignedCat) : null,
        expiring: p.expiring
      }))
    )
    for (const { pelletIndex, catIndex } of assignments) {
      const pellet = this.pellets[pelletIndex]
      const cat = this.cats[catIndex]
      pellet.assignedCat = cat
      // On eat completion: remove the pellet (also frees the cat ref). The engine
      // resets itself to autonomous before firing this.
      cat.engine.goEat(pellet.x, () => this.removePellet(pellet))
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

  // ── pointer hit-testing (live DOM rect reads at call time, never cached) ────
  /** Topmost cat under the point (last-drawn wins), preserving cat priority. */
  private catUnder(cx: number, cy: number): CatInstance | null {
    return pickTopmost(
      this.cats.map((c) => ({ rect: c.view.getHitRect(), ref: c })),
      { x: cx, y: cy }
    )
  }
  private overTrash(cx: number, cy: number): boolean {
    return pointInRect({ x: cx, y: cy }, this.trash.getBoundingClientRect())
  }
  private bowlUnder(cx: number, cy: number): boolean {
    return this.bowl !== null && pointInRect({ x: cx, y: cy }, this.bowl.getBoundingClientRect())
  }
  /** Whether the cursor is over any interactive object (cat or bowl). */
  private overInteractive(cx: number, cy: number): boolean {
    return this.catUnder(cx, cy) !== null || this.bowlUnder(cx, cy)
  }

  private bindPointer(): {
    onPointerDown: (e: PointerEvent) => void
    onPointerMove: (e: PointerEvent) => void
    onPointerUp: (e: PointerEvent) => void
  } {
    // Each handler reads the live rects, builds an event with the pre-computed
    // hit-test results, and dispatches it through the pure reducer. The reducer
    // owns ALL gesture decisions; dispatch() executes the returned effects.
    const onPointerDown = (e: PointerEvent): void => {
      this.dispatch({
        type: 'POINTER_DOWN',
        x: e.clientX,
        y: e.clientY,
        bowlX: this.bowlX,
        hit: { cat: this.catUnder(e.clientX, e.clientY), onBowl: this.bowlUnder(e.clientX, e.clientY) }
      })
    }
    const onPointerMove = (e: PointerEvent): void => {
      this.dispatch({
        type: 'POINTER_MOVE',
        x: e.clientX,
        y: e.clientY,
        overTrash: this.overTrash(e.clientX, e.clientY),
        overInteractive: this.overInteractive(e.clientX, e.clientY)
      })
    }
    const onPointerUp = (e: PointerEvent): void => {
      this.dispatch({
        type: 'POINTER_UP',
        x: e.clientX,
        y: e.clientY,
        onBowl: this.bowlUnder(e.clientX, e.clientY),
        overTrash: this.overTrash(e.clientX, e.clientY),
        overInteractive: this.overInteractive(e.clientX, e.clientY)
      })
    }
    return { onPointerDown, onPointerMove, onPointerUp }
  }

  /**
   * Feed an event through the pure gesture reducer, store the next state, and
   * execute the returned effects SYNCHRONOUSLY in order — so click-through
   * capture toggles within the same event turn, exactly as the old code did.
   */
  private dispatch(event: Parameters<typeof reduce<CatInstance>>[1]): void {
    const { state, effects } = reduce(this.gesture, event)
    this.gesture = state
    for (const effect of effects) this.runEffect(effect)
  }

  /** Execute one gesture effect against the DOM / engine / IO (impure). */
  private runEffect(effect: Effect<CatInstance>): void {
    switch (effect.type) {
      case 'SET_CAPTURE':
        // Idempotent: only flips click-through when the value actually changes.
        if (effect.on !== this.capturing) {
          this.capturing = effect.on
          window.petApi.setIgnoreMouseEvents(!effect.on)
        }
        break
      case 'START_DRAG':
        // FD4: grabbing a cat that was going to / eating a pellet frees that
        // pellet so it can be reassigned (startDrag clears the cat's eat state).
        this.unassignCat(effect.cat)
        effect.cat.engine.startDrag()
        this.trash.classList.add('visible')
        break
      case 'DRAG_TO':
        effect.cat.engine.dragTo(effect.x - this.def.displaySize / 2)
        break
      case 'END_DRAG':
        effect.cat.engine.endDrag()
        break
      case 'CLICK_CAT':
        effect.cat.engine.click()
        break
      case 'REMOVE_CAT':
        this.removeCat(effect.cat)
        this.onDeleteCb?.()
        break
      case 'START_FEED':
        this.startFeed(effect.x, effect.y)
        break
      case 'UPDATE_FEED':
        this.updateFeed(effect.x, effect.y)
        break
      case 'UPDATE_FOOD_TARGETS':
        this.updateFoodTargets(effect.x)
        break
      case 'CLEAR_FEEDING':
        this.clearFeeding()
        break
      case 'DROP_PELLET':
        this.dropPellet(effect.x, effect.y)
        break
      case 'SET_BOWL_X':
        if (this.bowl) {
          this.bowlX = this.clampBowlX(effect.x)
          this.bowl.style.left = `${this.bowlX}px`
        }
        break
      case 'PERSIST_BOWL_X':
        if (this.bowl) this.onBowlMoveCb?.(this.bowlX)
        break
      case 'REMOVE_BOWL_CFG':
        if (this.bowl) {
          this.removeBowl()
          this.onBowlRemoveCb?.()
        }
        break
      case 'TRASH':
        if (effect.visible !== undefined) this.trash.classList.toggle('visible', effect.visible)
        if (effect.hot !== undefined) this.trash.classList.toggle('hot', effect.hot)
        break
    }
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
