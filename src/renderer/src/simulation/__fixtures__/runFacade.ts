// `CatEngine` FACADE를 공유 스크립트 + 시드 RNG로 구동: PetWorld와 똑같이 public 메서드를
// 호출하고, 매 TICK 후 미러링된 x/y/animKey 필드로 프레임을 기록한다.
//
// facade 패리티 증명: facade가 frozen 골든마스터(`cat-golden.ts`)를 public API를 통해
// 끝까지 byte-for-byte 재현해야 한다.

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

// 부동소수점 노이즈로 가짜 diff가 나지 않도록 반올림.
function sample(x: number, y: number, animKey: string): Frame {
  return { x: Math.round(x * 1e6) / 1e6, y: Math.round(y * 1e6) / 1e6, animKey }
}

export function runFacade(steps: Step[] = script): Frame[] {
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
      // PetWorld가 매 프레임 하듯 미러링된 필드를 읽는다.
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
        // 콜백 내용은 프레임 시퀀스에 영향 없으므로 no-op.
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
  engine.dispose() // teardown도 한번 실행
  return frames
}
