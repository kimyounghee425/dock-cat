import { useEffect, useState, type CSSProperties } from 'react'
import type { CatColor } from './pet/types'
import { CAT_COLORS, CAT_SHEETS } from './pets/cat'

/**
 * Settings window UI. Picking a color persists it (main process) and broadcasts
 * the change live to the overlay pet.
 */
export function SettingsPanel(): JSX.Element {
  const [color, setColor] = useState<CatColor>('ginger')

  useEffect(() => {
    window.petApi.getConfig().then((cfg) => setColor(cfg.color))
    return window.petApi.onColorChange((c) => setColor(c))
  }, [])

  const pick = (c: CatColor): void => {
    setColor(c)
    window.petApi.setColor(c)
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
      <h1>고양이 색상</h1>
      <div className="swatches">
        {CAT_COLORS.map(({ id, label }) => (
          <button
            key={id}
            className={`swatch ${color === id ? 'selected' : ''}`}
            onClick={() => pick(id)}
            type="button"
          >
            <span className="swatch-preview" style={cropStyle(id)} />
            <span className="swatch-label">{label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
