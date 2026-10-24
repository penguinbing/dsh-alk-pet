window.__ModuleLoader__.load({ id: 'dsh-alk-pet', factory: (require) => {
  const React = require('react')
  const { useEffect, useMemo, useRef, useState } = React
  const endpoint = '/plugins/dsh-alk-pet/events'
  const configEndpoint = '/plugins/dsh-alk-pet/config'
  const imageEndpoint = '/plugins/dsh-alk-pet/image'
  const colors = { idle: '#79a7ff', thinking: '#ad8cff', working: '#59ccb2', waiting: '#ffd17a', success: '#85d78d', error: '#ff888e' }
  const copy = { idle: '待机中', thinking: '正在思考', working: '正在工作', waiting: '等待你', success: '完成啦', error: '遇到问题' }
  const defaultClips = { idle: 121, thinking: 121, working: 121, waiting: 121, success: 121, error: 59 }
  const taskStatusText = { idle: '待机', running: '运行中', waiting: '等待确认', success: '已完成', error: '失败' }
  const taskPalette = {
    idle: { fill: '#5d6675' },
    running: { fill: '#2f9e8f' },
    waiting: { fill: '#b8842f' },
    success: { fill: '#2f9c6c' },
    error: { fill: '#c65b68' },
  }
  const GLYPH_BOX = 16
  const CHIP = 20

  function clampSize(value) {
    const size = Number(value)
    if (!Number.isFinite(size)) return 120
    return Math.max(72, Math.min(200, Math.round(size)))
  }

  function resolveConfig(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return null
    const clips = snapshot.clips && typeof snapshot.clips === 'object' && Object.keys(snapshot.clips).length
      ? { ...defaultClips, ...snapshot.clips }
      : { ...defaultClips }
    const frameMs = Number.isInteger(snapshot.frameMs) && snapshot.frameMs >= 16 ? snapshot.frameMs : 83
    return {
      enabled: snapshot.enabled !== false,
      native: snapshot.native === true,
      size: clampSize(snapshot.size),
      reducedMotion: snapshot.reducedMotion === true,
      showBubble: snapshot.showBubble !== false,
      clips,
      frameMs,
      assetVersion: typeof snapshot.assetVersion === 'string' ? snapshot.assetVersion : 'dev',
    }
  }

  function configEqual(a, b) {
    if (!a || !b) return false
    return a.enabled === b.enabled
      && a.native === b.native
      && a.size === b.size
      && a.reducedMotion === b.reducedMotion
      && a.showBubble === b.showBubble
      && a.frameMs === b.frameMs
      && a.assetVersion === b.assetVersion
      && JSON.stringify(a.clips) === JSON.stringify(b.clips)
  }

  function selectedSession(snapshot) {
    const list = snapshot?.byId ? snapshot : snapshot?.state?.byId ? snapshot.state : snapshot?.sessions?.byId ? snapshot.sessions : null
    if (!list) return null
    let id = list.current || (list.ids || Object.keys(list.byId)).find((id) => Number(list.byId[id]?.retainedBy?.mainView || 0) > 0) || null
    const seen = new Set()
    while (id && list.byId[id]?.origin === 'subagent' && list.byId[id]?.parentId && !seen.has(id)) {
      seen.add(id)
      id = list.byId[id].parentId
    }
    return id
  }

  function imageUrl(state, frame, assetVersion) {
    return `${imageEndpoint}?state=${encodeURIComponent(state)}&frame=${frame}&v=${encodeURIComponent(assetVersion || 'dev')}`
  }

  function widestBubble(tasks) {
    if (typeof document === 'undefined') return 164
    const context = document.createElement('canvas').getContext('2d')
    if (!context) return 300
    let width = 164
    for (const task of tasks) {
      const title = task.title || '当前任务'
      const detail = task.detail && task.detail !== title ? task.detail : task.label || copy[task.state] || ''
      context.font = '650 12.5px system-ui, sans-serif'
      width = Math.max(width, context.measureText(title).width + 45)
      context.font = '11.5px system-ui, sans-serif'
      width = Math.max(width, context.measureText(detail).width + 34)
    }
    return Math.min(300, Math.ceil(width))
  }

  function bubbleWidth(tasks, selectedTaskId, hovered) {
    if (hovered && selectedTaskId) {
      const selected = tasks.find((task) => task.sessionId === selectedTaskId)
      if (selected) return widestBubble([selected])
    }
    return widestBubble(tasks)
  }

  function clampPosition(position, size, reserve = 110) {
    const viewportWidth = typeof window === 'undefined' ? 1200 : window.innerWidth
    const viewportHeight = typeof window === 'undefined' ? 800 : window.innerHeight
    const right = Math.max(0, Math.min(Math.max(0, viewportWidth - size), Number(position?.right) || 0))
    const bottom = Math.max(0, Math.min(Math.max(0, viewportHeight - size - reserve), Number(position?.bottom) || 0))
    return { right, bottom }
  }

  function glyphSvg(children) {
    return React.createElement('svg', { width: GLYPH_BOX, height: GLYPH_BOX, viewBox: '0 0 18 18', fill: 'none', 'aria-hidden': true }, ...children)
  }

  function statusGlyph(task, status) {
    if (status === 'success') {
      return glyphSvg([React.createElement('path', {
        key: 'check', d: 'M4.6 9.2 7.7 12.2 13.4 5.9', stroke: '#fff', strokeWidth: 2.1,
        strokeLinecap: 'round', strokeLinejoin: 'round',
      })])
    }
    if (status === 'error') {
      return glyphSvg([React.createElement('path', {
        key: 'cross', d: 'M5.2 5.2 12.8 12.8 M12.8 5.2 5.2 12.8', stroke: '#fff', strokeWidth: 2.1,
        strokeLinecap: 'round', strokeLinejoin: 'round',
      })])
    }
    if (status === 'waiting') {
      return glyphSvg([
        React.createElement('path', {
          key: 'question', d: 'M6.4 6.5a2.9 2.9 0 0 1 5.6 1.2c0 1.5-1 2-2 2.9-.6.6-.9 1.1-.9 1.9',
          stroke: '#fff', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round',
        }),
        React.createElement('circle', { key: 'dot', cx: 9.1, cy: 14.4, r: 1.05, fill: '#fff' }),
      ])
    }
    if (status === 'running') {
      return glyphSvg([React.createElement('rect', {
        key: 'square', x: 5.75, y: 5.75, width: 6.5, height: 6.5, rx: 1.1, fill: '#fff',
      })])
    }
    return React.createElement('span', {
      style: { boxSizing: 'border-box', width: 6.5, height: 6.5, borderRadius: '50%', border: '1.5px solid rgba(255,255,255,.72)' },
    })
  }

  function Pet(props) {
    const sessionSnapshot = props.useSessions ? props.useSessions((snapshot) => snapshot) : null
    const selectedId = selectedSession(sessionSnapshot)
    const selectedRow = selectedId ? sessionSnapshot?.byId?.[selectedId] : null
    const sidebarTitle = selectedRow?.displayTitle || selectedRow?.title || ''
    const [config, setConfig] = useState(null)
    const [state, setState] = useState('idle')
    const [animationState, setAnimationState] = useState('idle')
    const [viewed, setViewed] = useState(false)
    const [detail, setDetail] = useState('')
    const [title, setTitle] = useState('当前任务')
    const [eventSessionId, setEventSessionId] = useState(null)
    const [tasks, setTasks] = useState([])
    const [selectedTaskId, setSelectedTaskId] = useState(null)
    const [dotsHovered, setDotsHovered] = useState(false)
    const [frame, setFrame] = useState(1)
    const [patted, setPatted] = useState(false)
    const [position, setPosition] = useState(() => {
      try { return clampPosition(JSON.parse(localStorage.getItem('dsh-alk-pet-position')), 152) } catch { return { right: 24, bottom: 20 } }
    })
    const drag = useRef(null)
    const frameRef = useRef(1)
    const positionRef = useRef(position)
    const preloaded = useRef(new Set())
    const patTimer = useRef(null)
    const hoverSource = useRef(`web-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    const hoveringTasks = useRef(false)
    const selectedRef = useRef(selectedId)
    const lastSidebarSession = useRef(selectedId)
    const completionSelections = useRef(new Map())
    const applySnapshotConfig = (value) => {
      const next = resolveConfig(value)
      if (!next) return
      setConfig((current) => (configEqual(current, next) ? current : next))
    }
    const sendHover = (hovered, keepalive = false) => {
      if (hoveringTasks.current === hovered) return
      hoveringTasks.current = hovered
      fetch('/plugins/dsh-alk-pet/hover', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: hoverSource.current, hovered }), keepalive }).catch(() => {})
    }
    const setPos = (next) => {
      const previous = positionRef.current
      if (previous.right === next.right && previous.bottom === next.bottom) return
      positionRef.current = next
      setPosition(next)
    }
    useEffect(() => {
      if (tasks.length < 2 || config?.native || !config?.enabled) {
        setDotsHovered(false)
        sendHover(false)
      }
    }, [tasks.length, config?.native, config?.enabled])
    useEffect(() => () => { sendHover(false, true); clearTimeout(patTimer.current) }, [])
    useEffect(() => { selectedRef.current = selectedId }, [selectedId])
    useEffect(() => {
      if (!selectedId || !sidebarTitle) return
      fetch('/plugins/dsh-alk-pet/title', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: selectedId, title: sidebarTitle }) }).catch(() => {})
    }, [selectedId, sidebarTitle])
    useEffect(() => {
      let alive = true
      fetch(configEndpoint, { cache: 'no-store' }).then((response) => response.ok ? response.json() : null).then((value) => { if (alive && value) applySnapshotConfig(value) }).catch(() => {})
      const stream = new EventSource(endpoint)
      stream.onmessage = (event) => {
        try {
          const next = JSON.parse(event.data)
          if (!alive || !copy[next.state]) return
          applySnapshotConfig(next)
          const rows = Array.isArray(next.tasks) ? next.tasks : []
          for (const task of rows) {
            if (task.completionId != null && !completionSelections.current.has(task.completionId)) completionSelections.current.set(task.completionId, selectedRef.current)
          }
          setState(next.state)
          setViewed(next.viewed === true)
          setEventSessionId(next.sessionId || null)
          setTitle(next.title || '当前任务')
          setDetail(next.detail || '')
          setTasks(rows)
          setSelectedTaskId(next.selectedTaskId || null)
          if (completionSelections.current.size > 200) {
            const stale = [...completionSelections.current.keys()].slice(0, 50)
            for (const key of stale) completionSelections.current.delete(key)
          }
        } catch {}
      }
      return () => { alive = false; stream.close() }
    }, [])
    useEffect(() => { setAnimationState(state); frameRef.current = 1; setFrame(1) }, [state])
    useEffect(() => {
      frameRef.current = 1
      setFrame(1)
      if (!config || config.reducedMotion) return
      const total = config.clips[animationState] ?? 1
      const timer = setInterval(() => {
        if (frameRef.current < total) {
          frameRef.current += 1
          setFrame(frameRef.current)
        } else if (animationState === 'success' || animationState === 'error') {
          setAnimationState('idle')
        } else {
          frameRef.current = 1
          setFrame(1)
        }
      }, config.frameMs)
      return () => clearInterval(timer)
    }, [animationState, config])
    useEffect(() => {
      if (!config || config.reducedMotion) return
      const total = config.clips[animationState] ?? 1
      const limit = Math.min(total, 24)
      for (let index = 1; index <= limit; index += 1) {
        const key = `${config.assetVersion}/${animationState}/${index}`
        if (preloaded.current.has(key)) continue
        preloaded.current.add(key)
        const image = new Image()
        image.src = imageUrl(animationState, index, config.assetVersion)
      }
    }, [animationState, config])
    const size = config?.size ?? 120
    const petWidth = size
    const stackReserve = 110
    useEffect(() => {
      const onResize = () => setPos(clampPosition(positionRef.current, petWidth, stackReserve))
      window.addEventListener('resize', onResize)
      onResize()
      return () => window.removeEventListener('resize', onResize)
    }, [petWidth, stackReserve])
    useEffect(() => {
      const navigatedToSession = lastSidebarSession.current !== selectedId
      lastSidebarSession.current = selectedId
      if (selectedId) setPos(clampPosition(positionRef.current, petWidth, stackReserve))
      const completed = tasks.find((task) => task.sessionId === selectedId && !task.viewed && task.completionId != null && (task.status === 'success' || task.status === 'error'))
      if (!completed) return
      const markViewed = () => {
        if (document.visibilityState === 'hidden' || !document.hasFocus()) return
        fetch('/plugins/dsh-alk-pet/viewed', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: completed.sessionId, completionId: completed.completionId }) }).catch(() => {})
      }
      window.addEventListener('focus', markViewed)
      document.addEventListener('pointerdown', markViewed, { once: true })
      const selectedAtCompletion = completionSelections.current.get(completed.completionId)
      if (navigatedToSession || (selectedAtCompletion !== undefined && selectedAtCompletion !== selectedId)) markViewed()
      return () => { window.removeEventListener('focus', markViewed); document.removeEventListener('pointerdown', markViewed) }
    }, [tasks, selectedId, petWidth, stackReserve])
    if (!config || !config.enabled || config.native) return null
    const color = colors[state]
    const displayTitle = eventSessionId === selectedId && sidebarTitle ? sidebarTitle : title
    const bubblePosition = position.right < 110 ? { right: 0 } : position.right + size > window.innerWidth - 110 ? { left: 0 } : { left: '50%', transform: 'translateX(-50%)' }
    const showTasks = tasks.length > 1
    const showBubble = config.showBubble && state !== 'idle' && !viewed
    const multiBubbleWidth = showTasks ? widestBubble(tasks) : null
    const hoveredBubbleWidth = showTasks && dotsHovered ? bubbleWidth(tasks, selectedTaskId, true) : null
    const element = (tag, props, ...children) => React.createElement(tag, props, ...children)
    const chooseTask = (sessionId) => {
      if (drag.current || sessionId === selectedTaskId) return
      fetch('/plugins/dsh-alk-pet/select', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId }) }).catch(() => {})
    }
    const start = (event) => {
      drag.current = { x: event.clientX, y: event.clientY, right: position.right, bottom: position.bottom, moved: false }
      event.currentTarget.setPointerCapture(event.pointerId)
    }
    const move = (event) => {
      if (!drag.current) return
      const dx = event.clientX - drag.current.x, dy = event.clientY - drag.current.y
      if (Math.abs(dx) + Math.abs(dy) > 4) drag.current.moved = true
      setPos(clampPosition({ right: drag.current.right - dx, bottom: drag.current.bottom - dy }, petWidth, stackReserve))
    }
    const stop = () => {
      if (!drag.current) return
      if (drag.current.moved) localStorage.setItem('dsh-alk-pet-position', JSON.stringify(positionRef.current))
      else {
        setPatted(true)
        clearTimeout(patTimer.current)
        patTimer.current = setTimeout(() => setPatted(false), 850)
      }
      drag.current = null
    }
    const chipButton = (task) => {
      const status = task.status || 'idle'
      const palette = taskPalette[status] || taskPalette.idle
      const selected = task.sessionId === selectedTaskId
      return element('button', {
        key: task.sessionId,
        type: 'button',
        title: `${task.title || '当前任务'} · ${taskStatusText[status] || '待机'}`,
        'aria-label': `${task.title || '当前任务'}，${taskStatusText[status] || '待机'}`,
        'aria-pressed': selected,
        onPointerDown: (event) => event.stopPropagation(),
        onPointerEnter: () => chooseTask(task.sessionId),
        style: {
          boxSizing: 'border-box', display: 'grid', placeItems: 'center', width: CHIP, height: CHIP, padding: 0,
          flexShrink: 0, borderRadius: '50%', border: `2px solid ${selected ? '#fff' : palette.fill}`,
          background: palette.fill, color: '#fff', cursor: 'pointer', outline: 'none',
        },
      }, statusGlyph(task, status))
    }
    return element('div', {
      style: { position: 'fixed', right: position.right, bottom: position.bottom, width: size, zIndex: 2147483000, userSelect: 'none', touchAction: 'none', cursor: 'grab', fontFamily: 'system-ui, sans-serif' },
      onPointerDown: start,
      onPointerMove: move,
      onPointerUp: stop,
      onPointerCancel: stop,
      'aria-label': `桌面宠物：${copy[state]}`,
    },
    (showTasks || showBubble) && element('div', {
      style: {
        position: 'absolute', bottom: 'calc(100% + 5px)', ...bubblePosition, display: 'flex', flexDirection: 'column',
        alignItems: 'center', gap: 6,
        width: multiBubbleWidth ? `min(${multiBubbleWidth}px, calc(100vw - 24px))` : 'max-content',
        maxWidth: 'min(300px, calc(100vw - 24px))',
      },
    },
    showTasks && element('div', {
      role: 'group', 'aria-label': '切换任务',
      onPointerEnter: () => { setDotsHovered(true); sendHover(true) },
      onPointerLeave: () => { setDotsHovered(false); sendHover(false) },
      style: {
        display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 5, maxWidth: 300,
        background: 'none', border: 'none', boxShadow: 'none', padding: 0,
      },
    }, ...tasks.map(chipButton)),
    showBubble && element('div', {
      role: 'status',
      'aria-live': 'polite',
      style: {
        boxSizing: 'border-box', width: showTasks ? (hoveredBubbleWidth ? `${hoveredBubbleWidth}px` : '100%') : 'max-content',
        minWidth: 164, maxWidth: 'min(300px, calc(100vw - 24px))', padding: '7px 16px 8px', borderRadius: 23,
        background: 'linear-gradient(145deg, rgba(48,55,70,.84), rgba(30,35,47,.88))',
        border: '1px solid rgba(226,237,255,.22)', backdropFilter: 'blur(22px) saturate(130%)',
        WebkitBackdropFilter: 'blur(22px) saturate(130%)', color: 'white',
        boxShadow: '0 12px 30px #0004, inset 0 1px #fff2', fontSize: 11.5, lineHeight: 1.42, textAlign: 'left', overflow: 'hidden',
      },
    },
      element('div', { style: { display: 'flex', alignItems: 'center', gap: 7, fontWeight: 650, fontSize: 12.5, whiteSpace: 'nowrap', lineHeight: '18px' } },
        element('span', { style: { width: 6, height: 6, flexShrink: 0, borderRadius: '50%', background: color, boxShadow: `0 0 7px ${color}` } }),
        element('span', { style: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' } }, patted ? '❤' : displayTitle)),
      element('div', { style: { marginTop: 3, color: 'rgba(235,243,255,.76)', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' } }, detail && detail !== displayTitle ? detail : copy[state]))),
    element('img', {
      src: imageUrl(animationState, config.reducedMotion ? 1 : frame, config.assetVersion),
      alt: '', draggable: false, width: size,
      style: { display: 'block', filter: 'drop-shadow(0 8px 8px #0004)' },
    }))
  }

  function apply(ctx) {
    ctx.slots.inject('shell.overlay', () => {
      try { ctx.slots.register({ name: 'shell.overlay', id: 'dsh-alk-pet-overlay', order: 998 }, Pet) }
      catch (error) { console.error('[dsh-alk-pet] overlay registration failed', error) }
    })
  }
  return {
    name: 'dsh-alk-pet-client',
    inject: ['slots'],
    apply,
    __test: { CHIP, GLYPH_BOX, resolveConfig, selectedSession, clampPosition, imageUrl, widestBubble, bubbleWidth, taskPalette, statusGlyph },
  }
} })
