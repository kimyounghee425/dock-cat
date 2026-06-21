import type { Facing, PetDefinition } from './types'

// behaviors.ts — 고양이의 순수 행동 정책("각 행동이 무엇을 계산하는가"; catMachine.ts는
// "어떤 전이가 있는가"를 소유).
//
// 여기 헬퍼는 모두 순수 함수: CatContext 스냅샷을 읽어 부분 패치(또는 새 값)를 반환하고,
// 입력을 절대 변형하지 않는다. 일부는 ctx.rng()(공유 시드 클로저)를 호출하는데, 그 호출
// ORDER가 옛 명령형 engine과 정확히 같아야 골든마스터 패리티가 깨지지 않는다.
// queue/jump 갱신은 항상 새 배열/객체를 만든다.

// 먹이 타깃에 이만큼 가까우면 hop을 멈춘다(px). 떨림 방지.
export const FEED_STOP_THRESHOLD = 30
// 각 먹이 hop이 타깃 쪽으로 전진하는 거리(px).
export const FEED_HOP_STEP = 70
// 떨어진 pellet의 x와 이 px 이내면 "사실상 바로 위" — 좌/우로 기울지 않고 정면(front)으로 먹는다.
export const EAT_ONTOP_THRESHOLD = 20

// 큐에 들어가는 행동 한 박자(pose + 얼마나 유지할지).
export interface Act {
  key: string
  dur: number
  moving: boolean
  speed: number
}

// 놀란 도약과 모든 feeding/eating hop이 공유하는 jump arc.
export interface Jump {
  active: boolean
  t: number
  dur: number
  fromX: number
  dx: number
}

// "진행 중 jump 없음" 센티넬.
export const NO_JUMP: Jump = { active: false, t: 0, dur: 0, fromX: 0, dx: 0 }

// 정량 고양이 상태 — 머신의 context. 행동 헬퍼가 타입 체크되도록 여기서 소유.
export interface CatContext {
  def: PetDefinition
  getMaxX: () => number
  rng: () => number

  x: number
  y: number
  animKey: string
  facing: Facing

  moving: boolean
  speed: number
  remaining: number
  inactivity: number
  sleepAfter: number
  noWake: boolean
  sleepDrag: boolean
  lastMoving: boolean
  queue: Act[]

  jump: Jump

  foodTargetX: number | null

  eatTargetX: number | null
  eatRemaining: number
  onEatenCb: (() => void) | null

  // 매 send 후 facade가 drain·발화.
  pendingAfterTransition: Array<() => void>
}

export const playLen = (def: PetDefinition, k: string): number =>
  def.anim[k].frames / def.anim[k].fps

export const rand = (rng: () => number, min: number, max: number): number =>
  min + rng() * (max - min)
// rng()가 [0, 1)을 반환한다는 전제 → floor(rng()*len) ∈ [0, len-1].
export const pick = <T>(rng: () => number, arr: readonly T[]): T =>
  arr[Math.floor(rng() * arr.length)]

// Act로부터 현재 pose 설정.
export function apply(a: Act): Partial<CatContext> {
  return { animKey: a.key, moving: a.moving, speed: a.speed, remaining: a.dur, lastMoving: a.moving }
}

// facing을 (가끔 뒤집어) 고르고 walk Act 생성.
export function startWalk(ctx: CatContext): Partial<CatContext> {
  let facing = ctx.facing
  if (ctx.rng() < 0.5) facing = facing === 'left' ? 'right' : 'left'
  return {
    facing,
    ...apply({ key: `walk_${facing}`, dur: rand(ctx.rng, 1.5, 3.5), moving: true, speed: ctx.def.walkSpeed })
  }
}

// calm pose 선택(가끔 1회성 punctuation으로 시작).
export function startIdle(ctx: CatContext): Partial<CatContext> {
  const { def, rng, facing } = ctx
  const calm: string =
    rng() < 0.5 ? pick(rng, def.calmFront) : `${pick(rng, def.calmDir)}_${facing}`
  // lick은 오래 끌면 어색 — 짧게; 다른 calm pose는 길게 유지.
  const dur = calm.startsWith('lick') ? rand(rng, 3, 5) : rand(rng, 10, 18)

  // 가끔 짧은 1회성(yawn/meow/stretch)으로 시작한 뒤 정착.
  if (rng() < 0.25) {
    const p = pick(rng, def.punctuation)
    return {
      queue: [{ key: calm, dur, moving: false, speed: 0 }],
      ...apply({ key: p, dur: playLen(def, p), moving: false, speed: 0 })
    }
  }
  return apply({ key: calm, dur, moving: false, speed: 0 })
}

