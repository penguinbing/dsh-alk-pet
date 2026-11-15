import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHelperLog, logPathFor } from '../src/helper-log.js'

test('helper logs resolve to a per-platform user log file', () => {
  assert.equal(
    logPathFor('win32', { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local', USERPROFILE: 'C:\\Users\\me' }),
    join('C:\\Users\\me\\AppData\\Local', 'dsh-alk-pet', 'host.log'),
  )
  assert.equal(
    logPathFor('darwin', { HOME: '/Users/me' }),
    join('/Users/me', 'Library', 'Logs', 'dsh-alk-pet', 'host.log'),
  )
  assert.equal(
    logPathFor('linux', { HOME: '/home/me', XDG_STATE_HOME: '/home/me/.state' }),
    join('/home/me/.state', 'dsh-alk-pet', 'host.log'),
  )
})

test('helper logs are created lazily and append diagnostics', () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-alk-pet-log-'))
  try {
    const log = createHelperLog({ platform: 'darwin', env: { HOME: home }, timestamp: () => 'T' })
    const path = join(home, 'Library', 'Logs', 'dsh-alk-pet', 'host.log')
    assert.equal(existsSync(path), false)
    log('windows helper ready after 1234ms')
    log('native helper unavailable: helper exited (1)')
    const content = readFileSync(path, 'utf8')
    assert.equal(content, '[T] windows helper ready after 1234ms\n[T] native helper unavailable: helper exited (1)\n')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('helper log failures never break the pet', () => {
  const log = createHelperLog({ platform: 'darwin', env: { HOME: '/this/path/does/not/exist/alk-pet' } })
  assert.doesNotThrow(() => log('ignored'))
})

test('oversized helper logs are rotated instead of growing without bound', () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-alk-pet-log-'))
  try {
    const path = join(home, 'Library', 'Logs', 'dsh-alk-pet', 'host.log')
    mkdirSync(join(home, 'Library', 'Logs', 'dsh-alk-pet'), { recursive: true })
    writeFileSync(path, 'x'.repeat(300 * 1024))
    const log = createHelperLog({ platform: 'darwin', env: { HOME: home }, timestamp: () => 'T' })
    log('after rotation')
    assert.equal(existsSync(`${path}.1`), true)
    assert.equal(readFileSync(path, 'utf8'), '[T] after rotation\n')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
