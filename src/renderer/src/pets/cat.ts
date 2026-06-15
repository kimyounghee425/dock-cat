import type { Anim, CatColor, PetDefinition } from '../pet/types'
import ginger from '../assets/cat-ginger.png'
import grey from '../assets/cat-grey.png'
import white from '../assets/cat-white.png'

export const CAT_SHEETS: Record<CatColor, string> = { ginger, grey, white }

const FRAME = 64
const DISPLAY = 128
const WALK_SPEED = 55 // px/s
const RUN_SPEED = 150 // px/s

// Startled leap (on drag-drop) — tweak these to taste:
const JUMP_HEIGHT = 60 // px the cat rises at the peak
const JUMP_DISTANCE = 90 // px the cat travels sideways
const JUMP_DUR = 0.5 // seconds the leap takes

/**
 * Animation registry, mapped from the itch.io sheet (rows verified against the
 * labelled preview). Left/right variants exist as separate rows, so we never
 * mirror — we just play the row that matches the direction.
 */
const ANIM = {
  // movement (walk art is mirrored vs its label, so rows are swapped here)
  walk_left: { row: 4, frames: 6, fps: 9 },
  walk_right: { row: 5, frames: 6, fps: 9 },
  run_left: { row: 11, frames: 5, fps: 12 },
  run_right: { row: 10, frames: 5, fps: 12 },
  run_up: { row: 9, frames: 4, fps: 12 }, // used while being dragged

  // front-facing idle actions (no direction)
  lick_sit: { row: 12, frames: 8, fps: 8 },
  lick_lie: { row: 13, frames: 8, fps: 8 },
  meow_sit: { row: 14, frames: 3, fps: 6 },
  meow_lie: { row: 15, frames: 3, fps: 6 },
  tailwag_sit_front: { row: 19, frames: 5, fps: 8 },
  yawn: { row: 43, frames: 7, fps: 7 },
  on_hind: { row: 65, frames: 4, fps: 8 },

  // directional idle actions (left/right)
  scratch_sit_left: { row: 17, frames: 8, fps: 11 },
  scratch_sit_right: { row: 18, frames: 8, fps: 11 },
  tailwag_sit_left: { row: 21, frames: 5, fps: 8 },
  tailwag_sit_right: { row: 22, frames: 5, fps: 8 },
  tailwag_stand_left: { row: 25, frames: 5, fps: 8 },
  tailwag_stand_right: { row: 26, frames: 5, fps: 8 },
  tailwag_lie_left: { row: 27, frames: 3, fps: 6 },
  tailwag_lie_right: { row: 28, frames: 3, fps: 6 },
  pawswipe_stand_left: { row: 32, frames: 11, fps: 14 },
  pawswipe_stand_right: { row: 34, frames: 11, fps: 14 },
  pawswipe_sit_left: { row: 39, frames: 11, fps: 14 },
  pawswipe_sit_right: { row: 41, frames: 11, fps: 14 },
  jump_left: { row: 63, frames: 5, fps: 10 },
  jump_right: { row: 64, frames: 5, fps: 10 },

  // eating (stand + eat; front/left/right only — back never occurs on a 1-D floor)
  eat_front: { row: 56, frames: 10, fps: 10 },
  eat_left: { row: 58, frames: 10, fps: 10 },
  eat_right: { row: 59, frames: 10, fps: 10 },

  // sleep (5 styles × left/right, front-facing)
  sleep1_left: { row: 44, frames: 2, fps: 2 },
  sleep1_right: { row: 45, frames: 2, fps: 2 },
  sleep2_left: { row: 48, frames: 2, fps: 2 },
  sleep2_right: { row: 49, frames: 2, fps: 2 },
  sleep3_left: { row: 50, frames: 2, fps: 2 },
  sleep3_right: { row: 51, frames: 2, fps: 2 },
  sleep4_left: { row: 52, frames: 2, fps: 2 },
  sleep4_right: { row: 53, frames: 2, fps: 2 },
  sleep5_left: { row: 54, frames: 2, fps: 2 },
  sleep5_right: { row: 55, frames: 2, fps: 2 },

  // reactions
  hiss_left: { row: 60, frames: 2, fps: 7 },
  hiss_right: { row: 61, frames: 2, fps: 7 }
} satisfies Record<string, Anim>

export type AnimKey = keyof typeof ANIM

/**
 * Calm idle loops held for 10s+ (front-facing, no direction). These are the
 * cat's default "just chilling" states — repetitive, gentle motions.
 */
const CALM_FRONT: AnimKey[] = ['lick_sit', 'lick_lie', 'tailwag_sit_front']

/** Calm directional idle loops — resolved to `${base}_${facing}` at runtime. */
const CALM_DIR = ['scratch_sit', 'pawswipe_sit', 'tailwag_lie'] as const

/** Brief one-shot "punctuations" played occasionally before settling (front). */
const PUNCTUATION: AnimKey[] = ['yawn', 'meow_sit', 'on_hind']

/** Sleep style bases — resolved to `${base}_${facing}`. */
const SLEEP_STYLES = ['sleep1', 'sleep2', 'sleep3', 'sleep4', 'sleep5'] as const

/**
 * The cat as a plain data definition, injected into the engine/world so they
 * stay animal-agnostic. Adding another animal is just another `PetDefinition`.
 */
export const cat: PetDefinition = {
  anim: ANIM,
  calmFront: [...CALM_FRONT],
  calmDir: [...CALM_DIR],
  punctuation: [...PUNCTUATION],
  sleepStyles: [...SLEEP_STYLES],
  walkSpeed: WALK_SPEED,
  runSpeed: RUN_SPEED,
  jumpHeight: JUMP_HEIGHT,
  jumpDistance: JUMP_DISTANCE,
  jumpDur: JUMP_DUR,
  frameSize: FRAME,
  displaySize: DISPLAY
}
