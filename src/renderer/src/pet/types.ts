/** The behavioral states every pet can be in. Asset-agnostic. */
export type Pose = 'idle' | 'walk' | 'react' | 'sleep'

/** Timing knobs for the state machine (seconds unless noted). */
export interface BehaviorConfig {
  /** random idle duration range before wandering off */
  idleMin: number
  idleMax: number
  /** random walk duration range before stopping */
  walkMin: number
  walkMax: number
  /** seconds of no interaction before falling asleep */
  sleepAfter: number
  /** how long the click reaction plays (ms) */
  reactMs: number
}

/**
 * A pet is pure data: how it looks (svg variants), how it maps poses to those
 * variants, and how it behaves. Swapping SVG mockups for sprite sheets later
 * touches only this file + the view adapter — never the engine.
 */
export interface PetDefinition {
  id: string
  name: string
  /** rendered size in px (square) */
  size: number
  /** walk speed in px per second */
  speed: number
  /** named visual variants -> SVG markup */
  variants: Record<string, string>
  /** which variant to display for each pose */
  poseVariant: Record<Pose, string>
  behavior: BehaviorConfig
}
