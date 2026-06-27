import type { CatColor, CatCounts, PetDefinition } from './types'
import { CatEngine } from './engine'
import { PetView } from './view'
import { WebGLRenderer, type SpriteRenderInfo } from './WebGLRenderer'
import { clampX, pickTopmost, pointInRect } from './geometry'
import { assignNearestFree, computeGather } from './feeding-logic'
import { reduce, type Effect, type GestureState } from './gesture'
import bowlPng from './assets/bowl.png'
import pelletPng from './assets/pellet.png'

type TickFn = (
  xs: Float32Array, ys: Float32Array, speeds: Float32Array,
  facings: Uint8Array, movings: Uint8Array, remainings: Float32Array,
  inactivities: Float32Array, sleep_afters: Float32Array, max_xs: Float32Array,
  jump_actives: Uint8Array, jump_ts: Float32Array, jump_durs: Float32Array,
  jump_from_xs: Float32Array, jump_dxs: Float32Array, jump_heights: Float32Array,
  needs_xstate: Uint8Array, dt: number, count: number
) => void
let wasmTick: TickFn | null = null
void import('./wasm/pkg/cat_wasm').then((m) => { wasmTick = m.tick_awake })

interface CatInstance {
  color: CatColor
  engine: CatEngine
  view: PetView
  lastKey: string
}

// 바닥에 떨어진 pellet. `assignedCat`은 먹으러 보낸 단 한 마리(null = free 고양이 대기).
// 두 타이머는 destroy()/제거 시 깔끔히 취소할 수 있게 들고 있는다.
interface Pellet {
  el: HTMLImageElement
  x: number
  assignedCat: CatInstance | null
  expireTimer: ReturnType<typeof setTimeout>
  // TTL fade가 시작되면 true; fade 동안 (재)배정을 막는다.
  expiring: boolean
  // 400ms fade 제거 단계의 타이머 id(expiring일 때만). teardown이 fade 도중 끼어들어
  // 죽은 world에서 콜백이 터지지 않도록 destroy()/removePellet()이 취소할 수 있게 보관.
  fadeTimer: ReturnType<typeof setTimeout> | null
}

const BOWL_SIZE = 76
const PELLET_SIZE = 20

// 깨어 있는 고양이가 들고 있는 먹이를 알아채고 다가오는 커서 좌우 반경(px). 비-사용자설정.
const FOOD_RADIUS = 350

// 바닥에 동시에 허용되는 최대 pellet 수; 6번째는 가장 오래된 것을 축출.
const MAX_PELLETS = 5

// 안 먹힌 바닥 pellet이 떨어진 뒤 자동 소멸하기까지의 ms.
const PELLET_TTL_MS = 30_000

export type PerfStats = {
  fps: number
  frameMs: number
  longFrames: number
  tickMs: number
  renderMs: number
  heapMB: number
  canvasCount: number
  catCount: number
}

// 화면의 모든 고양이를 관리: 색상별 카운트 spawn/제거, 단일 rAF 루프, 중앙 집중식
// 클릭통과 + 드래그 처리(고양이끼리 마우스 다툼 방지), 삭제용 중앙 trash.
export class PetWorld {
  private stage: HTMLElement
  private def: PetDefinition
  private sheets: Record<CatColor, string>
  private sleepAfterSec: number
  private cats: CatInstance[] = []
  private trash: HTMLDivElement
  private onDeleteCb: (() => void) | null = null
  private noWake = false

  private bowl: HTMLImageElement | null = null
  private bowlX = 0
  private onBowlMoveCb: ((x: number) => void) | null = null
  private onBowlRemoveCb: (() => void) | null = null

