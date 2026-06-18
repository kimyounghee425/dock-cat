// Drives the OLD `CatEngine` through the shared script with a seeded RNG and
// records a frame after every TICK. This is the golden-master oracle: the new
// machine must reproduce these frames exactly (design D7).

import { CatEngine } from '../engine'
import {
  type Frame,
  type Step,
  MAX_X,
  SEED,
  SLEEP_AFTER,
  START_X,
  fixtureDef,
  mulberry32,
  script
} from './script'

/** Rounded so floating-point noise never produces spurious diffs. */
function sample(x: number, y: number, animKey: string): Frame {
  return { x: Math.round(x * 1e6) / 1e6, y: Math.round(y * 1e6) / 1e6, animKey }
}

export function runOldEngine(steps: Step[] = script): Frame[] {
  const rng = mulberry32(SEED)
  const engine = new CatEngine({
    def: fixtureDef,
    startX: START_X,
    getMaxX: () => MAX_X,
    sleepAfter: SLEEP_AFTER,
    rng
  })

  const frames: Frame[] = []
  for (const step of steps) {
    if ('tick' in step) {
      engine.tick(step.tick)
      frames.push(sample(engine.x, engine.y, engine.animKey))
      continue
    }
    switch (step.cmd) {
      case 'click':
        engine.click()
        break
      case 'startDrag':
        engine.startDrag()
        break
      case 'dragTo':
        engine.dragTo(step.x)
        break
      case 'endDrag':
        engine.endDrag()
        break
      case 'sleepNow':
        engine.sleepNow()
        break
      case 'wakeNow':
        engine.wakeNow()
        break
      case 'setFoodTarget':
        engine.setFoodTarget(step.x)
        break
      case 'goEat':
        // The completion callback is captured so a parity harness can assert it
        // fired; the frame sequence itself doesn't depend on what it does.
        engine.goEat(step.x, () => {})
        break
      case 'cancelEat':
        engine.cancelEat()
        break
      case 'setNoWake':
        engine.setNoWake(step.on)
        break
      case 'setSleepAfter':
        engine.setSleepAfter(step.sec)
        break
    }
  }
  return frames
}
