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

/**
 * Everything the engine + world need to drive an animal, bundled as plain data.
 * Animals differ in sprites/tunables only — behaviour logic is shared — so this
 * is an injected data definition, not a behaviour-strategy abstraction.
 */
export interface PetDefinition {
  /** Animation registry, keyed by animation name. */
  anim: Record<string, Anim>

  // behaviour pools (resolved against `anim` at runtime)
  calmFront: string[]
  calmDir: string[]
  punctuation: string[]
  sleepStyles: string[]

  // tunables
  walkSpeed: number
  runSpeed: number
  jumpHeight: number
  jumpDistance: number
  jumpDur: number

  // sprite geometry
  frameSize: number
  displaySize: number
}