  // 현재 포인터를 캡처 중인지(= 클릭통과 OFF).
  private capturing = false
  // 포인터 제스처 state. 모든 판정은 gesture.ts의 순수 reducer가 소유하고, 이 클래스는
  // live rect를 읽어 이벤트를 dispatch하고 반환된 effect를 실행만 한다.
  private gesture: GestureState<CatInstance> = { kind: 'idle' }
  // 먹이를 드는 동안 커서에 붙는 pellet element.
  private heldPellet: HTMLImageElement | null = null
  // 바닥에 놓인 pellet, 오래된 것부터(max-5 FIFO 축출용).
  private pellets: Pellet[] = []
  private onKeyDown: (e: KeyboardEvent) => void
  private last = performance.now()
  readonly perf: PerfStats = { fps: 0, frameMs: 0, longFrames: 0, tickMs: 0, renderMs: 0, heapMB: 0, canvasCount: 0, catCount: 0 }

  private renderer: WebGLRenderer
  private onResize: () => void

  private rafId = 0
  private alive = true
  private soa = {
    x:           new Float32Array(12_000),
    y:           new Float32Array(12_000),
    speed:       new Float32Array(12_000),
    facing:      new Uint8Array(12_000),
    moving:      new Uint8Array(12_000),
    remaining:   new Float32Array(12_000),
    inactivity:  new Float32Array(12_000),
    sleepAfter:  new Float32Array(12_000),
    maxX:        new Float32Array(12_000),
    jumpActive:  new Uint8Array(12_000),
    jumpT:       new Float32Array(12_000),
    jumpDur:     new Float32Array(12_000),
    jumpFromX:   new Float32Array(12_000),
    jumpDx:      new Float32Array(12_000),
    jumpHeight:  new Float32Array(12_000),
    needsXState: new Uint8Array(12_000),
  }
  private soaIdx: number[] = []
  private onPointerDown: (e: PointerEvent) => void
  private onPointerMove: (e: PointerEvent) => void
  private onPointerUp: (e: PointerEvent) => void

  constructor(
    stage: HTMLElement,
    def: PetDefinition,
    sheets: Record<CatColor, string>,
    sleepAfterSec: number
  ) {
    this.stage = stage
    this.def = def
    this.sheets = sheets
    this.sleepAfterSec = sleepAfterSec

    // maxInstances: 색상 3개 × MAX_PER_COLOR(4000) = 12000
    this.renderer = new WebGLRenderer(stage, def.frameSize, def.displaySize, 12_000)
    for (const [color, url] of Object.entries(sheets) as [CatColor, string][]) {
      void this.renderer.loadTexture(color, url)
    }

    this.onResize = (): void => { this.renderer.resize() }
    window.addEventListener('resize', this.onResize)

    this.trash = document.createElement('div')
    this.trash.className = 'trash'
    this.trash.innerHTML = '<span class="trash-emoji">🗑</span><span class="trash-label"></span>'
    stage.appendChild(this.trash)

    const handlers = this.bindPointer()
    this.onPointerDown = handlers.onPointerDown
    this.onPointerMove = handlers.onPointerMove
    this.onPointerUp = handlers.onPointerUp
    // pointerdown은 stage가 아니라 window에 건다: stage와 held pellet이 둘 다
    // pointer-events:none라, 빈(높은) 영역 클릭은 stage 리스너에 닿지 않는다(타깃은
    // stage의 부모 #root). window는 무조건 받으므로 어디서든 먹이를 떨굴 수 있다.
    window.addEventListener('pointerdown', this.onPointerDown)
    window.addEventListener('pointermove', this.onPointerMove)
    window.addEventListener('pointerup', this.onPointerUp)

    // ESC는 여기서 한 번만 등록; 먹이를 안 들고 있으면 reducer가 no-op.
    this.onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      this.dispatch({ type: 'ESC' })
    }
    window.addEventListener('keydown', this.onKeyDown)

