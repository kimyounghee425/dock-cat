import type { CatColor, PetDefinition } from './types'
import { PetEngine } from './engine'
import { Locomotion } from './locomotion'
import { PetView } from './view'

export interface PetController {
  setColor(color: CatColor): void
}

/**
 * Bootstraps one pet: wires engine + locomotion + view into a single rAF loop,
 * and manages click-through so only the pet captures the mouse. Returns a
 * controller so the host (settings) can swap colorways at runtime.
 */
export function startPet(
  stage: HTMLElement,
  def: PetDefinition,
  sheets: Record<CatColor, string>,
  initialColor: CatColor
): PetController {
  const engine = new PetEngine(def.behavior)
  const loco = new Locomotion(def.speed, def.displaySize)
  const view = new PetView(stage, def, sheets[initialColor])

  view.onClick(() => engine.poke())

  // Toggle native click capture based on whether the cursor is over the pet.
  let capturing = false
  window.addEventListener('mousemove', (e) => {
    const r = view.getHitRect()
    const over =
      e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
    if (over === capturing) return
    capturing = over
    window.petApi.setIgnoreMouseEvents(!over)
  })

  let last = performance.now()
  let lastPose = ''

  function frame(now: number): void {
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now

    engine.tick(dt)
    loco.update(dt, engine.isMoving())

    if (engine.pose !== lastPose) {
      view.setPose(engine.pose)
      lastPose = engine.pose
    }
    view.tick(dt)
    view.setTransform(loco.getX(), loco.getFlip())

    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)

  return {
    setColor: (color) => view.setSheet(sheets[color])
  }
}
