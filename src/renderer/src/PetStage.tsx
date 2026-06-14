import { useEffect, useRef } from 'react'
import { startPet, type PetController } from './pet/loop'
import { cat, CAT_SHEETS } from './pets/cat'

/**
 * Mount point for the imperative pet loop. Loads the saved colorway from the
 * main process, then subscribes to live color changes from the settings window.
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
      controller = startPet(stageRef.current, cat, CAT_SHEETS, cfg.color)
      unsubscribe = window.petApi.onColorChange((color) => controller?.setColor(color))
    })

    return () => unsubscribe?.()
  }, [])

  return <div ref={stageRef} className="pet-stage" />
}
