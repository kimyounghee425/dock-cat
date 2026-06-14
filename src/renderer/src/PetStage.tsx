import { useEffect, useRef } from 'react'
import { PetWorld } from './pet/world'
import { CAT_SHEETS } from './pets/cat'
import { STRINGS } from './i18n'

const toSec = (min: number | null): number => (min === null ? Infinity : min * 60)

/**
 * Mounts the pet world: spawns cats per the saved counts and keeps them in sync
 * with live config changes (counts + sleep timer). When a cat is dragged to the
 * trash, persists the reduced count back to config.
 */
export function PetStage(): JSX.Element {
  const stageRef = useRef<HTMLDivElement>(null)
  const started = useRef(false)

  useEffect(() => {
    if (started.current || !stageRef.current) return
    started.current = true

    let world: PetWorld | null = null

    window.petApi.getConfig().then((cfg) => {
      if (!stageRef.current) return
      world = new PetWorld(stageRef.current, CAT_SHEETS, toSec(cfg.sleepAfterMin))
      world.setCounts(cfg.counts)
      world.setNoWake(cfg.noWake)
      world.setTrashLabel(STRINGS[cfg.lang].giveAway)
      // a cat was trashed → persist the new counts
      world.onDelete(() => window.petApi.setConfig({ counts: world!.getCounts() }))
      window.petApi.onConfigChange((c) => {
        world?.setCounts(c.counts)
        world?.setSleepAfter(toSec(c.sleepAfterMin))
        world?.setNoWake(c.noWake)
        world?.setTrashLabel(STRINGS[c.lang].giveAway)
      })
      window.petApi.onSleepAll(() => world?.sleepAll())
      window.petApi.onWakeAll(() => world?.wakeAll())
    })
  }, [])

  return <div ref={stageRef} className="pet-stage" />
}
