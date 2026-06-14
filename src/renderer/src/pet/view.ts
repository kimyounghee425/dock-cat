import type { PetDefinition, Pose } from './types'

/**
 * Render adapter: turns engine pose + position into DOM. This is the ONLY layer
 * that knows the asset format. Today it injects inline SVG variants and lets CSS
 * animate them; swapping in a sprite sheet later means rewriting just this file.
 */
export class PetView {
  private el: HTMLDivElement
  private sprite: HTMLDivElement
  private def: PetDefinition
  private currentVariant = ''

  constructor(stage: HTMLElement, def: PetDefinition) {
    this.def = def

    this.el = document.createElement('div')
    this.el.className = 'pet'
    this.el.style.width = `${def.size}px`
    this.el.style.height = `${def.size}px`

    this.sprite = document.createElement('div')
    this.sprite.className = 'pet-sprite'
    this.sprite.style.width = '100%'
    this.sprite.style.height = '100%'

    const zzz = document.createElement('span')
    zzz.className = 'pet-zzz'
    zzz.textContent = 'Z'

    this.el.append(this.sprite, zzz)
    stage.appendChild(this.el)

    this.setPose('idle')
  }

  setPose(pose: Pose): void {
    this.el.dataset.pose = pose
    const variant = this.def.poseVariant[pose]
    if (variant !== this.currentVariant) {
      this.sprite.innerHTML = this.def.variants[variant]
      this.currentVariant = variant
    }
  }

  setTransform(x: number, flip: 1 | -1): void {
    this.el.style.transform = `translateX(${x}px) scaleX(${flip})`
  }

  /** Screen-space box of the pet, used for pointer hit-testing. */
  getRect(): DOMRect {
    return this.el.getBoundingClientRect()
  }

  /** Run a callback when the pet is clicked. */
  onClick(handler: () => void): void {
    this.el.addEventListener('click', handler)
  }
}
