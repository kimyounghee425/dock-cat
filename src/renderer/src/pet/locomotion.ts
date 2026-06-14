/**
 * Owns the pet's horizontal position along the floor. Moves only when the
 * engine says it's walking, mirrors facing direction, and turns around at the
 * screen edges. Vertical position is fixed to the bottom by CSS.
 */
export class Locomotion {
  private x: number
  private dir: 1 | -1 = 1 // 1 = facing/moving right, -1 = left
  private speed: number
  private size: number

  constructor(speed: number, size: number) {
    this.speed = speed
    this.size = size
    this.x = Math.random() * this.maxX()
    this.dir = Math.random() < 0.5 ? 1 : -1
  }

  update(dt: number, moving: boolean): void {
    if (!moving) return
    this.x += this.speed * this.dir * dt

    const max = this.maxX()
    if (this.x <= 0) {
      this.x = 0
      this.dir = 1
    } else if (this.x >= max) {
      this.x = max
      this.dir = -1
    }
  }

  getX(): number {
    return this.x
  }

  /** Mirror factor for the sprite: 1 faces right, -1 faces left. */
  getFlip(): 1 | -1 {
    return this.dir
  }

  private maxX(): number {
    return Math.max(0, window.innerWidth - this.size)
  }
}
