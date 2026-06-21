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

// catMachine — 고양이 행동 FSM, 전이의 단일 출처(canonical transition map).
// 이 파일은 "어떤 전이가 있는가"를 소유; 순수한 행동 계산은 behaviors.ts("각 행동이
// 무엇을 하는가")에 있다.
//
// State 토폴로지 (https://stately.ai/viz 에 붙여넣어 시각화):
//
//   cat
//   ├── awake            [initial]   TICK: inactivity→sleep; walk/leap physics
//   │   └── (posing · walking · airborne · decide는 합쳐짐: TICK 구동 모델에선
//   │        별개 state가 아니라 pose/timer 단계일 뿐)
//   ├── asleep                       CLICK[canWake]→awake(hiss); WAKE_NOW; DRAG_START
//   ├── dragging                     DRAG_MOVE; DRAG_END→asleep(sleepDrag) | awake(leap)
//   ├── feeding                      exit: gather 상태 정리
//   │   ├── hopping     [initial]    arc → 착지 → feedStep → (begging | 다음 hop)
//   │   └── begging                  on_hind, 0.2s 재확인 → (hopping | 재-beg)
//   └── eating                       exit: jump/y 정리 (콜백은 전이별 처리)
//       ├── traveling   [initial]    arc → 착지 → eatStep → (chewing | 다음 hop)
//       └── chewing                  eat 애니 카운트다운 → awake (onEaten 발화)
//
// 연속 물리는 TICK{dt}로 구동(`after` 미사용); context는 `assign`으로만 갱신.
// eat 콜백은 pendingAfterTransition drain 패턴: exit는 onEatenCb를 절대 지우지 않고,
// 완료 시 큐에 담아 facade가 전이가 가라앉은 뒤 drain·발화한다.

// 재export — 기존 import(`import { CatContext } from './catMachine'`)가 계속 동작하게.
// 타입 자체는 behaviors.ts에 정의.
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

