import { useEffect, useState } from 'react'
import { PetWorld, PerfStats } from '../simulation/world'

export function PerfHUD({ world }: { world: PetWorld | null }): JSX.Element | null {
  const [stats, setStats] = useState<PerfStats | null>(null)

  useEffect(() => {
    if (!world) { setStats(null); return }
    const id = setInterval(() => setStats({ ...world.perf }), 500)
    return () => clearInterval(id)
  }, [world])

  if (!stats) return null

  return (
    <div style={{
      position: 'fixed', top: 8, left: 8,
      background: 'rgba(0,0,0,0.75)', color: '#00ff88',
      fontFamily: 'monospace', fontSize: 11,
      padding: '6px 10px', borderRadius: 4,
      pointerEvents: 'none', lineHeight: 1.7,
      zIndex: 9999,
    }}>
      <div>{stats.fps.toFixed(1)} fps · {stats.frameMs.toFixed(1)}ms · long: {stats.longFrames}</div>
      <div>tick {stats.tickMs.toFixed(2)}ms · render {stats.renderMs.toFixed(2)}ms</div>
      <div>heap {stats.heapMB.toFixed(1)}MB · canvas {stats.canvasCount} · cats {stats.catCount}</div>
    </div>
  )
}
