export const DEFAULT_CONFIG = Object.freeze({
  enabled: true,
  size: 120,
  reducedMotion: false,
  showBubble: true,
})

export const MIN_SIZE = 72
export const MAX_SIZE = 200

export function clampSize(value) {
  const size = Number(value)
  if (!Number.isFinite(size)) return DEFAULT_CONFIG.size
  return Math.max(MIN_SIZE, Math.min(MAX_SIZE, Math.round(size)))
}

export function normalizeConfig(raw = {}) {
  const value = raw && typeof raw === 'object' ? raw : {}
  return {
    enabled: value.enabled !== false,
    size: clampSize(value.size),
    reducedMotion: value.reducedMotion === true,
    showBubble: value.showBubble !== false,
  }
}
