import type { DataForgeApi } from './index'

declare global {
  interface Window {
    dataforge: DataForgeApi
  }
}

export {}
