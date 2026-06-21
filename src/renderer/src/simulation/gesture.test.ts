import { describe, it, expect } from 'vitest'
import { reduce, type Effect, type GestureEvent, type GestureState } from './gesture'

// reducer는 cat ref에 대해 제네릭; 여기선 string으로 대역.
type Cat = string

const idle: GestureState<Cat> = { kind: 'idle' }

// 이벤트 열을 reduce에 흘려 스텝별 결과 수집.
function run(
  start: GestureState<Cat>,
  events: GestureEvent<Cat>[]
): { state: GestureState<Cat>; effects: Effect<Cat>[][] } {
  let state = start
  const effects: Effect<Cat>[][] = []
  for (const e of events) {
    const r = reduce(state, e)
    state = r.state
    effects.push(r.effects)
  }
  return { state, effects }
}

// 이벤트 빌더 (기본값으로 테스트를 간결하게; 케이스마다 override).
const down = (x: number, hit: { cat?: Cat | null; onBowl?: boolean }, bowlX = 0): GestureEvent<Cat> => ({
  type: 'POINTER_DOWN',
  x,
  y: 0,
  bowlX,
  hit: { cat: hit.cat ?? null, onBowl: hit.onBowl ?? false }
})
const move = (x: number, o: { overTrash?: boolean; overInteractive?: boolean } = {}): GestureEvent<Cat> => ({
  type: 'POINTER_MOVE',
  x,
  y: 0,
  overTrash: o.overTrash ?? false,
  overInteractive: o.overInteractive ?? false
})
const up = (
  x: number,
  o: { onBowl?: boolean; overTrash?: boolean; overInteractive?: boolean } = {}
): GestureEvent<Cat> => ({
  type: 'POINTER_UP',
  x,
  y: 0,
  onBowl: o.onBowl ?? false,
  overTrash: o.overTrash ?? false,
  overInteractive: o.overInteractive ?? false
})

describe('gesture — cat', () => {
  it('down then up with no move → CLICK_CAT', () => {
    const { state, effects } = run(idle, [down(100, { cat: 'c1' }), up(100)])
    expect(effects[0]).toEqual([]) // down: no effects
    expect(effects[1]).toEqual([
      { type: 'CLICK_CAT', cat: 'c1' },
      { type: 'SET_CAPTURE', on: false }
    ])
    expect(state).toEqual(idle)
  })

  it('down → move >4px → up → START_DRAG, DRAG_TO, END_DRAG', () => {
    const { state, effects } = run(idle, [down(100, { cat: 'c1' }), move(110), up(110)])
    expect(effects[1]).toEqual([
      { type: 'START_DRAG', cat: 'c1' },
      { type: 'DRAG_TO', cat: 'c1', x: 110 },
      { type: 'SET_CAPTURE', on: true },
      { type: 'TRASH', hot: false }
    ])
    expect(effects[2]).toEqual([
      { type: 'END_DRAG', cat: 'c1' },
      { type: 'TRASH', visible: false, hot: false },
      { type: 'SET_CAPTURE', on: false }
    ])
    expect(state).toEqual(idle)
  })

  it('dragging onto the trash → REMOVE_CAT (not END_DRAG)', () => {
    const { effects } = run(idle, [down(100, { cat: 'c1' }), move(120), up(120, { overTrash: true })])
    expect(effects[2][0]).toEqual({ type: 'REMOVE_CAT', cat: 'c1' })
  })

  it('move of exactly 4px is still a click (threshold is strictly >)', () => {
    const { state, effects } = run(idle, [down(100, { cat: 'c1' }), move(104), up(104)])
    expect(effects[1]).toEqual([]) // 4px → no drag started
    expect(state).toEqual(idle)
  })

  it('trash hot tracks overTrash while dragging', () => {
    const { effects } = run(idle, [down(100, { cat: 'c1' }), move(120), move(130, { overTrash: true })])
    expect(effects[2]).toEqual([
      { type: 'DRAG_TO', cat: 'c1', x: 130 },
      { type: 'SET_CAPTURE', on: true },
      { type: 'TRASH', hot: true }
    ])
  })
})