// calm 편향 — 가끔만 산책, 연속 두 번은 안 함.
export function autonomous(ctx: CatContext): Partial<CatContext> {
  if (!ctx.lastMoving && ctx.rng() < 0.25) return startWalk(ctx)
  return startIdle(ctx)
}

// 큐를 pop해 다음 것 적용, 비었으면 autonomous.
export function advance(ctx: CatContext): Partial<CatContext> {
  if (ctx.queue.length > 0) {
    const [next, ...rest] = ctx.queue
    return { queue: rest, ...apply(next) }
  }
  return autonomous(ctx)
}

// 먹이 결정 1회 — 먹이 쪽으로 hop 하거나 begging으로 정착. hop이 타깃/화면을 넘지 않게 clamp.
export function feedStep(ctx: CatContext): Partial<CatContext> {
  if (ctx.foodTargetX === null) return {}
  const max = ctx.getMaxX()
  const center = ctx.def.displaySize / 2
  const target = Math.max(0, Math.min(max, ctx.foodTargetX - center))
  const dx = target - ctx.x
  const dist = Math.abs(dx)

  if (dist <= FEED_STOP_THRESHOLD) {
    // 충분히 가까움: on_hind로 먹이를 향해 beg. dx가 분명히 nonzero일 때만 방향을 바꾸고,
    // 바로 위(dx === 0)면 현재 facing 유지(임의 flip 방지).
    let facing = ctx.facing
    if (dx > 0) facing = 'right'
    else if (dx < 0) facing = 'left'
    return {
      facing,
      jump: NO_JUMP,
      y: 0,
      animKey: 'on_hind',
      remaining: 0.2
    }
  }

  const dir: Facing = dx >= 0 ? 'right' : 'left'
  const step = Math.min(FEED_HOP_STEP, dist)
  const targetX = Math.max(0, Math.min(max, ctx.x + step * (dir === 'right' ? 1 : -1)))
  return {
    facing: dir,
    jump: { active: true, t: 0, dur: ctx.def.jumpDur, fromX: ctx.x, dx: targetX - ctx.x },
    animKey: `jump_${dir}`
  }
}

// 먹기 결정 1회 — pellet 쪽으로 hop 하거나, 마주보고 1회성 eat 애니 시작.
export function eatStep(ctx: CatContext): Partial<CatContext> {
  if (ctx.eatTargetX === null) return {}
  const max = ctx.getMaxX()
  const center = ctx.def.displaySize / 2
  const target = Math.max(0, Math.min(max, ctx.eatTargetX - center))
  const dx = target - ctx.x
  const dist = Math.abs(dx)

  if (dist <= FEED_STOP_THRESHOLD) {
    const pelletDx = ctx.eatTargetX - (ctx.x + center)
    let facing = ctx.facing
    let eatKey: string
    if (Math.abs(pelletDx) <= EAT_ONTOP_THRESHOLD) {
      eatKey = 'eat_front'
    } else if (pelletDx > 0) {
      facing = 'right'
      eatKey = 'eat_right'
    } else {
      facing = 'left'
      eatKey = 'eat_left'
    }
    return {
      facing,
      jump: NO_JUMP,
      y: 0,
      animKey: eatKey,
      eatRemaining: playLen(ctx.def, eatKey)
    }
  }

  const dir: Facing = dx >= 0 ? 'right' : 'left'
  const step = Math.min(FEED_HOP_STEP, dist)
  const targetX = Math.max(0, Math.min(max, ctx.x + step * (dir === 'right' ? 1 : -1)))
  return {
    facing: dir,
    jump: { active: true, t: 0, dur: ctx.def.jumpDur, fromX: ctx.x, dx: targetX - ctx.x },
    animKey: `jump_${dir}`
  }
}

// facing별 sleep pose 선택. jump/y도 함께 정리하므로 도약 중에 잠들어도 허공에 멈춘 채
// 굳지 않는다(stale arc 방지).
export function fallAsleep(ctx: CatContext): Partial<CatContext> {
  return {
    moving: false,
    queue: [],
    jump: NO_JUMP,
    y: 0,
    animKey: `${pick(ctx.rng, ctx.def.sleepStyles)}_${ctx.facing}`
  }
}

// jump arc 한 프레임 적분; 새 {x,y}와 종료 여부 반환.
export function tickArc(
  ctx: CatContext,
  dt: number
): { x: number; y: number; t: number; ended: boolean } {
  const t = Math.min(1, (ctx.jump.t + dt) / ctx.jump.dur)
  const x = Math.max(0, Math.min(ctx.getMaxX(), ctx.jump.fromX + ctx.jump.dx * t))
  const y = ctx.def.jumpHeight * Math.sin(Math.PI * t)
  return { x, y, t, ended: t >= 1 }
}
