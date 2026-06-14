import type { PetDefinition } from './types'
import { PetEngine } from './engine'
import { Locomotion } from './locomotion'
import { PetView } from './view'

/**
 * Bootstraps one pet: wires the engine, locomotion, and view into a single
 * requestAnimationFrame loop, and manages click-through so only the pet itself
 * captures the mouse while the rest of the overlay stays transparent to clicks.
 */
export function startPet(stage: HTMLElement, def: PetDefinition): void {
  const engine = new PetEngine(def.behavior)
  const loco = new Locomotion(def.speed, def.size)
  const view = new PetView(stage, def)

  view.onClick(() => engine.poke())

  // Toggle native click capture based on whether the cursor is over the pet.
  // Forwarded mousemove arrives even while the window ignores mouse events.
  let capturing = false
  window.addEventListener('mousemove', (e) => {
    const r = view.getRect()
    const over =
      e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
    if (over === capturing) return
    capturing = over
    window.petApi.setIgnoreMouseEvents(!over)
  })

  let last = performance.now()
  let lastPose = ''

  function frame(now: number): void {
    // Clamp dt so a backgrounded tab/window doesn't teleport the pet on resume.
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now

    engine.tick(dt)
    loco.update(dt, engine.isMoving())

    if (engine.pose !== lastPose) {
      view.setPose(engine.pose)
      lastPose = engine.pose
    }
    view.setTransform(loco.getX(), loco.getFlip())

    requestAnimationFrame(frame)
  }

  requestAnimationFrame(frame)
}
