import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { detailFor, stateForEvent } from '../src/state.js'

test('session events drive core pet states', () => {
  assert.equal(stateForEvent({ type: 'turn/start' }), 'thinking')
  assert.equal(stateForEvent({ type: 'tool/call', data: { name: 'shell' } }), 'working')
  assert.equal(stateForEvent({ type: 'tool/call', data: { name: 'request_user_input' } }), 'waiting')
  assert.equal(stateForEvent({ type: 'tool/call', data: { name: 'ask_user_question' } }), 'waiting')
  assert.equal(stateForEvent({ type: 'tool/call', data: { name: 'approval' } }), 'waiting')
  assert.equal(stateForEvent({ type: 'tool/result' }), 'thinking')
  assert.equal(stateForEvent({ type: 'tool/result', data: { error: { message: 'failed' } } }), 'error')
  assert.equal(stateForEvent({ type: 'turn/end' }), 'success')
  assert.equal(stateForEvent({ type: 'turn/end', data: { reason: { kind: 'aborted' } } }), 'idle')
  assert.equal(stateForEvent({ type: 'turn/end', data: { reason: { kind: 'blocked' } } }), 'waiting')
  assert.equal(stateForEvent({ type: 'turn/end', data: { reason: { kind: 'failed' } } }), 'error')
  assert.equal(stateForEvent({ type: 'turn/end', data: { reason: { kind: 'error' } } }), 'error')
  assert.equal(stateForEvent({ type: 'turn/end', data: { reason: { kind: 'interrupted' } } }), 'idle')
  assert.equal(stateForEvent({ type: 'turn/end', data: { reason: { kind: 'max-tokens' } } }), 'success')
  assert.equal(stateForEvent({ type: 'turn/end', data: { reason: { kind: 'forked' } } }), null)
  assert.equal(stateForEvent({ type: 'approval/asked' }), 'waiting')
  assert.equal(stateForEvent({ type: 'agent/request-error' }), 'error')
})

test('tool names containing "ask" as a fragment do not wait for the user', () => {
  for (const name of ['team_task_create', 'task', 'mask_image', 'task_update']) {
    assert.equal(stateForEvent({ type: 'tool/call', data: { name } }), 'working', name)
  }
})

test('working details describe common tool families', () => {
  assert.equal(detailFor({ type: 'tool/call', data: { name: 'web_search' } }, 'working'), '正在查找资料')
  assert.equal(detailFor({ type: 'tool/call', data: { name: 'run_code' } }, 'working'), '正在运行命令')
  assert.equal(detailFor({ type: 'tool/call', data: { name: 'apply_patch' } }, 'working'), '正在修改文件')
  assert.equal(detailFor({ type: 'tool/call', data: { name: 'todo_write' } }, 'working'), '正在整理任务')
  assert.equal(detailFor({ type: 'tool/call', data: { name: 'unknown_tool' } }, 'working'), '正在使用 unknown_tool')
  assert.equal(detailFor({ type: 'step/start', data: { step: 3 } }, 'thinking', '写测试'), '步骤 3 · 写测试')
})

test('working details append the command, file or query being handled', () => {
  const call = (name, args) => ({ type: 'tool/call', data: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) } })
  assert.equal(
    detailFor(call('run_code', { code: "const r = await tools.bash({ description: '跑测试', command: 'npm test -- --watch' })" }), 'working'),
    '正在运行命令 · npm test -- --watch'
  )
  assert.equal(detailFor(call('shell', { command: 'git status --short' }), 'working'), '正在运行命令 · git status --short')
  assert.equal(detailFor(call('read', { file_path: 'src/state.js' }), 'working'), '正在查找资料 · src/state.js')
  assert.equal(detailFor(call('web_search', { queries: ['dsh pet', 'macos overlay'] }), 'working'), '正在查找资料 · dsh pet macos overlay')
  assert.equal(detailFor(call('write', { path: 'src/index.js' }), 'working'), '正在修改文件 · src/index.js')
  assert.match(detailFor(call('run_code', '{not json'), 'working'), /^正在运行命令/)
  const long = 'x'.repeat(300)
  assert.ok(detailFor(call('shell', { command: long }), 'working').length < 120)
})
