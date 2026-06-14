/** The behavioral states every pet can be in. Asset-agnostic. */
export type Pose = 'idle' | 'walk' | 'react' | 'sleep'

/** Available colorways (one sprite sheet each). */
export type CatColor = 'ginger' | 'grey' | 'white'

/** One animation = a row of frames on the sprite sheet. */
export interface SpriteAnimation {
  /** row index on the 64px-cell sheet */
  row: number
  /** number of frames in this row */
  frames: number
  /** playback speed */
  fps: number
  /** loop forever, or hold the last frame when done */
  loop: boolean
}

/** Timing knobs for the state machine (seconds unless noted). */
export interface BehaviorConfig {
  idleMin: number
  idleMax: number
  walkMin: number
  walkMax: number
  /** seconds of no interaction before falling asleep */
  sleepAfter: number
  /** how long the click reaction plays (ms) — match the react animation length */
  reactMs: number
}

/**
 * A pet is pure data: sprite geometry, per-pose animations, and behavior timings.
 * The engine reads only `behavior` + Pose; the view reads the sprite fields.
 */
export interface PetDefinition {
  id: string
  name: string
  /** native sprite cell size in px (square) */
  frameSize: number
  /** rendered size on screen in px (square) */
  displaySize: number
  /** empty native px below the feet, used to sit the pet on the floor */
  baseline: number
  /** walk speed in px per second */
  speed: number
  animations: Record<Pose, SpriteAnimation>
  behavior: BehaviorConfig
}
