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
    // first run / missing file → keep defaults (en)
  }
}

export function saveConfig(): void {
  try {
    writeFileSync(configPath(), JSON.stringify(config))
  } catch {
    // non-fatal: settings just won't persist this session
  }
}
