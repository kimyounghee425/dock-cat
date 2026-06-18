import { setup, assign, type ActorRefFrom } from 'xstate'
import type { Facing, PetDefinition } from './types'

// ─────────────────────────────────────────────────────────────────────────────
// catMachine — the cat behaviour FSM, ported 1:1 from the imperative CatEngine.
//
// Statechart (design §4.3):
//   awake{ posing, walking, airborne, decide }
//   asleep
//   dragging
//   feeding{ hopping, begging }
//   eating{ traveling, chewing }
//
// Continuous physics is driven by TICK{dt} (design D1 — no `after`), context is
// updated only via `assign` (D6), behaviour policy lives in PURE helpers below
// that take a snapshot of context and return a partial patch (no mutation).
// The cleanup of the eat callback follows the pendingAfterTransition drain
// pattern (D4): exit never clears onEatenCb; completion captures it into the
// queue, the facade drains + fires it after the transition settles.
// ─────────────────────────────────────────────────────────────────────────────

/** Stop hopping once this close to the food target (px). Prevents jitter. */
const FEED_STOP_THRESHOLD = 30
/** How far each feeding hop advances toward the target (px). */
const FEED_HOP_STEP = 70
/**
 * When going to eat a dropped floor pellet, "essentially on top" means within
 * this many px of the pellet x — close enough to eat front-facing rather than
 * leaning left/right. (FD7)
 */
const EAT_ONTOP_THRESHOLD = 20

interface Act {
  key: string
  dur: number
  moving: boolean
  speed: number
}

interface Jump {
  active: boolean
  t: number
  dur: number
  fromX: number
  dx: number
}

const NO_JUMP: Jump = { active: false, t: 0, dur: 0, fromX: 0, dx: 0 }

export interface CatContext {
  def: PetDefinition
  getMaxX: () => number
  rng: () => number

  x: number
  y: number
  animKey: string
  facing: Facing

  moving: boolean
  speed: number
  remaining: number
  inactivity: number
  sleepAfter: number
  noWake: boolean
  sleepDrag: boolean
  lastMoving: boolean
  queue: Act[]

  jump: Jump

  foodTargetX: number | null

  eatTargetX: number | null
  eatRemaining: number
  onEatenCb: (() => void) | null

  /** Drained + fired by the facade after each send (D4). */
  pendingAfterTransition: Array<() => void>
}

export interface CatInput {
  def: PetDefinition
  startX: number
  getMaxX: () => number
  sleepAfter: number
  rng?: () => number
}

export type CatEvent =
  | { type: 'TICK'; dt: number }
  | { type: 'CLICK' }
  | { type: 'DRAG_START' }
  | { type: 'DRAG_MOVE'; x: number }
  | { type: 'DRAG_END' }
  | { type: 'SLEEP_NOW' }
  | { type: 'WAKE_NOW' }
  | { type: 'SET_FOOD_TARGET'; x: number | null }
  | { type: 'GO_EAT'; x: number; onEaten: () => void }
  | { type: 'CANCEL_EAT' }
  | { type: 'SET_SLEEP_AFTER'; sec: number }
  | { type: 'SET_NO_WAKE'; on: boolean }
  | { type: 'CLEAR_PENDING_CALLBACKS' }

// ── pure helpers ─────────────────────────────────────────────────────────────
// Each takes a read-only context view and returns a partial patch. They MAY call
// ctx.rng() (the shared seeded closure) — the ORDER of those calls must match the
// old engine exactly, or golden-master parity breaks.

const playLen = (def: PetDefinition, k: string): number => def.anim[k].frames / def.anim[k].fps

const rand = (rng: () => number, min: number, max: number): number => min + rng() * (max - min)
// Relies on rng() returning a value in [0, 1) so floor(rng()*len) ∈ [0, len-1].
const pick = <T>(rng: () => number, arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)]

/** apply(): mirror of CatEngine.apply — set the current pose from an Act. */
function apply(a: Act): Partial<CatContext> {
  return { animKey: a.key, moving: a.moving, speed: a.speed, remaining: a.dur, lastMoving: a.moving }
}

