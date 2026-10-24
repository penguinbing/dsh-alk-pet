import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { humanPromptTitle, loggedTitleOf, sessionIdOf, sessionTitleOf, truncate, updateTaskTitle } from '../src/task-title.js'

test('task title comes from the session and direct user prompt', () => {
  assert.equal(sessionIdOf({ header: { id: 's-1' } }), 's-1')
  assert.equal(sessionTitleOf({ header: { title: '修复桌面宠物' } }), '修复桌面宠物')
  assert.equal(humanPromptTitle({ type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '# 实现进度气泡\n支持两行' }] } }), '实现进度气泡 支持两行')
  assert.equal(humanPromptTitle({ type: 'user/message', data: { source: { kind: 'agent-instructions' }, content: [{ type: 'text', text: 'ignore me' }] } }), '')
})

test('overall task title stays on the first request until a session title is available', () => {
  const record = { title: '', titleSource: '' }
  const prompt = (text) => ({ type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text }] } })
  assert.equal(updateTaskTitle(record, {}, prompt('实现桌面宠物')), true)
  assert.equal(record.title, '实现桌面宠物')
  assert.equal(updateTaskTitle(record, {}, prompt('现在气泡有问题')), false)
  assert.equal(record.title, '实现桌面宠物')
  assert.equal(updateTaskTitle(record, { header: { title: 'DeepSeek 桌面宠物' } }, prompt('再调动画')), true)
  assert.equal(record.title, 'DeepSeek 桌面宠物')
  assert.equal(updateTaskTitle(record, {}, prompt('继续修改')), false)
  assert.equal(record.title, 'DeepSeek 桌面宠物')
})

test('session title revisions track the sidebar title', () => {
  const record = { title: '', titleSource: '' }
  const titleEvent = (title, kind) => ({ type: 'session/title', data: { title, source: { kind } } })
  assert.equal(updateTaskTitle(record, {}, titleEvent('第一次请求', 'fallback')), true)
  assert.equal(updateTaskTitle(record, {}, titleEvent('开发 DeepSeek 宠物插件', 'provider')), true)
  assert.equal(updateTaskTitle(record, {}, titleEvent('调整气泡样式', 'provider')), true)
  assert.equal(record.title, '调整气泡样式')
  assert.equal(updateTaskTitle(record, {}, titleEvent('我的桌面宠物', 'user')), true)
  assert.equal(updateTaskTitle(record, {}, titleEvent('再次自动改名', 'provider')), true)
  assert.equal(record.title, '再次自动改名')
})

test('restored sessions recover the title already shown in the DSH sidebar', () => {
  const session = { snapshotEvents() { return [
    { type: 'session/title', data: { title: '最初的自动标题', source: { kind: 'provider' } } },
    { type: 'user/message', data: { content: '继续处理' } },
    { type: 'session/title', data: { title: '盘后复盘个人笔记功能建议', source: { kind: 'provider' } } },
  ] } }
  assert.deepEqual(loggedTitleOf(session), { title: '盘后复盘个人笔记功能建议', source: 'session' })
  assert.deepEqual(loggedTitleOf({ snapshotEvents() { return [{ type: 'session/title', data: { title: '我手动起的名字', source: { kind: 'user' } } }] } }), { title: '我手动起的名字', source: 'user' })
})

test('truncation never splits surrogate pairs', () => {
  const emoji = '🐟'.repeat(120)
  assert.equal(Array.from(truncate(emoji, 100)).length, 100)
  assert.ok(!truncate(emoji, 100).includes('\uFFFD'))
  assert.equal(truncate('short', 10), 'short')
})
