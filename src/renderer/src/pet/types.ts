// Config types + constants live in the shared module; re-export them so
// existing renderer imports of `./pet/types` keep working.
export type { CatColor, CatCounts, Lang, PetConfig } from '../../../shared/config'
export { MAX_PER_COLOR } from '../../../shared/config'

export type Facing = 'left' | 'right'

/** One animation = a row of frames on the 64px-cell sprite sheet. */
export interface Anim {
  row: number
  frames: number
  fps: number
}
