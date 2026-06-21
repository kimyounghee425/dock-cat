import type { Anim, CatColor, PetDefinition } from '../pet/types'
import ginger from '../assets/cat-ginger.png'
import grey from '../assets/cat-grey.png'
import white from '../assets/cat-white.png'

export const CAT_SHEETS: Record<CatColor, string> = { ginger, grey, white }

const FRAME = 64
const DISPLAY = 128
const WALK_SPEED = 55 // px/s
const RUN_SPEED = 150 // px/s

// 놀란 도약(drag-drop 시) — 취향껏 조정:
const JUMP_HEIGHT = 60 // 정점에서 오르는 높이 px
const JUMP_DISTANCE = 90 // 옆으로 이동하는 px
const JUMP_DUR = 0.5 // 도약 시간(초)

// 애니 레지스트리. itch.io 시트 기준(라벨 프리뷰로 row 검증). left/right가 별도 row라
// 미러링 없이 방향에 맞는 row를 재생한다.
const ANIM = {
  // 이동 (walk 아트가 라벨과 반대로 미러돼 있어 여기서 row를 swap)
  walk_left: { row: 4, frames: 6, fps: 9 },
  walk_right: { row: 5, frames: 6, fps: 9 },
  run_left: { row: 11, frames: 5, fps: 12 },
  run_right: { row: 10, frames: 5, fps: 12 },
  run_up: { row: 9, frames: 4, fps: 12 }, // 드래그 중 사용

  // 정면 idle (방향 없음)
  lick_sit: { row: 12, frames: 8, fps: 8 },
  lick_lie: { row: 13, frames: 8, fps: 8 },
  meow_sit: { row: 14, frames: 3, fps: 6 },
  meow_lie: { row: 15, frames: 3, fps: 6 },
  tailwag_sit_front: { row: 19, frames: 5, fps: 8 },
  yawn: { row: 43, frames: 7, fps: 7 },
  on_hind: { row: 65, frames: 4, fps: 8 },

  // 방향 idle (left/right)
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

  // eating (front/left/right만 — 1차원 바닥에선 back이 없음)
  eat_front: { row: 56, frames: 10, fps: 10 },
  eat_left: { row: 58, frames: 10, fps: 10 },
  eat_right: { row: 59, frames: 10, fps: 10 },

  // sleep (5종 × left/right)
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

  // 반응
  hiss_left: { row: 60, frames: 2, fps: 7 },
  hiss_right: { row: 61, frames: 2, fps: 7 }
} satisfies Record<string, Anim>

export type AnimKey = keyof typeof ANIM

// 10s+ 유지하는 정면 calm idle 루프 — 기본 "그냥 쉬는" 상태.
const CALM_FRONT: AnimKey[] = ['lick_sit', 'lick_lie', 'tailwag_sit_front']

// 방향 calm idle — 런타임에 `${base}_${facing}`로 해석.
const CALM_DIR = ['scratch_sit', 'pawswipe_sit', 'tailwag_lie'] as const

// 정착 전 가끔 재생하는 짧은 1회성 "punctuation"(정면).
const PUNCTUATION: AnimKey[] = ['yawn', 'meow_sit', 'on_hind']

// sleep 스타일 base — `${base}_${facing}`로 해석.
const SLEEP_STYLES = ['sleep1', 'sleep2', 'sleep3', 'sleep4', 'sleep5'] as const

// 고양이를 plain 데이터 정의로 — engine/world에 주입해 동물-비의존 유지. 다른 동물 추가는
// 또 하나의 `PetDefinition`일 뿐.
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
