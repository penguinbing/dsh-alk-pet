import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { windowsHelperArgs } from '../src/native.js'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const scriptPath = join(root, 'native/windows/pet.ps1')

function scriptText() {
  return readFileSync(scriptPath, 'utf8')
}

test('the Windows helper script ships with the package', () => {
  assert.equal(existsSync(scriptPath), true)
  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  assert.ok(packageJson.files.includes('native/'))
  assert.deepEqual(windowsHelperArgs(scriptPath).slice(-1), [scriptPath])
})

test('the Windows helper script stays ASCII-only so Windows PowerShell cannot mis-decode it', () => {
  const bytes = readFileSync(scriptPath)
  const offending = []
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index]
    if (byte > 0x7e && byte !== 0x0a && byte !== 0x0d && byte !== 0x09) {
      offending.push({ index, byte })
      if (offending.length >= 5) break
    }
  }
  assert.deepEqual(offending, [], 'pet.ps1 must not contain non-ASCII bytes; use C# \\uXXXX escapes instead')
})

test('the Windows helper never touches console code pages (there is no console under windowsHide)', () => {
  const text = scriptText()
  assert.doesNotMatch(text, /\[Console\]::(InputEncoding|OutputEncoding)\s*=/)
  assert.doesNotMatch(text, /Console\.ReadLine\(/)
  assert.doesNotMatch(text, /Console\.WriteLine\(/)
})

test('the Windows helper protocol uses explicit UTF-8 streams over the inherited pipes', () => {
  const text = scriptText()
  assert.match(text, /Console\.OpenStandardInput\(\)/)
  assert.match(text, /Console\.OpenStandardOutput\(\)/)
  assert.match(text, /new UTF8Encoding\(false\)/)
  assert.match(text, /new StreamReader\(/)
  assert.match(text, /new StreamWriter\(/)
})

test('the Windows helper forces its layered window visible and announces readiness', () => {
  const text = scriptText()
  assert.match(text, /private static extern bool ShowWindow\(/)
  assert.match(text, /private static extern bool SetWindowPos\(/)
  assert.match(text, /private static extern bool IsWindowVisible\(/)
  assert.match(text, /private void ForceVisible\(\)/)
  assert.match(text, /private void AnnounceReadyIfVisible\(\)/)
  assert.match(text, /payload\["type"\] = "ready"/)
  assert.match(text, /SW_SHOWNOACTIVATE/)
  assert.match(text, /HWND_TOPMOST/)
})

test('the Windows helper logs startup failures where users can find them', () => {
  const text = scriptText()
  assert.match(text, /helper\.log/)
  assert.match(text, /Write-HelperLog/)
  assert.match(text, /windows helper failed/)
  assert.match(text, /\$ErrorActionPreference = 'Stop'/)
})

test('the Windows helper C# keeps exactly one here-string wrapper', () => {
  const lines = scriptText().split('\n')
  const openings = lines.filter((line) => line.trim() === "$source = @'").length
  const closings = lines.filter((line, index) => line.trim() === "'@" && index > 0).length
  assert.equal(openings, 1)
  assert.equal(closings, 1)
})

test('the helper references every assembly it compiles against by path', () => {
  const text = scriptText()
  for (const assembly of [
    'System.Windows.Forms.Form',
    'System.Drawing.Bitmap',
    'System.Web.Script.Serialization.JavaScriptSerializer',
    'System.ComponentModel.Component',
  ]) {
    assert.ok(text.includes(assembly), `expected an explicit assembly reference for ${assembly}`)
  }
  assert.match(text, /Add-Type -TypeDefinition/)
})
