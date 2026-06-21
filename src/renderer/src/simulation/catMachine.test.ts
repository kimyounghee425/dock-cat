import { describe, it, expect } from 'vitest'
import { createActor } from 'xstate'
import { catMachine, type CatContext } from './catMachine'
import { cat } from './cat'
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

// ── facade와 동등한 드라이버 ──
// CatEngine이 actor를 구동하는 방식을 그대로 모사: 매 send 뒤 pendingAfterTransition을 drain.
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

  // 단일 send 경로 + drain (facade 계약).
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

// 머신을 공유 스크립트로 구동, TICK마다 프레임 샘플.
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
    // 프레임별 비교 → 첫 divergence를 정확히 보고.
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
    // hop으로 이동한 뒤 on_hind beg pose로 정착. 넉넉히 tick하며 begging에 도달하는지 확인
    // (hop 사이엔 jump 프레임이라, 도착해서 begging 하위상태가 되는 순간을 본다).
    let begging = false
    for (let i = 0; i < 200 && !begging; i++) {
      tick(a, 1)
      if ((a.value() as { feeding?: string }).feeding === 'begging') begging = true
    }
    // 하위상태가 load-bearing: 도착하면 hopping → begging으로 전환.
    expect(begging).toBe(true)
    expect(a.ctx().animKey).toBe('on_hind')
    a.send({ type: 'SET_FOOD_TARGET', x: null })
    expect(a.value()).toBe('awake')
    expect(a.ctx().foodTargetX).toBeNull()
  })

  it('awake → eating.traveling → chewing → awake with onEaten called exactly once', () => {
    const a = makeActor()
    let calls = 0
    // pellet을 멀리 오른쪽에 둬서 HOP으로 가야만 도달 → `traveling` 하위상태(arc 적분)를
    // 실제로 거친 뒤 `chewing`으로 전환되는지 확인.
    a.send({ type: 'GO_EAT', x: 900, onEaten: () => calls++ })
    expect(a.value()).toEqual({ eating: 'traveling' })
    expect(a.ctx().animKey).toMatch(/^jump_/) // hopping, 아직 먹기 전
    expect(a.ctx().eatRemaining).toBe(0)

    // 도착해서 chewing 시작할 때까지 travel.
    let reachedChewing = false
    for (let i = 0; i < 120 && !reachedChewing; i++) {
      tick(a, 1)
      if (a.value() && (a.value() as { eating?: string }).eating === 'chewing')
        reachedChewing = true
    }
    expect(reachedChewing).toBe(true)
    expect(a.ctx().animKey).toMatch(/^eat_/)
    expect(a.ctx().eatRemaining).toBeGreaterThan(0)

    // chew 완료 → awake로 복귀, 콜백은 정확히 1회.
    tick(a, 60)
    expect(a.value()).toBe('awake')
    expect(calls).toBe(1)
    expect(a.ctx().eatTargetX).toBeNull()
    expect(a.ctx().onEatenCb).toBeNull()
  })

  it('eating: pellet already underfoot → straight to chewing (eat_front)', () => {
    const a = makeActor()
    // 스프라이트 CENTER(startX + displaySize/2)가 pellet 위 → EAT_ONTOP_THRESHOLD 이내 →
    // travel hop 없이 즉시 정면(front)으로 먹는다.
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
    const onTopX = START_X + cat.displaySize / 2 // pellet 위 → 즉시 먹기
    // eat 콜백이 고양이를 새 pellet에 재배정(PetWorld 패턴).
    a.send({
      type: 'GO_EAT',
      x: onTopX,
      onEaten: () => {
        outer++
        if (!reentered) {
          reentered = true
          // 콜백 안에서의 재진입 배정.
          a.send({ type: 'GO_EAT', x: onTopX, onEaten: () => {} })
        }
      }
    })
    // 첫 eat가 완료돼 콜백(→ goEat 재진입)을 발화할 때까지 tick. 직후를 단언: 콜백은 정확히
    // 1회, 재진입 GO_EAT는 awake에서 처리됨(고착/이중발화 아니라 다시 먹는 중).
    for (let i = 0; i < 60 && outer === 0; i++) tick(a, 1)
    expect(outer).toBe(1)
    expect(reentered).toBe(true)
    // 재진입 GO_EAT(발밑 pellet)가 awake에서 처리돼 다시 먹는 중 — 위에 있으니 즉시 chewing. 이중발화 없음.
    expect(a.value()).toEqual({ eating: 'chewing' })
    expect(a.ctx().eatRemaining).toBeGreaterThan(0)
  })

  it('awake mid-startled-leap → SLEEP_NOW clears jump/y (no frozen-aloft cat)', () => {
    const a = makeActor()
    // 놀란 도약 진입: drag 후 drop → awake에서 arc jump.
    a.send({ type: 'DRAG_START' })
    a.send({ type: 'DRAG_END' })
    expect(a.value()).toBe('awake')
    // arc 두어 tick: 공중(y > 0, jump active).
    tick(a, 2)
    expect(a.ctx().y).toBeGreaterThan(0)
    expect(a.ctx().jump.active).toBe(true)
    // 도약 중 강제 수면 → 깔끔히 착지해야(jump/y 정리).
    a.send({ type: 'SLEEP_NOW' })
    expect(a.value()).toBe('asleep')
    expect(a.ctx().y).toBe(0)
    expect(a.ctx().jump.active).toBe(false)
    expect(a.ctx().animKey).toMatch(/^sleep\d_/)
  })

  it('SET_SLEEP_AFTER resets inactivity only when awake', () => {
    // awake: sleepAfter 갱신 + inactivity 0으로.
    const a = makeActor({ sleepAfter: 100 })
    tick(a, 10) // inactivity 좀 쌓기
    expect(a.ctx().inactivity).toBeGreaterThan(0)
    a.send({ type: 'SET_SLEEP_AFTER', sec: 50 })
    expect(a.ctx().sleepAfter).toBe(50)
    expect(a.ctx().inactivity).toBe(0)

    // asleep: sleepAfter는 갱신하되 inactivity는 건드리지 않아야.
    const b = makeActor({ sleepAfter: 0.01 })
    tick(b, 1)
    expect(b.value()).toBe('asleep')
    const frozen = b.ctx().inactivity
    b.send({ type: 'SET_SLEEP_AFTER', sec: 5 })
    expect(b.ctx().sleepAfter).toBe(5)
    expect(b.ctx().inactivity).toBe(frozen)
  })

  it('awake mid-leap → inactivity timeout also clears jump/y', () => {
    // sleepAfter를 아주 작게 → 공중에 있는 바로 다음 tick에 임계를 넘는다.
    const a = makeActor({ sleepAfter: 0.01 })
    a.send({ type: 'DRAG_START' })
    a.send({ type: 'DRAG_END' })
    expect(a.ctx().jump.active).toBe(true)
    tick(a, 1) // inactivity + dt ≥ sleepAfter → 이 tick에 잠듦
    expect(a.value()).toBe('asleep')
    expect(a.ctx().y).toBe(0)
    expect(a.ctx().jump.active).toBe(false)
  })
})
