import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync } from 'fs'
import { DEFAULT_CONFIG, normalizeConfig, type PetConfig } from '../shared/config'

const configPath = (): string => join(app.getPath('userData'), 'config.json')

let config: PetConfig = { ...DEFAULT_CONFIG }

export function getConfig(): PetConfig {
  return config
}

export function setConfig(next: PetConfig): void {
  config = next
}

export function loadConfig(): void {
  try {
    const parsed = JSON.parse(readFileSync(configPath(), 'utf-8'))
    config = normalizeConfig(parsed)
  } catch {
    // 첫 실행 / 파일 없음 → 기본값(en) 유지
  }
}

export function saveConfig(): void {
  try {
    writeFileSync(configPath(), JSON.stringify(config))
  } catch {
    // non-fatal: 이번 세션에만 설정이 영속되지 않을 뿐
  }
}
