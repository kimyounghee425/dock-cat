import { ANIM, DISPLAY, FRAME } from '../pets/cat'
import type { CatColor } from './types'
import { CatEngine } from './engine'
import { PetView } from './view'

export interface PetController {
  setColor(color: CatColor): void
  setSleepAfter(sec: number): void
}

/**
 * Boots one cat: engine + view in a single rAF loop, plus pointer handling for
 * click (wake/hiss/meow) and floor-constrained dragging (plays run-up).
 * Only the cat's opaque pixels capture the mouse; everything else clicks through.
 */
export function startPet(
  stage: HTMLElement,
  sheets: Record<CatColor, string>,
  color: CatColor,
  sleepAfterSec: number
): PetController {
  const getMaxX = (): number => Math.max(0, window.innerWidth - DISPLAY)
  const engine = new CatEngine({ startX: Math.random() * getMaxX(), getMaxX, sleepAfter: sleepAfterSec })
  const view = new PetView(stage, FRAME, DISPLAY, sheets[color])

  let capturing = false
  let down = false
  let dragging = false
  let downX = 0

  const setCapture = (on: boolean): void => {
    if (on === capturing) return
    capturing = on
    window.petApi.setIgnoreMouseEvents(!on)
  }
  const overPet = (cx: number, cy: number): boolean => {
    const r = view.getHitRect()
    return cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom
  }
  const toPetX = (cx: number): number => cx - DISPLAY / 2

  stage.addEventListener('pointerdown', (e) => {
    if (!overPet(e.clientX, e.clientY)) return
    down = true
    dragging = false
    downX = e.clientX
  })
  window.addEventListener('pointermove', (e) => {
    if (down) {
      if (!dragging && Math.abs(e.clientX - downX) > 4) {
        dragging = true
        engine.startDrag()
      }
      if (dragging) {
        engine.dragTo(toPetX(e.clientX))
        setCapture(true) // hold capture for the whole drag
      }
      return
    }
    setCapture(overPet(e.clientX, e.clientY))
  })
  window.addEventListener('pointerup', (e) => {
    if (!down) return
    if (dragging) engine.endDrag()
    else engine.click()
    down = false
    dragging = false
    setCapture(overPet(e.clientX, e.clientY))
  })

  let last = performance.now()
  let lastKey = ''

  function frame(now: number): void {
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now

    engine.tick(dt)
    if (engine.animKey !== lastKey) {
      view.setAnimation(ANIM[engine.animKey])
      lastKey = engine.animKey
    }
    view.tick(dt)
    view.setPosition(engine.x, engine.y)

    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)

  return {
    setColor: (c) => view.setSheet(sheets[c]),
    setSleepAfter: (s) => engine.setSleepAfter(s)
  }
}
