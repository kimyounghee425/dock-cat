import { useEffect } from 'react'
import { PetStage } from './PetStage'
import { SettingsPanel } from './SettingsPanel'

/**
 * One renderer build, two windows: the transparent overlay (pet) and the
 * settings window. They're distinguished by the URL hash set in the main process.
 */
export function App(): JSX.Element {
  const isSettings = window.location.hash.replace('#', '') === 'settings'

  useEffect(() => {
    if (isSettings) document.documentElement.classList.add('mode-settings')
  }, [isSettings])

  return isSettings ? <SettingsPanel /> : <PetStage />
}
