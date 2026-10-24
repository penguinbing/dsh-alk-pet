import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadManifest } from './assets.js'
import { startNative } from './native.js'
import { HOVER_TTL_MS, PetRuntime } from './pet-runtime.js'

export const name = 'dsh-alk-pet'
export const inject = ['sessions']

const pluginPath = '/plugins/dsh-alk-pet'
const endpoints = {
  events: `${pluginPath}/events`,
  config: `${pluginPath}/config`,
  image: `${pluginPath}/image`,
  viewed: `${pluginPath}/viewed`,
  title: `${pluginPath}/title`,
  select: `${pluginPath}/select`,
  hover: `${pluginPath}/hover`,
}
const assets = join(dirname(dirname(fileURLToPath(import.meta.url))), 'assets/animations')
const IMAGE_CACHE_LIMIT = 256
const HOVER_SWEEP_MS = 60_000
const HEARTBEAT_MS = 25_000

export function isLocalAddress(address) {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

function local(req) {
  return isLocalAddress(req.socket?.remoteAddress ?? '')
}

function writeEvent(res, value) {
  res.write(`data: ${JSON.stringify(value)}\n\n`)
}

function readJson(req, res, handler) {
  let body = ''
  req.on('data', (chunk) => {
    body += chunk
    if (body.length > 4096) req.destroy()
  })
  req.on('end', () => {
    let payload
    try {
      payload = JSON.parse(body)
    } catch {
      res.writeHead(400)
      res.end()
      return
    }
    let status = 204
    try {
      status = handler(payload) ?? 204
    } catch {
      status = 400
    }
    res.writeHead(status)
    res.end()
  })
  req.on('error', () => {})
}

export function apply(ctx, config = {}, options = {}) {
  const startHelper = options.startNative ?? startNative
  const runtime = new PetRuntime(config, { manifest: options.manifest ?? loadManifest() })
  const clients = new Set()
  const imageCache = new Map()
  let native = null
  let carouselTimer = null
  let nextDelay = 2000
  let hoverSweep = null
  let heartbeat = null
  let disposed = false

  const snapshot = () => runtime.snapshot({ native: native !== null })

  const broadcast = () => {
    const current = snapshot()
    native?.send(current)
    for (const res of clients) {
      if (res.destroyed || res.writableEnded) {
        clients.delete(res)
        continue
      }
      try {
        writeEvent(res, current)
      } catch {
        clients.delete(res)
      }
    }
  }

  const scheduleCarousel = (delay = nextDelay) => {
    nextDelay = delay
    clearTimeout(carouselTimer)
    carouselTimer = null
    if (disposed || runtime.taskCount < 2 || runtime.hovering()) return
    carouselTimer = setTimeout(() => {
      runtime.advance()
      scheduleCarousel(2000)
    }, delay)
    carouselTimer.unref?.()
  }

  runtime.onChange = () => {
    broadcast()
    if (!carouselTimer) scheduleCarousel()
  }

  const onAction = (action) => {
    if (action?.type === 'select') {
      if (runtime.select(action.sessionId)) scheduleCarousel(2000)
      return
    }
    if (action?.type === 'hover') {
      const result = runtime.setHover('native', action.hovered === true)
      if (result.ok && result.changed) scheduleCarousel()
    }
  }

  if (runtime.config.enabled) {
    native = startHelper({
      onAction,
      onLog: (message) => console.warn('[dsh-alk-pet]', message),
      onExit: (error) => {
        native = null
        runtime.setHover('native', false)
        broadcast()
        console.warn('[dsh-alk-pet] native helper unavailable:', error?.message ?? error)
      },
    })
  }
  native?.send(snapshot())

  hoverSweep = setInterval(() => {
    if (runtime.pruneHovers()) scheduleCarousel()
  }, Math.min(HOVER_SWEEP_MS, HOVER_TTL_MS))
  hoverSweep.unref?.()

  heartbeat = setInterval(() => {
    for (const res of clients) {
      if (res.destroyed || res.writableEnded) {
        clients.delete(res)
        continue
      }
      try {
        res.write(': ping\n\n')
      } catch {
        clients.delete(res)
      }
    }
  }, HEARTBEAT_MS)
  heartbeat.unref?.()

  function events(req, res) {
    if (!local(req)) { res.writeHead(403); res.end(); return }
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive' })
    res.write('retry: 2000\n')
    writeEvent(res, snapshot())
    clients.add(res)
    res.on('error', () => clients.delete(res))
    req.on('close', () => clients.delete(res))
  }

  function configHandler(req, res) {
    if (!local(req)) { res.writeHead(403); res.end(); return }
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify({ ...runtime.configSnapshot(), native: native !== null }))
  }

  function image(req, res) {
    if (!local(req)) { res.writeHead(403); res.end(); return }
    const url = new URL(req.url ?? '', 'http://localhost')
    const state = url.searchParams.get('state')
    const frame = Number(url.searchParams.get('frame'))
    const clips = runtime.manifest.clips
    if (!state || !Object.hasOwn(clips, state) || !Number.isInteger(frame) || frame < 1 || frame > clips[state]) {
      res.writeHead(404); res.end(); return
    }
    const key = `${state}/${String(frame).padStart(3, '0')}`
    let image = imageCache.get(key)
    if (!image) {
      try {
        image = readFileSync(join(assets, state, `${String(frame).padStart(3, '0')}.png`))
      } catch {
        res.writeHead(404); res.end(); return
      }
      if (imageCache.size >= IMAGE_CACHE_LIMIT) imageCache.delete(imageCache.keys().next().value)
      imageCache.set(key, image)
    } else {
      imageCache.delete(key)
      imageCache.set(key, image)
    }
    res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=31536000, immutable' })
    res.end(image)
  }

  const onEvent = ctx.on('session/event', (session, event) => {
    runtime.onSessionEvent(session, event, ctx.sessions)
  })

  if (typeof ctx.inject === 'function') {
    ctx.inject(['webServer'], (httpCtx) => {
      httpCtx.effect(() => httpCtx.webServer.register({ kind: 'exact', path: endpoints.events, handler: events }), 'dsh-alk-pet: events')
      httpCtx.effect(() => httpCtx.webServer.register({ kind: 'exact', path: endpoints.config, handler: configHandler }), 'dsh-alk-pet: config')
      httpCtx.effect(() => httpCtx.webServer.register({ kind: 'exact', path: endpoints.image, handler: image }), 'dsh-alk-pet: image')
      httpCtx.effect(() => httpCtx.webServer.register({ kind: 'exact', path: endpoints.viewed, handler(req, res) {
        if (!local(req) || req.method !== 'POST') { res.writeHead(403); res.end(); return }
        readJson(req, res, (payload) => {
          if (typeof payload?.sessionId !== 'string') return 400
          runtime.markViewed(payload.sessionId, payload.completionId)
          scheduleCarousel()
          return 204
        })
      } }), 'dsh-alk-pet: viewed')
      httpCtx.effect(() => httpCtx.webServer.register({ kind: 'exact', path: endpoints.title, handler(req, res) {
        if (!local(req) || req.method !== 'POST') { res.writeHead(403); res.end(); return }
        readJson(req, res, (payload) => {
          if (typeof payload?.sessionId !== 'string' || typeof payload?.title !== 'string') return 400
          return runtime.postTitle(payload.sessionId, payload.title) ? 204 : 400
        })
      } }), 'dsh-alk-pet: title')
      httpCtx.effect(() => httpCtx.webServer.register({ kind: 'exact', path: endpoints.select, handler(req, res) {
        if (!local(req) || req.method !== 'POST') { res.writeHead(403); res.end(); return }
        readJson(req, res, (payload) => {
          if (typeof payload?.sessionId !== 'string' || !runtime.select(payload.sessionId)) return 404
          scheduleCarousel(2000)
          return 204
        })
      } }), 'dsh-alk-pet: select')
      httpCtx.effect(() => httpCtx.webServer.register({ kind: 'exact', path: endpoints.hover, handler(req, res) {
        if (!local(req) || req.method !== 'POST') { res.writeHead(403); res.end(); return }
        readJson(req, res, (payload) => {
          const result = runtime.setHover(payload?.source, payload?.hovered)
          if (!result.ok) return 400
          if (result.changed) scheduleCarousel()
          return 204
        })
      } }), 'dsh-alk-pet: hover')
    })
  }

  ctx.effect?.(() => () => {
    disposed = true
    clearTimeout(carouselTimer)
    clearInterval(hoverSweep)
    clearInterval(heartbeat)
    onEvent?.()
    native?.stop()
    native = null
    clients.forEach((res) => { try { res.end() } catch {} })
    clients.clear()
    imageCache.clear()
    runtime.dispose()
  }, 'dsh-alk-pet: cleanup')
}
