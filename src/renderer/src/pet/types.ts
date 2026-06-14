export type CatColor = 'ginger' | 'grey' | 'white'
export type Facing = 'left' | 'right'

/** One animation = a row of frames on the 64px-cell sprite sheet. */
export interface Anim {
  row: number
  frames: number
  fps: number
}

/** Persisted settings. sleepAfterMin = null means "never sleep". */
export interface PetConfig {
  color: CatColor
  sleepAfterMin: number | null
}
