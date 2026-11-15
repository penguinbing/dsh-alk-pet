import { spawn } from 'node:child_process'
import { accessSync, closeSync, constants, existsSync, openSync, readSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const helperPath = join(root, 'runtime/bin/darwin/dsh-alk-pet-helper')
const windowsScriptPath = join(root, 'native/windows/pet.ps1')
const assetsPath = join(root, 'assets/animations')

const MACHO_MAGIC_64 = 0xfeedfacf
const CPU_TYPE_ARM64 = 0x0100000c
const CPU_TYPE_X64 = 0x01000007

const DEFAULT_READY_TIMEOUT_MS = 25_000
const RESTART_DELAY_MS = 1200
const STDERR_LIMIT = 4096
const OUTPUT_LINE_LIMIT = 65536

function isExecutable(path) {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function machOArch(path) {
  try {
    const header = Buffer.alloc(8)
    const fd = openSync(path, 'r')
    try { readSync(fd, header, 0, header.length, 0) } finally { closeSync(fd) }
    if (header.readUInt32LE(0) !== MACHO_MAGIC_64) return null
    const cpuType = header.readUInt32LE(4)
    if (cpuType === CPU_TYPE_ARM64) return 'arm64'
    if (cpuType === CPU_TYPE_X64) return 'x64'
    return null
  } catch {
    return null
  }
}

function truncate(value, limit = 400) {
  const text = String(value ?? '').replace(/\s+$/u, '')
  return text.length > limit ? `${text.slice(0, limit)}...` : text
}

/**
 * Resolves the Windows PowerShell executable without relying only on PATH.
 *
 * The DSH desktop host is started by the Electron shell with a curated
 * environment, so `powershell.exe` is not guaranteed to be resolvable by name.
 * The absolute Windows PowerShell location is tried first; a bare name is kept
 * as the last resort so the spawn error still surfaces through `onLog`.
 */
export function resolveWindowsPowerShell({ env = process.env, fileExists = existsSync } = {}) {
  const explicit = env.DSH_ALK_PET_POWERSHELL
  if (typeof explicit === 'string' && explicit.trim()) {
    return fileExists(explicit.trim()) ? explicit.trim() : 'powershell.exe'
  }
  const systemRoot = env.SystemRoot || env.windir || 'C:\\Windows'
  const candidates = [
    join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    join(systemRoot, 'SysWOW64', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
  ]
  for (const candidate of candidates) {
    if (fileExists(candidate)) return candidate
  }
  return 'powershell.exe'
}

/** Arguments used to launch the Windows WinForms helper script. */
export function windowsHelperArgs(scriptPath = windowsScriptPath) {
  return ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath]
}

/**
 * Starts the platform native pet window.
 *
 * The helper is restarted a couple of times when it exits unexpectedly. On
 * Windows the helper must also announce itself with a `{"type":"ready"}` line
 * once its layered window is actually visible; a helper that stays alive but
 * never becomes visible is killed by the startup watchdog so the in-page
 * fallback can take over (the window is launched with `windowsHide`, and a
 * silent child process would otherwise leave the user with no pet at all).
 *
 * `onExit` fires once when the helper is given up (or was never startable),
 * `onReady` fires when the native window is usable, and `onDisconnect` fires
 * on every unexpected helper exit before a restart is attempted.
 */
export function startNative({
  onExit = () => {},
  onAction = () => {},
  onLog = () => {},
  onReady = () => {},
  onDisconnect = () => {},
  restarts = 2,
  readyTimeoutMs = DEFAULT_READY_TIMEOUT_MS,
  restartDelayMs = RESTART_DELAY_MS,
  platform = process.platform,
  spawnProcess = spawn,
  fileExists = existsSync,
  darwinHelperPath = helperPath,
  darwinAssetsPath = assetsPath,
} = {}) {
  let command
  let args
  if (platform === 'darwin') {
    if (!isExecutable(darwinHelperPath)) {
      onLog('helper missing or not executable; using in-page overlay')
      return null
    }
    const arch = machOArch(darwinHelperPath)
    if (arch && arch !== process.arch) {
      onLog(`helper is built for ${arch} but this host is ${process.arch}; using in-page overlay`)
      return null
    }
    command = darwinHelperPath
    args = [darwinAssetsPath]
  } else if (platform === 'win32') {
    if (!fileExists(windowsScriptPath)) {
      onLog(`windows helper script missing: ${windowsScriptPath}; using in-page overlay`)
      return null
    }
    command = resolveWindowsPowerShell({ fileExists })
    args = windowsHelperArgs(windowsScriptPath)
  } else {
    return null
  }

  let child = null
  let stopped = false
  let attempt = 0
  let restartTimer = null
  let ready = false
  let lastStderr = ''

  const spawnOnce = () => {
    if (stopped) return
    let finished = false
    let readyTimer = null
    let output = ''
    let stderrTail = ''
    const processHandle = spawnProcess(command, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    const spawnedAt = Date.now()
    child = processHandle
    ready = false

    const clearReadyTimer = () => {
      if (readyTimer !== null) {
        clearTimeout(readyTimer)
        readyTimer = null
      }
    }

    const fail = (error) => {
      if (finished) return
      finished = true
      clearReadyTimer()
      if (child === processHandle) child = null
      if (stopped) return
      ready = false
      onDisconnect(error)
      // A helper that stays alive for a while earns a fresh restart budget.
      if (Date.now() - spawnedAt > 30_000) attempt = 0
      attempt += 1
      const detail = stderrTail.trim() || lastStderr
      if (stderrTail.trim()) lastStderr = stderrTail.trim()
      const message = detail ? `${error?.message ?? 'unknown'}: ${truncate(detail, 800)}` : error?.message ?? 'unknown'
      if (attempt <= restarts) {
        const delay = restartDelayMs * attempt
        onLog(`helper stopped (${message}); restarting in ${delay}ms`)
        restartTimer = setTimeout(spawnOnce, delay)
        restartTimer.unref?.()
      } else {
        const finalError = new Error(message)
        onLog(`native helper unavailable: ${message}`)
        onExit(finalError)
      }
    }

    const announceReady = () => {
      if (ready) return
      ready = true
      clearReadyTimer()
      onLog(`native helper ready after ${Date.now() - spawnedAt}ms`)
      onReady()
    }

    processHandle.stdout.on('data', (chunk) => {
      output += String(chunk)
      if (output.length > OUTPUT_LINE_LIMIT) output = output.slice(-OUTPUT_LINE_LIMIT)
      let end
      while ((end = output.indexOf('\n')) >= 0) {
        const line = output.slice(0, end).trim()
        output = output.slice(end + 1)
        if (!line) continue
        let action
        try {
          action = JSON.parse(line)
        } catch {
          onLog(`unexpected windows helper output: ${truncate(line, 200)}`)
          continue
        }
        if (action?.type === 'ready') {
          announceReady()
          continue
        }
        try { onAction(action) } catch {}
      }
    })
    processHandle.stdin.on('error', () => {})
    processHandle.stderr.on('data', (data) => {
      const text = String(data)
      stderrTail = (stderrTail + text).slice(-STDERR_LIMIT)
      const trimmed = text.trim()
      if (trimmed) onLog(trimmed)
    })
    processHandle.on('error', fail)
    processHandle.on('exit', (code, signal) => fail(new Error(`helper exited (${code ?? signal})`)))

    // Windows only: a hidden helper that never announces itself would otherwise
    // suppress the in-page fallback forever.
    if (platform === 'win32' && readyTimeoutMs > 0) {
      readyTimer = setTimeout(() => {
        if (finished || stopped || ready) return
        const detail = stderrTail.trim()
        const error = new Error(`helper did not become visible within ${readyTimeoutMs}ms${detail ? `: ${truncate(detail, 800)}` : ''}`)
        onLog(error.message)
        fail(error)
        try { processHandle.kill() } catch {}
      }, readyTimeoutMs)
      readyTimer.unref?.()
    }
  }

  spawnOnce()

  return {
    // Windows helpers must announce readiness before the in-page overlay hides.
    requiresReady: platform === 'win32',
    isReady: () => ready,
    send(message) {
      if (!child || child.exitCode !== null || child.stdin.destroyed) return
      try { child.stdin.write(`${JSON.stringify(message)}\n`) } catch {}
    },
    stop() {
      stopped = true
      clearTimeout(restartTimer)
      if (!child) return
      try { child.stdin.end() } catch {}
      const timer = setTimeout(() => { if (child && child.exitCode === null) child.kill() }, 1000)
      timer.unref?.()
    },
  }
}
