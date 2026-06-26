import { describe, it, expect } from 'vitest'
import {
  clampX,
  exceedsDragThreshold,
  pickTopmost,
  pointInRect,
  spriteDestY,
  spriteHitRect,
  type Rect,
} from './geometry'

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

describe('spriteDestY', () => {
  // lowestRow 픽셀의 바닥면 = destY + (lowestRow+1)*scale = screenHeight - catY
  it('바닥(catY=0)에서 lowestRow 바닥면이 screenHeight와 일치한다', () => {
    const destY = spriteDestY(0, 28, 2, 800)
    expect(destY).toBe(742)
    expect(destY + (28 + 1) * 2).toBe(800)
  })

  it('공중(catY>0)에서 lowestRow 바닥면이 screenHeight - catY와 일치한다', () => {
    const destY = spriteDestY(50, 28, 2, 800)
    expect(destY).toBe(692)
    expect(destY + (28 + 1) * 2).toBe(750) // 800 - 50
  })

  it('lowestRow=0, scale=1 — 1픽셀짜리 스프라이트는 screenHeight-catY-1에 그린다', () => {
    expect(spriteDestY(0, 0, 1, 100)).toBe(99)
  })

  it('lowestRow가 frameSize-1이고 scale=1이면 destY=0 (스프라이트가 캔버스 꼭대기부터 시작)', () => {
    expect(spriteDestY(0, 31, 1, 32)).toBe(0)
  })
})

describe('spriteHitRect', () => {
  const box = { x: 2, y: 4, w: 28, h: 24 }

  it('contentBox를 scale만큼 확대해 화면 좌표로 변환한다', () => {
    const hr = spriteHitRect(100, 0, box, 28, 2, 800)
    expect(hr.left).toBe(104)   // 100 + 2*2
    expect(hr.right).toBe(160)  // 100 + (2+28)*2
    expect(hr.top).toBe(750)    // destY(742) + 4*2
    expect(hr.bottom).toBe(798) // destY(742) + (4+24)*2
  })

  it('히트박스 너비/높이가 contentBox * scale과 같다', () => {
    const hr = spriteHitRect(0, 0, box, 28, 2, 800)
    expect(hr.right - hr.left).toBe(box.w * 2)
    expect(hr.bottom - hr.top).toBe(box.h * 2)
  })

  it('catY가 오를수록 히트박스 전체가 위로 이동한다', () => {
    const floor = spriteHitRect(0, 0, box, 28, 2, 800)
    const air = spriteHitRect(0, 50, box, 28, 2, 800)
    expect(air.top).toBe(floor.top - 50)
    expect(air.bottom).toBe(floor.bottom - 50)
  })

  it('catX가 오를수록 히트박스 전체가 오른쪽으로 이동한다', () => {
    const left = spriteHitRect(0, 0, box, 28, 2, 800)
    const right = spriteHitRect(100, 0, box, 28, 2, 800)
    expect(right.left - left.left).toBe(100)
    expect(right.right - left.right).toBe(100)
  })
})
