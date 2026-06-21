// feeding-logic.ts — 순수 먹이 알고리즘 (engine·DOM·IO 없음).
// 버그가 잦던 두 곳을 plain 데이터 위에서 다뤄 단위 테스트로 잠근다.
//   • computeGather     — 반경 멤버십 + 커서 주변 fan-out
//   • assignNearestFree — 최근접 free 고양이 → pellet 배정, 이중배정 금지
// world.ts가 cats/pellets를 이 형태로 매핑해 호출하고, 결과로 engine/DOM 효과를 적용.

export interface GatherCat {
  // 스프라이트 CENTER x (호출부가 engine.x + displaySize/2로 계산).
  x: number
  // 모임/배정 가능(awake 또는 이미 모이는 중 — 자거나 다른 걸 먹는 중 아님).
  free: boolean
}

// gather 결과 한 건: 입력 `cats` 배열의 index + 가야 할 x.
export interface GatherTarget {
  index: number
  targetX: number
}

// `cursorX` 주변에 모일 고양이와 각자의 target x를 결정.
// 멤버십: free AND 커서로부터 `radius` 이내(inclusive). 한 점에 쌓이지 않도록
// 범위 내 멤버를 x로 정렬해 고르게 펼친다("한 마리만 따라옴/겹침" 수정):
//   targetX = cursorX + (i - (n-1)/2) * spacing
// 정렬은 stable이라 같은 x 멤버는 입력 순서 유지(Array.sort 안정성에 의존). 모이는
// 고양이마다(입력 index 기준) 한 건 반환; 목록에 없는 고양이는 호출부가 풀어준다.
export function computeGather(
  cats: ReadonlyArray<GatherCat>,
  cursorX: number,
  radius: number,
  spacing: number
): GatherTarget[] {
  const inRange = cats
    .map((cat, index) => ({ index, x: cat.x, free: cat.free }))
    .filter((c) => c.free && Math.abs(c.x - cursorX) <= radius)
  // x로 stable 정렬 → 같은 x 멤버는 입력 순서 유지.
  inRange.sort((a, b) => a.x - b.x)
  const n = inRange.length
  return inRange.map((c, i) => ({
    index: c.index,
    targetX: cursorX + (i - (n - 1) / 2) * spacing
  }))
}

export interface AssignCat {
  x: number
  free: boolean
}

export interface AssignPellet {
  x: number
  // 이미 배정된 고양이의 cats 배열 index, 없으면 null.
  assignedCatIndex: number | null
  // 페이드아웃 중 — expiring pellet은 절대 (재)배정하지 않는다.
  expiring: boolean
}

export interface Assignment {
  pelletIndex: number
  catIndex: number
}

// 미배정·비-expiring pellet마다 아직 taken 아닌 최근접 free 고양이를 단일 O(P·C) 패스로 고른다.
// `taken`은 이미 배정된 고양이로 시작해 배정할 때마다 키워, 한 패스에서 한 고양이가 두 pellet을
// 받지 않게 한다(이중배정 금지). 거리 비교는 `<`(strictly less)라 동률이면 더 앞 index 고양이가
// 이긴다 — 결정적. free 고양이가 없으면 그 pellet은 생략(다음 패스에서 재시도).
export function assignNearestFree(
  cats: ReadonlyArray<AssignCat>,
  pellets: ReadonlyArray<AssignPellet>
): Assignment[] {
  const taken = new Set<number>()
  for (const pellet of pellets) {
    if (pellet.assignedCatIndex !== null) taken.add(pellet.assignedCatIndex)
  }

  const assignments: Assignment[] = []
  pellets.forEach((pellet, pelletIndex) => {
    if (pellet.assignedCatIndex !== null || pellet.expiring) return
    let best = -1
    let bestDist = Infinity
    cats.forEach((cat, catIndex) => {
      if (!cat.free || taken.has(catIndex)) return
      const dist = Math.abs(cat.x - pellet.x)
      if (dist < bestDist) {
        bestDist = dist
        best = catIndex
      }
    })
    if (best !== -1) {
      taken.add(best)
      assignments.push({ pelletIndex, catIndex: best })
    }
  })
  return assignments
}
