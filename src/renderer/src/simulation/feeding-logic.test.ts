import { describe, it, expect } from 'vitest'
import {
  assignNearestFree,
  computeGather,
  type AssignCat,
  type AssignPellet,
  type GatherCat
} from './feeding-logic'

const RADIUS = 350
const SPACING = 90 // 단언용 고정 spacing(실제 앱: displaySize*0.7)

describe('computeGather — membership', () => {
  it('includes EVERY free cat in range (not just the nearest)', () => {
    // "한 마리만 따라옴" 회귀 방지: 범위 내 free 고양이 셋 다 모인다.
    const cats: GatherCat[] = [
      { x: 100, free: true },
      { x: 120, free: true },
      { x: 140, free: true }
    ]
    const out = computeGather(cats, 120, RADIUS, SPACING)
    expect(out.map((t) => t.index).sort((a, b) => a - b)).toEqual([0, 1, 2])
  })

  it('excludes out-of-range cats (inclusive boundary at exactly radius)', () => {
    const cats: GatherCat[] = [
      { x: 0, free: true }, // |0-400| = 400 > 350 → 제외
      { x: 50, free: true }, // |50-400| = 350 == radius → 포함(inclusive)
      { x: 400, free: true } // 커서 위 → 포함
    ]
    const out = computeGather(cats, 400, RADIUS, SPACING)
    expect(out.map((t) => t.index).sort((a, b) => a - b)).toEqual([1, 2])
  })

  it('excludes not-free cats even if in range', () => {
    const cats: GatherCat[] = [
      { x: 100, free: false },
      { x: 110, free: true }
    ]
    const out = computeGather(cats, 105, RADIUS, SPACING)
    expect(out.map((t) => t.index)).toEqual([1])
  })
})

describe('computeGather — fan-out', () => {
  it('n=1: the single gatherer targets exactly the cursor', () => {
    const out = computeGather([{ x: 200, free: true }], 200, RADIUS, SPACING)
    expect(out).toEqual([{ index: 0, targetX: 200 }])
  })

  it('n=2: symmetric ±spacing/2 about the cursor', () => {
    const out = computeGather(
      [
        { x: 100, free: true },
        { x: 300, free: true }
      ],
      200,
      RADIUS,
      SPACING
    )
    // offset: (0 - 0.5)*90 = -45 ; (1 - 0.5)*90 = +45
    expect(out).toEqual([
      { index: 0, targetX: 155 },
      { index: 1, targetX: 245 }
    ])
  })

  it('odd n: middle gatherer sits on the cursor, others symmetric', () => {
    const out = computeGather(
      [
        { x: 100, free: true },
        { x: 200, free: true },
        { x: 300, free: true }
      ],
      200,
      RADIUS,
      SPACING
    )
    // offset: -90, 0, +90
    expect(out.map((t) => t.targetX)).toEqual([110, 200, 290])
  })

  it('targets are sorted-by-x order and never cross (ascending)', () => {
    // x 순서가 뒤섞인 입력; 결과는 x 순서여야 서로 교차하지 않는다.
    const out = computeGather(
      [
        { x: 300, free: true },
        { x: 100, free: true },
        { x: 200, free: true }
      ],
      200,
      RADIUS,
      SPACING
    )
    // x 정렬 → 원래 index [1 (x100), 2 (x200), 0 (x300)], offset -90,0,+90.
    expect(out).toEqual([
      { index: 1, targetX: 110 },
      { index: 2, targetX: 200 },
      { index: 0, targetX: 290 }
    ])
    // targetX가 순증가 → 교차 없음.
    const xs = out.map((t) => t.targetX)
    expect(xs).toEqual([...xs].sort((a, b) => a - b))
  })

  it('even n offsets are symmetric about the cursor', () => {
    const out = computeGather(
      [
        { x: 10, free: true },
        { x: 20, free: true },
        { x: 30, free: true },
        { x: 40, free: true }
      ],
      0,
      RADIUS,
      SPACING
    )
    // n=4 offset: (-1.5,-0.5,+0.5,+1.5)*90 = -135,-45,45,135 → 대칭.
    expect(out.map((t) => t.targetX)).toEqual([-135, -45, 45, 135])
  })

  it('keeps input order for cats at the same x (stable sort)', () => {
    const out = computeGather(
      [
        { x: 100, free: true }, // index 0
        { x: 100, free: true }, // index 1 — 같은 x
        { x: 100, free: true } // index 2 — 같은 x
      ],
      100,
      RADIUS,
      SPACING
    )
    expect(out.map((t) => t.index)).toEqual([0, 1, 2])
  })

  it('returns empty when nobody is eligible', () => {
    expect(computeGather([{ x: 9999, free: true }], 0, RADIUS, SPACING)).toEqual([])
    expect(computeGather([], 0, RADIUS, SPACING)).toEqual([])
  })
})

