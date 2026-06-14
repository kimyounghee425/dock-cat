import type { BehaviorConfig, Pose } from './types'

/**
 * Pure behavioral state machine. Knows nothing about how the pet looks or where
 * it is on screen — it only decides which Pose the pet is in, based on timers
 * and interaction. Locomotion reads `isMoving()`; the view reads `pose`.
 */
export class PetEngine {
  pose: Pose = 'idle'

  private cfg: BehaviorConfig
  private stateTimer: number // seconds left in current idle/walk stretch
  private reactTimer = 0 // ms left in a click reaction
  private inactivity = 0 // seconds since last interaction

  constructor(cfg: BehaviorConfig) {
    this.cfg = cfg
    this.stateTimer = this.rand(cfg.idleMin, cfg.idleMax)
  }

  /** Pet is physically walking only in the walk pose. */
  isMoving(): boolean {
    return this.pose === 'walk'
  }

  /** Click reaction: wake if asleep, play `react`, and reset the sleep timer. */
  poke(): void {
    this.inactivity = 0
    this.pose = 'react'
    this.reactTimer = this.cfg.reactMs
  }

  /** Advance the machine by `dt` seconds. */
  tick(dt: number): void {
    this.inactivity += dt

    if (this.pose === 'react') {
      this.reactTimer -= dt * 1000
      if (this.reactTimer <= 0) this.enterIdle()
      return
    }

    if (this.pose !== 'sleep' && this.inactivity >= this.cfg.sleepAfter) {
      this.pose = 'sleep'
      return
    }

    if (this.pose === 'sleep') return // stays asleep until poked

    // idle <-> walk wandering
    this.stateTimer -= dt
    if (this.stateTimer <= 0) {
      if (this.pose === 'idle') {
        this.pose = 'walk'
        this.stateTimer = this.rand(this.cfg.walkMin, this.cfg.walkMax)
      } else {
        this.enterIdle()
      }
    }
  }

  private enterIdle(): void {
    this.pose = 'idle'
    this.stateTimer = this.rand(this.cfg.idleMin, this.cfg.idleMax)
  }

  private rand(min: number, max: number): number {
    return min + Math.random() * (max - min)
  }
}
