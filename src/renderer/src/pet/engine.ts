import { createActor, type Actor } from 'xstate'
import type { PetDefinition } from './types'
import { catMachine, type CatEvent } from './catMachine'

/**
 * Calm, cat-like behaviour. Mostly sits/grooms in one spot for 10s+ at a time,
 * with the occasional short stroll. Never runs or jumps on its own — those only
 * happen as a startled reaction to being picked up and put down. Sleeps after a
 * configurable idle period and hisses when woken.
 *
 * This class is a thin FACADE (design D2) over an XState actor running
 * `catMachine`: the behaviour logic lives in the machine, and every public
 * method here forwards to `actor.send(...)` while the read fields/queries read
 * the actor snapshot. The public surface is unchanged from the old imperative
 * engine, so `PetView`/`PetWorld` are unaffected (apart from calling `dispose`).
 */
export class CatEngine {
  // D9: x/y/animKey are mirrored from the actor snapshot into plain fields so
  // PetWorld's per-frame reads don't repeatedly call getSnapshot(). Kept current
  // by the subscription below (snapshots emit synchronously on every send).
  x: number
  y = 0 // height above the floor, px (only nonzero mid-jump)
  animKey = 'tailwag_sit_front'

  private actor: Actor<typeof catMachine>
  private sub: { unsubscribe: () => void }
  private disposed = false

  constructor(opts: {
    def: PetDefinition
    startX: number
    getMaxX: () => number
    sleepAfter: number
    rng?: () => number
  }) {
    this.x = opts.startX
    this.actor = createActor(catMachine, {
      input: {
        def: opts.def,
        startX: opts.startX,
        getMaxX: opts.getMaxX,
        sleepAfter: opts.sleepAfter,
        rng: opts.rng
      }
    })
    // Mirror the rendered fields on every snapshot (D9).
    this.sub = this.actor.subscribe((snapshot) => {
      this.x = snapshot.context.x
      this.y = snapshot.context.y
      this.animKey = snapshot.context.animKey
    })
    this.actor.start()
  }

  /**
   * The single send path (design D4). After delivering the event, drain the
   * machine's `pendingAfterTransition` slot: a normal eat completion captures its
   * onEaten callback there so it fires AFTER the transition settles (in `awake`),
   * making a re-entrant goEat() from inside the callback land cleanly. The slot
   * is cleared via CLEAR_PENDING_CALLBACKS before invoking, and the while-loop
   * tolerates re-entrancy (a callback that enqueues more is rare but safe).
   */
  private send(event: CatEvent): void {
    this.actor.send(event)
    let pending = this.actor.getSnapshot().context.pendingAfterTransition
    while (pending.length > 0) {
      this.actor.send({ type: 'CLEAR_PENDING_CALLBACKS' })
      for (const cb of pending) cb()
      pending = this.actor.getSnapshot().context.pendingAfterTransition
    }
  }

  isAsleep(): boolean {
    return this.actor.getSnapshot().matches('asleep')
  }

  /** True while playing the one-shot eat animation for an assigned pellet. */
  isEating(): boolean {
    return this.actor.getSnapshot().matches('eating')
  }

  /**
   * Eligible to be assigned a dropped pellet: awake or gathering (feeding), and
   * not asleep / being dragged / already eating another pellet. PetWorld also
   * tracks pellet→cat assignment so a free cat is only ever given one pellet.
   */
  isFreeToEat(): boolean {
    const snapshot = this.actor.getSnapshot()
    return snapshot.matches('awake') || snapshot.matches('feeding')
  }

  setSleepAfter(sec: number): void {
    this.send({ type: 'SET_SLEEP_AFTER', sec })
  }

  setNoWake(on: boolean): void {
    this.send({ type: 'SET_NO_WAKE', on })
  }

  /** Force sleep right now (used by the "sleep all" button). */
  sleepNow(): void {
    this.send({ type: 'SLEEP_NOW' })
  }

  /** Wake right now without a hiss (used by the "wake all" button). */
  wakeNow(): void {
    this.send({ type: 'WAKE_NOW' })
  }

  /**
   * Feeding: PetWorld passes the held-food x (cursor) for in-range awake cats,
   * or null to release. Sleeping/dragged cats ignore it (a no-op) so feeding
   * never disturbs the "don't wake" / drag flows.
   *  - non-null: enter `feeding`, hop toward x, beg (on_hind) once close.
   *  - null while feeding: exit cleanly back to normal autonomous behaviour.
   */
  setFoodTarget(x: number | null): void {
    this.send({ type: 'SET_FOOD_TARGET', x })
  }

  /**
   * Assigned a dropped floor pellet: leave gathering/idle, hop to `x`, play the
   * eat animation once (facing chosen by approach direction), then fire
   * `onEaten` so PetWorld removes the pellet and frees this cat. Sleeping/dragged
   * cats are never assigned (PetWorld only picks isFreeToEat() cats), but guard
   * anyway so a stray call can't disturb those flows.
   */
  goEat(x: number, onEaten: () => void): void {
    this.send({ type: 'GO_EAT', x, onEaten })
  }

  /**
   * Cancel an in-progress eat WITHOUT firing onEaten (the pellet was removed out
   * from under the cat — expired, capped out, or world torn down). The cat
   * reverts to normal autonomous behaviour. Safe to call when not eating.
   */
  cancelEat(): void {
    this.send({ type: 'CANCEL_EAT' })
  }

  /** Plain click: wake + hiss if asleep, otherwise a quick meow. */
  click(): void {
    this.send({ type: 'CLICK' })
  }

  startDrag(): void {
    this.send({ type: 'DRAG_START' })
  }

  dragTo(x: number): void {
    this.send({ type: 'DRAG_MOVE', x })
  }

  /** Put down → startled: a real arcing leap sideways, then bolt away. */
  endDrag(): void {
    this.send({ type: 'DRAG_END' })
  }

  tick(dt: number): void {
    this.send({ type: 'TICK', dt })
  }

  /**
   * Tear down the actor + subscription (D8). Called by PetWorld on removal.
   * Idempotent: safe to call more than once (defensive — double-dispose is
   * structurally unreachable today, but the guard hardens the teardown path).
   */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.sub.unsubscribe()
    this.actor.stop()
  }
}
