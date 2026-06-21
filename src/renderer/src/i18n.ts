import type { CatColor, Lang } from './simulation/types'

interface Strings {
  catsCount: (n: number) => string
  color: Record<CatColor, string>
  sleepAfter: string
  minutes: (n: number) => string
  never: string
  batch: string
  sleepAll: string
  wakeAll: string
  dontWake: string
  tipSleepAll: string
  tipWakeAll: string
  tipDontWake: string
  hint: (max: number) => string
  language: string
  giveAway: string
  startup: string
  launchAtLogin: string
  food: string
  foodBowl: string
}

export const STRINGS: Record<Lang, Strings> = {
  ko: {
    catsCount: (n) => `고양이 (${n}마리)`,
    color: { ginger: '진저', grey: '회색', white: '흰색' },
    sleepAfter: '잠들기까지',
    minutes: (n) => `${n}분`,
    never: '안 잠',
    batch: '한꺼번에',
    sleepAll: '모두 재우기',
    wakeAll: '모두 깨우기',
    dontWake: '깨우지 말기',
    tipSleepAll: '모든 고양이를 동시에 재워요',
    tipWakeAll: '자고 있는 고양이를 모두 깨워요',
    tipDontWake: '고양이를 클릭하거나 드래그해도 잠에서 깨지 않아요',
    hint: (max) => `색상별 최대 ${max}마리 · 드래그해서 가운데 휴지통에 놓으면 삭제`,
    language: '언어',
    giveAway: '분양하기',
    startup: '자동 실행',
    launchAtLogin: '로그인 시 DockCat 자동 실행',
    food: '먹이',
    foodBowl: '밥그릇'
  },
  en: {
    catsCount: (n) => `Cats (${n})`,
    color: { ginger: 'Ginger', grey: 'Grey', white: 'White' },
    sleepAfter: 'Sleep after',
    minutes: (n) => `${n} min`,
    never: 'Never',
    batch: 'All at once',
    sleepAll: 'Sleep all',
    wakeAll: 'Wake all',
    dontWake: "Don't wake",
    tipSleepAll: 'Put all cats to sleep at once',
    tipWakeAll: 'Wake up every sleeping cat',
    tipDontWake: "Clicking or dragging a cat won't wake it",
    hint: (max) => `Up to ${max} per color · drag onto the center trash to remove`,
    language: 'Language',
    giveAway: 'Give away',
    startup: 'Startup',
    launchAtLogin: 'Launch DockCat at login',
    food: 'Food',
    foodBowl: 'Food bowl'
  }
}

export const LANGS: { id: Lang; label: string }[] = [
  { id: 'ko', label: '한국어' },
  { id: 'en', label: 'English' }
]
