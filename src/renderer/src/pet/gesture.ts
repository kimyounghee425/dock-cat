// ─────────────────────────────────────────────────────────────────────────────
// gesture.ts — the pointer-gesture state machine as a PURE reducer
// (effects-as-data). No DOM, no engine, no `this`, no time/randomness.
//
// `world.ts` keeps a thin impure shell: on each pointer/key event it reads the
// live DOM rects (via geometry.ts), packages the pre-computed hit-test results
// into an Event, calls `reduce`, stores the returned state, and executes the
// returned Effects SYNCHRONOUSLY in order (so click-through capture toggles in
// the same event turn, exactly as the old imperative code did).
//
// The cat reference is generic `<T>` so the reducer never touches CatEngine.
// ─────────────────────────────────────────────────────────────────────────────

import { exceedsDragThreshold } from './geometry'

/**
 * Explicit gesture state — every previously-implicit flag combo, made
 * unrepresentable-if-invalid. `holding` is the food-hold toggle that persists
 * across press/release cycles; `holdingPressed` is holding WITH a press in
 * progress (the up handler decides drop-pellet vs end-hold).
 */
export type GestureState<T> =
  | { kind: 'idle' }
  | { kind: 'catPressed'; cat: T; downX: number }
  | { kind: 'catDragging'; cat: T }
  | { kind: 'bowlPressed'; downX: number; grabDx: number }
  | { kind: 'bowlDragging'; grabDx: number }
  | { kind: 'holding' }
  | { kind: 'holdingPressed'; downX: number; startedOnBowl: boolean }

/** The pre-computed hit-test results the impure layer reads from the DOM. */
export interface DownHit<T> {
  /** Topmost cat under the pointer (cats have priority over the bowl), else null. */
  cat: T | null
  /** Whether the pointer is over the bowl. */
  onBowl: boolean
}

export type GestureEvent<T> =
  | { type: 'POINTER_DOWN'; x: number; y: number; bowlX: number; hit: DownHit<T> }
  | { type: 'POINTER_MOVE'; x: number; y: number; overTrash: boolean; overInteractive: boolean }
  | { type: 'POINTER_UP'; x: number; y: number; onBowl: boolean; overTrash: boolean; overInteractive: boolean }
  | { type: 'ESC' }
  | { type: 'BOWL_REMOVED' }

/**
 * Intent data the impure layer executes. Each maps 1:1 to a side effect the old
 * code performed inline; the executor applies them synchronously, in order.
 */
export type Effect<T> =
  | { type: 'SET_CAPTURE'; on: boolean }
  | { type: 'START_DRAG'; cat: T }
  | { type: 'DRAG_TO'; cat: T; x: number }
  | { type: 'END_DRAG'; cat: T }
  | { type: 'CLICK_CAT'; cat: T }
  | { type: 'REMOVE_CAT'; cat: T }
  | { type: 'START_FEED'; x: number; y: number }
  | { type: 'UPDATE_FEED'; x: number; y: number }
  | { type: 'UPDATE_FOOD_TARGETS'; x: number }
  | { type: 'CLEAR_FEEDING' }
  | { type: 'DROP_PELLET'; x: number; y: number }
  | { type: 'SET_BOWL_X'; x: number }
  | { type: 'PERSIST_BOWL_X' }
  | { type: 'REMOVE_BOWL_CFG' }
  | { type: 'TRASH'; visible?: boolean; hot?: boolean }

export interface ReduceResult<T> {
  state: GestureState<T>
  effects: Effect<T>[]
}

/**
 * Pure transition: given the current gesture state and an event, return the next
 * state plus the ordered effects to execute. Faithfully reproduces world.ts's
 * onPointerDown/Move/Up + ESC + removeBowl, including effect ordering.
 */
export function reduce<T>(state: GestureState<T>, event: GestureEvent<T>): ReduceResult<T> {
  switch (event.type) {
    case 'POINTER_DOWN':
      return onDown(state, event)
    case 'POINTER_MOVE':
      return onMove(state, event)
    case 'POINTER_UP':
      return onUp(state, event)
    case 'ESC':
      return onEsc(state)
    case 'BOWL_REMOVED':
      return onBowlRemoved(state)
  }
}