/** startWalk(): pick (maybe flip) facing + a walk Act. */
function startWalk(ctx: CatContext): Partial<CatContext> {
  let facing = ctx.facing
  if (ctx.rng() < 0.5) facing = facing === 'left' ? 'right' : 'left'
  return {
    facing,
    ...apply({ key: `walk_${facing}`, dur: rand(ctx.rng, 1.5, 3.5), moving: true, speed: ctx.def.walkSpeed })
  }
}

/** startIdle(): pick a calm pose (optionally led by a one-shot punctuation). */
function startIdle(ctx: CatContext): Partial<CatContext> {
  const { def, rng, facing } = ctx
  const calm: string =
    rng() < 0.5 ? pick(rng, def.calmFront) : `${pick(rng, def.calmDir)}_${facing}`
  // Licking looks odd if held too long — keep it brief; other calm poses linger.
  const dur = calm.startsWith('lick') ? rand(rng, 3, 5) : rand(rng, 10, 18)

  // Occasionally lead with a brief one-shot (yawn/meow/stretch), then settle.
  if (rng() < 0.25) {
    const p = pick(rng, def.punctuation)
    return {
      queue: [{ key: calm, dur, moving: false, speed: 0 }],
      ...apply({ key: p, dur: playLen(def, p), moving: false, speed: 0 })
    }
  }
  return apply({ key: calm, dur, moving: false, speed: 0 })
}

/** autonomous(): calm bias — only stroll occasionally, never twice in a row. */
function autonomous(ctx: CatContext): Partial<CatContext> {
  if (!ctx.lastMoving && ctx.rng() < 0.25) return startWalk(ctx)
  return startIdle(ctx)
}

/** advance(): pop the queue (apply next), else go autonomous. */
function advance(ctx: CatContext): Partial<CatContext> {
  if (ctx.queue.length > 0) {
    const [next, ...rest] = ctx.queue
    return { queue: rest, ...apply(next) }
  }
  return autonomous(ctx)
}

/**
 * feedStep(): one feeding decision — hop toward the food, or settle into begging.
 * Returns a patch describing the chosen pose; clamped so hops never overshoot.
 */
function feedStep(ctx: CatContext): Partial<CatContext> {
  if (ctx.foodTargetX === null) return {}
  const max = ctx.getMaxX()
  const center = ctx.def.displaySize / 2
  const target = Math.max(0, Math.min(max, ctx.foodTargetX - center))
  const dx = target - ctx.x
  const dist = Math.abs(dx)

  if (dist <= FEED_STOP_THRESHOLD) {
    // Close enough: stand on hind legs and beg, facing the food. Only flip when
    // dx is clearly nonzero — keep current facing when directly above (dx === 0).
    let facing = ctx.facing
    if (dx > 0) facing = 'right'
    else if (dx < 0) facing = 'left'
    return {
      facing,
      jump: NO_JUMP,
      y: 0,
      animKey: 'on_hind',
      remaining: 0.2
    }
  }

  const dir: Facing = dx >= 0 ? 'right' : 'left'
  const step = Math.min(FEED_HOP_STEP, dist)
  const targetX = Math.max(0, Math.min(max, ctx.x + step * (dir === 'right' ? 1 : -1)))
  return {
    facing: dir,
    jump: { active: true, t: 0, dur: ctx.def.jumpDur, fromX: ctx.x, dx: targetX - ctx.x },
    animKey: `jump_${dir}`
  }
}

/**
 * eatStep(): one eating decision — hop toward the pellet, or face it and start
 * the one-shot eat animation. Returns a patch (may set eatRemaining to begin).
 */
