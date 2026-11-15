import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { EventEmitter } from 'node:events'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveWindowsPowerShell, startNative, windowsHelperArgs } from '../src/native.js'

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))

class FakeChild extends EventEmitter {
  constructor(command, args, options) {
    super()
    this.command = command
    this.args = args
    this.options = options
    this.stdout = new EventEmitter()
    this.stderr = new EventEmitter()
    this.writes = []
    this.stdin = {
      destroyed: false,
      written: this.writes,
      on() {},
      write(chunk) { this.written.push(String(chunk)) },
      end() { this.destroyed = true },
    }
    this.exitCode = null
    this.killed = false
  }

  kill() {
    this.killed = true
    this.exitCode = 1
    this.emit('exit', 1, null)
  }

  exit(code = 0) {
    this.exitCode = code
    this.emit('exit', code, null)
  }
}

function fakeSpawner() {
  const children = []
  const spawnProcess = (command, args, options) => {
    const child = new FakeChild(command, args, options)
    children.push(child)
    return child
  }
  return { children, spawnProcess }
}

const WINDOWS_SCRIPT = join(repoRoot, 'native/windows/pet.ps1')

function waitFor(predicate, timeoutMs = 1000) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now()
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer)
        resolve()
      } else if (Date.now() - startedAt > timeoutMs) {
        clearInterval(timer)
        reject(new Error('timed out waiting for condition'))
      }
    }, 5)
  })
}

test('windows PowerShell resolution prefers an absolute Windows PowerShell path', () => {
  const systemRoot = 'C:\\Windows'
  const expected = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const seen = []
  const fileExists = (path) => {
    seen.push(path)
    return path === expected
  }
  const env = { SystemRoot: systemRoot, PATH: 'C:\\Windows\\System32' }
  assert.equal(resolveWindowsPowerShell({ env, fileExists }), expected)
  assert.deepEqual(seen[0], expected)
  assert.equal(resolveWindowsPowerShell({ env: { SystemRoot: systemRoot }, fileExists: () => false }), 'powershell.exe')
  assert.equal(
    resolveWindowsPowerShell({ env: { DSH_ALK_PET_POWERSHELL: 'C:\\Tools\\pwsh.exe' }, fileExists: () => true }),
    'C:\\Tools\\pwsh.exe',
  )
  assert.equal(
    resolveWindowsPowerShell({ env: { DSH_ALK_PET_POWERSHELL: 'C:\\Missing\\pwsh.exe' }, fileExists: () => false }),
    'powershell.exe',
  )
})

test('windows helper arguments are predictable and non-interactive', () => {
  const args = windowsHelperArgs('C:\\Plugins\\dsh-alk-pet\\native\\windows\\pet.ps1')
  assert.deepEqual(args, [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    'C:\\Plugins\\dsh-alk-pet\\native\\windows\\pet.ps1',
  ])
})

test('a missing Windows helper script falls back without spawning', () => {
  const { children, spawnProcess } = fakeSpawner()
  const logs = []
  const handle = startNative({
    platform: 'win32',
    spawnProcess,
    fileExists: () => false,
    onLog: (message) => logs.push(message),
  })
  assert.equal(handle, null)
  assert.equal(children.length, 0)
  assert.match(logs.join('\n'), /windows helper script missing/)
})

test('windows launcher spawns PowerShell hidden and waits for the ready handshake', async () => {
  const { children, spawnProcess } = fakeSpawner()
  const events = []
  const handle = startNative({
    platform: 'win32',
    spawnProcess,
    fileExists: () => true,
    onReady: () => events.push('ready'),
    onLog: (message) => events.push(`log:${message}`),
  })
  assert.ok(handle)
  assert.equal(handle.requiresReady, true)
  assert.equal(handle.isReady(), false)
  assert.equal(events.filter((event) => event === 'ready').length, 0)
  assert.equal(children.length, 1)
  const child = children[0]
  assert.deepEqual(child.args, windowsHelperArgs(WINDOWS_SCRIPT))
  assert.equal(child.options.windowsHide, true)
  assert.deepEqual(child.options.stdio, ['pipe', 'pipe', 'pipe'])
  handle.send({ state: 'idle' })
  assert.deepEqual(JSON.parse(child.writes[0]), { state: 'idle' })

  child.stdout.emit('data', Buffer.from('{"type":"ready","pid":42}\n'))
  assert.equal(handle.isReady(), true)
  assert.equal(events.filter((event) => event === 'ready').length, 1)
  child.stdout.emit('data', Buffer.from('{"type":"select","sessionId":"s1"}\n'))
  assert.equal(handle.isReady(), true)
  handle.stop()
})

