import { useEffect, useState, type CSSProperties } from 'react'
import type { CatColor, PetConfig } from './pet/types'
import { CAT_COLORS, CAT_SHEETS } from './pets/cat'

const SLEEP_OPTIONS: { label: string; value: number | null }[] = [
  { label: '1분', value: 1 },
  { label: '5분', value: 5 },
  { label: '10분', value: 10 },
  { label: '30분', value: 30 },
  { label: '안 잠', value: null }
]

export function SettingsPanel(): JSX.Element {
  const [cfg, setCfg] = useState<PetConfig>({ color: 'ginger', sleepAfterMin: 5 })

  useEffect(() => {
    window.petApi.getConfig().then(setCfg)
    return window.petApi.onConfigChange(setCfg)
  }, [])

  const update = (partial: Partial<PetConfig>): void => {
    setCfg((c) => ({ ...c, ...partial }))
    window.petApi.setConfig(partial)
  }

  // Crop the sit-idle frame (row 19, col 0) out of the 14×72 / 64px sheet.
  const PREVIEW = 56
  const s = PREVIEW / 64
  const cropStyle = (id: CatColor): CSSProperties => ({
    backgroundImage: `url(${CAT_SHEETS[id]})`,
    backgroundSize: `${896 * s}px ${4608 * s}px`,
    backgroundPosition: `0px ${-19 * PREVIEW}px`,
    imageRendering: 'pixelated'
  })

  return (
    <div className="settings">
      <section>
        <h1>고양이 색상</h1>
        <div className="swatches">
          {CAT_COLORS.map(({ id, label }) => (
            <button
              key={id}
              className={`swatch ${cfg.color === id ? 'selected' : ''}`}
              onClick={() => update({ color: id })}
              type="button"
            >
              <span className="swatch-preview" style={cropStyle(id)} />
              <span className="swatch-label">{label}</span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h1>잠들기까지</h1>
        <div className="pills">
          {SLEEP_OPTIONS.map(({ label, value }) => (
            <button
              key={label}
              className={`pill ${cfg.sleepAfterMin === value ? 'selected' : ''}`}
              onClick={() => update({ sleepAfterMin: value })}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}
