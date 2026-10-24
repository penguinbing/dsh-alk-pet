export function statusForState(state) {
  if (state === 'waiting') return 'waiting'
  if (state === 'success') return 'success'
  if (state === 'error') return 'error'
  if (state === 'idle') return 'idle'
  return 'running'
}

export class TaskBoard {
  tasks = new Map()
  selectedId = null

  upsert(sessionId, patch) {
    const previous = this.tasks.get(sessionId) || { sessionId, state: 'idle', title: '当前任务', detail: '', viewed: false, completionId: null }
    const next = { ...previous, ...patch, sessionId }
    next.status = statusForState(next.state)
    this.tasks.set(sessionId, next)
    if (!this.selectedId) this.selectedId = sessionId
    return this.snapshot()
  }

  has(sessionId) {
    return this.tasks.has(sessionId)
  }

  get size() {
    return this.tasks.size
  }

  select(sessionId) {
    if (!this.tasks.has(sessionId)) return false
    this.selectedId = sessionId
    return true
  }

  advance() {
    const ids = [...this.tasks.keys()]
    if (ids.length < 2) return false
    const index = ids.indexOf(this.selectedId)
    this.selectedId = ids[(index + 1) % ids.length]
    return true
  }

  remove(sessionId) {
    if (!this.tasks.delete(sessionId)) return false
    if (this.selectedId === sessionId) this.selectedId = this.tasks.keys().next().value ?? null
    return true
  }

  markViewed(sessionId, completionId) {
    const task = this.tasks.get(sessionId)
    if (!task || task.completionId !== completionId || (task.state !== 'success' && task.state !== 'error')) return false
    return this.remove(sessionId)
  }

  snapshot() {
    const selected = this.tasks.get(this.selectedId) || { state: 'idle', title: '当前任务', detail: '', viewed: false }
    return {
      ...selected,
      selectedTaskId: this.selectedId,
      tasks: [...this.tasks.values()].map(({ sessionId, title, detail, label, state, status, viewed, completionId }) => ({ sessionId, title, detail, label, state, status, viewed, completionId })),
    }
  }
}
