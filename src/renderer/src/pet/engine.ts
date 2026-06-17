import type { Facing, PetDefinition } from './types'

type Mode = 'awake' | 'asleep' | 'dragging' | 'feeding' | 'eating'

/** Stop hopping once this close to the food target (px). Prevents jitter. */
const FEED_STOP_THRESHOLD = 30
/** How far each feeding hop advances toward the target (px). */
const FEED_HOP_STEP = 70
/**
 * When going to eat a dropped floor pellet, "essentially on top" means within
 * this many px of the pellet x — close enough to eat front-facing rather than
 * leaning left/right. (FD7)
 */
const EAT_ONTOP_THRESHOLD = 20
interface Act {
  key: string
  dur: number
  moving: boolean
  speed: number
}

const rand = (min: number, max: number): number => min + Math.random() * (max - min)
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)]

/**
 * Calm, cat-like behaviour. Mostly sits/grooms in one spot for 10s+ at a time,
 * with the occasional short stroll. Never runs or jumps on its own — those only
 * happen as a startled reaction to being picked up and put down. Sleeps after a
 * configurable idle period and hisses when woken.
 */
export class CatEngine {
  x: number
  y = 0 // height above the floor, px (only nonzero mid-jump)
  animKey: string = 'tailwag_sit_front'

  private def: PetDefinition
  private mode: Mode = 'awake'
  private facing: Facing = 'left'
  private getMaxX: () => number

  private moving = false
  private speed = 0
  private remaining = 0
  private inactivity = 0
  private sleepAfter: number
  private noWake = false
  private sleepDrag = false // dragging an asleep cat while "don't wake" is on
  private lastMoving = false
  private queue: Act[] = []

  // jump arc (the startled leap on drop AND each feeding hop reuse this)
  private jumpActive = false
  private jumpT = 0
  private jumpDur = 0
  private jumpFromX = 0
  private jumpDX = 0

  // feeding: target x of the held food (cursor) the cat hops toward & begs under
  private foodTargetX: number | null = null

  // eating: x of the dropped floor pellet this cat was assigned to go eat, and
  // the one-shot callback fired when the eat animation finishes so PetWorld can
  // remove the pellet + free the cat. eatRemaining counts down the eat anim.
  private eatTargetX: number | null = null
  private eatRemaining = 0
  private onEatenCb: (() => void) | null = null

  constructor(opts: {
    def: PetDefinition
    startX: number
    getMaxX: () => number
    sleepAfter: number
  }) {
    this.def = opts.def
    this.x = opts.startX
    this.getMaxX = opts.getMaxX
    this.sleepAfter = opts.sleepAfter
    this.startIdle()
  }

  private playLen(k: string): number {
    return this.def.anim[k].frames / this.def.anim[k].fps
  }

  isAsleep(): boolean {
    return this.mode === 'asleep'
  }

  /** True while playing the one-shot eat animation for an assigned pellet. */
  isEating(): boolean {
    return this.mode === 'eating'
  }

  /**
   * Eligible to be assigned a dropped pellet: awake or gathering (feeding), and
   * not asleep / being dragged / already eating another pellet. PetWorld also
   * tracks pellet→cat assignment so a free cat is only ever given one pellet.
   */
  isFreeToEat(): boolean {
    return this.mode === 'awake' || this.mode === 'feeding'
  }

  setSleepAfter(sec: number): void {
    this.sleepAfter = sec
    if (this.mode === 'awake') this.inactivity = 0
  }

  setNoWake(on: boolean): void {
    this.noWake = on
  }

  /** Force sleep right now (used by the "sleep all" button). */
  sleepNow(): void {
    if (this.mode === 'awake' || this.mode === 'feeding' || this.mode === 'eating') {
      // Clear any feeding/eating state so it doesn't linger after falling asleep.
      // PetWorld unassigns the pellet (if eating) in its sleepAll() loop. We drop
      // the callback here so it can't fire after the cat is asleep.
      this.foodTargetX = null
      this.eatTargetX = null
      this.onEatenCb = null
      this.eatRemaining = 0
      this.jumpActive = false
      this.y = 0
      this.fallAsleep()
    }
  }

  /** Wake right now without a hiss (used by the "wake all" button). */
  wakeNow(): void {
    if (this.mode === 'asleep') {
      this.inactivity = 0
      this.mode = 'awake'
      this.startIdle()
    }
  }

