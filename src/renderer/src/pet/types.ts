export type CatColor = 'ginger' | 'grey' | 'white'
export type Facing = 'left' | 'right'
export type Lang = 'ko' | 'en'

/** One animation = a row of frames on the 64px-cell sprite sheet. */
export interface Anim {
  row: number
  frames: number
  fps: number
}

/** How many cats of each color exist (0–2 each). */
export type CatCounts = Record<CatColor, number>

/** Persisted settings. sleepAfterMin = null means "never sleep". */
export interface PetConfig {
  counts: CatCounts
  sleepAfterMin: number | null
  /** When true, clicking a sleeping cat won't wake it. */
  noWake: boolean
  lang: Lang
}

export const MAX_PER_COLOR = 3