test('helper actions are forwarded and unexpected output is logged', () => {
  const { children, spawnProcess } = fakeSpawner()
  const actions = []
  const logs = []
  const handle = startNative({
    platform: 'win32',
    spawnProcess,
    fileExists: () => true,
    onAction: (action) => actions.push(action),
    onLog: (message) => logs.push(message),
  })
  children[0].stdout.emit('data', Buffer.from('not json\n{"type":"hover","hovered":true}\n'))
  assert.deepEqual(actions, [{ type: 'hover', hovered: true }])
  assert.match(logs.join('\n'), /unexpected windows helper output: not json/)
  handle.stop()
})

test('a Windows helper that keeps dying is restarted and finally abandoned', async () => {
  const { children, spawnProcess } = fakeSpawner()
  const exits = []
  startNative({
    platform: 'win32',
    spawnProcess,
    fileExists: () => true,
    restartDelayMs: 1,
    restarts: 1,
    onExit: (error) => exits.push(error.message),
    onLog: () => {},
  })
  children[0].stderr.emit('data', Buffer.from('Add-Type failed: boom\n'))
  children[0].exit(1)
  await waitFor(() => children.length === 2)
  children[1].exit(1)
  await waitFor(() => exits.length === 1)
  assert.match(exits[0], /helper exited \(1\)/)
  assert.match(exits[0], /Add-Type failed: boom/)
})

test('a Windows helper that never becomes visible is killed by the watchdog', async () => {
  const { children, spawnProcess } = fakeSpawner()
  const exits = []
  startNative({
    platform: 'win32',
    spawnProcess,
    fileExists: () => true,
    readyTimeoutMs: 20,
    restarts: 0,
    onExit: (error) => exits.push(error.message),
    onLog: () => {},
  })
  await waitFor(() => exits.length === 1)
  assert.equal(children[0].killed, true)
  assert.match(exits[0], /did not become visible within 20ms/)
})

test('the ready state resets when the helper exits before its replacement is ready', async () => {
  const { children, spawnProcess } = fakeSpawner()
  const transitions = []
  startNative({
    platform: 'win32',
    spawnProcess,
    fileExists: () => true,
    restartDelayMs: 1,
    restarts: 2,
    onReady: () => transitions.push('ready'),
    onDisconnect: () => transitions.push('disconnect'),
    onLog: () => {},
  })
  children[0].stdout.emit('data', Buffer.from('{"type":"ready"}\n'))
  assert.deepEqual(transitions, ['ready'])
  children[0].exit(0)
  await waitFor(() => children.length === 2)
  assert.deepEqual(transitions, ['ready', 'disconnect'])
})

test('non-Windows platforms without a native helper use the in-page overlay', () => {
  const logs = []
  assert.equal(startNative({ platform: 'linux', onLog: (message) => logs.push(message) }), null)
  const missing = startNative({
    platform: 'darwin',
    fileExists: () => false,
    darwinHelperPath: join(tmpdir(), 'does-not-exist-alk-pet-helper'),
    onLog: (message) => logs.push(message),
  })
  assert.equal(missing, null)
  assert.match(logs.join('\n'), /helper missing or not executable/)
})

test('the darwin launcher passes the animation assets to an executable helper', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-alk-pet-'))
  const helper = join(directory, 'helper')
  try {
    writeFileSync(helper, '#!/bin/sh\nexit 0\n')
    chmodSync(helper, 0o755)
    const { children, spawnProcess } = fakeSpawner()
    const handle = startNative({
      platform: 'darwin',
      spawnProcess,
      darwinHelperPath: helper,
      darwinAssetsPath: '/tmp/assets',
      fileExists: () => true,
      onLog: () => {},
    })
    assert.ok(handle)
    assert.equal(handle.requiresReady, false)
    assert.deepEqual(children[0].args, ['/tmp/assets'])
    handle.stop()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