  /**
   * Feeding: PetWorld passes the held-food x (cursor) for in-range awake cats,
   * or null to release. Sleeping/dragged cats ignore it (a no-op) so feeding
   * never disturbs the "don't wake" / drag flows.
   *  - non-null: enter `feeding`, hop toward x, beg (on_hind) once close.
   *  - null while feeding: exit cleanly back to normal autonomous behaviour.
   */
  setFoodTarget(x: number | null): void {
    // Asleep/dragged cats ignore food; an eating cat is committed to its pellet
    // and must not be pulled back into gathering (FD4).
    if (this.mode === 'asleep' || this.mode === 'dragging' || this.mode === 'eating') return
    if (x === null) {
      if (this.mode === 'feeding') {
        this.foodTargetX = null
        this.jumpActive = false
        this.y = 0
        this.moving = false
        this.queue = []
        this.mode = 'awake'
        this.inactivity = 0
        this.startIdle()
      }
      return
    }
    this.foodTargetX = x
    if (this.mode !== 'feeding') {
      this.mode = 'feeding'
      this.moving = false
      this.queue = []
      this.jumpActive = false
      this.y = 0
      // Decide what to do this frame (hop toward / beg) based on distance.
      this.feedStep()
    }
  }

  /**
   * Assigned a dropped floor pellet: leave gathering/idle, hop to `x`, play the
   * eat animation once (facing chosen by approach direction), then fire
   * `onEaten` so PetWorld removes the pellet and frees this cat. Sleeping/dragged
   * cats are never assigned (PetWorld only picks isFreeToEat() cats), but guard
   * anyway so a stray call can't disturb those flows.
   */
  goEat(x: number, onEaten: () => void): void {
    if (this.mode === 'asleep' || this.mode === 'dragging') return
    // Override any in-progress gather (this cat broke off to eat) and any prior
    // eat assignment (shouldn't happen — PetWorld prevents double-assign — but
    // be defensive so the latest assignment wins cleanly).
    this.foodTargetX = null
    this.eatTargetX = x
    this.onEatenCb = onEaten
    this.mode = 'eating'
    this.moving = false
    this.queue = []
    this.jumpActive = false
    this.y = 0
    this.inactivity = 0
    this.eatStep() // start hopping toward the pellet (or eat immediately if on it)
  }

  /**
   * Cancel an in-progress eat WITHOUT firing onEaten (the pellet was removed out
   * from under the cat — expired, capped out, or world torn down). The cat
   * reverts to normal autonomous behaviour. Safe to call when not eating.
   */
  cancelEat(): void {
    if (this.mode !== 'eating') return
    this.eatTargetX = null
    this.onEatenCb = null
    this.eatRemaining = 0
    this.jumpActive = false
    this.y = 0
    this.moving = false
    this.queue = []
    this.mode = 'awake'
    this.inactivity = 0
    this.startIdle()
  }

  /** Drive the eating mode each frame: hop to the pellet, then play eat once. */
  private tickEating(dt: number): void {
    if (this.eatTargetX === null) return

    // Travel phase: reuse the hop arc to approach the pellet.
    if (this.jumpActive) {
      this.jumpT += dt
      const t = Math.min(1, this.jumpT / this.jumpDur)
      this.x = Math.max(0, Math.min(this.getMaxX(), this.jumpFromX + this.jumpDX * t))
      this.y = this.def.jumpHeight * Math.sin(Math.PI * t)
      if (t >= 1) {
        this.jumpActive = false
        this.y = 0
        this.eatStep() // next hop or begin eating
      }
      return
    }

    // Eat phase: play the eat animation once, then fire the completion callback.
    if (this.eatRemaining > 0) {
      this.eatRemaining -= dt
      if (this.eatRemaining <= 0) {
        const cb = this.onEatenCb
        // Reset state BEFORE the callback so a re-entrant goEat() from inside the
        // callback (PetWorld reassigning) isn't clobbered afterwards.
        this.eatTargetX = null
        this.onEatenCb = null
        this.mode = 'awake'
        this.inactivity = 0
        this.startIdle()
        cb?.()
      }
    }
  }

