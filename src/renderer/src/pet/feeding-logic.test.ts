import { describe, it, expect } from 'vitest'
import {
  assignNearestFree,
  computeGather,
  type AssignCat,
  type AssignPellet,
  type GatherCat
} from './feeding-logic'

const RADIUS = 350
const SPACING = 90 // arbitrary fixed spacing for assertions (real app: displaySize*0.7)

describe('computeGather — membership', () => {
  it('includes EVERY free cat in range (not just the nearest)', () => {
    // The "only one cat follows" regression: all three in-range free cats gather.
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
      { x: 0, free: true }, // |0-400| = 400 > 350 → out
      { x: 50, free: true }, // |50-400| = 350 == radius → IN (inclusive)
      { x: 400, free: true } // on cursor → in
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
    // offsets: (0 - 0.5)*90 = -45 ; (1 - 0.5)*90 = +45
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
    // offsets: -90, 0, +90
    expect(out.map((t) => t.targetX)).toEqual([110, 200, 290])
  })

  it('targets are sorted-by-x order and never cross (ascending)', () => {
    // Provide cats out of x-order; result must be in x-order so they don't cross.
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
    // Sorted by x → original indices [1 (x100), 2 (x200), 0 (x300)], offsets -90,0,+90.
    expect(out).toEqual([
      { index: 1, targetX: 110 },
      { index: 2, targetX: 200 },
      { index: 0, targetX: 290 }
    ])
    // targetX strictly ascending → no crossing.
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
    // offsets for n=4: -1.5,-0.5,+0.5,+1.5 * 90 = -135,-45,45,135 → symmetric.
    expect(out.map((t) => t.targetX)).toEqual([-135, -45, 45, 135])
  })

  it('keeps input order for cats at the same x (stable sort)', () => {
    const out = computeGather(
      [
        { x: 100, free: true }, // index 0
        { x: 100, free: true }, // index 1 — same x
        { x: 100, free: true } // index 2 — same x
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
    // Both pellets are nearest to cat 0, but cat 0 can only take one.
    const cats = [free(100), free(105)]
    const out = assignNearestFree(cats, [pellet(100), pellet(101)])
    const catIndices = out.map((a) => a.catIndex)
    expect(new Set(catIndices).size).toBe(catIndices.length) // all distinct
    expect(out).toEqual([
      { pelletIndex: 0, catIndex: 0 }, // pellet 0 → nearest cat 0
      { pelletIndex: 1, catIndex: 1 } // pellet 1 → cat 0 taken, falls to cat 1
    ])
  })

  it('skips cats already taken by an existing assignment', () => {
    // Cat 0 is pre-assigned to pellet 0; pellet 1 must use cat 1 even if 0 is nearer.
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
      { x: 0, assignedCatIndex: 0, expiring: false }, // already assigned
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
    // Two cats equidistant from the pellet → strictly-less `<` keeps the first.
    const cats = [free(90), free(110)]
    const out = assignNearestFree(cats, [pellet(100)])
    expect(out).toEqual([{ pelletIndex: 0, catIndex: 0 }])
  })

  it('leaves a pellet unassigned when no free cat is available', () => {
    const cats = [busy(0)]
    expect(assignNearestFree(cats, [pellet(0)])).toEqual([])
  })

  it('a freed cat gets reassigned on the next pass', () => {
    // Pass 1: cat busy → pellet unassigned. Pass 2: cat free → assigned.
    const pellets = [pellet(0)]
    expect(assignNearestFree([busy(0)], pellets)).toEqual([])
    expect(assignNearestFree([free(0)], pellets)).toEqual([{ pelletIndex: 0, catIndex: 0 }])
  })
})
