import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  animationsDir, decodePng, encodePng, expectedManifest, listClipFiles, manifestPath, readManifest, MIN_ALPHA,
} from '../scripts/build-assets.mjs'

test('animation manifest matches every frame on disk', () => {
  const manifest = readManifest()
  assert.ok(manifest, 'assets/animations/manifest.json is missing; run npm run build:assets')
  const expected = expectedManifest()
  assert.deepEqual(manifest, expected)
  const { clips, files } = listClipFiles()
  assert.deepEqual(manifest.clips, clips)
  assert.equal(files.length, Object.values(clips).reduce((sum, count) => sum + count, 0))
  for (const [state, count] of Object.entries(clips)) {
    for (let frame = 1; frame <= count; frame += 1) {
      assert.ok(files.includes(join(state, `${String(frame).padStart(3, '0')}.png`)), `${state} frame ${frame}`)
    }
  }
})

test('animation frames have fully transparent backgrounds for Windows layered rendering', () => {
  for (const state of Object.keys(readManifest().clips)) {
    const frame = state === 'error' ? 59 : 121
    const image = decodePng(readFileSync(join(animationsDir, state, `${String(frame).padStart(3, '0')}.png`)))
    let nearTransparent = 0
    for (let i = 3; i < image.pixels.length; i += 4) {
      const alpha = image.pixels[i]
      if (alpha > 0 && alpha < MIN_ALPHA) nearTransparent += 1
    }
    assert.equal(nearTransparent, 0, `${state}/${frame} still has alpha in [1, ${MIN_ALPHA - 1}]`)
    assert.equal(image.width, 206)
    assert.equal(image.height, 172)
  }
})

test('png decoder/encoder round-trips pixels without loss', () => {
  const source = readFileSync(join(animationsDir, 'idle', '001.png'))
  const image = decodePng(source)
  const encoded = encodePng(image)
  const decoded = decodePng(encoded)
  assert.equal(decoded.width, image.width)
  assert.equal(decoded.height, image.height)
  assert.ok(decoded.pixels.equals(image.pixels))
  assert.ok(readFileSync(manifestPath).length > 0)
})
