// ─────────────────────────────────────────────────────────────────────────────
// geometry.ts — pure pointer geometry / hit-testing (no DOM, no IO).
//
// `world.ts` reads the live DOM rects at the moment of each pointer event and
// passes them in here as plain data; these functions only do arithmetic. Keeping
// this layer pure makes the hit-test semantics unit-testable and portable (the
// Tauri migration keeps the webview JS verbatim and rewrites only the shell).
// ─────────────────────────────────────────────────────────────────────────────

/** A pointer position in client coordinates. */
export interface Point {
  x: number
  y: number
}

/**
 * An axis-aligned rectangle in client coordinates. Structurally satisfied by
 * both `HitRect` (cat hit boxes) and the browser's `DOMRect`
 * (`getBoundingClientRect()`), so call sites can pass either without adapting.
 */
export interface Rect {
  left: number
  top: number
  right: number
  bottom: number
}

/** A candidate hit target: its rect paired with the value to return if hit. */
export interface Hit<T> {
  rect: Rect
  ref: T
}

/**
 * Point-in-rect test with bounds INCLUSIVE on all four edges — byte-faithful to
 * world.ts's original `cx >= left && cx <= right && cy >= top && cy <= bottom`.
 */
export function pointInRect(pt: Point, rect: Rect): boolean {
  return pt.x >= rect.left && pt.x <= rect.right && pt.y >= rect.top && pt.y <= rect.bottom
}

/**
 * Pick the topmost hit under `pt`, or null if none. Candidates are given in DRAW
 * order (index 0 = first drawn / bottom-most), so the topmost hit is the
 * LAST-matching one — preserving world.ts's original behaviour of scanning the
 * cat list from last to first and returning the first match it finds.
 */
export function pickTopmost<T>(candidates: ReadonlyArray<Hit<T>>, pt: Point): T | null {
  let hit: T | null = null
  for (const candidate of candidates) {
    if (pointInRect(pt, candidate.rect)) hit = candidate.ref
  }
  return hit
}

/** Clamp `x` to the inclusive range [min, max]. */
export function clampX(x: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, x))
}

/**
 * Whether the pointer has moved far enough from its press point to count as a
 * drag rather than a click. Matches world.ts's `Math.abs(x - downX) > 4` — note
 * STRICTLY greater than, so exactly `threshold` px is still a click.
 */
export function exceedsDragThreshold(downX: number, x: number, threshold = 4): boolean {
  return Math.abs(x - downX) > threshold
}
