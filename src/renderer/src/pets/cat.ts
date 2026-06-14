import type { CatColor, PetDefinition } from '../pet/types'
import ginger from '../assets/cat-ginger.png'
import grey from '../assets/cat-grey.png'
import white from '../assets/cat-white.png'

/** Sprite sheet URL per colorway (sheets are identical in layout). */
export const CAT_SHEETS: Record<CatColor, string> = { ginger, grey, white }

export const CAT_COLORS: { id: CatColor; label: string }[] = [
  { id: 'ginger', label: '진저' },
  { id: 'grey', label: '회색' },
  { id: 'white', label: '흰색' }
]

/**
 * Cat definition mapped onto the itch.io sprite sheet (64px cells, 14 cols).
 * Row indices were identified from the sheet:
 *   r4  = walk (side, faces left in art) · r8 = sit idle (front, tail wag)
 *   r48 = curled sleep · r29 = stand + react (front), used on click
 */
export const cat: PetDefinition = {
  id: 'cat',
  name: '고양이',
  frameSize: 64,
  displaySize: 128,
  baseline: 16,
  speed: 60,
  animations: {
    walk: { row: 4, frames: 6, fps: 10, loop: true },
    idle: { row: 8, frames: 4, fps: 5, loop: true },
    sleep: { row: 48, frames: 2, fps: 2, loop: true },
    react: { row: 29, frames: 11, fps: 14, loop: false }
  },
  behavior: {
    idleMin: 1.5,
    idleMax: 4,
    walkMin: 2,
    walkMax: 5,
    sleepAfter: 30,
    reactMs: 800
  }
}
