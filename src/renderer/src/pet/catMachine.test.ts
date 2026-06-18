import { describe, it, expect } from 'vitest'
import { createActor } from 'xstate'
import { catMachine, type CatContext } from './catMachine'
import { cat } from '../pets/cat'
import {
  type Frame,
  type Step,
  MAX_X,
  SEED,
  SLEEP_AFTER,
  START_X,
  mulberry32,
  script
} from './__fixtures__/script'
import { goldenFrames } from './__fixtures__/cat-golden'

// ── facade-equivalent driver ─────────────────────────────────────────────────
// Mirrors how CatEngine (Phase 2) will drive the actor: every send is followed
// by a drain of pendingAfterTransition (D4). Here it also lets us count + verify
// onEaten callback firing for the parity script.

function makeActor(opts: {
  startX?: number
  sleepAfter?: number
  rng?: () => number
  noWake?: boolean
} = {}) {
  const actor = createActor(catMachine, {
    input: {
      def: cat,
      startX: opts.startX ?? START_X,
      getMaxX: () => MAX_X,
      sleepAfter: opts.sleepAfter ?? SLEEP_AFTER,
      rng: opts.rng ?? mulberry32(SEED)
    }
  }).start()

  // Single send path + drain (the Phase-2 facade contract).
  const send = (event: Parameters<typeof actor.send>[0]): void => {
    actor.send(event)
    let pending = actor.getSnapshot().context.pendingAfterTransition
    while (pending.length > 0) {
      actor.send({ type: 'CLEAR_PENDING_CALLBACKS' })
      for (const cb of pending) cb()
      pending = actor.getSnapshot().context.pendingAfterTransition
    }
  }

  const ctx = (): CatContext => actor.getSnapshot().context
  const value = () => actor.getSnapshot().value
  return { actor, send, ctx, value }
}

/** Drive the new machine through the shared script, sampling a frame per TICK. */
function runMachine(steps: Step[] = script): Frame[] {
  const a = makeActor({ rng: mulberry32(SEED) })
  const frames: Frame[] = []
  const round = (n: number): number => Math.round(n * 1e6) / 1e6
  for (const step of steps) {
    if ('tick' in step) {
      a.send({ type: 'TICK', dt: step.tick })
      const c = a.ctx()
      frames.push({ x: round(c.x), y: round(c.y), animKey: c.animKey })
      continue
    }
    switch (step.cmd) {
      case 'click':
        a.send({ type: 'CLICK' })
        break
      case 'startDrag':
        a.send({ type: 'DRAG_START' })
        break
      case 'dragTo':
        a.send({ type: 'DRAG_MOVE', x: step.x })
        break
      case 'endDrag':
        a.send({ type: 'DRAG_END' })
        break
      case 'sleepNow':
        a.send({ type: 'SLEEP_NOW' })
        break
      case 'wakeNow':
        a.send({ type: 'WAKE_NOW' })
        break
      case 'setFoodTarget':
        a.send({ type: 'SET_FOOD_TARGET', x: step.x })
        break
      case 'goEat':
        a.send({ type: 'GO_EAT', x: step.x, onEaten: () => {} })
        break
      case 'cancelEat':
        a.send({ type: 'CANCEL_EAT' })
        break
      case 'setNoWake':
        a.send({ type: 'SET_NO_WAKE', on: step.on })
        break
      case 'setSleepAfter':
        a.send({ type: 'SET_SLEEP_AFTER', sec: step.sec })
        break
    }
  }
  return frames
}

const tick = (a: ReturnType<typeof makeActor>, n = 1, dt = 0.05): void => {
  for (let i = 0; i < n; i++) a.send({ type: 'TICK', dt })
}

describe('catMachine golden-master parity (P1)', () => {
  it('reproduces the old CatEngine frame sequence byte-for-byte', () => {
    const frames = runMachine(script)
    expect(frames.length).toBe(goldenFrames.length)
    // Compare frame-by-frame so the first divergence is reported precisely.
    for (let i = 0; i < goldenFrames.length; i++) {
      expect(frames[i], `frame ${i}`).toEqual(goldenFrames[i])
    }
  })
})

