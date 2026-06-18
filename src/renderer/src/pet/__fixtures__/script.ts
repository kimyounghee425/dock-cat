// Shared deterministic test harness for the CatEngine → catMachine parity work.
//
// Both the OLD `CatEngine` and the NEW `catMachine` are driven through the SAME
// scripted sequence of events + TICKs with the SAME seeded RNG, and their
// per-frame `{ x, y, animKey }` output is compared. This is the executable
// definition of "behaviour 100% preserved" (design D7 / P1).

import type { PetDefinition } from '../types'
import { cat } from '../../pets/cat'

/** Mulberry32 — a tiny, fast, fully deterministic seeded PRNG. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A frame sample: the only outputs the renderer ever reads from the engine. */
export interface Frame {
  x: number
  y: number
  animKey: string
}

/**
 * One step of the script. Either a TICK (advance physics by `dt` seconds and
 * sample a frame) or a command that maps 1:1 to a public engine method / a
 * machine event.
 */
export type Step =
  | { tick: number }
  | { cmd: 'click' }
  | { cmd: 'startDrag' }
  | { cmd: 'dragTo'; x: number }
  | { cmd: 'endDrag' }
  | { cmd: 'sleepNow' }
  | { cmd: 'wakeNow' }
  | { cmd: 'setFoodTarget'; x: number | null }
  | { cmd: 'goEat'; x: number }
  | { cmd: 'cancelEat' }
  | { cmd: 'setNoWake'; on: boolean }
  | { cmd: 'setSleepAfter'; sec: number }

/** Fixed sprite-floor width used by the harness (matches a typical screen). */
export const MAX_X = 1200
export const START_X = 400
export const SLEEP_AFTER = 8
export const SEED = 0x9e3779b9

export const fixtureDef: PetDefinition = cat

/**
 * The scripted sequence. Designed to exercise every transition the lead listed:
 * idle/walk autonomous loop over many ticks; click; drag start/move/end startled
 * leap; sleep via inactivity; wakeNow; sleepNow; setFoodTarget gather→beg; goEat
 * travel→chew→onEaten; cancelEat; noWake behaviours.
 *
 * `dt = 0.05` matches PetWorld's clamp (Math.min(0.05, …)); the cat spends ~20
 * frames/sec of simulated time, so multi-second poses cover many frames.
 */
const T = 0.05

function ticks(n: number): Step[] {
  return Array.from({ length: n }, () => ({ tick: T }))
}

export const script: Step[] = [
  // 1) Autonomous idle/walk loop over many ticks (covers startIdle/startWalk/
  //    autonomous/advance, walk edge-turn, punctuation lead, lick-vs-calm dur).
  ...ticks(120),

  // 2) Plain click → meow, then settle back into autonomous.
  { cmd: 'click' },
  ...ticks(40),

  // 3) Drag: startDrag (run_up) → dragTo a few times → endDrag (startled leap +
  //    panic run queue). Then let the leap + run play out.
  { cmd: 'startDrag' },
  { cmd: 'dragTo', x: 100 },
  ...ticks(5),
  { cmd: 'dragTo', x: 900 },
  ...ticks(5),
  { cmd: 'endDrag' },
  ...ticks(120),

  // 4) Feeding: hold food to the right → gather hops → beg (on_hind). Move the
  //    cursor so the beg re-orients, then release (→ awake).
  { cmd: 'setFoodTarget', x: 1000 },
  ...ticks(60),
  { cmd: 'setFoodTarget', x: 200 },
  ...ticks(60),
  { cmd: 'setFoodTarget', x: null },
  ...ticks(40),

  // 5) goEat: travel hops to a pellet → chew (eat anim) → completion (onEaten).
  { cmd: 'goEat', x: 700 },
  ...ticks(120),

  // 6) goEat then cancelEat mid-travel (pellet removed): revert to autonomous.
  { cmd: 'goEat', x: 150 },
  ...ticks(6),
  { cmd: 'cancelEat' },
  ...ticks(40),

  // 7) Inactivity sleep: idle long enough (> SLEEP_AFTER) to fall asleep.
  ...ticks(200),

  // 8) Click an asleep cat → hiss + wake.
  { cmd: 'click' },
  ...ticks(40),

  // 9) sleepNow / wakeNow buttons.
  { cmd: 'sleepNow' },
  ...ticks(20),
  { cmd: 'wakeNow' },
  ...ticks(40),

  // 10) noWake: asleep cat ignores click; drag carries it without waking.
  ...ticks(200),
  { cmd: 'setNoWake', on: true },
  { cmd: 'click' },
  ...ticks(10),
  { cmd: 'startDrag' },
  { cmd: 'dragTo', x: 600 },
  ...ticks(5),
  { cmd: 'endDrag' },
  ...ticks(20),
  { cmd: 'setNoWake', on: false },

  // 11) feeding interrupted by sleepNow (exit cleanup), then more idle.
  { cmd: 'wakeNow' },
  { cmd: 'setFoodTarget', x: 800 },
  ...ticks(20),
  { cmd: 'sleepNow' },
  ...ticks(20),
  { cmd: 'wakeNow' },
  ...ticks(60)
]
