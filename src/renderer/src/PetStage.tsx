import { useEffect, useRef } from 'react'
import { startPet, type PetController } from './pet/loop'
import { CAT_SHEETS } from './pets/cat'

const toSec = (min: number | null): number => (min === null ? Infinity : min * 60)

/**
 * Mount point for the imperative pet loop. Loads the saved config from the main
 * process, then applies live color / sleep-timer changes from the settings window.
 */
export function PetStage(): JSX.Element {
  const stageRef = useRef<HTMLDivElement>(null)
  const started = useRef(false)

  useEffect(() => {
    if (started.current || !stageRef.current) return
    started.current = true

    let controller: PetController | null = null
    let unsubscribe: (() => void) | undefined

    window.petApi.getConfig().then((cfg) => {
      if (!stageRef.current) return
      controller = startPet(stageRef.current, CAT_SHEETS, cfg.color, toSec(cfg.sleepAfterMin))
      unsubscribe = window.petApi.onConfigChange((c) => {
        controller?.setColor(c.color)
        controller?.setSleepAfter(toSec(c.sleepAfterMin))
      })
    })

    return () => unsubscribe?.()
  }, [])

  return <div ref={stageRef} className="pet-stage" />
}
