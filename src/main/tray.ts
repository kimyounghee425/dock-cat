import { Menu, nativeImage, Tray, app } from 'electron'
import type { Lang } from '../shared/config'
import { getConfig } from './config-store'
import { getSettingsWindow, openSettings } from './windows'

export const MAIN_STR: Record<Lang, { settings: string; quit: string; title: string }> = {
  ko: { settings: '설정…', quit: '종료', title: 'DockCat 설정' },
  en: { settings: 'Settings…', quit: 'Quit', title: 'DockCat Settings' }
}

// 픽셀-고양이 트레이 아이콘(스프라이트 프레임; 컬러, non-template).
const TRAY_ICON =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACwAAAAsCAYAAAAehFoBAAACgUlEQVR4nO1YsWoCQRA9RbCzOOyTwiYHEiUfkB+wtfAX8gGSFCJikeAH5BdS2MbSws4mJCGwaVIkVSCIhV0gYJjj5hjW3bvZvcXcBR8srre7b9/Ozs7OnecdkAP4tfrWBYfvgIc10Xy23KZNmNY2ny1jnix6ypxOQghvencfFnlCXMhoMFGK9mv1LYwDDihZwRKcJ1Q4nao/7x4aB6zV7XViS4JlAUEQ7LQB0LrAsTfBKvfQQW4TDtzAyiXAQrZWqjqybiF9uMTpBCf95uoirH9XjkN/5UJE/nt5fRv+X29WrDl1SB2MIctEpAoi8uXhuJ9J9J+6hG9x+ymjhEwiW7fb63iL5wfvS3wqSaEdsCB9KAfy21h6RzCQUSJZPIo5Pz1ThjFsT+qzLqpLOBGMq9f5F7UW3nIU8rOp4pLJkrkpt4a6BTdKgCsk3YDCUZRgx2GaM8hCAVEeoRQthAiFAnTng7sI9kqR3DQmi0isLAj4Hp9e4v/tVpMlvHCHrmQ6wOTmExrrqizMtbSxS6gmSUO71dSKljnTBOfCJd5eP+I6iIeiC3tWUaJxcmQkRmiiBOWH6EJ5dbuSCwuboJxlC+lWym20HjDDoIov8zudTI6/sJ1JC+EibayxhWk2xpmoq+mvQ9r3i7JJ3FVtLQhCUUniRoNJWPby5SdPqLgisvn+4JP8BJEU/jILVomEZ5yo4CsyQM6ijQXDJGm5L6Kr6SfnIya5sjOXMME0WgQVys2J/9+hW29WpeG4H/ubDQTJJYDHxrJswVQ0TmgrFkDrNu92Vgm8Kn9FyPlyW5N12SJzLoEAUbAY+rxhkIZyUbhDV7IZlPR6LucKa4fucIC3B/wCTxqj23SDXUkAAAAASUVORK5CYII='

let tray: Tray | null = null

export function refreshTrayMenu(): void {
  if (!tray) return
  const s = MAIN_STR[getConfig().lang]
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: s.settings, click: openSettings },
      { type: 'separator' },
      { label: s.quit, click: () => app.quit() }
    ])
  )
}

export function createTray(): void {
  const icon = nativeImage.createFromDataURL(TRAY_ICON)
  icon.setTemplateImage(false) // 고양이 색상 유지
  tray = new Tray(icon.resize({ width: 20, height: 20 }))
  tray.setToolTip('DockCat')
  refreshTrayMenu()
}

// 현재 언어를 트레이 메뉴 + 설정 창 제목에 적용.
export function applyLang(): void {
  refreshTrayMenu()
  getSettingsWindow()?.setTitle(MAIN_STR[getConfig().lang].title)
}