describe('catMachine transitions (§4.7)', () => {
  it('awake → feeding → begging (on_hind) → awake', () => {
    const a = makeActor()
    expect(a.value()).toBe('awake')
    a.send({ type: 'SET_FOOD_TARGET', x: 1000 })
    expect(a.value()).toEqual({ feeding: 'hopping' })
    // Hops settle into the on_hind beg pose after travelling. Tick generously
    // and confirm the cat reaches + holds the beg pose (between hops it shows a
    // jump frame, so assert it lands on on_hind at least once it has arrived).
    let begging = false
    for (let i = 0; i < 200 && !begging; i++) {
      tick(a, 1)
      if ((a.value() as { feeding?: string }).feeding === 'begging') begging = true
    }
    // The substate is load-bearing: arriving flips hopping → begging.
    expect(begging).toBe(true)
    expect(a.ctx().animKey).toBe('on_hind')
    a.send({ type: 'SET_FOOD_TARGET', x: null })
    expect(a.value()).toBe('awake')
    expect(a.ctx().foodTargetX).toBeNull()
  })

  it('awake → eating.traveling → chewing → awake with onEaten called exactly once', () => {
    const a = makeActor()
    let calls = 0
    // Pellet placed far to the right so the cat must HOP to reach it: this
    // genuinely exercises the `traveling` substate (arc integration) before it
    // arrives and transitions to `chewing`.
    a.send({ type: 'GO_EAT', x: 900, onEaten: () => calls++ })
    expect(a.value()).toEqual({ eating: 'traveling' })
    expect(a.ctx().animKey).toMatch(/^jump_/) // hopping, not yet eating
    expect(a.ctx().eatRemaining).toBe(0)

    // Travel until it arrives and starts chewing.
    let reachedChewing = false
    for (let i = 0; i < 120 && !reachedChewing; i++) {
      tick(a, 1)
      if (a.value() && (a.value() as { eating?: string }).eating === 'chewing')
        reachedChewing = true
    }
    expect(reachedChewing).toBe(true)
    expect(a.ctx().animKey).toMatch(/^eat_/)
    expect(a.ctx().eatRemaining).toBeGreaterThan(0)

    // Chew to completion → back to awake, callback fired exactly once.
    tick(a, 60)
    expect(a.value()).toBe('awake')
    expect(calls).toBe(1)
    expect(a.ctx().eatTargetX).toBeNull()
    expect(a.ctx().onEatenCb).toBeNull()
  })

  it('eating: pellet already underfoot → straight to chewing (eat_front)', () => {
    const a = makeActor()
    // Sprite CENTER (startX + displaySize/2) over the pellet → within
    // EAT_ONTOP_THRESHOLD → eats front-facing immediately, no travel hop.
    const onTopX = START_X + cat.displaySize / 2
    a.send({ type: 'GO_EAT', x: onTopX, onEaten: () => {} })
    expect(a.value()).toEqual({ eating: 'chewing' })
    expect(a.ctx().animKey).toBe('eat_front')
    expect(a.ctx().eatRemaining).toBeGreaterThan(0)
  })

  it('asleep + noWake + CLICK → no transition', () => {
    const a = makeActor({ sleepAfter: 0.01, noWake: true })
    a.send({ type: 'SET_NO_WAKE', on: true })
    tick(a, 1) // inactivity ≥ sleepAfter → asleep
    expect(a.value()).toBe('asleep')
    const before = a.ctx().animKey
    a.send({ type: 'CLICK' })
    expect(a.value()).toBe('asleep')
    expect(a.ctx().animKey).toBe(before)
  })

  it('asleep + CLICK → awake (hiss)', () => {
    const a = makeActor({ sleepAfter: 0.01 })
    tick(a, 1)
    expect(a.value()).toBe('asleep')
    a.send({ type: 'CLICK' })
    expect(a.value()).toBe('awake')
    expect(a.ctx().animKey).toMatch(/^hiss_/)
  })

  it('feeding → SLEEP_NOW → asleep then foodTargetX null', () => {
    const a = makeActor()
    a.send({ type: 'SET_FOOD_TARGET', x: 900 })
    expect(a.value()).toEqual({ feeding: 'hopping' })
    a.send({ type: 'SLEEP_NOW' })
    expect(a.value()).toBe('asleep')
    expect(a.ctx().foodTargetX).toBeNull()
  })

  it('eating → DRAG_START → dragging then onEatenCb null (NOT called)', () => {
    const a = makeActor()
    let calls = 0
    a.send({ type: 'GO_EAT', x: 800, onEaten: () => calls++ })
    expect(a.value()).toEqual({ eating: 'traveling' })
    a.send({ type: 'DRAG_START' })
    expect(a.value()).toBe('dragging')
    expect(a.ctx().onEatenCb).toBeNull()
    expect(a.ctx().eatTargetX).toBeNull()
    expect(calls).toBe(0)
  })

  it('D4 re-entrancy: onEaten that calls goEat lands in awake→eating, no double-call', () => {
    const a = makeActor()
    let outer = 0
    let reentered = false
    const onTopX = START_X + cat.displaySize / 2 // center over pellet → eat now
    // The eat callback re-assigns the cat to a NEW pellet (PetWorld pattern).
    a.send({
      type: 'GO_EAT',
      x: onTopX,
      onEaten: () => {
        outer++
        if (!reentered) {
          reentered = true
          // Re-entrant assignment from inside the callback.
          a.send({ type: 'GO_EAT', x: onTopX, onEaten: () => {} })
        }
      }
    })
    // Tick until the first eat completes and fires its callback (which re-enters
    // goEat). Assert the moment after: the cb fired exactly once and the
    // re-entrant GO_EAT was processed from awake (so we're eating again, not
    // stuck/double-firing).
    for (let i = 0; i < 60 && outer === 0; i++) tick(a, 1)
    expect(outer).toBe(1)
    expect(reentered).toBe(true)
    // The re-entrant GO_EAT (pellet underfoot) was processed from awake and is
    // now eating again — chewing immediately since it's on top. No double-fire.
    expect(a.value()).toEqual({ eating: 'chewing' })
    expect(a.ctx().eatRemaining).toBeGreaterThan(0)
  })

  it('awake mid-startled-leap → SLEEP_NOW clears jump/y (no frozen-aloft cat)', () => {
    const a = makeActor()
    // Enter a startled leap: drag then drop → arcing jump in awake.
    a.send({ type: 'DRAG_START' })
    a.send({ type: 'DRAG_END' })
    expect(a.value()).toBe('awake')
    // A couple ticks into the arc: airborne (y > 0, jump active).
    tick(a, 2)
    expect(a.ctx().y).toBeGreaterThan(0)
    expect(a.ctx().jump.active).toBe(true)
    // Force sleep mid-leap → must land cleanly (old sleepNow clears jump/y).
    a.send({ type: 'SLEEP_NOW' })
    expect(a.value()).toBe('asleep')
    expect(a.ctx().y).toBe(0)
    expect(a.ctx().jump.active).toBe(false)
    expect(a.ctx().animKey).toMatch(/^sleep\d_/)
  })

  it('SET_SLEEP_AFTER resets inactivity only when awake', () => {
    // Awake: updates sleepAfter AND zeroes inactivity (old setSleepAfter).
    const a = makeActor({ sleepAfter: 100 })
    tick(a, 10) // accrue some inactivity
    expect(a.ctx().inactivity).toBeGreaterThan(0)
    a.send({ type: 'SET_SLEEP_AFTER', sec: 50 })
    expect(a.ctx().sleepAfter).toBe(50)
    expect(a.ctx().inactivity).toBe(0)

    // Asleep: updates sleepAfter but must NOT touch inactivity.
    const b = makeActor({ sleepAfter: 0.01 })
    tick(b, 1)
    expect(b.value()).toBe('asleep')
    const frozen = b.ctx().inactivity
    b.send({ type: 'SET_SLEEP_AFTER', sec: 5 })
    expect(b.ctx().sleepAfter).toBe(5)
    expect(b.ctx().inactivity).toBe(frozen)
  })

  it('awake mid-leap → inactivity timeout also clears jump/y', () => {
    // sleepAfter tiny so the very next tick crosses the threshold while airborne.
    const a = makeActor({ sleepAfter: 0.01 })
    a.send({ type: 'DRAG_START' })
    a.send({ type: 'DRAG_END' })
    expect(a.ctx().jump.active).toBe(true)
    tick(a, 1) // inactivity + dt ≥ sleepAfter → fall asleep this tick
    expect(a.value()).toBe('asleep')
    expect(a.ctx().y).toBe(0)
    expect(a.ctx().jump.active).toBe(false)
  })
})