function onDown<T>(
  state: GestureState<T>,
  e: Extract<GestureEvent<T>, { type: 'POINTER_DOWN' }>
): ReduceResult<T> {
  // While holding food, the press belongs to feeding: record where it began and
  // whether it started on the bowl; the up handler decides drop vs end-hold.
  if (state.kind === 'holding' || state.kind === 'holdingPressed') {
    return {
      state: { kind: 'holdingPressed', downX: e.x, startedOnBowl: e.hit.onBowl },
      effects: []
    }
  }
  // Cats keep priority over the bowl (impure layer already applied this in hit.cat).
  if (e.hit.cat !== null) {
    return { state: { kind: 'catPressed', cat: e.hit.cat, downX: e.x }, effects: [] }
  }
  // Bowl press: undecided drag (reposition) vs click (toggle food-hold).
  if (e.hit.onBowl) {
    return { state: { kind: 'bowlPressed', downX: e.x, grabDx: e.x - e.bowlX }, effects: [] }
  }
  // Empty space: no gesture begins.
  return { state: { kind: 'idle' }, effects: [] }
}

function onMove<T>(
  state: GestureState<T>,
  e: Extract<GestureEvent<T>, { type: 'POINTER_MOVE' }>
): ReduceResult<T> {
  // Holding: pellet tracks the cursor, cats gather, capture stays on. (Checked
  // first — a press in progress while holding still feeds, never drags.)
  if (state.kind === 'holding' || state.kind === 'holdingPressed') {
    return {
      state,
      effects: [
        { type: 'UPDATE_FEED', x: e.x, y: e.y },
        { type: 'SET_CAPTURE', on: true }
      ]
    }
  }

  if (state.kind === 'catPressed') {
    if (exceedsDragThreshold(state.downX, e.x)) {
      // Crossed threshold: begin the drag (START_DRAG frees any pellet + shows
      // trash), then immediately track + capture + trash-hot this same frame.
      return {
        state: { kind: 'catDragging', cat: state.cat },
        effects: [
          { type: 'START_DRAG', cat: state.cat },
          { type: 'DRAG_TO', cat: state.cat, x: e.x },
          { type: 'SET_CAPTURE', on: true },
          { type: 'TRASH', hot: e.overTrash }
        ]
      }
    }
    return { state, effects: [] } // not yet a drag
  }

  if (state.kind === 'catDragging') {
    return {
      state,
      effects: [
        { type: 'DRAG_TO', cat: state.cat, x: e.x },
        { type: 'SET_CAPTURE', on: true },
        { type: 'TRASH', hot: e.overTrash }
      ]
    }
  }

  if (state.kind === 'bowlPressed') {
    if (exceedsDragThreshold(state.downX, e.x)) {
      // Crossed threshold: reposition gesture. Show trash, then move + capture +
      // trash-hot this same frame. (SET_BOWL_X carries the raw target; the impure
      // layer clamps to the screen since that needs window width.)
      return {
        state: { kind: 'bowlDragging', grabDx: state.grabDx },
        effects: [
          { type: 'TRASH', visible: true },
          { type: 'SET_BOWL_X', x: e.x - state.grabDx },
          { type: 'SET_CAPTURE', on: true },
          { type: 'TRASH', hot: e.overTrash }
        ]
      }
    }
    return { state, effects: [] } // not yet a drag
  }

  if (state.kind === 'bowlDragging') {
    return {
      state,
      effects: [
        { type: 'SET_BOWL_X', x: e.x - state.grabDx },
        { type: 'SET_CAPTURE', on: true },
        { type: 'TRASH', hot: e.overTrash }
      ]
    }
  }

  // idle: just keep capture in sync with whether we're over something interactive.
  return { state, effects: [{ type: 'SET_CAPTURE', on: e.overInteractive }] }
}

