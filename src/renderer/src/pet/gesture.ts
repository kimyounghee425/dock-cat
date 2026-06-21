// gesture.ts — 포인터 제스처 상태머신을 순수 reducer(effects-as-data)로.
// DOM·engine·`this`·시간/무작위 없음.
//
// world.ts는 얇은 불순 껍데기: 이벤트마다 live rect를 읽고(geometry), 미리 계산한
// 히트 결과를 Event로 싸서 `reduce` 호출, 반환 state 저장 후 Effect를 순서대로
// SYNCHRONOUS하게 실행한다 — 그래야 클릭통과 캡처가 같은 이벤트 턴 안에서 토글된다(필수).
// 고양이 ref는 제네릭 `<T>`라 reducer가 CatEngine을 몰라도 된다.

import { exceedsDragThreshold } from './geometry'

// 명시적 제스처 state — 과거 암묵적 플래그 조합을 "불가능 조합은 표현 불가"로 만든 것.
// `holding`은 press/release를 넘어 지속되는 먹이-들기 토글; `holdingPressed`는 누른 채
// 들고 있는 상태(up 핸들러가 pellet 떨구기 vs 들기 종료를 결정).
export type GestureState<T> =
  | { kind: 'idle' }
  | { kind: 'catPressed'; cat: T; downX: number }
  | { kind: 'catDragging'; cat: T }
  | { kind: 'bowlPressed'; downX: number; grabDx: number }
  | { kind: 'bowlDragging'; grabDx: number }
  | { kind: 'holding' }
  | { kind: 'holdingPressed'; downX: number; startedOnBowl: boolean }

// 불순 계층이 DOM에서 읽어 넘기는, 미리 계산한 히트 결과.
export interface DownHit<T> {
  // 포인터 아래 topmost 고양이(고양이가 밥그릇보다 우선), 없으면 null.
  cat: T | null
  onBowl: boolean
}

export type GestureEvent<T> =
  | { type: 'POINTER_DOWN'; x: number; y: number; bowlX: number; hit: DownHit<T> }
  | { type: 'POINTER_MOVE'; x: number; y: number; overTrash: boolean; overInteractive: boolean }
  | { type: 'POINTER_UP'; x: number; y: number; onBowl: boolean; overTrash: boolean; overInteractive: boolean }
  | { type: 'ESC' }
  | { type: 'BOWL_REMOVED' }

// 불순 계층이 실행할 의도 데이터. 각 효과는 옛 인라인 부작용과 1:1; 순서대로 동기 실행.
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

// 순수 전이: 현재 state + event → 다음 state + 실행할 effect들(순서 포함).
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
  // 들고 있는 동안의 press는 먹이용: 시작 지점과 밥그릇에서 시작했는지를 기록,
  // 떨구기 vs 들기-종료는 up에서 결정.
  if (state.kind === 'holding' || state.kind === 'holdingPressed') {
    return {
      state: { kind: 'holdingPressed', downX: e.x, startedOnBowl: e.hit.onBowl },
      effects: []
    }
  }
  // 고양이가 밥그릇보다 우선(이미 hit.cat에 반영됨).
  if (e.hit.cat !== null) {
    return { state: { kind: 'catPressed', cat: e.hit.cat, downX: e.x }, effects: [] }
  }
  // 밥그릇 press: 드래그(이동) vs 클릭(먹이-들기 토글) 미결정.
  if (e.hit.onBowl) {
    return { state: { kind: 'bowlPressed', downX: e.x, grabDx: e.x - e.bowlX }, effects: [] }
  }
  return { state: { kind: 'idle' }, effects: [] }
}

function onMove<T>(
  state: GestureState<T>,
  e: Extract<GestureEvent<T>, { type: 'POINTER_MOVE' }>
): ReduceResult<T> {
  // 들고 있는 중: pellet이 커서를 따르고 고양이가 모이며 캡처 유지. (먼저 검사 —
  // 들고 있는 동안의 press는 드래그가 아니라 계속 먹이질이다.)
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
      // 임계 초과: 드래그 시작(START_DRAG가 pellet 해제 + trash 표시) 후 같은 프레임에
      // 바로 추적 + 캡처 + trash-hot.
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
    return { state, effects: [] } // 아직 드래그 아님
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
      // 임계 초과: 이동 제스처. trash 표시 후 같은 프레임에 이동 + 캡처 + trash-hot.
      // (SET_BOWL_X는 raw 타깃만 싣고, 화면 폭이 필요한 clamp는 불순 계층이 한다.)
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
    return { state, effects: [] } // 아직 드래그 아님
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

  // idle: interactive 위에 있는지에 맞춰 캡처만 동기화.
  return { state, effects: [{ type: 'SET_CAPTURE', on: e.overInteractive }] }
}

function onUp<T>(
  state: GestureState<T>,
  e: Extract<GestureEvent<T>, { type: 'POINTER_UP' }>
): ReduceResult<T> {
  // 들고 있고 press 진행 중: (press가 시작된) 밥그릇을 클릭하면 들기 종료, 그 외 클릭은
  // pellet을 떨구고 계속 들고 있는다.
  if (state.kind === 'holdingPressed') {
    const endHold = state.startedOnBowl && e.onBowl
    if (endHold) {
      return {
        state: { kind: 'idle' },
        effects: [
          { type: 'CLEAR_FEEDING' },
          { type: 'SET_CAPTURE', on: e.overInteractive }
        ]
      }
    }
    // pellet 떨구고 gather 갱신, 계속 들고 있음(캡처 유지).
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
    // 드래그 없음 → 단순 클릭. 이후 캡처는 over-interactive를 따른다(tail).
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
    // 밥그릇 깔끔한 클릭(드래그 없음) → 먹이-들기 ON. 이제 holding이라 옛 코드의 tail
    // `if (!holdingFood) setCapture`는 건너뛴다(여기서 SET_CAPTURE를 따로 안 냄).
    return {
      state: { kind: 'holding' },
      effects: [
        { type: 'START_FEED', x: e.x, y: e.y },
        { type: 'SET_CAPTURE', on: true }
      ]
    }
  }

  if (state.kind === 'bowlDragging') {
    // 드래그 종료: 버리거나 새 위치 저장, 이후 trash 해제 + 캡처 동기화.
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

  // 추적된 press 없이 holding이면 캡처 유지(옛 tail은 holding일 때 건너뜀).
  if (state.kind === 'holding') {
    return { state, effects: [] }
  }
  return { state: { kind: 'idle' }, effects: [{ type: 'SET_CAPTURE', on: e.overInteractive }] }
}

function onEsc<T>(state: GestureState<T>): ReduceResult<T> {
  // ESC는 들고 있을 때만 동작: feeding을 비우고 캡처를 무조건 해제(keydown은 커서 위치를
  // 모르므로 다음 move가 복원).
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
  // 제스처 도중 밥그릇이 사라짐(예: config echo). bowl-drag나 먹이-들기를 취소해
  // 플래그/trash/캡처가 고착되지 않게 한다; 고양이 드래그는 영향 없음.
  const bowlActive = state.kind === 'bowlPressed' || state.kind === 'bowlDragging'
  const holding = state.kind === 'holding' || state.kind === 'holdingPressed'
  if (!bowlActive && !holding) return { state, effects: [] }

  const effects: Effect<T>[] = []
  if (bowlActive) effects.push({ type: 'TRASH', visible: false, hot: false })
  if (holding) effects.push({ type: 'CLEAR_FEEDING' })
  effects.push({ type: 'SET_CAPTURE', on: false }) // 캡처 해제는 마지막에
  return { state: { kind: 'idle' }, effects }
}
