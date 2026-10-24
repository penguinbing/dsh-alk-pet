import { loadManifest } from './assets.js'
import { normalizeConfig } from './config.js'
import { labels, stateForEvent, detailFor } from './state.js'
import { loggedTitleOf, sessionIdOf, sessionTitleOf, truncate, updateTaskTitle } from './task-title.js'
import { isSubagentSession, ownerSessionOf } from './session-owner.js'
import { TaskBoard } from './task-board.js'

export const HOVER_TTL_MS = 5 * 60 * 1000
const SESSION_TTL_MS = 24 * 60 * 60 * 1000
const SESSION_SOFT_LIMIT = 300
const TITLE_CACHE_LIMIT = 80
const TITLE_LIMIT = 100

export class PetRuntime {
  constructor(config = {}, options = {}) {
    this.manifest = options.manifest ?? loadManifest()
    this.now = options.now ?? (() => Date.now())
    this.config = normalizeConfig(config)
    this.board = new TaskBoard()
    this.sessions = new Map()
    this.clientTitles = new Map()
    this.hoverSources = new Map()
    this.completionNumber = 0
    this.onChange = () => {}
  }

  get taskCount() {
    return this.board.size
  }

  snapshot(extra = {}) {
    const selected = this.board.snapshot()
    return {
      ...selected,
      label: labels[selected.state] ?? labels.idle,
      ...this.configSnapshot(),
      ...extra,
    }
  }

  configSnapshot() {
    return {
      enabled: this.config.enabled,
      size: this.config.size,
      reducedMotion: this.config.reducedMotion,
      showBubble: this.config.showBubble,
      clips: this.manifest.clips,
      frameMs: this.manifest.frameMs,
      assetVersion: this.manifest.assetVersion,
    }
  }

  setConfig(patch = {}) {
    const next = normalizeConfig({ ...this.config, ...patch })
    if (JSON.stringify(next) === JSON.stringify(this.config)) return false
    this.config = next
    this.emit()
    return true
  }

  emit(extra) {
    this.onChange(this.snapshot(extra))
  }

  recordFor(session) {
    const id = sessionIdOf(session)
    let record = this.sessions.get(id)
    if (!record) {
      const logged = loggedTitleOf(session)
      const uiTitle = this.clientTitles.get(id)
      this.clientTitles.delete(id)
      const title = truncate(uiTitle || logged?.title || sessionTitleOf(session), TITLE_LIMIT)
      record = {
        id,
        title,
        titleSource: uiTitle ? 'client' : logged?.source || (title ? 'session' : ''),
        task: '',
        activeTools: 0,
        lastSeen: this.now(),
      }
      this.sessions.set(id, record)
      this.pruneSessions()
    }
    record.lastSeen = this.now()
    return record
  }

  onSessionEvent(session, event, store) {
    if (!this.config.enabled) return
    const id = sessionIdOf(session)
    const record = this.recordFor(session)
    const owner = ownerSessionOf(session, store)
    if (!owner.id) return
    const ownerRecord = owner.session ? this.recordFor(owner.session) : this.sessions.get(owner.id)
    const ownerTitle = () => truncate(ownerRecord?.title || this.clientTitles.get(owner.id) || '当前任务', TITLE_LIMIT)

    if (updateTaskTitle(record, session, event) && !isSubagentSession(session) && this.board.has(id)) {
      this.updateTask(id, { title: ownerTitle(), titleSource: record.titleSource })
    }
    if (event?.type === 'session/title') return

    if (event?.type === 'turn/start') {
      record.activeTools = 0
      record.task = ''
    } else if (event?.type === 'turn/end') {
      record.activeTools = 0
    } else if (event?.type === 'tool/call') {
      record.activeTools += 1
    } else if (event?.type === 'tool/result') {
      record.activeTools = Math.max(0, record.activeTools - 1)
    }

    if (event?.type === 'todo/write') {
      const todos = Array.isArray(event.data?.todos) ? event.data.todos : []
      const active = todos.find((todo) => todo?.status === 'in_progress') ?? todos.find((todo) => todo?.status === 'pending')
      if (active?.content) {
        record.task = truncate(String(active.content), TITLE_LIMIT)
        const ownerTask = this.board.tasks.get(owner.id)
        if (ownerTask && (ownerTask.state === 'thinking' || ownerTask.state === 'idle')) {
          this.updateTask(owner.id, { title: ownerTitle(), titleSource: ownerRecord?.titleSource, detail: record.task.slice(0, 100) })
        }
      }
      return
    }

    const state = stateForEvent(event)
    if (!state) return
    // Keep "working" until the last parallel tool call finishes.
    if (record.activeTools > 0 && state === 'thinking') return
    if (isSubagentSession(session) && event?.type === 'turn/end') return
    if (state === 'idle') {
      // Aborted turns are not "tasks"; dropping them prevents idle dots accumulating forever.
      if (this.board.remove(owner.id)) this.emit()
      return
    }
    this.updateTask(owner.id, {
      activitySessionId: id,
      state,
      title: ownerTitle(),
      titleSource: ownerRecord?.titleSource,
      label: labels[state],
      detail: detailFor(event, state, record.task),
      viewed: false,
      completionId: state === 'success' || state === 'error' ? ++this.completionNumber : null,
    })
  }

