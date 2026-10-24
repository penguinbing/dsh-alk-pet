import { sessionIdOf } from './task-title.js'

export function isSubagentSession(session) {
  const header = session?.header
  return header?.origin === 'subagent' || (Number.isFinite(header?.delegationDepth) && header.delegationDepth > 0)
}

export function ownerSessionOf(session, store) {
  let current = session
  const seen = new Set()
  while (isSubagentSession(current)) {
    const parentId = current?.header?.parentSession
    if (typeof parentId !== 'string' || !parentId || seen.has(parentId)) return { id: null, session: null }
    seen.add(parentId)
    const parent = store?.get?.(parentId)
    if (!parent) return { id: parentId, session: null }
    current = parent
  }
  return { id: sessionIdOf(current), session: current }
}
