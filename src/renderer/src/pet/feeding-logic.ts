// ─────────────────────────────────────────────────────────────────────────────
// feeding-logic.ts — pure feeding algorithms (no engine refs, no DOM, no IO).
//
// The two bug-prone pieces of the feeding flow, expressed over PLAIN DATA so they
// can be unit-tested in isolation and ported verbatim (the Tauri migration keeps
// the webview JS and rewrites only the shell):
//   • computeGather       — radius membership + fan-out around the cursor
//   • assignNearestFree   — nearest-free-cat → pellet assignment, no double-assign
//
// `world.ts` maps its cats/pellets to these shapes, calls the function, then
// applies the engine/DOM effects from the returned plain results.
// ─────────────────────────────────────────────────────────────────────────────

/** A cat reduced to what the feeding math needs: its CENTER x and eligibility. */
export interface GatherCat {
  /** Sprite CENTER x in client coords (caller computes engine.x + displaySize/2). */
  x: number
  /** Eligible to gather / be assigned (awake or already gathering — not asleep/eating elsewhere). */
  free: boolean
}

/** One gather result: the index into the input `cats` array + where it should go. */
export interface GatherTarget {
  index: number
  targetX: number
}

/**
 * Decide which cats gather around `cursorX` and each one's target x.
 *
 * Membership: free AND within `radius` of the cursor (INCLUSIVE — matches the
 * original `<= radius`). The in-range members are sorted by x and fanned out
 * evenly so they don't stack on one spot (the "only one cat follows / cats pile
 * up" fix): `targetX = cursorX + (i - (n-1)/2) * spacing`.
 *
 * The sort is stable, so members at the same x keep their original (input) order
 * — preserving world.ts's reliance on Array.sort stability. Returns one entry per
 * gathering cat (by input index); cats not listed should be released by the
 * caller (`setFoodTarget(null)`).
 */
export function computeGather(
  cats: ReadonlyArray<GatherCat>,
  cursorX: number,
  radius: number,
  spacing: number
): GatherTarget[] {
  const inRange = cats
    .map((cat, index) => ({ index, x: cat.x, free: cat.free }))
    .filter((c) => c.free && Math.abs(c.x - cursorX) <= radius)
  // Stable sort by x so equal-x members keep input order (matches Array.sort).
  inRange.sort((a, b) => a.x - b.x)
  const n = inRange.length
  return inRange.map((c, i) => ({
    index: c.index,
    targetX: cursorX + (i - (n - 1) / 2) * spacing
  }))
}

/** A cat reduced for assignment: its CENTER x and whether it's free to eat. */
export interface AssignCat {
  x: number
  free: boolean
}

/** A pellet reduced for assignment: its x + current assignment / expiry status. */
export interface AssignPellet {
  x: number
  /** Index into the cats array this pellet is already assigned to, else null. */
  assignedCatIndex: number | null
  /** True while fading out — never (re)assign an expiring pellet. */
  expiring: boolean
}

/** One assignment result: pellet index ← cat index (both into the input arrays). */
export interface Assignment {
  pelletIndex: number
  catIndex: number
}

/**
 * For every unassigned, non-expiring pellet, pick the nearest free cat that isn't
 * already taken, in a single O(P·C) pass. The `taken` set starts from cats
 * already assigned to a pellet and grows as we assign, so no cat is given two
 * pellets in one pass (FD4 no-double-assign). Distance uses `<` (strictly less),
 * so on a tie the EARLIER cat (by input index) wins — deterministic, matching the
 * original iteration order. A pellet with no available free cat is simply omitted
 * (left unassigned; a later pass retries).
 */
export function assignNearestFree(
  cats: ReadonlyArray<AssignCat>,
  pellets: ReadonlyArray<AssignPellet>
): Assignment[] {
  const taken = new Set<number>()
  for (const pellet of pellets) {
    if (pellet.assignedCatIndex !== null) taken.add(pellet.assignedCatIndex)
  }

  const assignments: Assignment[] = []
  pellets.forEach((pellet, pelletIndex) => {
    if (pellet.assignedCatIndex !== null || pellet.expiring) return
    let best = -1
    let bestDist = Infinity
    cats.forEach((cat, catIndex) => {
      if (!cat.free || taken.has(catIndex)) return
      const dist = Math.abs(cat.x - pellet.x)
      if (dist < bestDist) {
        bestDist = dist
        best = catIndex
      }
    })
    if (best !== -1) {
      taken.add(best)
      assignments.push({ pelletIndex, catIndex: best })
    }
  })
  return assignments
}
