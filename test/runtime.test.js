import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { HOVER_TTL_MS, PetRuntime } from '../src/pet-runtime.js'

const manifest = {
  version: 'test',
  frameMs: 83,
  assetVersion: 'abc123def456',
  clips: { idle: 121, thinking: 121, working: 121, waiting: 121, success: 121, error: 59 },
}

function setup(config = {}) {
  const clock = { now: 1_000_000 }
  const runtime = new PetRuntime(config, { manifest, now: () => clock.now })
  const changes = []
  runtime.onChange = (snapshot) => changes.push(snapshot)
  const session = (id, extra = {}, title = '') => ({ header: { id, ...extra }, title })
  const store = (...list) => ({ get: (id) => list.find((entry) => entry.header.id === id) })
  return { runtime, changes, session, store, clock }
}

test('a completed turn exposes success until the result is viewed', () => {
  const { runtime, session, store } = setup()
  const s = session('s1')
  runtime.onSessionEvent(s, { type: 'turn/start' }, store(s))
  assert.equal(runtime.snapshot().state, 'thinking')
  assert.equal(runtime.snapshot().label, '正在思考')
  assert.equal(runtime.taskCount, 1)
  runtime.onSessionEvent(s, { type: 'tool/call', data: { name: 'shell' } }, store(s))
  assert.equal(runtime.snapshot().state, 'working')
  assert.equal(runtime.snapshot().detail, '正在运行命令')
  runtime.onSessionEvent(s, { type: 'tool/result' }, store(s))
  assert.equal(runtime.snapshot().state, 'thinking')
  runtime.onSessionEvent(s, { type: 'turn/end', data: { reason: { kind: 'completed' } } }, store(s))
  const completed = runtime.snapshot()
  assert.equal(completed.state, 'success')
  assert.equal(completed.completionId, 1)
  assert.equal(completed.viewed, false)
  assert.equal(runtime.markViewed('s1', 99), false)
  assert.equal(runtime.taskCount, 1)
  assert.equal(runtime.markViewed('s1', 1), true)
  assert.equal(runtime.taskCount, 0)
  assert.equal(runtime.snapshot().state, 'idle')
})

test('parallel tool calls keep the pet working until the last result', () => {
  const { runtime, session, store } = setup()
  const s = session('s1')
  runtime.onSessionEvent(s, { type: 'turn/start' }, store(s))
  runtime.onSessionEvent(s, { type: 'tool/call', data: { name: 'shell' } }, store(s))
  runtime.onSessionEvent(s, { type: 'tool/call', data: { name: 'web_search' } }, store(s))
  assert.equal(runtime.snapshot().state, 'working')
  runtime.onSessionEvent(s, { type: 'tool/result' }, store(s))
  assert.equal(runtime.snapshot().state, 'working')
  runtime.onSessionEvent(s, { type: 'tool/result' }, store(s))
  assert.equal(runtime.snapshot().state, 'thinking')
})

test('aborted turns do not leave an idle dot behind', () => {
  const { runtime, session, store } = setup()
  const s = session('s1')
  runtime.onSessionEvent(s, { type: 'turn/start' }, store(s))
  assert.equal(runtime.taskCount, 1)
  runtime.onSessionEvent(s, { type: 'turn/end', data: { reason: { kind: 'aborted' } } }, store(s))
  assert.equal(runtime.taskCount, 0)
  assert.equal(runtime.snapshot().state, 'idle')
})

test('team task tools are not mistaken for a user prompt', () => {
  const { runtime, session, store } = setup()
  const s = session('s1')
  runtime.onSessionEvent(s, { type: 'turn/start' }, store(s))
  runtime.onSessionEvent(s, { type: 'tool/call', data: { name: 'team_task_create' } }, store(s))
  assert.equal(runtime.snapshot().state, 'working')
  runtime.onSessionEvent(s, { type: 'tool/call', data: { name: 'ask_user_question' } }, store(s))
  assert.equal(runtime.snapshot().state, 'waiting')
})

test('subagent activity is folded into the owning top-level task', () => {
  const { runtime, session, store } = setup()
  const root = session('root', {}, '总任务')
  const child = session('child', { parentSession: 'root', origin: 'subagent', delegationDepth: 1 })
  runtime.onSessionEvent(root, { type: 'turn/start' }, store(root, child))
  runtime.onSessionEvent(child, { type: 'tool/call', data: { name: 'shell' } }, store(root, child))
  const snapshot = runtime.snapshot()
  assert.equal(snapshot.sessionId, 'root')
  assert.equal(snapshot.title, '总任务')
  assert.equal(snapshot.state, 'working')
  assert.equal(snapshot.activitySessionId, 'child')
  assert.equal(runtime.taskCount, 1)
})

test('hover sources expire so the carousel cannot stay paused forever', () => {
  const { runtime, clock } = setup()
  assert.equal(runtime.setHover('tab-1', true).changed, true)
  assert.equal(runtime.hovering(), true)
  clock.now += HOVER_TTL_MS - 1
  assert.equal(runtime.pruneHovers(), false)
  clock.now += 2
  assert.equal(runtime.pruneHovers(), true)
  assert.equal(runtime.hovering(), false)
  assert.equal(runtime.setHover('tab-1', false).changed, false)
  assert.equal(runtime.setHover('', true).ok, false)
  assert.equal(runtime.setHover('x'.repeat(129), true).ok, false)
})

test('config is clamped and shipped with the snapshot', () => {
  const { runtime } = setup({ size: 9999, reducedMotion: 'yes', showBubble: 'no' })
  const snapshot = runtime.snapshot()
  assert.equal(snapshot.size, 200)
  assert.equal(snapshot.reducedMotion, false)
  assert.equal(snapshot.showBubble, true)
  assert.deepEqual(snapshot.clips, manifest.clips)
  assert.equal(snapshot.frameMs, 83)
  assert.equal(snapshot.assetVersion, 'abc123def456')
  const fallback = new PetRuntime({ size: 'nope' }, { manifest })
  assert.equal(fallback.snapshot().size, 120)
})

test('a client title seen before the first event is used for the task', () => {
  const { runtime, session, store } = setup()
  assert.equal(runtime.postTitle('s2', '  我的标题  '), true)
  const s = session('s2')
  runtime.onSessionEvent(s, { type: 'turn/start' }, store(s))
  const snapshot = runtime.snapshot()
  assert.equal(snapshot.title, '我的标题')
  assert.equal(snapshot.titleSource, 'client')
  assert.equal(runtime.postTitle('s2', '新标题'), true)
  assert.equal(runtime.snapshot().title, '新标题')
  assert.equal(runtime.postTitle('s2', '   '), false)
})

test('long-lived hosts do not grow session/title caches without bound', () => {
  const { runtime, session, clock } = setup()
  for (let i = 0; i < 320; i += 1) {
    clock.now += 1000
    runtime.recordFor(session(`s${i}`))
  }
  assert.ok(runtime.sessions.size <= 300)
  for (let i = 0; i < 120; i += 1) runtime.postTitle(`missing-${i}`, `标题 ${i}`)
  assert.ok(runtime.clientTitles.size <= 80)
})

test('disabled config ignores session events', () => {
  const { runtime, session, store } = setup({ enabled: false })
  const s = session('s1')
  runtime.onSessionEvent(s, { type: 'turn/start' }, store(s))
  assert.equal(runtime.taskCount, 0)
})