export const catMachine = setup({
  types: {
    context: {} as CatContext,
    events: {} as CatEvent,
    input: {} as CatInput
  },
  actions: {
    // awake TICK: inactivity 적분, walk/jump 물리, pose 타이머.
    awakeTick: assign(({ context, event }) => {
      if (event.type !== 'TICK') return {}
      const dt = event.dt
      const inactivity = context.inactivity + dt

      // 도약 중: arc를 적분한 뒤 pose 타이머(큐된 패닉 run)를 센다.
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
        // advance()가 다음 pose(animKey/remaining/…)를 고른다; 적분 필드를 이겨야 하므로
        // 마지막에 spread.
        if (ctx2.remaining <= 0)
          return { inactivity, x: ctx2.x, y: ctx2.y, jump: ctx2.jump, ...advance(ctx2) }
        return { inactivity, x: ctx2.x, y: ctx2.y, jump: ctx2.jump, remaining: ctx2.remaining }
      }

      // 보행: 가장자리 turn과 함께 x 적분.
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
      // advance()를 마지막에 spread해 edge-turn 결과를 이기게 한다.
      if (remaining <= 0) return { inactivity, x, facing, ...advance(ctx2) }
      return { inactivity, x, facing, animKey, remaining }
    }),

    // feeding.hopping arc 중: jump 포물선 한 프레임 적분.
    feedArcIntegrate: assign(({ context, event }) => {
      if (event.type !== 'TICK') return {}
      const arc = tickArc(context, event.dt)
      return { x: arc.x, y: arc.y, jump: { ...context.jump, t: context.jump.t + event.dt } }
    }),

    // feeding hop 착지: arc 끝에 정착하고 다음 feedStep 실행.
    feedLandAndStep: assign(({ context, event }) => {
      if (event.type !== 'TICK') return {}
      const arc = tickArc(context, event.dt)
      const landed: CatContext = { ...context, x: arc.x, y: 0, jump: NO_JUMP }
      return { x: arc.x, y: 0, jump: NO_JUMP, ...feedStep(landed) }
    }),

    // feeding.begging 재확인 tick: 0.2s 타이머 감산(결정 없음).
    begWait: assign(({ context, event }) => ({
      remaining: context.remaining - (event.type === 'TICK' ? event.dt : 0)
    })),

    // feeding.begging 타이머 만료: feedStep 재실행(재-beg 또는 hop 시작).
    begStep: assign(({ context, event }) => {
      const remaining = context.remaining - (event.type === 'TICK' ? event.dt : 0)
      return { remaining, ...feedStep({ ...context, remaining }) }
    }),

    // eating.traveling arc 중: jump 포물선 한 프레임 적분.
    eatArcIntegrate: assign(({ context, event }) => {
      if (event.type !== 'TICK') return {}
      const arc = tickArc(context, event.dt)
      return { x: arc.x, y: arc.y, jump: { ...context.jump, t: context.jump.t + event.dt } }
    }),

    // eating hop 착지: arc 끝에 정착하고 다음 eatStep 실행.
    eatLandAndStep: assign(({ context, event }) => {
      if (event.type !== 'TICK') return {}
      const arc = tickArc(context, event.dt)
      const landed: CatContext = { ...context, x: arc.x, y: 0, jump: NO_JUMP }
      return { x: arc.x, y: 0, jump: NO_JUMP, ...eatStep(landed) }
    }),

    // eating.chewing tick: 1회성 eat 애니 카운트다운.
    chewCountdown: assign({
      eatRemaining: ({ context, event }) =>
        context.eatRemaining - (event.type === 'TICK' ? event.dt : 0)
    }),

    // 정상 완료: onEatenCb를 deferred 큐에 담고 eat ctx 정리. 전이 후 facade가
    // pendingAfterTransition을 drain한다.
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

    // 비정상 탈출(drag/sleep/cancel): 콜백을 발화하지 않고 버린다.
    abortEat: assign({
      eatTargetX: null,
      onEatenCb: null,
      eatRemaining: 0
    }),

    enterAwakeIdle: assign(({ context }) => ({ inactivity: 0, ...startIdle(context) })),

    fallAsleepAction: assign(({ context }) => fallAsleep(context))
  },
  guards: {
    // dt를 FIRST 더한 뒤 임계를 검사 → 임계를 넘는 그 tick에 잠든다(한 tick 늦지 않게).
    isInactiveEnough: ({ context, event }) =>
      event.type === 'TICK' && context.inactivity + event.dt >= context.sleepAfter,
    canWake: ({ context }) => !context.noWake,
    wasSleepDrag: ({ context }) => context.sleepDrag,

    // ── feeding/eating 하위상태 결정 guard (순수 기하, rng 없음) ──
    feedArcEnding: ({ context, event }) =>
      event.type === 'TICK' &&
      context.jump.active &&
      (context.jump.t + event.dt) / context.jump.dur >= 1,
    feedBegExpires: ({ context, event }) =>
      event.type === 'TICK' && context.remaining - event.dt <= 0,

    eatArcEnding: ({ context, event }) =>
      event.type === 'TICK' &&
      context.jump.active &&
      (context.jump.t + event.dt) / context.jump.dur >= 1,
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
  // 초기 calm pose는 옛 생성자(startIdle())와 동일하게.
  entry: assign(({ context }) => startIdle(context)),
  initial: 'awake',
  on: {
    // 기본(non-awake): sleepAfter만 갱신. awake state가 이를 오버라이드해 inactivity도
    // 0으로 리셋한다(awake일 때만 0으로 하는 옛 동작). snapshot 읽기 없이, 현재 state의
    // 핸들러가 곧 현재 진실이다.
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
        // awake는 root 핸들러를 오버라이드: sleepAfter 설정 시 inactivity 타이머도 리셋.
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
          // awake에서 SET_FOOD_TARGET(null)은 no-op.
        ],
        GO_EAT: { target: 'eating' }
      }
    },

    asleep: {
      // 자는 동안 TICK은 no-op — x/y/animKey/inactivity 모두 깰 때까지 정지.
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
        // "깨우지 말기"가 켜진 자는 고양이를 드래그하면 깨우지 않고 옮긴다(sleepDrag),
        // sleep pose 유지.
        DRAG_START: {
          target: 'dragging',
          actions: assign({ sleepDrag: ({ context }) => context.noWake })
        }
        // 자는 동안 SET_FOOD_TARGET / GO_EAT 무시.
      }
    },

    dragging: {
      entry: assign(({ context }) => {
        // "깨우지 말기" + 이미 자는 중 → 깨우지 않고 옮김(sleep pose 유지).
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
            // 놀람: 옆으로 포물선 도약 후 질주(패닉 run 큐).
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
      // feeding을 떠나는 모든 경로에서 gather 상태를 정리(exit에 중앙화).
      exit: assign({ foodTargetX: null, jump: NO_JUMP, y: 0, moving: false, queue: [] }),
      initial: 'hopping',
      // entry가 첫 hop/beg를 결정(옛 setFoodTarget()의 feedStep과 동일).
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
            // null → feeding 떠나 awake로(exit가 상태 정리).
            guard: ({ event }) => event.type === 'SET_FOOD_TARGET' && event.x === null,
            target: 'awake',
            actions: 'enterAwakeIdle'
          },
          {
            // 새 non-null 타깃: foodTargetX만 갱신; 하위상태가 재확인.
            actions: assign({
              foodTargetX: ({ event, context }) =>
                event.type === 'SET_FOOD_TARGET' ? event.x : context.foodTargetX
            })
          }
        ],
        GO_EAT: { target: 'eating' },
        DRAG_START: { target: 'dragging', actions: assign({ sleepDrag: false }) },
        SLEEP_NOW: { target: 'asleep', actions: 'fallAsleepAction' }
        // CLICK 무시(모이는 중).
      },
      states: {
        // hop 중: 매 TICK arc 적분; 착지 tick에 feedStep(다음 hop 또는 정착). transient
        // `always`가 feedStep이 jump를 멈추는 순간 begging으로 보낸다 — entry 즉시 beg
        // (이미 먹이 근처)와 hop 시퀀스의 마지막 착지 둘 다 커버.
        hopping: {
          always: { guard: ({ context }) => !context.jump.active, target: 'begging' },
          on: {
            TICK: [
              { guard: 'feedArcEnding', actions: 'feedLandAndStep' },
              { actions: 'feedArcIntegrate' }
            ]
          }
        },
        // on_hind 유지, 0.2s마다 재확인. 타깃이 범위를 벗어나면 feedStep이 hop을 시작 →
        // transient가 다시 hopping으로 보낸다.
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
      // 어떤 경로로 나가든 공통 물리 정리; 콜백 수명은 전이별 처리 — exit는 onEatenCb를
      // 건드리지 않는다.
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
        // 이들은 eating을 완전히 떠난다(parent exit가 jump/y 정리); 콜백은 발화 없이 버림.
        CANCEL_EAT: { target: 'awake', actions: ['abortEat', 'enterAwakeIdle'] },
        DRAG_START: { target: 'dragging', actions: ['abortEat', assign({ sleepDrag: false })] },
        SLEEP_NOW: { target: 'asleep', actions: ['abortEat', 'fallAsleepAction'] }
        // SET_FOOD_TARGET / CLICK 무시 — pellet에 전념.
      },
      states: {
        // pellet 쪽으로 hop 중: arc 적분; 착지 시 eatStep(다음 hop 또는 도착). transient가
        // eatStep이 jump를 멈추면 chewing으로 보낸다 — entry 즉시 eat(이미 위)와 travel
        // 시퀀스의 마지막 착지 둘 다 커버.
        traveling: {
          always: { guard: ({ context }) => !context.jump.active, target: 'chewing' },
          on: {
            TICK: [
              { guard: 'eatArcEnding', actions: 'eatLandAndStep' },
              { actions: 'eatArcIntegrate' }
            ]
          }
        },
        // 1회성 eat 애니 재생. 완료 시 deferred 콜백(캡처 → ctx 정리 → 큐)을 발화하고 awake로.
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
