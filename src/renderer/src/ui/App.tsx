import { useEffect } from 'react'
import { PetStage } from './PetStage'
import { SettingsPanel } from './SettingsPanel'

// 단일 renderer 빌드, 두 창: 투명 overlay(펫)와 설정 창. main 프로세스가 설정한 URL hash로 구분.
export function App(): JSX.Element {
  const isSettings = window.location.hash.replace('#', '') === 'settings'

  useEffect(() => {
    if (isSettings) document.documentElement.classList.add('mode-settings')
  }, [isSettings])

  return isSettings ? <SettingsPanel /> : <PetStage />
}
