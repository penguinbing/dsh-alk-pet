export function truncate(value, max = 100) {
  return Array.from(String(value ?? '')).slice(0, max).join('')
}

function clean(value) {
  return truncate(String(value ?? '').replace(/\s+/gu, ' ').trim().replace(/^#{1,6}\s*/u, ''), 100)
}

export function sessionIdOf(session) {
  return String(session?.header?.id ?? session?.id ?? 'unknown-session')
}

export function sessionTitleOf(session) {
  return clean(session?.title ?? session?.header?.title ?? session?.name ?? session?.header?.name)
}

export function loggedTitleOf(session) {
  if (typeof session?.snapshotEvents !== 'function') return null
  try {
    const events = session.snapshotEvents()
    const event = events.findLast((entry) => entry?.type === 'session/title' && clean(entry.data?.title))
    return event ? { title: clean(event.data.title), source: event.data?.source?.kind === 'user' ? 'user' : 'session' } : null
  } catch { return null }
}

export function humanPromptTitle(event) {
  if (event?.type !== 'user/message' || event?.data?.source?.kind !== 'user') return ''
  const content = event.data.content
  const text = Array.isArray(content)
    ? content.filter((block) => block?.type === 'text').map((block) => block.text ?? '').join(' ')
    : typeof content === 'string' ? content : ''
  return clean(text)
}

export function updateTaskTitle(record, session, event) {
  if (event?.type === 'session/title' && typeof event.data?.title === 'string') {
    const title = clean(event.data.title)
    if (!title) return false
    const changed = record.title !== title
    record.title = title
    record.titleSource = event.data?.source?.kind || 'session'
    return changed
  }
  const sessionTitle = sessionTitleOf(session)
  if (sessionTitle && (!record.title || record.titleSource === 'prompt')) {
    record.title = sessionTitle
    record.titleSource = 'session'
    return true
  }
  const promptTitle = humanPromptTitle(event)
  if (promptTitle && !record.title) {
    record.title = promptTitle
    record.titleSource = 'prompt'
    return true
  }
  return false
}