  /**
   * One eating decision: if the pellet is farther than the stop threshold, hop
   * toward it; otherwise face it and begin the one-shot eat animation. Direction
   * is chosen by sign of (pelletX - catX); within EAT_ONTOP_THRESHOLD the cat is
   * essentially on top of the pellet so it eats front-facing. (FD7)
   */
  private eatStep(): void {
    if (this.eatTargetX === null) return
    const max = this.getMaxX()
    const center = this.def.displaySize / 2
    // Compare sprite center to the pellet x so the cat lands over the pellet.
    const target = Math.max(0, Math.min(max, this.eatTargetX - center))
    const dx = target - this.x
    const dist = Math.abs(dx)

    if (dist <= FEED_STOP_THRESHOLD) {
      // Arrived: pick eat facing by where the pellet sits relative to the cat.
      const pelletDx = this.eatTargetX - (this.x + center)
      let eatKey: string
      if (Math.abs(pelletDx) <= EAT_ONTOP_THRESHOLD) {
        eatKey = 'eat_front'
      } else if (pelletDx > 0) {
        this.facing = 'right'
        eatKey = 'eat_right'
      } else {
        this.facing = 'left'
        eatKey = 'eat_left'
      }
      this.jumpActive = false
      this.y = 0
      this.animKey = eatKey
      this.eatRemaining = this.playLen(eatKey)
      return
    }

    // Hop toward the pellet by a bounded step (never past it, never off-screen).
    const dir: Facing = dx >= 0 ? 'right' : 'left'
    this.facing = dir
    const step = Math.min(FEED_HOP_STEP, dist)
    const targetX = Math.max(0, Math.min(max, this.x + step * (dir === 'right' ? 1 : -1)))
    this.jumpActive = true
    this.jumpT = 0
    this.jumpDur = this.def.jumpDur
    this.jumpFromX = this.x
    this.jumpDX = targetX - this.x
    this.animKey = `jump_${dir}`
  }

  /** Drive the feeding mode each frame: hop arc, then beg under the target. */
  private tickFeeding(dt: number): void {
    if (this.foodTargetX === null) return

    if (this.jumpActive) {
      this.jumpT += dt
      const t = Math.min(1, this.jumpT / this.jumpDur)
      this.x = Math.max(0, Math.min(this.getMaxX(), this.jumpFromX + this.jumpDX * t))
      this.y = this.def.jumpHeight * Math.sin(Math.PI * t)
      if (t >= 1) {
        this.jumpActive = false
        this.y = 0
        this.feedStep() // chain the next hop or settle into begging
      }
      return
    }

    // Waiting/begging: keep facing the target side in case the cursor moved.
    this.remaining -= dt
    if (this.remaining <= 0) this.feedStep()
  }

  /**
   * One feeding decision: if the target is farther than the stop threshold,
   * start a hop toward it; otherwise hold the begging pose facing the target.
   * Clamped so hops never overshoot the target or the screen edge (FD6).
   */
  private feedStep(): void {
    if (this.foodTargetX === null) return
    const max = this.getMaxX()
    const center = this.def.displaySize / 2
    // Target the sprite-left position that puts the sprite CENTER over the food x,
    // matching the same convention used in eatStep(). This means the cat's body
    // is centred under the cursor rather than its left edge touching it.
    const target = Math.max(0, Math.min(max, this.foodTargetX - center))
    const dx = target - this.x
    const dist = Math.abs(dx)

    if (dist <= FEED_STOP_THRESHOLD) {
      // Close enough: stand on hind legs and beg, facing the food.
      // Only flip when dx is clearly nonzero — preserve current facing when the
      // cursor is directly above the cat (dx === 0) to avoid an arbitrary flip.
      if (dx > 0) this.facing = 'right'
      else if (dx < 0) this.facing = 'left'
      // dx === 0: keep this.facing as-is
      this.jumpActive = false
      this.y = 0
      this.animKey = 'on_hind'
      // Re-check periodically so a moving cursor re-orients the pose.
      this.remaining = 0.2
      return
    }

    // Hop toward the target by a bounded step (never past it, never off-screen).
    const dir: Facing = dx >= 0 ? 'right' : 'left'
    this.facing = dir
    const step = Math.min(FEED_HOP_STEP, dist)
    const targetX = Math.max(0, Math.min(max, this.x + step * (dir === 'right' ? 1 : -1)))
    this.jumpActive = true
    this.jumpT = 0
    this.jumpDur = this.def.jumpDur
    this.jumpFromX = this.x
    this.jumpDX = targetX - this.x
    this.animKey = `jump_${dir}`
  }

  tick(dt: number): void {
    if (this.mode === 'feeding') {
      this.tickFeeding(dt)
      return
    }
    if (this.mode === 'eating') {
      this.tickEating(dt)
      return
    }
    if (this.mode !== 'awake') return

    this.inactivity += dt
    if (this.inactivity >= this.sleepAfter) {
      this.fallAsleep()
      return
    }

    if (this.jumpActive) {
      this.jumpT += dt
      const t = Math.min(1, this.jumpT / this.jumpDur)
      this.x = Math.max(0, Math.min(this.getMaxX(), this.jumpFromX + this.jumpDX * t))
      this.y = this.def.jumpHeight * Math.sin(Math.PI * t) // parabolic hop
      if (t >= 1) {
        this.jumpActive = false
        this.y = 0
      }
      this.remaining -= dt
      if (this.remaining <= 0) this.advance()
      return
    }

    if (this.moving) {
      const dir = this.facing === 'right' ? 1 : -1
      this.x += this.speed * dir * dt
      const max = this.getMaxX()
      if (this.x <= 0) {
        this.x = 0
        this.turn('right')
      } else if (this.x >= max) {
        this.x = max
        this.turn('left')
      }
    }

    this.remaining -= dt
    if (this.remaining <= 0) this.advance()
  }

