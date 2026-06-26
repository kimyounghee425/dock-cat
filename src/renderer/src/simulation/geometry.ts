// geometry.ts — 순수 포인터 기하/히트테스트 (DOM·IO 없음).
// 호출부(world.ts)가 포인터 이벤트 시점에 live rect를 읽어 plain 데이터로 넘기고,
// 여기서는 산술만 한다. 순수 유지 → 단위 테스트 가능 + 이식 가능.

export interface Point {
  x: number
  y: number
}

// HitRect(고양이 히트박스)와 브라우저 DOMRect 둘 다 구조적으로 만족 → 호출부가
// 어느 쪽이든 그대로 넘길 수 있다.
export interface Rect {
  left: number
  top: number
  right: number
  bottom: number
}

// 히트 후보: rect + 맞았을 때 돌려줄 값.
export interface Hit<T> {
  rect: Rect
  ref: T
}

// 네 변 모두 inclusive(경계 포함) 판정.
export function pointInRect(pt: Point, rect: Rect): boolean {
  return pt.x >= rect.left && pt.x <= rect.right && pt.y >= rect.top && pt.y <= rect.bottom
}

// `pt` 아래의 topmost 히트(없으면 null). 후보는 draw 순서(index 0 = 맨 아래)로 주어지므로
// topmost는 "마지막으로 맞은" 것 — 리스트를 끝에서부터 훑어 첫 히트를 쓰던 것과 동치.
export function pickTopmost<T>(candidates: ReadonlyArray<Hit<T>>, pt: Point): T | null {
  let hit: T | null = null
  for (const candidate of candidates) {
    if (pointInRect(pt, candidate.rect)) hit = candidate.ref
  }
  return hit
}

export function clampX(x: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, x))
}

// 클릭이 아니라 드래그로 칠 만큼 눌렀던 지점에서 벗어났는가. STRICTLY 초과이므로
// 정확히 threshold px는 아직 클릭이다.
export function exceedsDragThreshold(downX: number, x: number, threshold = 4): boolean {
  return Math.abs(x - downX) > threshold
}

// 스프라이트 픽셀 공간의 불투명 bounding box.
export interface Box {
  x: number
  y: number
  w: number
  h: number
}

// 단일 canvas 렌더링에서 스프라이트를 그릴 CSS y 좌표(top).
// catY: 엔진 y (0 = 바닥, 위로 증가), lowestRow: 스프라이트에서 가장 아래 불투명 row(0-indexed).
// lowestRow 픽셀의 바닥면이 화면 바닥(screenHeight - catY)에 닿도록 destY를 역산한다.
export function spriteDestY(
  catY: number,
  lowestRow: number,
  scale: number,
  screenHeight: number
): number {
  return screenHeight - catY - (lowestRow + 1) * scale
}

// 단일 canvas 좌표계에서의 히트 Rect.
// contentBox: 스프라이트 픽셀 공간의 불투명 bounding box.
export function spriteHitRect(
  catX: number,
  catY: number,
  contentBox: Box,
  lowestRow: number,
  scale: number,
  screenHeight: number
): Rect {
  const destY = spriteDestY(catY, lowestRow, scale, screenHeight)
  return {
    left: catX + contentBox.x * scale,
    top: destY + contentBox.y * scale,
    right: catX + (contentBox.x + contentBox.w) * scale,
    bottom: destY + (contentBox.y + contentBox.h) * scale,
  }
}
