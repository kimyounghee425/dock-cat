import { useEffect, useRef, useState } from 'react'
import { PetWorld } from '../simulation/world'
import { cat, CAT_SHEETS } from '../simulation/cat'
import { STRINGS } from '../i18n'
import { PerfHUD } from './PerfHUD'

const toSec = (min: number | null): number => (min === null ? Infinity : min * 60)

// pet world를 마운트: 저장된 counts로 고양이를 spawn하고 live config 변경(counts + sleep
// 타이머)과 동기화. 고양이를 trash로 드래그하면 줄어든 count를 config에 영속.
export function PetStage(): JSX.Element {
  const stageRef = useRef<HTMLDivElement>(null)
  const [world, setWorld] = useState<PetWorld | null>(null)
  const [showPerf, setShowPerf] = useState(false)

  useEffect(() => {
    if (!stageRef.current) return

    let w: PetWorld | null = null
    let disposed = false
    const unsubscribe: Array<() => void> = []

    window.petApi.getConfig().then((cfg) => {
      // config가 resolve되기 전에 effect가 정리됨(예: StrictMode 리마운트).
      if (disposed || !stageRef.current) return
      w = new PetWorld(stageRef.current, cat, CAT_SHEETS, toSec(cfg.sleepAfterMin))
      w.setCounts(cfg.counts)
      w.setNoWake(cfg.noWake)
      w.setTrashLabel(STRINGS[cfg.lang].giveAway)
      w.setBowl(cfg.bowlEnabled, cfg.bowlX)
      // 고양이가 trash됨 → 새 counts 영속
      w.onDelete(() => window.petApi.setConfig({ counts: w!.getCounts() }))
      // bowl 드래그 → x 영속; bowl trash → 토글 off
      w.onBowlMove((x) => window.petApi.setConfig({ bowlX: x }))
      w.onBowlRemove(() => window.petApi.setConfig({ bowlEnabled: false }))
      setShowPerf(cfg.showPerf)
      unsubscribe.push(
        window.petApi.onConfigChange((c) => {
          w?.setCounts(c.counts)
          w?.setSleepAfter(toSec(c.sleepAfterMin))
          w?.setNoWake(c.noWake)
          w?.setTrashLabel(STRINGS[c.lang].giveAway)
          w?.setBowl(c.bowlEnabled, c.bowlX)
          setShowPerf(c.showPerf)
        }),
        window.petApi.onSleepAll(() => w?.sleepAll()),
        window.petApi.onWakeAll(() => w?.wakeAll())
      )
      setWorld(w)
    })

    return () => {
      disposed = true
      for (const off of unsubscribe) off()
      w?.destroy()
      setWorld(null)
    }
  }, [])

  return (
    <>
      <div ref={stageRef} className="pet-stage" />
      <PerfHUD world={showPerf ? world : null} />
    </>
  )
}
