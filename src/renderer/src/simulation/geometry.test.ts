import { describe, it, expect } from 'vitest'
import { clampX, exceedsDragThreshold, pickTopmost, pointInRect, type Rect } from './geometry'

const rect = (left: number, top: number, right: number, bottom: number): Rect => ({
  left,
  top,
  right,
  bottom
})

describe('pointInRect', () => {
  const r = rect(10, 20, 30, 40)

  it('is true for an interior point', () => {
    expect(pointInRect({ x: 20, y: 30 }, r)).toBe(true)
  })

  it('is false for a point outside on each side', () => {
    expect(pointInRect({ x: 9, y: 30 }, r)).toBe(false)
    expect(pointInRect({ x: 31, y: 30 }, r)).toBe(false)
    expect(pointInRect({ x: 20, y: 19 }, r)).toBe(false)
    expect(pointInRect({ x: 20, y: 41 }, r)).toBe(false)
  })

  it('is INCLUSIVE on every edge and corner (matches original >=/<=)', () => {
    expect(pointInRect({ x: 10, y: 30 }, r)).toBe(true)
    expect(pointInRect({ x: 30, y: 30 }, r)).toBe(true)
    expect(pointInRect({ x: 20, y: 20 }, r)).toBe(true)
    expect(pointInRect({ x: 20, y: 40 }, r)).toBe(true)
    expect(pointInRect({ x: 10, y: 20 }, r)).toBe(true)
    expect(pointInRect({ x: 30, y: 40 }, r)).toBe(true)
  })
})

describe('pickTopmost', () => {
  it('returns null when the point is outside every candidate', () => {
    const candidates = [
      { rect: rect(0, 0, 10, 10), ref: 'a' },
      { rect: rect(20, 20, 30, 30), ref: 'b' }
    ]
    expect(pickTopmost(candidates, { x: 15, y: 15 })).toBeNull()
  })

  it('returns the only matching candidate when they do not overlap', () => {
    const candidates = [
      { rect: rect(0, 0, 10, 10), ref: 'a' },
      { rect: rect(20, 20, 30, 30), ref: 'b' }
    ]
    expect(pickTopmost(candidates, { x: 5, y: 5 })).toBe('a')
    expect(pickTopmost(candidates, { x: 25, y: 25 })).toBe('b')
  })

  it('picks the topmost (last in draw order) when candidates overlap', () => {
    // draw 순서: index 0이 맨 아래, 뒤 index가 위.
    const candidates = [
      { rect: rect(0, 0, 100, 100), ref: 'bottom' },
      { rect: rect(0, 0, 100, 100), ref: 'middle' },
      { rect: rect(0, 0, 100, 100), ref: 'top' }
    ]
    expect(pickTopmost(candidates, { x: 50, y: 50 })).toBe('top')
  })

  it('picks the topmost among only those actually under the point', () => {
    const candidates = [
      { rect: rect(0, 0, 100, 100), ref: 'bottom-wide' },
      { rect: rect(200, 200, 300, 300), ref: 'top-elsewhere' }
    ]
    // 뒤 후보가 위에 있지만 point 아래가 아님 → 앞 후보가 이긴다.
    expect(pickTopmost(candidates, { x: 50, y: 50 })).toBe('bottom-wide')
  })

  it('returns null for an empty candidate list', () => {
    expect(pickTopmost([], { x: 0, y: 0 })).toBeNull()
  })
})

describe('clampX', () => {
  it('returns x unchanged when inside the range', () => {
    expect(clampX(50, 0, 100)).toBe(50)
  })

  it('clamps below the minimum up to min', () => {
    expect(clampX(-5, 0, 100)).toBe(0)
  })

  it('clamps above the maximum down to max', () => {
    expect(clampX(150, 0, 100)).toBe(100)
  })

  it('clamps a negative x to a zero min', () => {
    expect(clampX(-1000, 0, 800)).toBe(0)
  })

  it('clamps an x past the screen width down to max', () => {
    expect(clampX(9999, 0, 800)).toBe(800)
  })

  it('returns the bounds exactly when x equals them', () => {
    expect(clampX(0, 0, 100)).toBe(0)
    expect(clampX(100, 0, 100)).toBe(100)
  })
})

describe('exceedsDragThreshold', () => {
  it('is false at exactly the threshold (4px is still a click)', () => {
    expect(exceedsDragThreshold(100, 104)).toBe(false)
    expect(exceedsDragThreshold(100, 96)).toBe(false) // 음의 방향으로 정확히 4
  })

  it('is true just past the threshold (5px is a drag)', () => {
    expect(exceedsDragThreshold(100, 105)).toBe(true)
  })

  it('uses absolute distance, so a negative delta past threshold is a drag', () => {
    expect(exceedsDragThreshold(100, 95)).toBe(true) // delta -5 → |5| > 4 (음수 부호 무관)
  })

  it('is false for no movement', () => {
    expect(exceedsDragThreshold(100, 100)).toBe(false)
  })

  it('honours a custom threshold', () => {
    expect(exceedsDragThreshold(0, 10, 10)).toBe(false) // 정확히 10
    expect(exceedsDragThreshold(0, 11, 10)).toBe(true)
  })
})
