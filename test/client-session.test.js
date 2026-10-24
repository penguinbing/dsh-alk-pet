import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

function loadClient() {
  let plugin
  let registered
  const React = {
    useState(value) { return [typeof value === 'function' ? value() : value, () => {}] },
    useRef(value) { return { current: value } },
    useMemo(factory) { return factory() },
    useEffect() {},
    createElement(type, props, ...children) { return { type, props, children } },
  }
  const code = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  runInNewContext(code, {
    window: { __ModuleLoader__: { load(entry) { plugin = entry.factory(() => React) } }, innerWidth: 1200, innerHeight: 800, addEventListener() {}, removeEventListener() {} },
    localStorage: { getItem() { return null }, setItem() {} },
    document: { createElement() { return { getContext() { return { measureText(text) { return { width: String(text ?? '').length * 7 } } } } } }, addEventListener() {}, removeEventListener() {}, visibilityState: 'visible', hasFocus() { return true } },
    Image: class { set src(_value) {} },
    EventSource: class { close() {} },
    fetch: () => Promise.resolve({ ok: false }),
    encodeURIComponent,
    Date,
    Math,
    JSON,
    Set,
    Map,
  })
  plugin.apply({ slots: { inject(_name, callback) { callback() }, register(options, component) { registered = { options, component } } } })
  return { plugin, registered }
}

test('overlay registers the pet on the shell overlay slot', () => {
  const { registered, plugin } = loadClient()
  assert.equal(registered.options.name, 'shell.overlay')
  assert.equal(registered.options.id, 'dsh-alk-pet-overlay')
  assert.equal(typeof registered.component, 'function')
  assert.equal(plugin.name, 'dsh-alk-pet-client')
  assert.equal(JSON.stringify(plugin.inject), JSON.stringify(['slots']))
})

test('task dots keep the shared circle metrics with distinct status colors', () => {
  const { plugin } = loadClient()
  const { CHIP, GLYPH_BOX, taskPalette } = plugin.__test
  assert.equal(CHIP, 20)
  assert.equal(GLYPH_BOX, 16)
  assert.equal(Object.keys(taskPalette).length, 5)
  assert.equal(new Set(Object.values(taskPalette).map((entry) => entry.fill)).size, 5)
  assert.notEqual(taskPalette.running.fill, taskPalette.success.fill)
  assert.ok(taskPalette.idle.fill.startsWith('#'))
})

test('snapshot config is validated and clamped in the client', () => {
  const { plugin } = loadClient()
  const { resolveConfig } = plugin.__test
  assert.equal(resolveConfig(null), null)
  const config = resolveConfig({ size: 9999, enabled: false, native: true, reducedMotion: true, showBubble: false, frameMs: 50, assetVersion: 'abc', clips: { idle: 2 } })
  assert.equal(config.size, 200)
  assert.equal(config.enabled, false)
  assert.equal(config.native, true)
  assert.equal(config.reducedMotion, true)
  assert.equal(config.showBubble, false)
  assert.equal(config.frameMs, 50)
  assert.equal(config.assetVersion, 'abc')
  assert.equal(config.clips.idle, 2)
  assert.equal(config.clips.error, 59)
  assert.equal(resolveConfig({}).frameMs, 83)
  assert.equal(resolveConfig({ size: 'huge' }).size, 120)
})

test('selected session walks subagent sessions up to the main session', () => {
  const { plugin } = loadClient()
  const { selectedSession } = plugin.__test
  const snapshot = {
    current: 'child',
    byId: {
      child: { origin: 'subagent', parentId: 'root' },
      root: { title: '主任务' },
    },
  }
  assert.equal(selectedSession(snapshot), 'root')
  assert.equal(selectedSession({ byId: { one: {} }, current: 'one' }), 'one')
  assert.equal(selectedSession(null), null)
})

test('positions, frame URLs and bubble widths are safe to render', () => {
  const { plugin } = loadClient()
  const { clampPosition, imageUrl, widestBubble } = plugin.__test
  assert.deepEqual(JSON.parse(JSON.stringify(clampPosition({ right: -50, bottom: 99999 }, 120))), { right: 0, bottom: 800 - 120 - 110 })
  assert.equal(imageUrl('idle', 3, 'v1'), '/plugins/dsh-alk-pet/image?state=idle&frame=3&v=v1')
  assert.equal(typeof widestBubble([{ title: '标题', detail: '动作', state: 'working' }]), 'number')
})

test('hovering a task dot sizes the bubble from that task only', () => {
  const { plugin } = loadClient()
  const { bubbleWidth } = plugin.__test
  const tasks = [
    { sessionId: 'short', title: '短', detail: '短动作', state: 'working' },
    { sessionId: 'long', title: '很长'.repeat(20), detail: '同样很长'.repeat(10), state: 'working' },
  ]
  const widest = bubbleWidth(tasks, 'short', false)
  assert.equal(widest, 300)
  assert.ok(bubbleWidth(tasks, 'short', true) < widest)
  assert.equal(bubbleWidth(tasks, 'long', true), 300)
  assert.equal(bubbleWidth(tasks, 'missing', true), widest)
})
