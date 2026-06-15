import type { Facing, PetDefinition } from './types'

type Mode = 'awake' | 'asleep' | 'dragging'
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

  // jump arc (only used for the startled leap on drop)
  private jumpActive = false
  private jumpT = 0
  private jumpDur = 0
  private jumpFromX = 0
  private jumpDX = 0

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

  setSleepAfter(sec: number): void {
    this.sleepAfter = sec
    if (this.mode === 'awake') this.inactivity = 0
  }

  setNoWake(on: boolean): void {
    this.noWake = on
  }

  /** Force sleep right now (used by the "sleep all" button). */
  sleepNow(): void {
    if (this.mode === 'awake') this.fallAsleep()
  }

  /** Wake right now without a hiss (used by the "wake all" button). */
  wakeNow(): void {
    if (this.mode === 'asleep') {
      this.inactivity = 0
      this.mode = 'awake'
      this.startIdle()
    }
  }

  tick(dt: number): void {
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