function onUp<T>(
  state: GestureState<T>,
  e: Extract<GestureEvent<T>, { type: 'POINTER_UP' }>
): ReduceResult<T> {
  // Holding + a press in progress: clicking the bowl (where the press began) ends
  // the hold; any other click drops a pellet and KEEPS holding.
  if (state.kind === 'holdingPressed') {
    const endHold = state.startedOnBowl && e.onBowl
    if (endHold) {
      // Hold ends → capture follows whether we're still over something.
      return {
        state: { kind: 'idle' },
        effects: [
          { type: 'CLEAR_FEEDING' },
          { type: 'SET_CAPTURE', on: e.overInteractive }
        ]
      }
    }
    // Drop a pellet, refresh the gather pass, stay holding (capture stays on).
    return {
      state: { kind: 'holding' },
      effects: [
        { type: 'DROP_PELLET', x: e.x, y: e.y },
        { type: 'UPDATE_FOOD_TARGETS', x: e.x },
        { type: 'SET_CAPTURE', on: true }
      ]
    }
  }

  if (state.kind === 'catPressed') {
    // No drag → a plain click. Then capture follows over-interactive (tail).
    return {
      state: { kind: 'idle' },
      effects: [
        { type: 'CLICK_CAT', cat: state.cat },
        { type: 'SET_CAPTURE', on: e.overInteractive }
      ]
    }
  }

  if (state.kind === 'catDragging') {
    const drop: Effect<T> = e.overTrash
      ? { type: 'REMOVE_CAT', cat: state.cat }
      : { type: 'END_DRAG', cat: state.cat }
    return {
      state: { kind: 'idle' },
      effects: [
        drop,
        { type: 'TRASH', visible: false, hot: false },
        { type: 'SET_CAPTURE', on: e.overInteractive }
      ]
    }
  }

  if (state.kind === 'bowlPressed') {
    // Clean click on the bowl (no drag) → toggle food-hold ON. holdingFood is now
    // true, so the old code's tail `if (!holdingFood) setCapture` is skipped.
    return {
      state: { kind: 'holding' },
      effects: [
        { type: 'START_FEED', x: e.x, y: e.y },
        { type: 'SET_CAPTURE', on: true }
      ]
    }
  }

  if (state.kind === 'bowlDragging') {
    // Drag ended: trash it or persist its new position, then clear trash + capture.
    const drop: Effect<T> = e.overTrash ? { type: 'REMOVE_BOWL_CFG' } : { type: 'PERSIST_BOWL_X' }
    return {
      state: { kind: 'idle' },
      effects: [
        drop,
        { type: 'TRASH', visible: false, hot: false },
        { type: 'SET_CAPTURE', on: e.overInteractive }
      ]
    }
  }

  // idle / holding (no press): the old up handler's tail still synced capture.
  if (state.kind === 'holding') {
    // Holding without a tracked press: keep capture on (old tail skips when holding).
    return { state, effects: [] }
  }
  return { state: { kind: 'idle' }, effects: [{ type: 'SET_CAPTURE', on: e.overInteractive }] }
}

function onEsc<T>(state: GestureState<T>): ReduceResult<T> {
  // ESC only acts while holding food; it clears feeding and unconditionally drops
  // capture (a keydown gives no cursor position; the next move restores it).
  if (state.kind === 'holding' || state.kind === 'holdingPressed') {
    return {
      state: { kind: 'idle' },
      effects: [
        { type: 'CLEAR_FEEDING' },
        { type: 'SET_CAPTURE', on: false }
      ]
    }
  }
  return { state, effects: [] }
}

function onBowlRemoved<T>(state: GestureState<T>): ReduceResult<T> {
  // The bowl vanished mid-gesture (e.g. a config echo). Cancel any bowl-drag or
  // food-hold so flags/trash/capture don't get stuck; a cat drag is unaffected.
  const bowlActive = state.kind === 'bowlPressed' || state.kind === 'bowlDragging'
  const holding = state.kind === 'holding' || state.kind === 'holdingPressed'
  if (!bowlActive && !holding) return { state, effects: [] }

  const effects: Effect<T>[] = []
  if (bowlActive) effects.push({ type: 'TRASH', visible: false, hot: false })
  if (holding) effects.push({ type: 'CLEAR_FEEDING' })
  effects.push({ type: 'SET_CAPTURE', on: false }) // wasActive → drop capture last
  return { state: { kind: 'idle' }, effects }
}
