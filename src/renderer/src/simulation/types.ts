// config 타입/상수는 shared 모듈에 있다; 기존 renderer의 `./pet/types` import가 계속
// 동작하도록 재export.
export type { CatColor, CatCounts, Lang, PetConfig } from '../../../shared/config'
export { MAX_PER_COLOR } from '../../../shared/config'

export type Facing = 'left' | 'right'

// 애니 하나 = 64px 셀 스프라이트 시트의 한 row 프레임들.
export interface Anim {
  row: number
  frames: number
  fps: number
}

// engine + world가 동물을 구동하는 데 필요한 전부를 plain 데이터로 묶음. 동물은
// 스프라이트/튜너블만 다르고 행동 로직은 공유 → 행동 전략 추상화가 아니라 주입 데이터.
export interface PetDefinition {
  // 애니 레지스트리, 애니 이름이 키.
  anim: Record<string, Anim>

  // 행동 풀 (런타임에 `anim`에 대해 해석)
  calmFront: string[]
  calmDir: string[]
  punctuation: string[]
  sleepStyles: string[]

  // 튜너블
  walkSpeed: number
  runSpeed: number
  jumpHeight: number
  jumpDistance: number
  jumpDur: number

  // 스프라이트 기하
  frameSize: number
  displaySize: number
}
