// 패리티 작업용 공유 결정적 테스트 하니스.
//
// catMachine과 facade(CatEngine)를 동일한 이벤트+TICK 스크립트 + 동일 시드 RNG로 구동해
// 프레임별 `{ x, y, animKey }` 출력을 frozen 골든마스터와 비교한다. "동작 100% 보존"의
// 실행 가능한 정의.

import type { PetDefinition } from '../types'
import { cat } from '../../pets/cat'

// Mulberry32 — 작고 빠른 완전 결정적 시드 PRNG.
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

// 프레임 샘플: renderer가 engine에서 읽는 유일한 출력.
export interface Frame {
  x: number
  y: number
  animKey: string
}

// 스크립트 한 스텝. TICK(`dt`초만큼 물리 전진 후 프레임 샘플) 또는 public engine 메서드/
// 머신 이벤트와 1:1 대응하는 command.
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

// 하니스가 쓰는 고정 sprite-floor 폭(전형적 화면 크기).
export const MAX_X = 1200
export const START_X = 400
export const SLEEP_AFTER = 8
export const SEED = 0x9e3779b9

export const fixtureDef: PetDefinition = cat

// 스크립트 시퀀스. 모든 전이를 한 번씩 거치도록 설계: idle/walk 루프; click; 드래그
// 시작/이동/종료 놀란 도약; inactivity 수면; wakeNow; sleepNow; setFoodTarget gather→beg;
// goEat travel→chew→onEaten; cancelEat; noWake 동작.
// dt = 0.05는 PetWorld의 clamp(Math.min(0.05, …))와 일치 → 초당 ~20프레임이라 수 초짜리
// pose가 여러 프레임을 커버한다.
const T = 0.05

function ticks(n: number): Step[] {
  return Array.from({ length: n }, () => ({ tick: T }))
}

export const script: Step[] = [
  // 1) autonomous idle/walk 루프(startIdle/startWalk/autonomous/advance, walk
  //    edge-turn, punctuation 선행, lick-vs-calm dur 커버).
  ...ticks(120),

  // 2) 단순 click → meow, 이후 autonomous로 복귀.
  { cmd: 'click' },
  ...ticks(40),

  // 3) 드래그: startDrag(run_up) → dragTo 몇 번 → endDrag(놀란 도약 + 패닉 run 큐).
  //    이후 도약 + run을 끝까지 재생.
  { cmd: 'startDrag' },
  { cmd: 'dragTo', x: 100 },
  ...ticks(5),
  { cmd: 'dragTo', x: 900 },
  ...ticks(5),
  { cmd: 'endDrag' },
  ...ticks(120),

  // 4) feeding: 오른쪽에 먹이 → gather hop → beg(on_hind). 커서를 옮겨 beg가 재정렬되게
  //    한 뒤 해제(→ awake).
  { cmd: 'setFoodTarget', x: 1000 },
  ...ticks(60),
  { cmd: 'setFoodTarget', x: 200 },
  ...ticks(60),
  { cmd: 'setFoodTarget', x: null },
  ...ticks(40),

  // 5) goEat: pellet로 travel hop → chew(eat 애니) → 완료(onEaten).
  { cmd: 'goEat', x: 700 },
  ...ticks(120),

  // 6) goEat 후 travel 도중 cancelEat(pellet 제거): autonomous로 복귀.
  { cmd: 'goEat', x: 150 },
  ...ticks(6),
  { cmd: 'cancelEat' },
  ...ticks(40),

  // 7) inactivity 수면: SLEEP_AFTER를 넘길 만큼 idle.
  ...ticks(200),

  // 8) 자는 고양이 click → hiss + 기상.
  { cmd: 'click' },
  ...ticks(40),

  // 9) sleepNow / wakeNow 버튼.
  { cmd: 'sleepNow' },
  ...ticks(20),
  { cmd: 'wakeNow' },
  ...ticks(40),

  // 10) noWake: 자는 고양이는 click 무시; 드래그는 깨우지 않고 옮긴다.
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

  // 11) feeding을 sleepNow로 중단(exit 정리), 이후 추가 idle.
  { cmd: 'wakeNow' },
  { cmd: 'setFoodTarget', x: 800 },
  ...ticks(20),
  { cmd: 'sleepNow' },
  ...ticks(20),
  { cmd: 'wakeNow' },
  ...ticks(60)
]
