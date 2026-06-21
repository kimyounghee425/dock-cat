import { createActor, type Actor } from 'xstate'
import type { PetDefinition } from './types'
import { catMachine, type CatEvent } from './catMachine'

// catMachine을 돌리는 XState actor 위의 얇은 FACADE. 행동 로직은 머신에 있고, 모든 public
// 메서드는 `actor.send(...)`로 위임하며 읽기 필드/질의는 snapshot을 읽는다. public 표면은
// 옛 명령형 engine과 동일하라 `PetView`/`PetWorld`는 영향 없다(`dispose` 호출 제외).
export class CatEngine {
  // x/y/animKey를 snapshot에서 plain 필드로 미러링 → PetWorld의 매 프레임 읽기가 getSnapshot()을
  // 반복 호출하지 않게. 아래 구독이 최신으로 유지(snapshot은 매 send마다 동기 emit).
  x: number
  y = 0 // 바닥 위 높이 px (도약 중에만 nonzero)
  animKey = 'tailwag_sit_front'

  private actor: Actor<typeof catMachine>
  private sub: { unsubscribe: () => void }
  private disposed = false

  constructor(opts: {
    def: PetDefinition
    startX: number
    getMaxX: () => number
    sleepAfter: number
    rng?: () => number
  }) {
    this.x = opts.startX
    this.actor = createActor(catMachine, {
      input: {
        def: opts.def,
        startX: opts.startX,
        getMaxX: opts.getMaxX,
        sleepAfter: opts.sleepAfter,
        rng: opts.rng
      }
    })
    // 매 snapshot마다 렌더 필드 미러링.
    this.sub = this.actor.subscribe((snapshot) => {
      this.x = snapshot.context.x
      this.y = snapshot.context.y
      this.animKey = snapshot.context.animKey
    })
    this.actor.start()
  }

  // 단일 send 경로. 이벤트 전달 후 `pendingAfterTransition`을 drain한다: 정상 eat 완료는
  // onEaten 콜백을 거기 담아 전이가 `awake`로 가라앉은 뒤 발화 → 콜백 안에서의 재진입
  // goEat()이 깔끔히 처리된다. 호출 전 CLEAR_PENDING_CALLBACKS로 슬롯을 비우고, while 루프는
  // 재진입(콜백이 더 채우는 경우)을 견딘다.
  private send(event: CatEvent): void {
    this.actor.send(event)
    let pending = this.actor.getSnapshot().context.pendingAfterTransition
    while (pending.length > 0) {
      this.actor.send({ type: 'CLEAR_PENDING_CALLBACKS' })
      for (const cb of pending) cb()
      pending = this.actor.getSnapshot().context.pendingAfterTransition
    }
  }

  isAsleep(): boolean {
    return this.actor.getSnapshot().matches('asleep')
  }

  isEating(): boolean {
    return this.actor.getSnapshot().matches('eating')
  }

  // 떨어진 pellet 배정 가능: awake 또는 feeding(모이는 중)이고, 자거나 드래그 중이거나
  // 다른 pellet을 먹는 중이 아닐 때.
  isFreeToEat(): boolean {
    const snapshot = this.actor.getSnapshot()
    return snapshot.matches('awake') || snapshot.matches('feeding')
  }

  setSleepAfter(sec: number): void {
    this.send({ type: 'SET_SLEEP_AFTER', sec })
  }

  setNoWake(on: boolean): void {
    this.send({ type: 'SET_NO_WAKE', on })
  }

  sleepNow(): void {
    this.send({ type: 'SLEEP_NOW' })
  }

  wakeNow(): void {
    this.send({ type: 'WAKE_NOW' })
  }

  // 먹이주기: 반경 내 awake 고양이에 커서 x를 넘기거나 null로 해제. 자거나 드래그 중인
  // 고양이는 무시(no-op)해 "깨우지 말기"/드래그 흐름을 방해하지 않는다.
  setFoodTarget(x: number | null): void {
    this.send({ type: 'SET_FOOD_TARGET', x })
  }

  // 떨어진 pellet 배정: `x`로 hop → eat 애니 1회 재생 후 `onEaten` 발화(PetWorld가 pellet
  // 제거 + 고양이 해제). 자거나 드래그 중인 고양이엔 배정되지 않지만 방어적으로 가드.
  goEat(x: number, onEaten: () => void): void {
    this.send({ type: 'GO_EAT', x, onEaten })
  }

  // onEaten을 발화하지 않고 진행 중 eat 취소(pellet이 만료/축출/teardown으로 사라짐). 먹는
  // 중이 아니어도 안전.
  cancelEat(): void {
    this.send({ type: 'CANCEL_EAT' })
  }

  click(): void {
    this.send({ type: 'CLICK' })
  }

  startDrag(): void {
    this.send({ type: 'DRAG_START' })
  }

  dragTo(x: number): void {
    this.send({ type: 'DRAG_MOVE', x })
  }

  endDrag(): void {
    this.send({ type: 'DRAG_END' })
  }

  tick(dt: number): void {
    this.send({ type: 'TICK', dt })
  }

  // actor + 구독 정리. Idempotent: 여러 번 호출해도 안전(방어적).
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.sub.unsubscribe()
    this.actor.stop()
  }
}