    this.rafId = requestAnimationFrame((t) => this.frame(t))
  }

  // world가 만든 모든 것 정리: rAF 루프 중지, 포인터 리스너 제거, 모든 고양이 + trash를
  // DOM에서 분리. 여러 번 호출해도 안전.
  destroy(): void {
    if (!this.alive) return
    this.alive = false
    cancelAnimationFrame(this.rafId)
    window.removeEventListener('pointerdown', this.onPointerDown)
    window.removeEventListener('pointermove', this.onPointerMove)
    window.removeEventListener('pointerup', this.onPointerUp)
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('resize', this.onResize)
    this.clearFeeding() // 들고 있던 pellet 제거 + 먹이 타깃 해제
    this.clearPellets() // 바닥 pellet 제거, 타이머 정리 + 진행 중 eat 취소
    for (const c of this.cats) {
      c.engine.dispose() // actor 중지 + 구독 해제
      c.view.destroy()
    }
    this.cats = []
    this.removeBowl()
    this.trash.remove()
    this.renderer.destroy()
  }

  onDelete(cb: () => void): void {
    this.onDeleteCb = cb
  }

  // 밥그릇을 새 floor x에 놓을 때(저장용).
  onBowlMove(cb: (x: number) => void): void {
    this.onBowlMoveCb = cb
  }

  // 밥그릇을 trash에 버릴 때(config에서 비활성화).
  onBowlRemove(cb: () => void): void {
    this.onBowlRemoveCb = cb
  }

  // 밥그릇 element를 config에 맞춰 동기화: 생성/제거 + `x`(null이면 화면 중앙)로 이동.
  // 저장된 값이 낡아 화면 밖이어도 밥그릇이 사라지지 않도록 x를 보이는 floor 안으로 clamp.
  setBowl(enabled: boolean, x: number | null): void {
    if (!enabled) {
      // 진행 중인 밥그릇 제스처/먹이-들기를 취소(config echo가 제스처 도중 올 수 있음)한 뒤 제거.
      this.dispatch({ type: 'BOWL_REMOVED' })
      this.removeBowl()
      return
    }
    if (!this.bowl) {
      const img = document.createElement('img')
      img.className = 'bowl'
      img.src = bowlPng
      img.draggable = false
      this.stage.appendChild(img)
      this.bowl = img
    }
    const target = x === null ? (window.innerWidth - BOWL_SIZE) / 2 : x
    this.bowlX = this.clampBowlX(target)
    this.bowl.style.left = `${this.bowlX}px`
  }

  // 고양이를 trash 위로 올렸을 때 표시할 텍스트.
  setTrashLabel(text: string): void {
    const label = this.trash.querySelector('.trash-label')
    if (label) label.textContent = text
  }

  setSleepAfter(sec: number): void {
    this.sleepAfterSec = sec
    for (const c of this.cats) c.engine.setSleepAfter(sec)
  }

  setNoWake(on: boolean): void {
    this.noWake = on
    for (const c of this.cats) c.engine.setNoWake(on)
  }

  // 모든 고양이를 즉시 재운다.
  sleepAll(): void {
    for (const c of this.cats) c.engine.sleepNow()
    // 먹던 고양이가 이제 자므로 그 pellet을 풀어 다른 (깨어 있는) 고양이가 배정되게 한다.
    for (const p of this.pellets) {
      if (p.assignedCat && p.assignedCat.engine.isAsleep()) p.assignedCat = null
    }
  }

  // 자는 고양이를 즉시 모두 깨운다.
  wakeAll(): void {
    for (const c of this.cats) c.engine.wakeNow()
  }

  // 살아있는 고양이를 요청된 색상별 카운트에 맞춘다.
  setCounts(counts: CatCounts): void {
    const colors: CatColor[] = ['ginger', 'grey', 'white']
    for (const color of colors) {
      let have = this.cats.filter((c) => c.color === color).length
      while (have < counts[color]) {
        this.spawn(color)
        have++
      }
      while (have > counts[color]) {
        const victim = [...this.cats].reverse().find((c) => c.color === color)
        if (victim) this.removeCat(victim)
        have--
      }
    }
  }

  getCounts(): CatCounts {
    const counts: CatCounts = { ginger: 0, grey: 0, white: 0 }
    for (const c of this.cats) counts[c.color]++
    return counts
  }

  // --- 내부 구현 ---
  private getMaxX = (): number => Math.max(0, window.innerWidth - this.def.displaySize)

  private spawn(color: CatColor): void {
    const engine = new CatEngine({
      def: this.def,
      startX: Math.random() * this.getMaxX(),
      getMaxX: this.getMaxX,
      sleepAfter: this.sleepAfterSec
    })
    engine.setNoWake(this.noWake)
    const view = new PetView(this.def.frameSize, this.def.displaySize, this.sheets[color])
    this.cats.push({ color, engine, view, lastKey: '' })
  }

  private removeCat(cat: CatInstance): void {
    // 이 고양이가 pellet에 배정돼 먹는 중이면 먼저 cancelEat() — 참조를 잃기 전에 고아
    // onEatenCb 클로저를 떨군다. 그 뒤 배정을 null해 pellet을 재배정 가능하게.
    for (const p of this.pellets) {
      if (p.assignedCat === cat) {
        cat.engine.cancelEat() // onEatenCb 해제; 먹는 중 아니면 no-op
        p.assignedCat = null
      }
    }
    cat.engine.dispose() // actor 중지 + 구독 해제
    cat.view.destroy()
    this.cats = this.cats.filter((c) => c !== cat)
  }

  // 밥그릇 element의 DOM 정리만. 진행 중 제스처/먹이-들기 취소는 BOWL_REMOVED 이벤트로
  // reducer가 처리한다(외부 제거 트리거 setBowl(false)가 dispatch).
  private removeBowl(): void {
    if (!this.bowl) return
    this.bowl.remove()
    this.bowl = null
  }

  private clampBowlX = (x: number): number => clampX(x, 0, window.innerWidth - BOWL_SIZE)

  // 먹이-들기 ON: 클릭 지점에 커서 부착 pellet 생성 + 첫 gather 패스. 깔끔한 밥그릇
  // 클릭(드래그 없는 pointerup)에서 호출. 이후 pellet은 updateFeed()로 매 move마다 따라온다.
  private startFeed(x: number, y: number): void {
    if (!this.heldPellet) {
      const img = document.createElement('img')
      img.className = 'pellet'
      img.src = pelletPng
      img.draggable = false
      this.stage.appendChild(img)
      this.heldPellet = img
    }
    this.positionPellet(x, y)
    this.updateFoodTargets(x)
  }

  // pellet을 커서에 따라가게 하고 누가 모일지 재계산.
  private updateFeed(x: number, y: number): void {
    if (this.heldPellet) this.positionPellet(x, y)
    this.updateFoodTargets(x)
  }

  private positionPellet(x: number, y: number): void {
    if (!this.heldPellet) return
    this.heldPellet.style.left = `${x - PELLET_SIZE / 2}px`
    this.heldPellet.style.top = `${y - PELLET_SIZE / 2}px`
  }

  // 커서 x의 FOOD_RADIUS 내 고양이는 모이게 하고 나머지는 풀어준다. 매 move마다 재계산.
  private updateFoodTargets(cursorX: number): void {
    const center = this.def.displaySize / 2
    const spacing = this.def.displaySize * 0.7
    // 순수 코어가 멤버십 + 각자의 fan-out target x 결정; 스프라이트 CENTER x 규약.
    const targets = computeGather(
      this.cats.map((c) => ({ x: c.engine.x + center, free: c.engine.isFreeToEat() })),
      cursorX,
      FOOD_RADIUS,
      spacing
    )
    // 모이지 않는 고양이를 풀어준 뒤, 모이는 각자를 제 자리로 보낸다.
    const gathering = new Set(targets.map((t) => t.index))
    this.cats.forEach((c, i) => {
      if (!gathering.has(i)) c.engine.setFoodTarget(null)
    })
    for (const t of targets) this.cats[t.index].engine.setFoodTarget(t.targetX)
  }

  // 먹이-들기 종료: 커서 pellet 제거 + 모든 고양이 먹이 타깃 해제. (캡처 재평가는 호출부 책임.)
  private clearFeeding(): void {
    if (this.heldPellet) {
      this.heldPellet.remove()
      this.heldPellet = null
    }
    for (const c of this.cats) c.engine.setFoodTarget(null)
  }

  // 커서 x에 바닥 pellet을 떨군다(바닥 기준). max-5 캡 적용(가장 오래된 것 축출), 30s 만료
  // 타이머 장전, 최근접 free 고양이를 즉시 배정 시도.
  private dropPellet(cursorX: number, cursorY: number): void {
    // 추가 전에 캡을 적용해 한순간도 초과하지 않게.
    while (this.pellets.length >= MAX_PELLETS) {
      this.removePellet(this.pellets[0]) // 오래된 것부터(FIFO)
    }
    const x = Math.max(0, Math.min(window.innerWidth, cursorX))
    const el = document.createElement('img')
    el.className = 'pellet-floor'
    el.src = pelletPng
    el.draggable = false
    el.style.left = `${x - PELLET_SIZE / 2}px`
    // 떨어지는 애니: 커서 높이에서 시작해 바닥으로 낙하(슝).
    const restTop = window.innerHeight - PELLET_SIZE
    const dy = Math.min(0, cursorY - restTop)
    el.style.transition = 'none'
    el.style.transform = `translateY(${dy}px)`
    this.stage.appendChild(el)
    requestAnimationFrame(() => {
      el.style.transition = '' // 스타일시트로 복귀(opacity + transform)
      el.style.transform = 'translateY(0)'
    })
    const pellet: Pellet = {
      el,
      x,
      assignedCat: null,
      expireTimer: setTimeout(() => this.expirePellet(pellet), PELLET_TTL_MS),
      expiring: false,
      fadeTimer: null // 30s TTL이 터지면 expirePellet()이 설정
    }
    this.pellets.push(pellet)
    this.assignPellets()
  }

  // 미배정 pellet마다 최근접 free 고양이를 보내 먹게 한다(이중배정 없음). pellet이
  // 떨어질 때와 매 프레임 호출 → 한때 배정 못 한 pellet도 고양이가 free되면 집어간다.
  private assignPellets(): void {
    const center = this.def.displaySize / 2
    // 순수 코어가 incremental taken-set으로 최근접-free 패스(이중배정 없음, 결정적
    // 타이브레이크)를 plain 데이터 위에서 수행. 스프라이트 CENTER x 규약.
    const assignments = assignNearestFree(
      this.cats.map((c) => ({ x: c.engine.x + center, free: c.engine.isFreeToEat() })),
      this.pellets.map((p) => ({
        x: p.x,
        assignedCatIndex: p.assignedCat ? this.cats.indexOf(p.assignedCat) : null,
        expiring: p.expiring
      }))
    )
    for (const { pelletIndex, catIndex } of assignments) {
      const pellet = this.pellets[pelletIndex]
      const cat = this.cats[catIndex]
      pellet.assignedCat = cat
      // 먹기 완료 시: pellet 제거(고양이 참조도 해제). engine은 이 콜백 전에 스스로
      // autonomous로 리셋된다.
      cat.engine.goEat(pellet.x, () => this.removePellet(pellet))
    }
  }

  // 바닥 pellet 제거: 만료 타이머 정리, 배정된 고양이의 eat 취소(깔끔히 복귀), 배열에서
  // 빼고 element 분리. pellet당 한 번 호출해도 안전.
  private removePellet(pellet: Pellet): void {
    const idx = this.pellets.indexOf(pellet)
    if (idx === -1) return // 이미 제거됨
    this.pellets.splice(idx, 1)
    clearTimeout(pellet.expireTimer)
    // 400ms fade 창 도중 teardown이 끼어들면 죽은 world에서 콜백이 터지지 않도록 취소.
    if (pellet.fadeTimer !== null) clearTimeout(pellet.fadeTimer)
    // 이 pellet을 먹던 고양이가 있으면 복귀시킨다(pellet을 먼저 지워 eat 완료 콜백은 안 터짐).
    // 그 콜백이 pellet을 지운 경우엔 고양이가 이미 리셋돼 cancelEat은 no-op이다.
    if (pellet.assignedCat) pellet.assignedCat.engine.cancelEat()
    pellet.el.remove()
  }

  // 30s TTL 경과: pellet을 fade-out 후 제거.
  private expirePellet(pellet: Pellet): void {
    if (this.pellets.indexOf(pellet) === -1 || pellet.expiring) return
    pellet.expiring = true // fade 동안 재배정 차단
    pellet.el.classList.add('pellet-floor--expiring')
    // 먹던 고양이를 즉시 풀어 사라지는 pellet을 계속 먹지 않게 한다.
    if (pellet.assignedCat) {
      pellet.assignedCat.engine.cancelEat()
      pellet.assignedCat = null
    }
    // fade 창 도중 teardown 시 취소할 수 있게 id 보관 — 죽은 world 콜백 방지.
    pellet.fadeTimer = setTimeout(() => this.removePellet(pellet), 400)
  }

  // 모든 바닥 pellet 제거 + 타이머 정리 + 먹던 고양이 복귀(teardown용).
  private clearPellets(): void {
    // 먼저 복사: removePellet이 this.pellets를 변형한다.
    for (const pellet of [...this.pellets]) this.removePellet(pellet)
  }

  // 이 고양이에 배정된 pellet을 푼다(드래그가 eat를 덮어쓰기 전에 사용).
  private unassignCat(cat: CatInstance): void {
    for (const p of this.pellets) {
      if (p.assignedCat === cat) p.assignedCat = null
    }
  }

  // ── 포인터 히트테스트 (live DOM rect를 호출 시점에 읽음, 캐시 금지) ──
  // 포인터 아래 topmost 고양이(마지막 그린 것 우선) — 고양이 우선순위 보존.
  private catUnder(cx: number, cy: number): CatInstance | null {
    return pickTopmost(
      this.cats.map((c) => ({ rect: c.view.getHitRect(), ref: c })),
      { x: cx, y: cy }
    )
  }
  private overTrash(cx: number, cy: number): boolean {
    return pointInRect({ x: cx, y: cy }, this.trash.getBoundingClientRect())
  }
  private bowlUnder(cx: number, cy: number): boolean {
    return this.bowl !== null && pointInRect({ x: cx, y: cy }, this.bowl.getBoundingClientRect())
  }
  // 커서가 interactive 객체(고양이 또는 밥그릇) 위에 있는가.
  private overInteractive(cx: number, cy: number): boolean {
    return this.catUnder(cx, cy) !== null || this.bowlUnder(cx, cy)
  }

  private bindPointer(): {
    onPointerDown: (e: PointerEvent) => void
    onPointerMove: (e: PointerEvent) => void
    onPointerUp: (e: PointerEvent) => void
  } {
    // 각 핸들러는 live rect를 읽어 히트 결과를 담은 이벤트를 만들고 reducer로 dispatch.
    // 모든 제스처 판정은 reducer가 소유; dispatch()가 반환 effect를 실행한다.
    const onPointerDown = (e: PointerEvent): void => {
      this.dispatch({
        type: 'POINTER_DOWN',
        x: e.clientX,
        y: e.clientY,
        bowlX: this.bowlX,
        hit: { cat: this.catUnder(e.clientX, e.clientY), onBowl: this.bowlUnder(e.clientX, e.clientY) }
      })
    }
    const onPointerMove = (e: PointerEvent): void => {
      this.dispatch({
        type: 'POINTER_MOVE',
        x: e.clientX,
        y: e.clientY,
        overTrash: this.overTrash(e.clientX, e.clientY),
        overInteractive: this.overInteractive(e.clientX, e.clientY)
      })
    }
    const onPointerUp = (e: PointerEvent): void => {
      this.dispatch({
        type: 'POINTER_UP',
        x: e.clientX,
        y: e.clientY,
        onBowl: this.bowlUnder(e.clientX, e.clientY),
        overTrash: this.overTrash(e.clientX, e.clientY),
        overInteractive: this.overInteractive(e.clientX, e.clientY)
      })
    }
    return { onPointerDown, onPointerMove, onPointerUp }
  }

  // 이벤트를 순수 reducer에 넣어 다음 state를 저장하고, 반환 effect를 순서대로 SYNCHRONOUS
  // 실행 — 클릭통과 캡처가 같은 이벤트 턴 안에서 토글되도록(필수).
  private dispatch(event: Parameters<typeof reduce<CatInstance>>[1]): void {
    const { state, effects } = reduce(this.gesture, event)
    this.gesture = state
    for (const effect of effects) this.runEffect(effect)
  }

  // 제스처 effect 하나를 DOM/engine/IO에 실행(불순).
  private runEffect(effect: Effect<CatInstance>): void {
    switch (effect.type) {
      case 'SET_CAPTURE':
        // Idempotent: 값이 실제로 바뀔 때만 클릭통과를 토글.
        if (effect.on !== this.capturing) {
          this.capturing = effect.on
          window.petApi.setIgnoreMouseEvents(!effect.on)
        }
        break
      case 'START_DRAG':
        // pellet으로 가던/먹던 고양이를 잡으면 그 pellet을 풀어 재배정 가능하게 한다
        // (startDrag가 고양이의 eat 상태를 정리).
        this.unassignCat(effect.cat)
        effect.cat.engine.startDrag()
        this.trash.classList.add('visible')
        break
      case 'DRAG_TO':
        effect.cat.engine.dragTo(effect.x - this.def.displaySize / 2)
        break
      case 'END_DRAG':
        effect.cat.engine.endDrag()
        break
      case 'CLICK_CAT':
        effect.cat.engine.click()
        break
      case 'REMOVE_CAT':
        this.removeCat(effect.cat)
        this.onDeleteCb?.()
        break
      case 'START_FEED':
        this.startFeed(effect.x, effect.y)
        break
      case 'UPDATE_FEED':
        this.updateFeed(effect.x, effect.y)
        break
      case 'UPDATE_FOOD_TARGETS':
        this.updateFoodTargets(effect.x)
        break
      case 'CLEAR_FEEDING':
        this.clearFeeding()
        break
      case 'DROP_PELLET':
        this.dropPellet(effect.x, effect.y)
        break
      case 'SET_BOWL_X':
        if (this.bowl) {
          this.bowlX = this.clampBowlX(effect.x)
          this.bowl.style.left = `${this.bowlX}px`
        }
        break
      case 'PERSIST_BOWL_X':
        if (this.bowl) this.onBowlMoveCb?.(this.bowlX)
        break
      case 'REMOVE_BOWL_CFG':
        if (this.bowl) {
          this.removeBowl()
          this.onBowlRemoveCb?.()
        }
        break
      case 'TRASH':
        if (effect.visible !== undefined) this.trash.classList.toggle('visible', effect.visible)
        if (effect.hot !== undefined) this.trash.classList.toggle('hot', effect.hot)
        break
    }
  }

  private frame(now: number): void {
    if (!this.alive) return
    const elapsed = now - this.last
    this.last = now
    const dt = Math.min(0.05, elapsed / 1000)

    this.perf.fps = this.perf.fps * 0.9 + (1000 / elapsed) * 0.1
    this.perf.frameMs = elapsed
    if (elapsed > 16) this.perf.longFrames++

    // free 고양이를 기다리는 pellet이 있으면 배정 재시도(방금 다 먹었거나 깼거나 내려놨을
    // 수 있음). 미배정 pellet이 없으면 값싼 no-op.
    if (this.pellets.some((p) => !p.assignedCat && !p.expiring)) this.assignPellets()

    const t0 = performance.now()
    const { soa } = this
    const maxX = this.getMaxX()
    let n = 0
    for (let i = 0; i < this.cats.length; i++) {
      const { engine } = this.cats[i]
      if (engine.sleeping) continue
      soa.x[n] = engine.x
      soa.y[n] = engine.y
      soa.speed[n] = engine.speed
      soa.facing[n] = engine.facing === 'right' ? 1 : 0
      soa.moving[n] = engine.moving ? 1 : 0
      soa.remaining[n] = engine.remaining
      soa.inactivity[n] = engine.inactivity
      soa.sleepAfter[n] = engine.sleepAfter
      soa.maxX[n] = maxX
      soa.jumpActive[n] = engine.jump.active ? 1 : 0
      soa.jumpT[n] = engine.jump.t
      soa.jumpDur[n] = engine.jump.dur
      soa.jumpFromX[n] = engine.jump.fromX
      soa.jumpDx[n] = engine.jump.dx
      soa.jumpHeight[n] = this.def.jumpHeight
      this.soaIdx[n] = i
      n++
    }
    const tick = wasmTick
    if (n > 0) {
      if (tick !== null) {
        tick(
          soa.x.subarray(0, n), soa.y.subarray(0, n), soa.speed.subarray(0, n),
          soa.facing.subarray(0, n), soa.moving.subarray(0, n),
          soa.remaining.subarray(0, n), soa.inactivity.subarray(0, n),
          soa.sleepAfter.subarray(0, n), soa.maxX.subarray(0, n),
          soa.jumpActive.subarray(0, n), soa.jumpT.subarray(0, n),
          soa.jumpDur.subarray(0, n), soa.jumpFromX.subarray(0, n), soa.jumpDx.subarray(0, n),
          soa.jumpHeight.subarray(0, n),
          soa.needsXState.subarray(0, n),
          dt, n
        )
        for (let j = 0; j < n; j++) {
          const c = this.cats[this.soaIdx[j]]
          const { engine } = c
          if (soa.needsXState[j]) {
            engine.syncPhysics(
              soa.x[j], soa.y[j], soa.remaining[j], soa.inactivity[j],
              { active: !!soa.jumpActive[j], t: soa.jumpT[j], dur: soa.jumpDur[j], fromX: soa.jumpFromX[j], dx: soa.jumpDx[j] }
            )
            engine.tick(dt)
            if (engine.animKey !== c.lastKey) {
              const anim = this.def.anim[engine.animKey]
              if (anim) c.view.setAnimation(anim)
              c.lastKey = engine.animKey
            }
          } else {
            engine.x = soa.x[j]
            engine.y = soa.y[j]
            engine.inactivity = soa.inactivity[j]
            engine.remaining = soa.remaining[j]
            if (engine.jump.active) engine.jump = { ...engine.jump, t: soa.jumpT[j] }
          }
        }
      } else {
        // ponytail: JS fallback until WASM resolves (typically <1 frame)
        for (let j = 0; j < n; j++) {
          const c = this.cats[this.soaIdx[j]]
          c.engine.tick(dt)
          if (c.engine.animKey !== c.lastKey) {
            const anim = this.def.anim[c.engine.animKey]
            if (anim) c.view.setAnimation(anim)
            c.lastKey = c.engine.animKey
          }
        }
      }
    }
    this.perf.tickMs = performance.now() - t0

    const t1 = performance.now()
    const sprites: SpriteRenderInfo[] = []
    for (const c of this.cats) {
      c.view.setPosition(c.engine.x, c.engine.y)
      c.view.tick(dt)
      const rs = c.view.getRenderState()
      if (rs) sprites.push({ color: c.color, x: c.engine.x, y: c.engine.y, ...rs })
    }
    this.renderer.render(sprites, window.innerHeight)
    this.perf.renderMs = performance.now() - t1

    this.perf.catCount = this.cats.length
    this.perf.canvasCount = 1
    this.perf.heapMB = ((performance as any).memory?.usedJSHeapSize ?? 0) / 1_048_576

    this.rafId = requestAnimationFrame((t) => this.frame(t))
  }
}
