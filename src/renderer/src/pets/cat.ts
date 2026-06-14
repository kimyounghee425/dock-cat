import type { PetDefinition } from '../pet/types'

/**
 * Mockup cat rendered as inline SVG in the Claude coral palette.
 * Two visual variants: `awake` (eyes open) and `asleep` (eyes closed).
 * Poses reuse these variants; motion comes from CSS (see styles.css).
 * Replacing this with a real sprite sheet later only touches `variants`,
 * `poseVariant`, and the view adapter — the engine stays untouched.
 */

const FACE_AWAKE = `
  <!-- eyes -->
  <ellipse cx="26" cy="34" rx="3.1" ry="4" fill="#2b2118" />
  <ellipse cx="38" cy="34" rx="3.1" ry="4" fill="#2b2118" />
  <circle cx="27.2" cy="32.6" r="1.1" fill="#fff" />
  <circle cx="39.2" cy="32.6" r="1.1" fill="#fff" />
  <!-- nose -->
  <path d="M30.5 38.5 h3 l-1.5 1.8 z" fill="#7a3b2c" />
  <!-- mouth -->
  <path d="M32 40.3 q-2 2.4 -4 0.6 M32 40.3 q2 2.4 4 0.6"
        stroke="#7a3b2c" stroke-width="1.1" fill="none" stroke-linecap="round" />
`

const FACE_ASLEEP = `
  <!-- closed eyes -->
  <path d="M22.8 34 q3.2 3 6.4 0" stroke="#2b2118" stroke-width="1.4" fill="none" stroke-linecap="round" />
  <path d="M34.8 34 q3.2 3 6.4 0" stroke="#2b2118" stroke-width="1.4" fill="none" stroke-linecap="round" />
  <!-- nose -->
  <path d="M30.5 38.5 h3 l-1.5 1.8 z" fill="#7a3b2c" />
`

function buildCat(face: string): string {
  return `
  <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" shape-rendering="geometricPrecision">
    <g class="pet-body">
      <!-- tail -->
      <path d="M50 50 q14 -2 9 -18 q-1 -5 -6 -3 q4 4 1 9 q-3 6 -10 5 z" fill="#c15f3c" />
      <!-- feet -->
      <ellipse cx="24" cy="59" rx="6" ry="4" fill="#c15f3c" />
      <ellipse cx="40" cy="59" rx="6" ry="4" fill="#c15f3c" />
      <!-- body / loaf -->
      <path d="M16 40 q0 -22 16 -22 q16 0 16 22 q0 18 -16 18 q-16 0 -16 -18 z" fill="#d97757" />
      <!-- belly highlight -->
      <ellipse cx="32" cy="46" rx="9" ry="11" fill="#e89b80" opacity="0.55" />
      <!-- ears -->
      <path d="M19 24 l-2 -11 l11 5 z" fill="#d97757" />
      <path d="M45 24 l2 -11 l-11 5 z" fill="#d97757" />
      <path d="M20 22 l-1 -6 l6 3 z" fill="#f4a98c" />
      <path d="M44 22 l1 -6 l-6 3 z" fill="#f4a98c" />
      <!-- blush -->
      <ellipse cx="22" cy="40" rx="3" ry="1.8" fill="#f4a98c" opacity="0.8" />
      <ellipse cx="42" cy="40" rx="3" ry="1.8" fill="#f4a98c" opacity="0.8" />
      <!-- whiskers -->
      <g stroke="#c15f3c" stroke-width="0.9" stroke-linecap="round">
        <path d="M18 37 h-7 M18 40 h-8" />
        <path d="M46 37 h7 M46 40 h8" />
      </g>
      ${face}
    </g>
  </svg>`
}

export const cat: PetDefinition = {
  id: 'cat',
  name: '고양이',
  size: 96,
  speed: 70,
  variants: {
    awake: buildCat(FACE_AWAKE),
    asleep: buildCat(FACE_ASLEEP)
  },
  poseVariant: {
    idle: 'awake',
    walk: 'awake',
    react: 'awake',
    sleep: 'asleep'
  },
  behavior: {
    idleMin: 1.5,
    idleMax: 4,
    walkMin: 2,
    walkMax: 5,
    sleepAfter: 30,
    reactMs: 550
  }
}
