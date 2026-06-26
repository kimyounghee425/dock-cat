import { describe, it, expect } from 'vitest'
import { CatEngine } from './engine'
import { cat } from './cat'
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
    expect(e.animKey).toBe('lick_sit') // startIdle()의 초기 calm pose
    expect(e.y).toBe(0)
    e.startDrag()
    expect(e.animKey).toBe('run_up')
    e.endDrag() // 놀란 도약 → 다음 tick들에서 arc 중간
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
    // pellet이 발밑 → 즉시 먹기 시작, eat 애니 후 완료.
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
    e.startDrag() // travel 도중 끌어냄
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
        e.goEat(onTopX, cb) // 콜백 안에서 재배정(PetWorld 패턴)
      }
    }
    e.goEat(onTopX, cb)
    // 첫 eat가 콜백을 발화(→ goEat 재진입)할 때까지 tick.
    for (let i = 0; i < 60 && calls === 0; i++) e.tick(0.05)
    expect(calls).toBe(1)
    expect(reentered).toBe(true)
    // 재진입 배정이 안착해 다시 먹는 중 — 고착 아님.
    expect(e.isEating()).toBe(true)
  })

  it('dispose() stops the actor + unsubscribes (D8) without throwing', () => {
    const e = make()
    const animBefore = e.animKey
    expect(() => e.dispose()).not.toThrow()
    // 구독이 사라져 미러링 필드는 마지막 값에 고정(actor가 더는 emit 안 함). 멈춘 actor를
    // 여기서 건드리지 않는다 — XState의 "sent to stopped actor" 경고만 찍힐 뿐.
    expect(e.animKey).toBe(animBefore)
  })
})
