import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { isSubagentSession, ownerSessionOf } from '../src/session-owner.js'

test('subagent activity belongs to the user session, while ordinary forks remain user sessions', () => {
  const root = { header: { id: 'root' } }
  const child = { header: { id: 'child', parentSession: 'root', origin: 'subagent', delegationDepth: 1 } }
  const grandchild = { header: { id: 'grandchild', parentSession: 'child', origin: 'subagent', delegationDepth: 2 } }
  const fork = { header: { id: 'fork', parentSession: 'root' } }
  const sessions = new Map([['root', root], ['child', child], ['grandchild', grandchild], ['fork', fork]])
  const store = { get: (id) => sessions.get(id) }
  assert.equal(isSubagentSession(child), true)
  assert.deepEqual(ownerSessionOf(grandchild, store), { id: 'root', session: root })
  assert.deepEqual(ownerSessionOf(fork, store), { id: 'fork', session: fork })
})
