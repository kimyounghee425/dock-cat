// Pure, framework-free config module shared by main, preload, and renderer.
// MUST NOT import electron or any node/renderer-only API — it gets bundled
// into the renderer too.

export type CatColor = 'ginger' | 'grey' | 'white'
export type CatCounts = Record<CatColor, number>
export type Lang = 'ko' | 'en'

/** Persisted settings. sleepAfterMin = null means "never sleep". */
export interface PetConfig {
  counts: CatCounts
  sleepAfterMin: number | null
  /** When true, clicking a sleeping cat won't wake it. */
  noWake: boolean
  lang: Lang
  /** Start DockCat automatically on login. */
  launchAtLogin: boolean
}

export const MAX_PER_COLOR = 3
export const CAT_COLORS: CatColor[] = ['ginger', 'grey', 'white']
export const SLEEP_OPTIONS: (number | null)[] = [1, 5, 10, 30, null]

export const DEFAULT_CONFIG: PetConfig = {
  counts: { ginger: 1, grey: 0, white: 0 },
  sleepAfterMin: 5,
  noWake: false,
  lang: 'en',
  launchAtLogin: false
}

const clampCount = (n: unknown): number =>
  typeof n === 'number' && Number.isFinite(n)
    ? Math.max(0, Math.min(MAX_PER_COLOR, Math.round(n)))
    : 0

const isLang = (v: unknown): v is Lang => v === 'ko' || v === 'en'

/** Loose: accepts null or any finite number (preserves legacy config.json values). */
const isFiniteSleep = (v: unknown): v is number | null =>
  v === null || (typeof v === 'number' && Number.isFinite(v))

/** Strict: only the UI-allowed options [1,5,10,30,null]. */
const isOptionSleep = (v: unknown): v is number | null =>
  v === null || (typeof v === 'number' && SLEEP_OPTIONS.includes(v))

/**
 * Represents a validated IPC partial where counts may be sparse (only the
 * colors the sender actually specified).
 */
export type PartialPetConfig = Omit<Partial<PetConfig>, 'counts'> & {
  counts?: Partial<CatCounts>
}

/**
 * Turn any input (e.g. parsed config.json, possibly from an older version with
 * missing fields) into a fully-valid PetConfig, filling defaults.
 * sleepAfterMin: accepts null or ANY finite number (loose — preserves legacy values).
 */
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
    // Backward-compat: old single-color config → that color gets count 1.
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
        : DEFAULT_CONFIG.launchAtLogin
  }
}

/**
 * Validate an incoming IPC partial: only includes keys that are present AND
 * valid. Never throws.
 * - counts: only colors actually present in the input are included (sparse —
 *   missing colors are NOT defaulted to 0, so the caller can deep-merge safely).
 * - sleepAfterMin: strict whitelist (UI-originated values only).
 */
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

  return out
}
