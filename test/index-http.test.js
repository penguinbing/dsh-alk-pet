import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { EventEmitter } from 'node:events'
import { apply } from '../src/index.js'

function createHarness() {
  const endpoints = new Map()
  const disposers = []
  const sent = []
  let eventHandler = null
  let cleanup = null
  let nativeStopped = false
  const sessions = new Map()
  const ctx = {
    sessions: { get: (id) => sessions.get(id) },
    on(type, handler) { eventHandler = handler; return () => { eventHandler = null } },
    inject(_deps, callback) {
      callback({
        effect(effect) { disposers.push(effect()) },
        webServer: { register(route) { endpoints.set(route.path, route.handler); return () => endpoints.delete(route.path) } },
      })
    },
    effect(factory) { cleanup = factory() },
  }
  const native = { send: (message) => sent.push(message), stop() { nativeStopped = true } }
  const startNative = () => native
  apply(ctx, {}, { startNative })
  const session = (id, extra = {}, title = '') => ({ header: { id, ...extra }, title })
  const call = async (path, { method = 'GET', url, body, address = '127.0.0.1' } = {}) => {
    const handler = endpoints.get(path)
    assert.ok(handler, `missing endpoint ${path}`)
    const req = new EventEmitter()
    req.method = method
    req.url = url ?? path
    req.socket = { remoteAddress: address }
    const result = { status: 200, headers: {}, body: Buffer.alloc(0) }
    const res = {
      on() {},
      writeHead(status, headers = {}) { result.status = status; Object.assign(result.headers, headers) },
      write(chunk) { result.body = Buffer.concat([result.body, Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))]) },
      end(chunk) { if (chunk) result.body = Buffer.concat([result.body, Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))]) },
    }
    const done = new Promise((resolve) => { res.end = ((original) => (chunk) => { original(chunk); resolve() })(res.end) })
    handler(req, res)
    if (path.endsWith('/events')) return result
    if (method === 'POST') {
      await Promise.resolve()
      if (body !== undefined) req.emit('data', Buffer.from(JSON.stringify(body)))
      req.emit('end')
    }
    await done
    return result
  }
  return {
    ctx, sent, endpoints, sessions, session, call, event: (sessionValue, eventValue) => eventHandler?.(sessionValue, eventValue),
    dispose() { disposers.forEach((dispose) => { try { dispose() } catch {} }); cleanup?.() },
    get nativeStopped() { return nativeStopped },
  }
}

test('host endpoints expose config, SSE snapshots, images and task actions', async () => {
  const harness = createHarness()
  const session = harness.session('session-1', {}, '测试任务')
  harness.sessions.set('session-1', session)

  const config = await harness.call('/plugins/dsh-alk-pet/config')
  assert.equal(config.status, 200)
  const configBody = JSON.parse(String(config.body))
  assert.equal(configBody.size, 120)
  assert.equal(configBody.native, true)
  assert.equal(configBody.clips.idle, 121)
  assert.match(configBody.assetVersion, /^[0-9a-f]{12}$/)

  harness.event(session, { type: 'turn/start' })
  assert.equal(harness.sent.at(-1).state, 'thinking')
  assert.equal(harness.sent.at(-1).native, true)

  const stream = await harness.call('/plugins/dsh-alk-pet/events')
  assert.equal(stream.status, 200)
  assert.match(String(stream.body), /^retry: 2000\ndata: /)
  assert.match(String(stream.body), /"sessionId":"session-1"/)

  const image = await harness.call('/plugins/dsh-alk-pet/image', { url: '/plugins/dsh-alk-pet/image?state=idle&frame=1' })
  assert.equal(image.status, 200)
  assert.equal(image.headers['content-type'], 'image/png')
  assert.equal(image.headers['cache-control'], 'public, max-age=31536000, immutable')
  assert.deepEqual([...image.body.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47])
  assert.equal((await harness.call('/plugins/dsh-alk-pet/image', { url: '/plugins/dsh-alk-pet/image?state=idle&frame=9999' })).status, 404)
  assert.equal((await harness.call('/plugins/dsh-alk-pet/image', { url: '/plugins/dsh-alk-pet/image?state=idle&frame=1', address: '10.0.0.8' })).status, 403)

  const title = await harness.call('/plugins/dsh-alk-pet/title', { method: 'POST', body: { sessionId: 'session-1', title: '我改的标题' } })
  assert.equal(title.status, 204)
  assert.equal(harness.sent.at(-1).title, '我改的标题')

  const selectMissing = await harness.call('/plugins/dsh-alk-pet/select', { method: 'POST', body: { sessionId: 'missing' } })
  assert.equal(selectMissing.status, 404)
  const select = await harness.call('/plugins/dsh-alk-pet/select', { method: 'POST', body: { sessionId: 'session-1' } })
  assert.equal(select.status, 204)

  const hover = await harness.call('/plugins/dsh-alk-pet/hover', { method: 'POST', body: { source: 'web-test', hovered: true } })
  assert.equal(hover.status, 204)
  assert.equal((await harness.call('/plugins/dsh-alk-pet/hover', { method: 'POST', body: { source: '', hovered: true } })).status, 400)
  assert.equal((await harness.call('/plugins/dsh-alk-pet/viewed', { method: 'GET' })).status, 403)

  harness.event(session, { type: 'turn/end', data: { reason: { kind: 'completed' } } })
  const completed = harness.sent.at(-1)
  assert.equal(completed.state, 'success')
  assert.equal(completed.completionId, 1)
  const viewed = await harness.call('/plugins/dsh-alk-pet/viewed', { method: 'POST', body: { sessionId: 'session-1', completionId: 1 } })
  assert.equal(viewed.status, 204)
  assert.equal(harness.sent.at(-1).tasks.length, 0)

  harness.dispose()
  assert.equal(harness.nativeStopped, true)
})
