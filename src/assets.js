import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const manifestPath = join(root, 'assets/animations/manifest.json')

export const FALLBACK_MANIFEST = Object.freeze({
  version: '0.0.0',
  frameMs: 83,
  assetVersion: 'dev',
  clips: Object.freeze({ idle: 121, thinking: 121, working: 121, waiting: 121, success: 121, error: 59 }),
})

function validClips(clips) {
  if (!clips || typeof clips !== 'object') return false
  return Object.values(clips).every((count) => Number.isInteger(count) && count > 0) && Object.keys(clips).length > 0
}

export function loadManifest(path = manifestPath) {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'))
    if (!validClips(value?.clips)) return { ...FALLBACK_MANIFEST }
    return {
      version: String(value.version ?? FALLBACK_MANIFEST.version),
      frameMs: Number.isInteger(value.frameMs) && value.frameMs >= 16 ? value.frameMs : FALLBACK_MANIFEST.frameMs,
      assetVersion: String(value.assetVersion ?? FALLBACK_MANIFEST.assetVersion),
      clips: { ...value.clips },
    }
  } catch {
    return { ...FALLBACK_MANIFEST }
  }
}
