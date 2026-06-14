/// <reference types="vite/client" />
import type { PetApi } from '../../preload'

declare global {
  interface Window {
    petApi: PetApi
  }
}