function eatStep(ctx: CatContext): Partial<CatContext> {
  if (ctx.eatTargetX === null) return {}
  const max = ctx.getMaxX()
  const center = ctx.def.displaySize / 2
  const target = Math.max(0, Math.min(max, ctx.eatTargetX - center))
  const dx = target - ctx.x
  const dist = Math.abs(dx)

  if (dist <= FEED_STOP_THRESHOLD) {
    const pelletDx = ctx.eatTargetX - (ctx.x + center)
    let facing = ctx.facing
    let eatKey: string
    if (Math.abs(pelletDx) <= EAT_ONTOP_THRESHOLD) {
      eatKey = 'eat_front'
    } else if (pelletDx > 0) {
      facing = 'right'
      eatKey = 'eat_right'
    } else {
      facing = 'left'
      eatKey = 'eat_left'
    }
    return {
      facing,
      jump: NO_JUMP,
      y: 0,
      animKey: eatKey,
      eatRemaining: playLen(ctx.def, eatKey)
    }
  }

  const dir: Facing = dx >= 0 ? 'right' : 'left'
  const step = Math.min(FEED_HOP_STEP, dist)
  const targetX = Math.max(0, Math.min(max, ctx.x + step * (dir === 'right' ? 1 : -1)))
  return {
    facing: dir,
    jump: { active: true, t: 0, dur: ctx.def.jumpDur, fromX: ctx.x, dx: targetX - ctx.x },
    animKey: `jump_${dir}`
  }
}

/**
 * fallAsleep(): pick a sleep pose by facing. Mirrors the old engine's sleepNow()
 * which clears jumpActive/y for ALL modes before sleeping (engine.ts:122-124),
 * so a cat that falls asleep mid-leap doesn't stay frozen aloft with a stale arc.
 */
function fallAsleep(ctx: CatContext): Partial<CatContext> {
  return {
    moving: false,
    queue: [],
    jump: NO_JUMP,
    y: 0,
    animKey: `${pick(ctx.rng, ctx.def.sleepStyles)}_${ctx.facing}`
  }
}

/** Integrate one frame of the jump arc; returns the new {x,y} + whether it ended. */
function tickArc(ctx: CatContext, dt: number): { x: number; y: number; t: number; ended: boolean } {
  const t = Math.min(1, (ctx.jump.t + dt) / ctx.jump.dur)
  const x = Math.max(0, Math.min(ctx.getMaxX(), ctx.jump.fromX + ctx.jump.dx * t))
  const y = ctx.def.jumpHeight * Math.sin(Math.PI * t)
  return { x, y, t, ended: t >= 1 }
}

// ── machine ──────────────────────────────────────────────────────────────────

