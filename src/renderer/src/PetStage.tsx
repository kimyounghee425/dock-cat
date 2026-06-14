import { useEffect, useRef } from 'react'
import { startPet } from './pet/loop'
import { cat } from './pets/cat'

/**
 * Mount point for the imperative pet loop. React owns the stage element, but the
 * animation runs outside React (no per-frame re-renders) via startPet().
 */
export function PetStage(): JSX.Element {
  const stageRef = useRef<HTMLDivElement>(null)
  const started = useRef(false)

  useEffect(() => {
    if (started.current || !stageRef.current) return
    started.current = true // guard against React StrictMode double-invoke
    startPet(stageRef.current, cat)
  }, [])

  return <div ref={stageRef} className="pet-stage" />
}
