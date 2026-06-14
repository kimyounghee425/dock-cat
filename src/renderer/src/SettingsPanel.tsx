import { useEffect, useState, type CSSProperties } from 'react'
import type { CatColor, PetConfig } from './pet/types'
import { MAX_PER_COLOR } from './pet/types'
import { CAT_SHEETS } from './pets/cat'
import { LANGS, STRINGS } from './i18n'

const COLORS: CatColor[] = ['ginger', 'grey', 'white']
const SLEEP_VALUES: (number | null)[] = [1, 5, 10, 30, null]

const DEFAULT: PetConfig = {
  counts: { ginger: 1, grey: 0, white: 0 },
  sleepAfterMin: 5,
  noWake: false,
  lang: 'en'
}

const LANG_SHORT: Record<string, string> = { ko: '한', en: 'EN' }

export function SettingsPanel(): JSX.Element {
  const [cfg, setCfg] = useState<PetConfig>(DEFAULT)

  useEffect(() => {
    window.petApi.getConfig().then(setCfg)
    return window.petApi.onConfigChange(setCfg)
  }, [])

  const t = STRINGS[cfg.lang]

  const update = (partial: Partial<PetConfig>): void => {
    setCfg((c) => ({ ...c, ...partial }))
    window.petApi.setConfig(partial)
  }

  const setCount = (color: CatColor, n: number): void => {
    const clamped = Math.max(0, Math.min(MAX_PER_COLOR, n))
    update({ counts: { ...cfg.counts, [color]: clamped } })
  }

  // Crop the sit-idle frame (row 19, col 0) out of the 14×72 / 64px sheet.
  const PREVIEW = 48
  const s = PREVIEW / 64
  const cropStyle = (id: CatColor): CSSProperties => ({
    backgroundImage: `url(${CAT_SHEETS[id]})`,
    backgroundSize: `${896 * s}px ${4608 * s}px`,
    backgroundPosition: `0px ${-19 * PREVIEW}px`,
    imageRendering: 'pixelated'
  })

  const total = cfg.counts.ginger + cfg.counts.grey + cfg.counts.white

  return (
    <div className="settings">
      <div className="lang-toggle">
        {LANGS.map(({ id }) => (
          <button
            key={id}
            className={`lang-btn ${cfg.lang === id ? 'on' : ''}`}
            onClick={() => update({ lang: id })}
            type="button"
          >
            {LANG_SHORT[id]}
          </button>
        ))}
      </div>

      <section>
        <h1>{t.catsCount(total)}</h1>
        <div className="cat-rows">
          {COLORS.map((id) => (
            <div className="cat-row" key={id}>
              <span className="swatch-preview" style={cropStyle(id)} />
              <span className="cat-name">{t.color[id]}</span>
              <div className="stepper">
                <button
                  onClick={() => setCount(id, cfg.counts[id] - 1)}
                  disabled={cfg.counts[id] <= 0}
                  type="button"
                >
                  −
                </button>
                <span className="count">{cfg.counts[id]}</span>
                <button
                  onClick={() => setCount(id, cfg.counts[id] + 1)}
                  disabled={cfg.counts[id] >= MAX_PER_COLOR}
                  type="button"
                >
                  +
                </button>
              </div>
            </div>
          ))}
        </div>
        <p className="hint">{t.hint(MAX_PER_COLOR)}</p>
      </section>

      <section>
        <h1>{t.sleepAfter}</h1>
        <div className="pills">
          {SLEEP_VALUES.map((value) => (
            <button
              key={String(value)}
              className={`pill ${cfg.sleepAfterMin === value ? 'selected' : ''}`}
              onClick={() => update({ sleepAfterMin: value })}
              type="button"
            >
              {value === null ? t.never : t.minutes(value)}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h1>{t.batch}</h1>
        <div className="action-row">
          <button
            className="action-btn"
            data-tip={t.tipSleepAll}
            onClick={() => window.petApi.sleepAll()}
            type="button"
          >
            {t.sleepAll}
          </button>
          <button
            className={`action-btn toggle ${cfg.noWake ? 'on' : ''}`}
            data-tip={t.tipDontWake}
            onClick={() => update({ noWake: !cfg.noWake })}
            type="button"
          >
            {t.dontWake}
            {cfg.noWake ? ' ✓' : ''}
          </button>
        </div>
      </section>
    </div>
  )
}
