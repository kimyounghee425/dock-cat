// main·preload·renderer가 공유하는 순수 config 모듈. renderer에도 번들되므로 electron이나
// node/renderer 전용 API를 import하면 안 된다.

export type CatColor = 'ginger' | 'grey' | 'white'
export type CatCounts = Record<CatColor, number>
export type Lang = 'ko' | 'en'

// 영속 설정. sleepAfterMin = null이면 "잠 안 잠".
export interface PetConfig {
  counts: CatCounts
  sleepAfterMin: number | null
  // true면 자는 고양이를 클릭해도 깨우지 않는다.
  noWake: boolean
  lang: Lang
  launchAtLogin: boolean
  bowlEnabled: boolean
  // 밥그릇 floor x; null이면 "기본 위치"(renderer에서 해석).
  bowlX: number | null
  showPerf: boolean
}

export const MAX_PER_COLOR = 500
export const CAT_COLORS: CatColor[] = ['ginger', 'grey', 'white']
export const SLEEP_OPTIONS: (number | null)[] = [1, 5, 10, 30, null]

export const DEFAULT_CONFIG: PetConfig = {
  counts: { ginger: 1, grey: 0, white: 0 },
  sleepAfterMin: 5,
  noWake: false,
  lang: 'en',
  launchAtLogin: false,
  bowlEnabled: false,
  bowlX: null,
  showPerf: false
}

const clampCount = (n: unknown): number =>
  typeof n === 'number' && Number.isFinite(n)
    ? Math.max(0, Math.min(MAX_PER_COLOR, Math.round(n)))
    : 0

const isLang = (v: unknown): v is Lang => v === 'ko' || v === 'en'

// Loose: null 또는 임의의 유한수 허용(legacy config.json 값 보존).
const isFiniteSleep = (v: unknown): v is number | null =>
  v === null || (typeof v === 'number' && Number.isFinite(v))

// Strict: UI가 허용하는 옵션 [1,5,10,30,null]만.
const isOptionSleep = (v: unknown): v is number | null =>
  v === null || (typeof v === 'number' && SLEEP_OPTIONS.includes(v))

// bowlX는 null 또는 임의 유한수. 화면 폭 clamp는 여기서 안 한다(main은 화면 크기를
// 모름) — 밥그릇 배치 시 renderer/world가 clamp.
const isBowlX = (v: unknown): v is number | null =>
  v === null || (typeof v === 'number' && Number.isFinite(v))

// counts가 sparse할 수 있는(보낸 쪽이 지정한 색상만) 검증된 IPC partial.
export type PartialPetConfig = Omit<Partial<PetConfig>, 'counts'> & {
  counts?: Partial<CatCounts>
}

// 임의 입력(예: 파싱된 config.json, 필드 빠진 구버전일 수 있음)을 기본값으로 채워 완전한
// PetConfig로 변환. sleepAfterMin은 loose(null 또는 임의 유한수 — legacy 값 보존).
export function normalizeConfig(raw: unknown): PetConfig {
  const r = (raw ?? {}) as Record<string, unknown>

  let counts: CatCounts
  if (r.counts && typeof r.counts === 'object') {
    const c = r.counts as Record<string, unknown>
    counts = {
      ginger: clampCount(c.ginger),
      grey: clampCount(c.grey),
      white: clampCount(c.white)
    }
  } else if (typeof r.color === 'string' && CAT_COLORS.includes(r.color as CatColor)) {
    // 하위호환: 옛 단일-색상 config → 그 색상 count 1.
    counts = { ginger: 0, grey: 0, white: 0 }
    counts[r.color as CatColor] = 1
  } else {
    counts = { ...DEFAULT_CONFIG.counts }
  }

  return {
    counts,
    sleepAfterMin: isFiniteSleep(r.sleepAfterMin)
      ? r.sleepAfterMin
      : DEFAULT_CONFIG.sleepAfterMin,
    noWake: typeof r.noWake === 'boolean' ? r.noWake : DEFAULT_CONFIG.noWake,
    lang: isLang(r.lang) ? r.lang : DEFAULT_CONFIG.lang,
    launchAtLogin:
      typeof r.launchAtLogin === 'boolean'
        ? r.launchAtLogin
        : DEFAULT_CONFIG.launchAtLogin,
    bowlEnabled:
      typeof r.bowlEnabled === 'boolean' ? r.bowlEnabled : DEFAULT_CONFIG.bowlEnabled,
    bowlX: isBowlX(r.bowlX) ? r.bowlX : DEFAULT_CONFIG.bowlX,
    showPerf: typeof r.showPerf === 'boolean' ? r.showPerf : DEFAULT_CONFIG.showPerf
  }
}

// 들어온 IPC partial 검증: 존재하고 유효한 키만 포함. 절대 throw 안 함.
// - counts: 입력에 실제 있는 색상만 포함(sparse — 빠진 색상을 0으로 채우지 않아 호출부가
//   안전하게 deep-merge 가능).
// - sleepAfterMin: strict 화이트리스트(UI 출처 값만).
export function normalizePartialConfig(raw: unknown): PartialPetConfig {
  const r = (raw ?? {}) as Record<string, unknown>
  const out: PartialPetConfig = {}

  if (r.counts && typeof r.counts === 'object') {
    const c = r.counts as Record<string, unknown>
    const counts: Partial<CatCounts> = {}
    for (const color of CAT_COLORS) {
      if (color in c) counts[color] = clampCount(c[color])
    }
    if (Object.keys(counts).length > 0) out.counts = counts
  }
  if (isOptionSleep(r.sleepAfterMin)) out.sleepAfterMin = r.sleepAfterMin
  if (typeof r.noWake === 'boolean') out.noWake = r.noWake
  if (isLang(r.lang)) out.lang = r.lang
  if (typeof r.launchAtLogin === 'boolean') out.launchAtLogin = r.launchAtLogin
  if (typeof r.bowlEnabled === 'boolean') out.bowlEnabled = r.bowlEnabled
  if (isBowlX(r.bowlX)) out.bowlX = r.bowlX
  if (typeof r.showPerf === 'boolean') out.showPerf = r.showPerf

  return out
}