export const catMachine = setup({
  types: {
    context: {} as CatContext,
    events: {} as CatEvent,
    input: {} as CatInput
  },
  actions: {
    /** awake TICK: integrate inactivity, walk/jump physics, and pose timers. */
    awakeTick: assign(({ context, event }) => {
      if (event.type !== 'TICK') return {}
      const dt = event.dt
      const inactivity = context.inactivity + dt

      // Mid-leap: integrate the arc, then count the pose timer (queued panic run).
      if (context.jump.active) {
        const arc = tickArc(context, dt)
        const ctx2: CatContext = {
          ...context,
          inactivity,
          x: arc.x,
          y: arc.ended ? 0 : arc.y,
          jump: arc.ended ? NO_JUMP : { ...context.jump, t: context.jump.t + dt },
          remaining: context.remaining - dt
        }
        // advance() picks the next pose (animKey/remaining/…); it must win over
        // the integrated fields, so spread it LAST.
        if (ctx2.remaining <= 0)
          return { inactivity, x: ctx2.x, y: ctx2.y, jump: ctx2.jump, ...advance(ctx2) }
        return { inactivity, x: ctx2.x, y: ctx2.y, jump: ctx2.jump, remaining: ctx2.remaining }
      }

      // Walking: integrate x with edge-turn.
      let x = context.x
      let facing = context.facing
      let animKey = context.animKey
      if (context.moving) {
        const dir = context.facing === 'right' ? 1 : -1
        x = context.x + context.speed * dir * dt
        const max = context.getMaxX()
        if (x <= 0) {
          x = 0
          facing = 'right'
          const base = animKey.startsWith('run') ? 'run' : 'walk'
          animKey = `${base}_right`
        } else if (x >= max) {
          x = max
          facing = 'left'
          const base = animKey.startsWith('run') ? 'run' : 'walk'
          animKey = `${base}_left`
        }
      }

      const remaining = context.remaining - dt
      const ctx2: CatContext = { ...context, inactivity, x, facing, animKey, remaining }
      // advance() picks the next pose; spread it LAST so it wins over edge-turn.
      if (remaining <= 0) return { inactivity, x, facing, ...advance(ctx2) }
      return { inactivity, x, facing, animKey, remaining }
    }),

    /** feeding.hopping mid-arc: integrate the jump parabola one frame. */
    feedArcIntegrate: assign(({ context, event }) => {
      if (event.type !== 'TICK') return {}
      const arc = tickArc(context, event.dt)
      return { x: arc.x, y: arc.y, jump: { ...context.jump, t: context.jump.t + event.dt } }
    }),

    /** feeding hop landed: settle at the arc's end and run the next feedStep. */
    feedLandAndStep: assign(({ context, event }) => {
      if (event.type !== 'TICK') return {}
      const arc = tickArc(context, event.dt)
      const landed: CatContext = { ...context, x: arc.x, y: 0, jump: NO_JUMP }
      return { x: arc.x, y: 0, jump: NO_JUMP, ...feedStep(landed) }
    }),

    /** feeding.begging re-check tick: decrement the 0.2s timer (no decision). */
    begWait: assign(({ context, event }) => ({
      remaining: context.remaining - (event.type === 'TICK' ? event.dt : 0)
    })),

    /** feeding.begging timer expired: re-run feedStep (re-beg or start a hop). */
    begStep: assign(({ context, event }) => {
      const remaining = context.remaining - (event.type === 'TICK' ? event.dt : 0)
      return { remaining, ...feedStep({ ...context, remaining }) }
    }),

    /** eating.traveling mid-arc: integrate the jump parabola one frame. */
    eatArcIntegrate: assign(({ context, event }) => {
      if (event.type !== 'TICK') return {}
      const arc = tickArc(context, event.dt)
      return { x: arc.x, y: arc.y, jump: { ...context.jump, t: context.jump.t + event.dt } }
    }),

    /** eating hop landed: settle at the arc's end and run the next eatStep. */
    eatLandAndStep: assign(({ context, event }) => {
      if (event.type !== 'TICK') return {}
      const arc = tickArc(context, event.dt)
      const landed: CatContext = { ...context, x: arc.x, y: 0, jump: NO_JUMP }
      return { x: arc.x, y: 0, jump: NO_JUMP, ...eatStep(landed) }
    }),

    /** eating.chewing tick: count down the one-shot eat animation. */
    chewCountdown: assign({
      eatRemaining: ({ context, event }) =>
        context.eatRemaining - (event.type === 'TICK' ? event.dt : 0)
    }),

    /**
     * Capture onEatenCb into the deferred queue, then clear eat ctx (D4 normal
     * completion). The facade drains pendingAfterTransition after the transition.
     */
    completeEat: assign(({ context }) => {
      const cb = context.onEatenCb
      return {
        eatTargetX: null,
        onEatenCb: null,
        eatRemaining: 0,
        jump: NO_JUMP,
        y: 0,
        pendingAfterTransition: cb
          ? [...context.pendingAfterTransition, cb]
          : context.pendingAfterTransition
      }
    }),

    /** Abnormal eat exit (drag/sleep/cancel): drop the callback, do NOT fire it. */
    abortEat: assign({
      eatTargetX: null,
      onEatenCb: null,
      eatRemaining: 0
    }),

    enterAwakeIdle: assign(({ context }) => ({ inactivity: 0, ...startIdle(context) })),

    fallAsleepAction: assign(({ context }) => fallAsleep(context))
  },
  guards: {
    // Old engine increments inactivity by dt FIRST, then checks the threshold,
    // so the sleep fires on the tick the threshold is crossed (not one later).
    isInactiveEnough: ({ context, event }) =>
      event.type === 'TICK' && context.inactivity + event.dt >= context.sleepAfter,
    canWake: ({ context }) => !context.noWake,
    wasSleepDrag: ({ context }) => context.sleepDrag,

    // ── feeding/eating substate decision guards (pure geometry, no rng) ───────
    /** Hopping: the current jump arc finishes on this tick. */
    feedArcEnding: ({ context, event }) =>
      event.type === 'TICK' &&
      context.jump.active &&
      (context.jump.t + event.dt) / context.jump.dur >= 1,
    /** Begging: the 0.2s re-check timer expires on this tick. */
    feedBegExpires: ({ context, event }) =>
      event.type === 'TICK' && context.remaining - event.dt <= 0,

    /** Traveling: the current jump arc finishes on this tick. */
    eatArcEnding: ({ context, event }) =>
      event.type === 'TICK' &&
      context.jump.active &&
      (context.jump.t + event.dt) / context.jump.dur >= 1,
    /** Chewing: the one-shot eat animation completes on this tick. */
    chewDone: ({ context, event }) =>
      event.type === 'TICK' && context.eatRemaining > 0 && context.eatRemaining - event.dt <= 0
  }
}).createMachine({
  id: 'cat',
  context: ({ input }) => ({
    def: input.def,
    getMaxX: input.getMaxX,
    rng: input.rng ?? Math.random,
    x: input.startX,
    y: 0,
    animKey: 'tailwag_sit_front',
    facing: 'left',
    moving: false,
    speed: 0,
    remaining: 0,
    inactivity: 0,
    sleepAfter: input.sleepAfter,
    noWake: false,
    sleepDrag: false,
    lastMoving: false,
    queue: [],
    jump: NO_JUMP,
    foodTargetX: null,
    eatTargetX: null,
    eatRemaining: 0,
    onEatenCb: null,
    pendingAfterTransition: []
  }),
  // Pick the initial calm pose exactly as the old constructor did (startIdle()).
  entry: assign(({ context }) => startIdle(context)),
  initial: 'awake',
  on: {
    // Default (non-awake states): update sleepAfter only. The `awake` state
    // overrides this to ALSO reset inactivity — matching the old engine, which
    // zeroes inactivity only when `mode === 'awake'`. No snapshot reads here:
    // the current state's own handler decides, which IS the current truth.
    SET_SLEEP_AFTER: {
      actions: assign({
        sleepAfter: ({ context, event }) =>
          event.type === 'SET_SLEEP_AFTER' ? event.sec : context.sleepAfter
      })
    },
    SET_NO_WAKE: {
      actions: assign({
        noWake: ({ event }) => (event.type === 'SET_NO_WAKE' ? event.on : false)
      })
    },
    CLEAR_PENDING_CALLBACKS: {
      actions: assign({ pendingAfterTransition: [] })
    }
  },
  states: {
    awake: {
      on: {
        // Awake overrides the root handler: setting sleepAfter also resets the
        // inactivity timer (old setSleepAfter() zeroes it only when mode==awake).
        SET_SLEEP_AFTER: {
          actions: assign({
            sleepAfter: ({ context, event }) =>
              event.type === 'SET_SLEEP_AFTER' ? event.sec : context.sleepAfter,
            inactivity: 0
          })
        },
        TICK: [
          { guard: 'isInactiveEnough', target: 'asleep', actions: 'fallAsleepAction' },
          { actions: 'awakeTick' }
        ],
        CLICK: {
          actions: assign(({ context }) => ({
            inactivity: 0,
            moving: false,
            queue: [],
            animKey: 'meow_sit',
            remaining: 1.0,
            facing: context.facing
          }))
        },
        DRAG_START: { target: 'dragging', actions: assign({ sleepDrag: false }) },
        SLEEP_NOW: { target: 'asleep', actions: 'fallAsleepAction' },
        SET_FOOD_TARGET: [
          { guard: ({ event }) => event.type === 'SET_FOOD_TARGET' && event.x !== null, target: 'feeding' }
          // SET_FOOD_TARGET(null) in awake is a no-op.
        ],
        GO_EAT: { target: 'eating' }
      }
    },

    asleep: {
      // TICK is a no-op while asleep — the old engine returns early when not
      // awake, so x/y/animKey/inactivity all stay frozen until woken.
      on: {
        TICK: {},
        CLICK: {
          guard: 'canWake',
          target: 'awake',
          actions: assign(({ context }) => ({
            inactivity: 0,
            moving: false,
            queue: [],
            animKey: `hiss_${context.facing}`,
            remaining: 1.0
          }))
        },
        WAKE_NOW: { target: 'awake', actions: 'enterAwakeIdle' },
        // Dragging an asleep cat while "don't wake" is on carries it without
        // waking (sleepDrag), keeping the sleep pose (old startDrag).
        DRAG_START: {
          target: 'dragging',
          actions: assign({ sleepDrag: ({ context }) => context.noWake })
        }
        // SET_FOOD_TARGET / GO_EAT ignored while asleep.
      }
    },

    dragging: {
      entry: assign(({ context }) => {
        // "don't wake" + already asleep → carry without waking (keep sleep pose).
        const sleepDrag = context.sleepDrag
        return {
          inactivity: 0,
          moving: false,
          queue: [],
          foodTargetX: null,
          eatTargetX: null,
          onEatenCb: null,
          eatRemaining: 0,
          jump: NO_JUMP,
          y: 0,
          animKey: sleepDrag ? context.animKey : 'run_up'
        }
      }),
      on: {
        DRAG_MOVE: {
          actions: assign(({ context, event }) => ({
            x:
              event.type === 'DRAG_MOVE'
                ? Math.max(0, Math.min(context.getMaxX(), event.x))
                : context.x,
            inactivity: 0
          }))
        },
        DRAG_END: [
          {
            guard: 'wasSleepDrag',
            target: 'asleep',
            actions: assign({ inactivity: 0, sleepDrag: false, y: 0 })
          },
          {
            target: 'awake',
            // Startled: arcing leap sideways, then bolt away (panic run queue).
            actions: assign(({ context }) => {
              const facing: Facing = context.rng() < 0.5 ? 'left' : 'right'
              const dir = facing === 'right' ? 1 : -1
              return {
                inactivity: 0,
                facing,
                queue: [
                  {
                    key: `run_${facing}`,
                    dur: rand(context.rng, 1.2, 2.2),
                    moving: true,
                    speed: context.def.runSpeed
                  }
                ],
                jump: {
                  active: true,
                  t: 0,
                  dur: context.def.jumpDur,
                  fromX: context.x,
                  dx: context.def.jumpDistance * dir
                },
                moving: false,
                animKey: `jump_${facing}`,
                remaining: context.def.jumpDur
              }
            })
          }
        ]
      }
    },

    feeding: {
      // Leaving feeding (any path) clears the gather state (design §4.3 exit).
      exit: assign({ foodTargetX: null, jump: NO_JUMP, y: 0, moving: false, queue: [] }),
      initial: 'hopping',
      // Entry decides the first hop/beg, matching setFoodTarget()'s feedStep().
      entry: assign(({ context, event }) => {
        const foodTargetX = event.type === 'SET_FOOD_TARGET' ? event.x : context.foodTargetX
        const seeded: CatContext = {
          ...context,
          foodTargetX,
          moving: false,
          queue: [],
          jump: NO_JUMP,
          y: 0
        }
        return { foodTargetX, moving: false, queue: [], jump: NO_JUMP, y: 0, ...feedStep(seeded) }
      }),
      on: {
        SET_FOOD_TARGET: [
          {
            // null → leave feeding (exit action clears state) back to awake.
            guard: ({ event }) => event.type === 'SET_FOOD_TARGET' && event.x === null,
            target: 'awake',
            actions: 'enterAwakeIdle'
          },
          {
            // New non-null target: just update foodTargetX; the substate re-checks.
            actions: assign({
              foodTargetX: ({ event, context }) =>
                event.type === 'SET_FOOD_TARGET' ? event.x : context.foodTargetX
            })
          }
        ],
        GO_EAT: { target: 'eating' },
        DRAG_START: { target: 'dragging', actions: assign({ sleepDrag: false }) },
        SLEEP_NOW: { target: 'asleep', actions: 'fallAsleepAction' }
        // CLICK ignored (busy gathering).
      },
      states: {
        // Mid-hop: integrate the arc each TICK; on the landing tick run feedStep
        // (next hop or settle). The transient `always` routes to `begging` the
        // moment feedStep stops jumping — covering both an immediate beg on entry
        // (cat already near the food) and the final landing of a hop sequence.
        hopping: {
          always: { guard: ({ context }) => !context.jump.active, target: 'begging' },
          on: {
            TICK: [
              { guard: 'feedArcEnding', actions: 'feedLandAndStep' },
              { actions: 'feedArcIntegrate' }
            ]
          }
        },
        // Begging: hold on_hind, re-checking every 0.2s. If the target moved out
        // of range, feedStep starts a hop → the transient routes back to hopping.
        begging: {
          always: { guard: ({ context }) => context.jump.active, target: 'hopping' },
          on: {
            TICK: [
              { guard: 'feedBegExpires', actions: 'begStep' },
              { actions: 'begWait' }
            ]
          }
        }
      }
    },

    eating: {
      // Common physics cleanup on ANY exit; callback lifecycle is per-transition
      // (D4): exit does NOT touch onEatenCb.
      exit: assign({ jump: NO_JUMP, y: 0 }),
      initial: 'traveling',
      entry: assign(({ context, event }) => {
        const eatTargetX = event.type === 'GO_EAT' ? event.x : context.eatTargetX
        const onEatenCb = event.type === 'GO_EAT' ? event.onEaten : context.onEatenCb
        const seeded: CatContext = {
          ...context,
          foodTargetX: null,
          eatTargetX,
          onEatenCb,
          moving: false,
          queue: [],
          jump: NO_JUMP,
          y: 0,
          inactivity: 0
        }
        return {
          foodTargetX: null,
          eatTargetX,
          onEatenCb,
          moving: false,
          queue: [],
          jump: NO_JUMP,
          y: 0,
          inactivity: 0,
          ...eatStep(seeded)
        }
      }),
      on: {
        // These leave `eating` entirely (parent exit clears jump/y); the callback
        // is dropped without firing (D4 abnormal exit).
        CANCEL_EAT: { target: 'awake', actions: ['abortEat', 'enterAwakeIdle'] },
        DRAG_START: { target: 'dragging', actions: ['abortEat', assign({ sleepDrag: false })] },
        SLEEP_NOW: { target: 'asleep', actions: ['abortEat', 'fallAsleepAction'] }
        // SET_FOOD_TARGET / CLICK ignored — committed to the pellet.
      },
      states: {
        // Mid-hop toward the pellet: integrate the arc; on landing run eatStep
        // (next hop or arrive). The transient routes to `chewing` once eatStep
        // stops jumping — covering an immediate eat on entry (already on top) and
        // the final landing of a travel sequence.
        traveling: {
          always: { guard: ({ context }) => !context.jump.active, target: 'chewing' },
          on: {
            TICK: [
              { guard: 'eatArcEnding', actions: 'eatLandAndStep' },
              { actions: 'eatArcIntegrate' }
            ]
          }
        },
        // Chewing: play the one-shot eat anim. On completion fire the D4 deferred
        // callback (capture → clear ctx → queue) and return to awake.
        chewing: {
          on: {
            TICK: [
              { guard: 'chewDone', target: '#cat.awake', actions: ['completeEat', 'enterAwakeIdle'] },
              { actions: 'chewCountdown' }
            ]
          }
        }
      }
    }
  }
})

export type CatActorRef = ActorRefFrom<typeof catMachine>