  updateTask(sessionId, patch) {
    this.board.upsert(sessionId, patch)
    this.emit()
  }

  select(sessionId) {
    if (!this.board.select(sessionId)) return false
    this.emit()
    return true
  }

  advance() {
    if (!this.board.advance()) return false
    this.emit()
    return true
  }

  markViewed(sessionId, completionId) {
    if (!this.board.markViewed(sessionId, completionId)) return false
    this.emit()
    return true
  }

  postTitle(sessionId, title) {
    if (typeof sessionId !== 'string' || typeof title !== 'string' || !title.trim()) return false
    const nextTitle = truncate(title.trim(), TITLE_LIMIT)
    const record = this.sessions.get(sessionId)
    if (record) {
      if (record.title !== nextTitle) {
        record.title = nextTitle
        record.titleSource = 'client'
        if (this.board.has(sessionId)) this.updateTask(sessionId, { title: nextTitle, titleSource: 'client' })
      }
      return true
    }
    this.clientTitles.set(sessionId, nextTitle)
    this.pruneTitles()
    return true
  }

  setHover(source, hovered) {
    if (typeof source !== 'string' || !source || source.length > 128 || typeof hovered !== 'boolean') {
      return { ok: false, changed: false }
    }
    const changed = hovered ? !this.hoverSources.has(source) : this.hoverSources.delete(source)
    if (hovered) this.hoverSources.set(source, this.now())
    return { ok: true, changed }
  }

  hovering() {
    return this.hoverSources.size > 0
  }

  pruneHovers(now = this.now()) {
    let changed = false
    for (const [source, seen] of this.hoverSources) {
      if (now - seen > HOVER_TTL_MS) {
        this.hoverSources.delete(source)
        changed = true
      }
    }
    return changed
  }

  pruneSessions() {
    if (this.sessions.size <= SESSION_SOFT_LIMIT) return
    const cutoff = this.now() - SESSION_TTL_MS
    for (const [id, record] of this.sessions) {
      if (this.sessions.size <= SESSION_SOFT_LIMIT) return
      if (record.lastSeen < cutoff && !this.board.has(id)) this.sessions.delete(id)
    }
    // Hard cap: drop the oldest bookkeeping-only records even when fresh.
    for (const [id] of this.sessions) {
      if (this.sessions.size <= SESSION_SOFT_LIMIT) return
      if (!this.board.has(id)) this.sessions.delete(id)
    }
  }

  pruneTitles() {
    while (this.clientTitles.size > TITLE_CACHE_LIMIT) {
      this.clientTitles.delete(this.clientTitles.keys().next().value)
    }
  }

  dispose() {
    this.sessions.clear()
    this.clientTitles.clear()
    this.hoverSources.clear()
    this.board.tasks.clear()
    this.board.selectedId = null
    this.onChange = () => {}
  }
}