describe('gesture — bowl', () => {
  it('down then up with no move → START_FEED (hold turns ON)', () => {
    const { state, effects } = run(idle, [down(50, { onBowl: true }), up(50)])
    expect(effects[1]).toEqual([
      { type: 'START_FEED', x: 50, y: 0 },
      { type: 'SET_CAPTURE', on: true }
    ])
    expect(state).toEqual({ kind: 'holding' })
  })

  it('down → move >4px → bowl drag: TRASH visible + SET_BOWL_X live, PERSIST on up', () => {
    const { state, effects } = run(idle, [down(50, { onBowl: true }, 40), move(70), up(70)])
    // grabDx = 50 - 40 = 10 ; SET_BOWL_X는 raw(70 - 10 = 60)를 싣고 executor가 clamp.
    expect(effects[1]).toEqual([
      { type: 'TRASH', visible: true },
      { type: 'SET_BOWL_X', x: 60 },
      { type: 'SET_CAPTURE', on: true },
      { type: 'TRASH', hot: false }
    ])
    expect(effects[2]).toEqual([
      { type: 'PERSIST_BOWL_X' },
      { type: 'TRASH', visible: false, hot: false },
      { type: 'SET_CAPTURE', on: false }
    ])
    expect(state).toEqual(idle)
  })

  it('bowl drag onto trash → REMOVE_BOWL_CFG', () => {
    const { effects } = run(idle, [down(50, { onBowl: true }), move(80), up(80, { overTrash: true })])
    expect(effects[2][0]).toEqual({ type: 'REMOVE_BOWL_CFG' })
  })

  it('subsequent bowl-drag moves keep emitting SET_BOWL_X with the same grabDx', () => {
    const { effects } = run(idle, [down(50, { onBowl: true }, 40), move(70), move(90)])
    expect(effects[2]).toEqual([
      { type: 'SET_BOWL_X', x: 80 }, // 90 - 10
      { type: 'SET_CAPTURE', on: true },
      { type: 'TRASH', hot: false }
    ])
  })
})

describe('gesture — holding food', () => {
  const holding: GestureState<Cat> = { kind: 'holding' }

  it('click on empty area → DROP_PELLET + refresh, stays holding', () => {
    const { state, effects } = run(holding, [down(200, { onBowl: false }), up(200)])
    expect(effects[1]).toEqual([
      { type: 'DROP_PELLET', x: 200, y: 0 },
      { type: 'UPDATE_FOOD_TARGETS', x: 200 },
      { type: 'SET_CAPTURE', on: true }
    ])
    expect(state).toEqual({ kind: 'holding' })
  })

  it('click on the bowl (started on bowl) → CLEAR_FEEDING, hold OFF', () => {
    const { state, effects } = run(holding, [down(50, { onBowl: true }), up(50, { onBowl: true })])
    expect(effects[1]).toEqual([
      { type: 'CLEAR_FEEDING' },
      { type: 'SET_CAPTURE', on: false }
    ])
    expect(state).toEqual(idle)
  })

  it('press began on bowl but released off it → drops a pellet, keeps holding', () => {
    const { state, effects } = run(holding, [down(50, { onBowl: true }), up(300, { onBowl: false })])
    expect(effects[1][0]).toEqual({ type: 'DROP_PELLET', x: 300, y: 0 })
    expect(state).toEqual({ kind: 'holding' })
  })

  it('ESC → CLEAR_FEEDING + capture released', () => {
    const { state, effects } = run(holding, [{ type: 'ESC' }])
    expect(effects[0]).toEqual([
      { type: 'CLEAR_FEEDING' },
      { type: 'SET_CAPTURE', on: false }
    ])
    expect(state).toEqual(idle)
  })

  it('move while holding → UPDATE_FEED + SET_CAPTURE on', () => {
    const { state, effects } = run(holding, [move(123)])
    expect(effects[0]).toEqual([
      { type: 'UPDATE_FEED', x: 123, y: 0 },
      { type: 'SET_CAPTURE', on: true }
    ])
    expect(state).toEqual({ kind: 'holding' })
  })

  it('move during holdingPressed still feeds and keeps the press', () => {
    const { state, effects } = run(holding, [down(50, { onBowl: true }), move(60)])
    // press는 아직 진행 중(up에서 결정)이고, move는 먹이질을 한다.
    expect(effects[1]).toEqual([
      { type: 'UPDATE_FEED', x: 60, y: 0 },
      { type: 'SET_CAPTURE', on: true }
    ])
    expect(state).toEqual({ kind: 'holdingPressed', downX: 50, startedOnBowl: true })
  })
})

