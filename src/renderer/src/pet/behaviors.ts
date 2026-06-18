import type { Facing, PetDefinition } from './types'

// ─────────────────────────────────────────────────────────────────────────────
// behaviors.ts — the cat's PURE behaviour policy (the "what each behaviour
// computes" half of the engine; `catMachine.ts` owns "what transitions exist").
//
// Every helper here is a pure function: it reads a snapshot of `CatContext` and
// returns a partial patch (or new value) — it never mutates its input. Some
// helpers call `ctx.rng()` (the shared seeded closure); the ORDER of those calls
// must match the original imperative engine exactly, or golden-master parity
// breaks. Queue/jump updates produce NEW arrays/objects (design D6).
// ─────────────────────────────────────────────────────────────────────────────

/** Stop hopping once this close to the food target (px). Prevents jitter. */
export const FEED_STOP_THRESHOLD = 30
/** How far each feeding hop advances toward the target (px). */
export const FEED_HOP_STEP = 70
/**
 * When going to eat a dropped floor pellet, "essentially on top" means within
 * this many px of the pellet x — close enough to eat front-facing rather than
 * leaning left/right. (FD7)
 */
export const EAT_ONTOP_THRESHOLD = 20

/** One queued behaviour beat (pose + how long to hold it). */
export interface Act {
  key: string
  dur: number
  moving: boolean
  speed: number
}

/** The jump arc shared by the startled leap and every feeding/eating hop. */
export interface Jump {
  active: boolean
  t: number
  dur: number
  fromX: number
  dx: number
}

/** The "no jump in progress" sentinel (a fresh object each time it's assigned). */
export const NO_JUMP: Jump = { active: false, t: 0, dur: 0, fromX: 0, dx: 0 }

/** Quantitative cat state — the machine's context, owned here so behaviours type-check. */
export interface CatContext {
  def: PetDefinition
  getMaxX: () => number
  rng: () => number

  x: number
  y: number
  animKey: string
  facing: Facing

  moving: boolean
  speed: number
  remaining: number
  inactivity: number
  sleepAfter: number
  noWake: boolean
  sleepDrag: boolean
  lastMoving: boolean
  queue: Act[]

  jump: Jump

  foodTargetX: number | null

  eatTargetX: number | null
  eatRemaining: number
  onEatenCb: (() => void) | null

  /** Drained + fired by the facade after each send (D4). */
  pendingAfterTransition: Array<() => void>
}

export const playLen = (def: PetDefinition, k: string): number =>
  def.anim[k].frames / def.anim[k].fps

export const rand = (rng: () => number, min: number, max: number): number =>
  min + rng() * (max - min)
// Relies on rng() returning a value in [0, 1) so floor(rng()*len) ∈ [0, len-1].
export const pick = <T>(rng: () => number, arr: readonly T[]): T =>
  arr[Math.floor(rng() * arr.length)]

/** apply(): mirror of the old CatEngine.apply — set the current pose from an Act. */
export function apply(a: Act): Partial<CatContext> {
  return { animKey: a.key, moving: a.moving, speed: a.speed, remaining: a.dur, lastMoving: a.moving }
}

/** startWalk(): pick (maybe flip) facing + a walk Act. */
export function startWalk(ctx: CatContext): Partial<CatContext> {
  let facing = ctx.facing
  if (ctx.rng() < 0.5) facing = facing === 'left' ? 'right' : 'left'
  return {
    facing,
    ...apply({ key: `walk_${facing}`, dur: rand(ctx.rng, 1.5, 3.5), moving: true, speed: ctx.def.walkSpeed })
  }
}

/** startIdle(): pick a calm pose (optionally led by a one-shot punctuation). */
export function startIdle(ctx: CatContext): Partial<CatContext> {
  const { def, rng, facing } = ctx
  const calm: string =
    rng() < 0.5 ? pick(rng, def.calmFront) : `${pick(rng, def.calmDir)}_${facing}`
  // Licking looks odd if held too long — keep it brief; other calm poses linger.
  const dur = calm.startsWith('lick') ? rand(rng, 3, 5) : rand(rng, 10, 18)

  // Occasionally lead with a brief one-shot (yawn/meow/stretch), then settle.
  if (rng() < 0.25) {
    const p = pick(rng, def.punctuation)
    return {
      queue: [{ key: calm, dur, moving: false, speed: 0 }],
      ...apply({ key: p, dur: playLen(def, p), moving: false, speed: 0 })
    }
  }
  return apply({ key: calm, dur, moving: false, speed: 0 })
}

/** autonomous(): calm bias — only stroll occasionally, never twice in a row. */
export function autonomous(ctx: CatContext): Partial<CatContext> {
  if (!ctx.lastMoving && ctx.rng() < 0.25) return startWalk(ctx)
  return startIdle(ctx)
}

