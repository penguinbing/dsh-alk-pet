import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'

const MAX_LOG_BYTES = 256 * 1024

function logPathFor(platform, env) {
  const home = env.HOME || env.USERPROFILE || ''
  if (platform === 'win32') {
    const base = env.LOCALAPPDATA || join(home, 'AppData', 'Local')
    return join(base, 'dsh-alk-pet', 'host.log')
  }
  if (platform === 'darwin') {
    return join(home, 'Library', 'Logs', 'dsh-alk-pet', 'host.log')
  }
  return join(env.XDG_STATE_HOME || join(home, '.local', 'state'), 'dsh-alk-pet', 'host.log')
}

/**
 * Best-effort append-only log for native helper diagnostics.
 *
 * The DSH desktop shell discards a plugin host's console output, so a Windows
 * user whose native helper keeps falling back would otherwise have no clue why.
 * The log is created lazily on the first write; failures never throw.
 */
export function createHelperLog({ platform = process.platform, env = process.env, timestamp = () => new Date().toISOString() } = {}) {
  let path = null
  let prepared = false
  return function log(message) {
    const line = `[${timestamp()}] ${String(message ?? '').replace(/\s+$/u, '')}\n`
    try {
      if (!path) {
        path = logPathFor(platform, env)
        if (!path) return
      }
      if (!prepared) {
        mkdirSync(dirname(path), { recursive: true })
        prepared = true
      }
      try {
        if (statSync(path).size > MAX_LOG_BYTES) renameSync(path, `${path}.1`)
      } catch {}
      appendFileSync(path, line)
    } catch {
      // Diagnostics must never break the pet.
    }
  }
}

export { logPathFor }