describe('assignNearestFree', () => {
  const free = (x: number): AssignCat => ({ x, free: true })
  const busy = (x: number): AssignCat => ({ x, free: false })
  const pellet = (x: number): AssignPellet => ({ x, assignedCatIndex: null, expiring: false })

  it('assigns the nearest free cat to a pellet', () => {
    const cats = [free(0), free(100), free(500)]
    const out = assignNearestFree(cats, [pellet(120)])
    expect(out).toEqual([{ pelletIndex: 0, catIndex: 1 }])
  })

  it('never gives the same cat to two pellets (no double-assign)', () => {
    // 두 pellet 모두 cat 0이 최근접이지만 cat 0은 하나만 받을 수 있다.
    const cats = [free(100), free(105)]
    const out = assignNearestFree(cats, [pellet(100), pellet(101)])
    const catIndices = out.map((a) => a.catIndex)
    expect(new Set(catIndices).size).toBe(catIndices.length) // 모두 distinct
    expect(out).toEqual([
      { pelletIndex: 0, catIndex: 0 }, // pellet 0 → 최근접 cat 0
      { pelletIndex: 1, catIndex: 1 } // pellet 1 → cat 0은 taken, cat 1로
    ])
  })

  it('skips cats already taken by an existing assignment', () => {
    // cat 0이 pellet 0에 선배정됨; cat 0이 더 가까워도 pellet 1은 cat 1을 써야 한다.
    const cats = [free(100), free(500)]
    const pellets: AssignPellet[] = [
      { x: 100, assignedCatIndex: 0, expiring: false },
      { x: 110, assignedCatIndex: null, expiring: false }
    ]
    const out = assignNearestFree(cats, pellets)
    expect(out).toEqual([{ pelletIndex: 1, catIndex: 1 }])
  })

  it('skips already-assigned and expiring pellets', () => {
    const cats = [free(0)]
    const pellets: AssignPellet[] = [
      { x: 0, assignedCatIndex: 0, expiring: false }, // 이미 배정됨
      { x: 0, assignedCatIndex: null, expiring: true } // expiring
    ]
    expect(assignNearestFree(cats, pellets)).toEqual([])
  })

  it('skips not-free cats', () => {
    const cats = [busy(100), free(500)]
    const out = assignNearestFree(cats, [pellet(100)])
    expect(out).toEqual([{ pelletIndex: 0, catIndex: 1 }])
  })

  it('breaks distance ties deterministically toward the earlier cat index', () => {
    // pellet에서 등거리인 두 고양이 → strictly-less `<`라 앞 것을 유지.
    const cats = [free(90), free(110)]
    const out = assignNearestFree(cats, [pellet(100)])
    expect(out).toEqual([{ pelletIndex: 0, catIndex: 0 }])
  })

  it('leaves a pellet unassigned when no free cat is available', () => {
    const cats = [busy(0)]
    expect(assignNearestFree(cats, [pellet(0)])).toEqual([])
  })

  it('a freed cat gets reassigned on the next pass', () => {
    // 1패스: cat busy → 미배정. 2패스: cat free → 배정.
    const pellets = [pellet(0)]
    expect(assignNearestFree([busy(0)], pellets)).toEqual([])
    expect(assignNearestFree([free(0)], pellets)).toEqual([{ pelletIndex: 0, catIndex: 0 }])
  })
})
