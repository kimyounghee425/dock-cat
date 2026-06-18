import { describe, it, expect } from 'vitest'
import { CatEngine } from './engine'
import { cat } from '../pets/cat'
import { runFacade } from './__fixtures__/runFacade'
import { goldenFrames } from './__fixtures__/cat-golden'
import { MAX_X, START_X, SLEEP_AFTER, SEED, mulberry32 } from './__fixtures__/script'

describe('CatEngine facade golden-master parity (Phase 2 P1)', () => {
  it('reproduces the frozen golden fixture byte-for-byte through the public API', () => {
    const frames = runFacade()
    expect(frames.length).toBe(goldenFrames.length)
    for (let i = 0; i < goldenFrames.length; i++) {
      expect(frames[i], `frame ${i}`).toEqual(goldenFrames[i])
    }
  })
})

describe('CatEngine facade behaviour (D2/D4/D8/D9)', () => {
  const make = (overrides: { startX?: number; sleepAfter?: number } = {}): CatEngine =>
    new CatEngine({
      def: cat,
      startX: overrides.startX ?? START_X,
      getMaxX: () => MAX_X,
      sleepAfter: overrides.sleepAfter ?? SLEEP_AFTER,
      rng: mulberry32(SEED)
    })

  it('mirrors x/y/animKey into plain fields (D9) updated each tick', () => {
    const e = make()
    expect(e.animKey).toBe('lick_sit') // initial calm pose from startIdle()
    expect(e.y).toBe(0)
    e.startDrag()
    expect(e.animKey).toBe('run_up')
    e.endDrag() // startled leap → mid-arc on the next ticks
    e.tick(0.05)
    e.tick(0.05)
    expect(e.y).toBeGreaterThan(0)
    expect(e.animKey).toMatch(/^jump_/)
  })

  it('isFreeToEat / isEating / isAsleep reflect the machine state', () => {
    const e = make()
    expect(e.isFreeToEat()).toBe(true)
    expect(e.isEating()).toBe(false)
    expect(e.isAsleep()).toBe(false)

    e.goEat(900, () => {})
    expect(e.isEating()).toBe(true)
    expect(e.isFreeToEat()).toBe(false)

    e.cancelEat()
    expect(e.isEating()).toBe(false)
    expect(e.isFreeToEat()).toBe(true)
  })

  it('onEaten fires exactly once on normal completion (D4 drain)', () => {
    const e = make()
    let calls = 0
    // Pellet underfoot → eats immediately, completes after the eat anim.
    const onTopX = START_X + cat.displaySize / 2
    e.goEat(onTopX, () => calls++)
    for (let i = 0; i < 60 && e.isEating(); i++) e.tick(0.05)
    expect(calls).toBe(1)
    expect(e.isEating()).toBe(false)
  })

  it('abnormal exit (drag mid-eat) drops onEaten without firing it', () => {
    const e = make()
    let calls = 0
    e.goEat(900, () => calls++)
    expect(e.isEating()).toBe(true)
    e.startDrag() // pulled away mid-travel
    e.endDrag()
    for (let i = 0; i < 30; i++) e.tick(0.05)
    expect(calls).toBe(0)
  })

  it('re-entrant goEat from inside onEaten lands cleanly (D4)', () => {
    const e = make()
    let calls = 0
    let reentered = false
    const onTopX = START_X + cat.displaySize / 2
    const cb = (): void => {
      calls++
      if (!reentered) {
        reentered = true
        e.goEat(onTopX, cb) // re-assign from inside the callback (PetWorld pattern)
      }
    }
    e.goEat(onTopX, cb)
    // Tick until the first eat fires its callback (which re-enters goEat).
    for (let i = 0; i < 60 && calls === 0; i++) e.tick(0.05)
    expect(calls).toBe(1)
    expect(reentered).toBe(true)
    // The re-entrant assignment landed and the cat is eating again — not stuck.
    expect(e.isEating()).toBe(true)
  })

  it('dispose() stops the actor + unsubscribes (D8) without throwing', () => {
    const e = make()
    const animBefore = e.animKey
    expect(() => e.dispose()).not.toThrow()
    // The subscription is gone, so the mirrored fields freeze at their last value
    // (the actor no longer emits). We don't poke the stopped actor here — that
    // would just log XState's "sent to stopped actor" warning.
    expect(e.animKey).toBe(animBefore)
  })
})