/** advance(): pop the queue (apply next), else go autonomous. */
export function advance(ctx: CatContext): Partial<CatContext> {
  if (ctx.queue.length > 0) {
    const [next, ...rest] = ctx.queue
    return { queue: rest, ...apply(next) }
  }
  return autonomous(ctx)
}

/**
 * feedStep(): one feeding decision — hop toward the food, or settle into begging.
 * Returns a patch describing the chosen pose; clamped so hops never overshoot.
 */
export function feedStep(ctx: CatContext): Partial<CatContext> {
  if (ctx.foodTargetX === null) return {}
  const max = ctx.getMaxX()
  const center = ctx.def.displaySize / 2
  const target = Math.max(0, Math.min(max, ctx.foodTargetX - center))
  const dx = target - ctx.x
  const dist = Math.abs(dx)

  if (dist <= FEED_STOP_THRESHOLD) {
    // Close enough: stand on hind legs and beg, facing the food. Only flip when
    // dx is clearly nonzero — keep current facing when directly above (dx === 0).
    let facing = ctx.facing
    if (dx > 0) facing = 'right'
    else if (dx < 0) facing = 'left'
    return {
      facing,
      jump: NO_JUMP,
      y: 0,
      animKey: 'on_hind',
      remaining: 0.2
    }
  }

  const dir: Facing = dx >= 0 ? 'right' : 'left'
  const step = Math.min(FEED_HOP_STEP, dist)
  const targetX = Math.max(0, Math.min(max, ctx.x + step * (dir === 'right' ? 1 : -1)))
  return {
    facing: dir,
    jump: { active: true, t: 0, dur: ctx.def.jumpDur, fromX: ctx.x, dx: targetX - ctx.x },
    animKey: `jump_${dir}`
  }
}

/**
 * eatStep(): one eating decision — hop toward the pellet, or face it and start
 * the one-shot eat animation. Returns a patch (may set eatRemaining to begin).
 */
export function eatStep(ctx: CatContext): Partial<CatContext> {
  if (ctx.eatTargetX === null) return {}
  const max = ctx.getMaxX()
  const center = ctx.def.displaySize / 2
  const target = Math.max(0, Math.min(max, ctx.eatTargetX - center))
  const dx = target - ctx.x
  const dist = Math.abs(dx)

  if (dist <= FEED_STOP_THRESHOLD) {
    const pelletDx = ctx.eatTargetX - (ctx.x + center)
    let facing = ctx.facing
    let eatKey: string
    if (Math.abs(pelletDx) <= EAT_ONTOP_THRESHOLD) {
      eatKey = 'eat_front'
    } else if (pelletDx > 0) {
      facing = 'right'
      eatKey = 'eat_right'
    } else {
      facing = 'left'
      eatKey = 'eat_left'
    }
    return {
      facing,
      jump: NO_JUMP,
      y: 0,
      animKey: eatKey,
      eatRemaining: playLen(ctx.def, eatKey)
    }
  }

  const dir: Facing = dx >= 0 ? 'right' : 'left'
  const step = Math.min(FEED_HOP_STEP, dist)
  const targetX = Math.max(0, Math.min(max, ctx.x + step * (dir === 'right' ? 1 : -1)))
  return {
    facing: dir,
    jump: { active: true, t: 0, dur: ctx.def.jumpDur, fromX: ctx.x, dx: targetX - ctx.x },
    animKey: `jump_${dir}`
  }
}

/**
 * fallAsleep(): pick a sleep pose by facing. Mirrors the old engine's sleepNow()
 * which clears jumpActive/y for ALL modes before sleeping (engine.ts:122-124),
 * so a cat that falls asleep mid-leap doesn't stay frozen aloft with a stale arc.
 */
export function fallAsleep(ctx: CatContext): Partial<CatContext> {
  return {
    moving: false,
    queue: [],
    jump: NO_JUMP,
    y: 0,
    animKey: `${pick(ctx.rng, ctx.def.sleepStyles)}_${ctx.facing}`
  }
}

/** Integrate one frame of the jump arc; returns the new {x,y} + whether it ended. */
export function tickArc(
  ctx: CatContext,
  dt: number
): { x: number; y: number; t: number; ended: boolean } {
  const t = Math.min(1, (ctx.jump.t + dt) / ctx.jump.dur)
  const x = Math.max(0, Math.min(ctx.getMaxX(), ctx.jump.fromX + ctx.jump.dx * t))
  const y = ctx.def.jumpHeight * Math.sin(Math.PI * t)
  return { x, y, t, ended: t >= 1 }
}