  /** Plain click: wake + hiss if asleep, otherwise a quick meow. */
  click(): void {
    if (this.mode === 'feeding' || this.mode === 'eating') return // busy: ignore tap
    if (this.mode === 'asleep' && this.noWake) return // "don't wake" is on
    this.inactivity = 0
    this.moving = false
    this.queue = []
    if (this.mode === 'asleep') {
      this.mode = 'awake'
      this.animKey = `hiss_${this.facing}`
      this.remaining = 1.0
    } else {
      this.animKey = 'meow_sit'
      this.remaining = 1.0
    }
  }

  startDrag(): void {
    // "don't wake" + already asleep → carry it without waking (keep sleep pose)
    this.sleepDrag = this.noWake && this.mode === 'asleep'
    this.mode = 'dragging'
    this.inactivity = 0
    this.moving = false
    this.queue = []
    // Dragging a cat overrides any in-progress feeding gather or eat. PetWorld
    // unassigns the pellet (if this cat was eating) when it begins the drag.
    this.foodTargetX = null
    this.eatTargetX = null
    this.onEatenCb = null
    this.eatRemaining = 0
    this.jumpActive = false
    this.y = 0
    if (!this.sleepDrag) this.animKey = 'run_up'
  }

  dragTo(x: number): void {
    this.x = Math.max(0, Math.min(this.getMaxX(), x))
    this.inactivity = 0
  }

  /** Put down → startled: a real arcing leap sideways, then bolt away. */
  endDrag(): void {
    this.inactivity = 0
    // carried while asleep → just stays asleep at the new spot
    if (this.sleepDrag) {
      this.sleepDrag = false
      this.mode = 'asleep'
      this.y = 0
      return
    }
    this.mode = 'awake'
    this.facing = Math.random() < 0.5 ? 'left' : 'right'
    const dir = this.facing === 'right' ? 1 : -1

    // queue the panicked run that follows the leap
    this.queue = [
      { key: `run_${this.facing}`, dur: rand(1.2, 2.2), moving: true, speed: this.def.runSpeed }
    ]

    // arc jump: x handled by the jump arc in tick(), not the moving branch
    this.jumpActive = true
    this.jumpT = 0
    this.jumpDur = this.def.jumpDur
    this.jumpFromX = this.x
    this.jumpDX = this.def.jumpDistance * dir
    this.moving = false
    this.animKey = `jump_${this.facing}`
    this.remaining = this.jumpDur
  }

  private apply(a: Act): void {
    this.animKey = a.key
    this.moving = a.moving
    this.speed = a.speed
    this.remaining = a.dur
    this.lastMoving = a.moving
  }

  private advance(): void {
    const next = this.queue.shift()
    if (next) this.apply(next)
    else this.autonomous()
  }

  private autonomous(): void {
    // Calm bias: only stroll occasionally, and never twice in a row.
    if (!this.lastMoving && Math.random() < 0.25) this.startWalk()
    else this.startIdle()
  }

  private startWalk(): void {
    if (Math.random() < 0.5) this.facing = this.facing === 'left' ? 'right' : 'left'
    this.apply({
      key: `walk_${this.facing}`,
      dur: rand(1.5, 3.5),
      moving: true,
      speed: this.def.walkSpeed
    })
  }

  private startIdle(): void {
    const calm: string =
      Math.random() < 0.5
        ? pick(this.def.calmFront)
        : `${pick(this.def.calmDir)}_${this.facing}`
    // Licking looks odd if held too long — keep it brief; other calm poses linger.
    const dur = calm.startsWith('lick') ? rand(3, 5) : rand(10, 18)

    // Occasionally lead with a brief one-shot (yawn/meow/stretch), then settle.
    if (Math.random() < 0.25) {
      const p = pick(this.def.punctuation)
      this.queue = [{ key: calm, dur, moving: false, speed: 0 }]
      this.apply({ key: p, dur: this.playLen(p), moving: false, speed: 0 })
    } else {
      this.apply({ key: calm, dur, moving: false, speed: 0 })
    }
  }

  private turn(f: Facing): void {
    this.facing = f
    if (this.moving) {
      const base = this.animKey.startsWith('run') ? 'run' : 'walk'
      this.animKey = `${base}_${f}`
    }
  }

  private fallAsleep(): void {
    this.mode = 'asleep'
    this.moving = false
    this.queue = []
    this.animKey = `${pick(this.def.sleepStyles)}_${this.facing}`
  }
}