describe('gesture — idle capture sync', () => {
  it('idle move emits SET_CAPTURE matching overInteractive', () => {
    expect(reduce(idle, move(10, { overInteractive: true })).effects).toEqual([
      { type: 'SET_CAPTURE', on: true }
    ])
    expect(reduce(idle, move(10, { overInteractive: false })).effects).toEqual([
      { type: 'SET_CAPTURE', on: false }
    ])
  })

  it('idle up syncs capture to overInteractive', () => {
    expect(reduce(idle, up(10, { overInteractive: true })).effects).toEqual([
      { type: 'SET_CAPTURE', on: true }
    ])
  })

  it('down on empty space stays idle with no effects', () => {
    expect(reduce(idle, down(10, {}))).toEqual({ state: idle, effects: [] })
  })
})

describe('gesture — BOWL_REMOVED mid-gesture', () => {
  it('while bowl-dragging → reset to idle, trash cleared, capture released', () => {
    const { state, effects } = run(idle, [
      down(50, { onBowl: true }),
      move(80),
      { type: 'BOWL_REMOVED' }
    ])
    expect(effects[2]).toEqual([
      { type: 'TRASH', visible: false, hot: false },
      { type: 'SET_CAPTURE', on: false }
    ])
    expect(state).toEqual(idle)
  })

  it('while holding → CLEAR_FEEDING + capture released, reset to idle', () => {
    const { state, effects } = run({ kind: 'holding' }, [{ type: 'BOWL_REMOVED' }])
    expect(effects[0]).toEqual([
      { type: 'CLEAR_FEEDING' },
      { type: 'SET_CAPTURE', on: false }
    ])
    expect(state).toEqual(idle)
  })

  it('while holdingPressed → both trash-clear path skipped, feeding cleared', () => {
    const { state, effects } = run({ kind: 'holding' }, [
      down(50, { onBowl: true }),
      { type: 'BOWL_REMOVED' }
    ])
    // holdingPressed는 "holding"(bowlActive 아님)이라 CLEAR_FEEDING + capture만.
    expect(effects[1]).toEqual([
      { type: 'CLEAR_FEEDING' },
      { type: 'SET_CAPTURE', on: false }
    ])
    expect(state).toEqual(idle)
  })

  it('while idle or cat-dragging → no-op (a cat drag is unaffected)', () => {
    expect(reduce(idle, { type: 'BOWL_REMOVED' })).toEqual({ state: idle, effects: [] })
    const dragging: GestureState<Cat> = { kind: 'catDragging', cat: 'c1' }
    expect(reduce(dragging, { type: 'BOWL_REMOVED' })).toEqual({ state: dragging, effects: [] })
  })
})

describe('gesture — ESC when not holding', () => {
  it('is a no-op in idle', () => {
    expect(reduce(idle, { type: 'ESC' })).toEqual({ state: idle, effects: [] })
  })
  it('is a no-op mid cat-drag', () => {
    const dragging: GestureState<Cat> = { kind: 'catDragging', cat: 'c1' }
    expect(reduce(dragging, { type: 'ESC' })).toEqual({ state: dragging, effects: [] })
  })
})
