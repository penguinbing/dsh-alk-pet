export const labels = Object.freeze({
  idle: '待机中', thinking: '正在思考', working: '正在工作',
  waiting: '等待你', success: '完成啦', error: '遇到问题',
})

const WAITING_TOOL = /(?:^|_)(?:ask|approval|permission|user_input)(?:_|$)/i
const TARGET_LIMIT = 96

function clipTarget(value) {
  const text = String(value ?? '').replace(/\s+/gu, ' ').trim()
  if (!text) return ''
  return text.length > TARGET_LIMIT ? `${text.slice(0, TARGET_LIMIT - 1)}…` : text
}

function parseArguments(raw) {
  if (raw && typeof raw === 'object') return raw
  if (typeof raw !== 'string') return null
  const text = raw.trim()
  if (!text) return ''
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

export function toolNameOf(event) {
  return String(event?.data?.name ?? event?.data?.toolName ?? event?.data?.message?.name ?? '').toLowerCase()
}

export function toolArguments(event) {
  const data = event?.data
  return parseArguments(data?.arguments ?? data?.args ?? data?.input ?? data?.params ?? data?.toolInput)
}

function commandInsideCode(code) {
  const match = String(code).match(/(?:command|cmd)\s*:\s*(['"`])([\s\S]*?)\1/u)
  return match ? match[2] : ''
}

function targetOf(args) {
  if (!args) return ''
  if (typeof args === 'string') return clipTarget(args)
  if (Array.isArray(args)) return clipTarget(args.filter((value) => typeof value === 'string').join(' '))
  if (typeof args !== 'object') return ''
  for (const value of [args.command, args.cmd, args.script]) {
    if (typeof value === 'string' && value.trim()) return clipTarget(value)
  }
  if (typeof args.code === 'string' && args.code.trim()) {
    const command = commandInsideCode(args.code)
    if (command) return clipTarget(command)
    if (typeof args.description === 'string' && args.description.trim()) return clipTarget(args.description)
    return clipTarget(args.code)
  }
  for (const value of [args.description, args.query, args.queries, args.pattern, args.url, args.file_path, args.path, args.filename, args.name]) {
    if (typeof value === 'string' && value.trim()) return clipTarget(value)
    if (Array.isArray(value) && value.length) {
      const text = value.filter((entry) => typeof entry === 'string' && entry.trim()).join(' ')
      if (text) return clipTarget(text)
    }
  }
  return ''
}

export function stateForEvent(event) {
  const type = String(event?.type ?? '')
  if (type === 'turn/end') {
    const reason = String(event?.data?.reason?.kind ?? 'completed')
    if (reason === 'blocked') return 'waiting'
    if (reason === 'aborted' || reason === 'interrupted') return 'idle'
    if (reason === 'completed' || reason === 'max-tokens') return 'success'
    if (reason === 'forked') return null
    return 'error'
  }
  if (type === 'approval/asked') return 'waiting'
  if (type === 'approval/decided') return 'thinking'
  if (/error|failed/.test(type)) return 'error'
  if (type === 'tool/call' || type === 'tool/start' || type === 'tools/call') {
    const name = toolNameOf(event).replace(/[^a-z0-9]+/gu, '_')
    if (WAITING_TOOL.test(name)) return 'waiting'
    return 'working'
  }
  if (type === 'tool/result' || type === 'tools/result') return event?.data?.error ? 'error' : 'thinking'
  if (type === 'assistant/message' || type === 'assistant/attempt' || type === 'step/start' || type === 'turn/start') return 'thinking'
  return null
}

export function detailFor(event, state, task) {
  if (state === 'waiting') return '等待你确认'
  if (state === 'success') return '任务已完成'
  if (state === 'error') return '任务遇到问题'
  if (state === 'working') {
    const name = toolNameOf(event)
    const target = targetOf(toolArguments(event))
    const suffix = target ? ` · ${target}` : ''
    if (/search|grep|find|glob|web|read|fetch|open/i.test(name)) return `正在查找资料${suffix}`
    if (/test|check|lint|build|verify/i.test(name)) return `正在验证结果${suffix}`
    if (/run_code|shell|bash|exec|command|terminal|powershell/i.test(name)) return `正在运行命令${suffix}`
    if (/todo|task|plan/i.test(name)) return `正在整理任务${suffix}`
    if (/subagent|delegate|agent/i.test(name)) return `正在协调子任务${suffix}`
    if (/write|edit|patch|replace|create/i.test(name)) return `正在修改文件${suffix}`
    return `正在使用 ${name.slice(0, 64)}${suffix}`
  }
  if (event?.type === 'step/start' && Number.isInteger(event?.data?.step)) {
    const prefix = `步骤 ${event.data.step}`
    return task ? `${prefix} · ${task.slice(0, 100)}` : `${prefix} · 分析中`
  }
  return task ? task.slice(0, 100) : labels[state]
}
