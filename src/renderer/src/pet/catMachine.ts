import { setup, assign, type ActorRefFrom } from 'xstate'
import type { PetDefinition, Facing } from './types'
import {
  NO_JUMP,
  advance,
  eatStep,
  fallAsleep,
  feedStep,
  rand,
  startIdle,
  tickArc,
  type CatContext
} from './behaviors'

// ─────────────────────────────────────────────────────────────────────────────
// catMachine — the cat behaviour FSM (the canonical, single-source transition
// map; design P3/§4.3). This file owns "what transitions exist"; the PURE
// per-behaviour computation lives in `behaviors.ts` ("what each behaviour does").
//
// State topology (paste into https://stately.ai/viz to visualize):
//
//   cat
//   ├── awake            [initial]   TICK: inactivity→sleep; walk/leap physics
//   │   └── (posing · walking · airborne · decide are collapsed: under the
//   │        TICK-driven model these are pose/timer phases, not distinct states)
//   ├── asleep                       CLICK[canWake]→awake(hiss); WAKE_NOW; DRAG_START
//   ├── dragging                     DRAG_MOVE; DRAG_END→asleep(sleepDrag) | awake(leap)
//   ├── feeding                      exit: clear gather state
//   │   ├── hopping     [initial]    arc → land → feedStep → (begging | next hop)
//   │   └── begging                  on_hind, 0.2s re-check → (hopping | re-beg)
//   └── eating                       exit: clear jump/y (callback per-transition)
//       ├── traveling   [initial]    arc → land → eatStep → (chewing | next hop)
//       └── chewing                  eat anim countdown → awake (fires onEaten, D4)
//
// Continuous physics is driven by TICK{dt} (design D1 — no `after`); context is
// updated only via `assign` (D6); the eat callback follows the
// pendingAfterTransition drain pattern (D4): exit never clears onEatenCb;
// completion captures it into the queue, the facade drains + fires it after the
// transition settles.
// ─────────────────────────────────────────────────────────────────────────────

// Re-exported so existing importers (tests) keep `import { CatContext } from
// './catMachine'` working; the type itself is defined alongside the behaviours.
export type { CatContext } from './behaviors'

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
