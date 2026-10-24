import { spawn } from 'node:child_process'
import { accessSync, closeSync, constants, openSync, readSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const helperPath = join(root, 'runtime/bin/darwin/dsh-alk-pet-helper')
const assetsPath = join(root, 'assets/animations')

const MACHO_MAGIC_64 = 0xfeedfacf
const CPU_TYPE_ARM64 = 0x0100000c
const CPU_TYPE_X64 = 0x01000007

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

/**
 * Starts the platform native pet window. The helper is restarted a couple of
 * times when it exits unexpectedly; onExit fires once when it is given up
 * (or was never startable).
 */
export function startNative({ onExit = () => {}, onAction = () => {}, onLog = () => {}, restarts = 2 } = {}) {
  let command
  let args
  if (process.platform === 'darwin') {
    if (!isExecutable(helperPath)) {
      onLog('helper missing or not executable; using in-page overlay')
      return null
    }
    const arch = machOArch(helperPath)
    if (arch && arch !== process.arch) {
      onLog(`helper is built for ${arch} but this host is ${process.arch}; using in-page overlay`)
      return null
    }
    command = helperPath
    args = [assetsPath]
  } else if (process.platform === 'win32') {
    command = 'powershell.exe'
    args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'native/windows/pet.ps1')]
  } else {
    return null
  }

  let child = null
  let stopped = false
  let attempt = 0
  let restartTimer = null

  const spawnOnce = () => {
    if (stopped) return
    let finished = false
    let output = ''
    const processHandle = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    const spawnedAt = Date.now()
    child = processHandle

    const fail = (error) => {
      if (finished) return
      finished = true
      if (child === processHandle) child = null
      if (stopped) return
      // A helper that stays alive for a while earns a fresh restart budget.
      if (Date.now() - spawnedAt > 30_000) attempt = 0
      attempt += 1
      if (attempt <= restarts) {
        const delay = 1200 * attempt
        onLog(`helper stopped (${error?.message ?? 'unknown'}); restarting in ${delay}ms`)
        restartTimer = setTimeout(spawnOnce, delay)
        restartTimer.unref?.()
      } else {
        onExit(error)
      }
    }

    processHandle.stdout.on('data', (chunk) => {
      output += String(chunk)
      if (output.length > 65536) output = ''
      let end
      while ((end = output.indexOf('\n')) >= 0) {
        const line = output.slice(0, end)
        output = output.slice(end + 1)
        try { onAction(JSON.parse(line)) } catch {}
      }
    })
    processHandle.stdin.on('error', () => {})
    processHandle.stderr.on('data', (data) => onLog(String(data).trim()))
    processHandle.on('error', fail)
    processHandle.on('exit', (code, signal) => fail(new Error(`helper exited (${code ?? signal})`)))
  }

  spawnOnce()

  return {
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
