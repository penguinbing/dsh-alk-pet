import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { clampSize, normalizeConfig } from '../src/config.js'
import { loadManifest } from '../src/assets.js'
import { isLocalAddress } from '../src/index.js'

test('config values are normalized before reaching clients and helpers', () => {
  assert.deepEqual(normalizeConfig(), { enabled: true, size: 120, reducedMotion: false, showBubble: true })
  assert.deepEqual(normalizeConfig({ enabled: false, size: 150.6, reducedMotion: true, showBubble: false }), {
    enabled: false, size: 151, reducedMotion: true, showBubble: false,
  })
  assert.equal(clampSize(1), 72)
  assert.equal(clampSize(500), 200)
  assert.equal(clampSize(Number.NaN), 120)
  assert.deepEqual(normalizeConfig(null), { enabled: true, size: 120, reducedMotion: false, showBubble: true })
})

test('the animation manifest used by the host matches the generated one', () => {
  const manifest = loadManifest()
  assert.equal(manifest.frameMs, 83)
  assert.equal(manifest.clips.error, 59)
  assert.equal(manifest.clips.idle, 121)
  assert.match(manifest.assetVersion, /^[0-9a-f]{12}$|^dev$/)
})

test('only loopback addresses may talk to the pet endpoints', () => {
  for (const address of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) assert.equal(isLocalAddress(address), true, address)
  for (const address of ['192.168.1.4', '10.0.0.2', '::ffff:192.168.1.4', 'localhost', '']) assert.equal(isLocalAddress(address), false, address)
})
