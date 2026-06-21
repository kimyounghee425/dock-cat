import { useEffect, useRef } from 'react'
import { PetWorld } from './pet/world'
import { cat, CAT_SHEETS } from './pets/cat'
import { STRINGS } from './i18n'

const toSec = (min: number | null): number => (min === null ? Infinity : min * 60)

// pet world를 마운트: 저장된 counts로 고양이를 spawn하고 live config 변경(counts + sleep
// 타이머)과 동기화. 고양이를 trash로 드래그하면 줄어든 count를 config에 영속.
export function PetStage(): JSX.Element {
  const stageRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!stageRef.current) return

    let world: PetWorld | null = null
    let disposed = false
    const unsubscribe: Array<() => void> = []

    window.petApi.getConfig().then((cfg) => {
      // config가 resolve되기 전에 effect가 정리됨(예: StrictMode 리마운트).
      if (disposed || !stageRef.current) return
      world = new PetWorld(stageRef.current, cat, CAT_SHEETS, toSec(cfg.sleepAfterMin))
      world.setCounts(cfg.counts)
      world.setNoWake(cfg.noWake)
      world.setTrashLabel(STRINGS[cfg.lang].giveAway)
      world.setBowl(cfg.bowlEnabled, cfg.bowlX)
      // 고양이가 trash됨 → 새 counts 영속
      world.onDelete(() => window.petApi.setConfig({ counts: world!.getCounts() }))
      // bowl 드래그 → x 영속; bowl trash → 토글 off
      world.onBowlMove((x) => window.petApi.setConfig({ bowlX: x }))
      world.onBowlRemove(() => window.petApi.setConfig({ bowlEnabled: false }))
      unsubscribe.push(
        window.petApi.onConfigChange((c) => {
          world?.setCounts(c.counts)
          world?.setSleepAfter(toSec(c.sleepAfterMin))
          world?.setNoWake(c.noWake)
          world?.setTrashLabel(STRINGS[c.lang].giveAway)
          world?.setBowl(c.bowlEnabled, c.bowlX)
        }),
        window.petApi.onSleepAll(() => world?.sleepAll()),
        window.petApi.onWakeAll(() => world?.wakeAll())
      )
    })

    return () => {
      disposed = true
      for (const off of unsubscribe) off()
      world?.destroy()
    }
  }, [])

  return <div ref={stageRef} className="pet-stage" />
}
