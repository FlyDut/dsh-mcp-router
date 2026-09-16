/**
 * MCP 管理面板：统计头 + 中间层说明 + 生效时机 + 服务器卡片列表 + 添加 MCP 弹窗。
 *
 * 数据流：`GET /state`（注册表行 × 策略 × 预设隔离后的生效档位）与 `GET /presets`
 * 并行拉取；写操作统一走 `submit()`（携带进程级 x-panel-token）。
 * 样式全部 JS 内联（宿主全局 CSS 可能覆盖注入的 class），颜色走 --dsw-alias-* 主题变量。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { McpRow, McpToolInfo, McpView, PresetListView, PresetOption } from '../shared-types'
import { AddMcpModal } from './add-mcp'
import { describeError, readJson } from './http'
import { EditMcpModal } from './edit-mcp'
import { ImportMcpModal } from './import-mcp'
import { ServerCard } from './server-card'

interface Props {
  /** 由 locale 插槽注入：NS 字典的翻译函数 */
  t: (key: string, params?: Record<string, string | number>) => string
  close?: () => void
}

type ApplyMode = 'immediate' | 'next-session'

/** 策略提交去抖窗口（同窗口内的多次点击合并为一次批量请求 → 一次缓存失效）。 */
const POLICY_BATCH_DEBOUNCE_MS = 400
/** 缓存警示条自动消失时长（ms）。 */
const WARN_AUTO_DISMISS_MS = 12_000

const C = {
  page: { display: 'flex', flexDirection: 'column' as const, gap: '12px', maxWidth: '820px', padding: '4px 2px' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' },
  title: { margin: 0, fontSize: 18, fontWeight: 600, color: 'var(--dsw-alias-label-primary)' },
  meta: { margin: '2px 0 0', fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' },
  refresh: {
    font: 'inherit',
    cursor: 'pointer',
    border: '1px solid var(--dsw-alias-border-l2)',
    background: 'var(--dsw-alias-bg-layer-1)',
    color: 'var(--dsw-alias-label-secondary)',
    borderRadius: 6,
    padding: '5px 12px',
    fontSize: 12,
  },
  stats: { display: 'flex', gap: '8px', flexWrap: 'wrap' as const },
  stat: {
    flex: '1 1 0',
    minWidth: 110,
    background: 'var(--dsw-alias-bg-layer-1)',
    border: '1px solid var(--dsw-alias-border-l2)',
    borderRadius: 8,
    padding: '10px 12px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 2,
  },
  statValue: { fontSize: 18, fontWeight: 600, color: 'var(--dsw-alias-label-primary)' },
  statLabel: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' },
  card: {
    background: 'var(--dsw-alias-bg-layer-1)',
    border: '1px solid var(--dsw-alias-border-l2)',
    borderRadius: 8,
    padding: '10px 12px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 6,
  },
  cardTop: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' as const },
  cardTitle: { margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--dsw-alias-label-primary)' },
  cardDesc: { margin: 0, fontSize: 12, color: 'var(--dsw-alias-label-secondary)', lineHeight: '18px' },
  toggle: (active: boolean): React.CSSProperties => ({
    font: 'inherit',
    cursor: 'pointer',
    border: '1px solid',
    borderRadius: 6,
    padding: '4px 12px',
    fontSize: 12,
    fontWeight: active ? 600 : 400,
    color: active ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-tertiary)',
    background: active ? 'color-mix(in srgb, var(--dsw-alias-state-info-primary, #4a90d9) 16%, transparent)' : 'transparent',
    borderColor: active ? 'var(--dsw-alias-state-info-primary, #4a90d9)' : 'var(--dsw-alias-border-l2)',
  }),
  hint: { margin: 0, fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' },
  error: {
    fontSize: 12,
    color: 'var(--dsw-alias-label-primary)',
    background: 'color-mix(in srgb, var(--dsw-alias-state-error-primary) 14%, transparent)',
    borderLeft: '3px solid var(--dsw-alias-state-error-primary)',
    borderRadius: 6,
    padding: '8px 10px',
  },
  empty: { fontSize: 13, color: 'var(--dsw-alias-label-tertiary)', padding: '16px 0', textAlign: 'center' as const },
  warn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
    fontSize: 12,
    lineHeight: '18px',
    color: 'var(--dsw-alias-label-primary)',
    background: 'color-mix(in srgb, var(--dsw-alias-state-warn-primary) 16%, transparent)',
    borderLeft: '3px solid var(--dsw-alias-state-warn-primary)',
    borderRadius: 6,
    padding: '8px 10px',
  },
  warnSevere: {
    background: 'color-mix(in srgb, var(--dsw-alias-state-error-primary) 24%, transparent)',
    borderLeft: '3px solid var(--dsw-alias-state-error-primary)',
    fontWeight: 600,
  } as React.CSSProperties,
  warnDismiss: {
    font: 'inherit',
    cursor: 'pointer',
    border: 0,
    background: 'transparent',
    color: 'inherit',
    opacity: 0.85,
    padding: '2px 6px',
    borderRadius: 4,
    fontSize: 12,
    whiteSpace: 'nowrap' as const,
  },
}

/** 删除二次确认框样式（轻量内联，不引入额外组件）。 */
const confirmOverlay: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0, 0, 0, 0.45)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
}
const confirmModal: React.CSSProperties = {
  width: 'min(480px, calc(100vw - 48px))',
  background: 'var(--dsw-alias-bg-layer-1)',
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 10,
  padding: '16px 18px',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  boxShadow: '0 8px 30px rgba(0,0,0,0.25)',
}

/** 进程级随机令牌缓存（token 全程不变，复用免重复请求）。 */
let tokenPromise: Promise<string | null> | null = null
function ensureToken(): Promise<string | null> {
  if (!tokenPromise) {
    tokenPromise = fetch('/api/mcp-panel/token')
      .then((r) => r.json() as Promise<{ token?: string }>)
      .then((b) => b?.token ?? null)
      .catch(() => null)
  }
  return tokenPromise
}

function formatK(n: number): string {
  return n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') : String(n)
}

export function McpPanelSection(props: Props): React.ReactElement {
  const { t } = props
  const [view, setView] = useState<McpView | null>(null)
  const [presets, setPresets] = useState<PresetOption[]>([])
  const [presetsError, setPresetsError] = useState<string | undefined>(undefined)
  const [applyMode, setApplyMode] = useState<ApplyMode>('immediate')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [toolBusy, setToolBusy] = useState<Record<string, boolean>>({})
  const [warn, setWarn] = useState<{ text: string; severe: boolean } | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [showImport, setShowImport] = useState(false)
  /** 正在编辑的行（null = 未打开编辑弹窗）。 */
  const [editing, setEditing] = useState<McpRow | null>(null)
  /** 待确认删除的行（null = 未打开确认框）。 */
  const [removing, setRemoving] = useState<McpRow | null>(null)
  const [removingBusy, setRemovingBusy] = useState(false)
  const [defaultExposure, setDefaultExposure] = useState<string>('native')
  const warnTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const seq = useRef(0)

  const showWarn = useCallback((text: string, severe: boolean) => {
    setWarn({ text, severe })
    if (warnTimer.current) clearTimeout(warnTimer.current)
    warnTimer.current = setTimeout(() => setWarn(null), WARN_AUTO_DISMISS_MS)
  }, [])

  const load = useCallback(() => {
    const current = ++seq.current
    setError(null)
    fetch('/api/mcp-panel/state')
      .then((res) => readJson<{ ok: boolean; state?: McpView; error?: string }>(res))
      .then((body) => {
        if (!body.ok || !body.state) throw new Error(body.error ?? 'bad response')
        if (current !== seq.current) return
        setView(body.state)
      })
      .catch((err: unknown) => {
        if (current === seq.current) setError(describeError(err, t))
      })
  }, [t])

  const loadPresets = useCallback(() => {
    fetch('/api/mcp-panel/presets')
      .then((res) => readJson<{ ok: boolean } & Partial<PresetListView>>(res))
      .then((body) => {
        if (!body.ok) return
        setPresets(body.presets ?? [])
        setPresetsError(body.error)
      })
      .catch((err: unknown) => {
        // 预设列表不可得（服务视图受限 / 插件未重启）：降级为「仅显示已配置 id」，不影响其它功能
        setPresetsError(describeError(err, t))
      })
  }, [t])

  useEffect(() => {
    load()
    loadPresets()
    fetch('/api/mcp-panel/config')
      .then((r) => readJson<{ ok: boolean; applyMode?: ApplyMode; defaultExposure?: string }>(r))
      .then((b) => {
        if (b.ok && b.applyMode) setApplyMode(b.applyMode)
        if (b.ok && typeof b.defaultExposure === 'string') setDefaultExposure(b.defaultExposure)
      })
      .catch(() => {
        /* 默认 immediate */
      })
  }, [load, loadPresets])

  useEffect(
    () => () => {
      if (warnTimer.current) clearTimeout(warnTimer.current)
    },
    [],
  )

  // 策略提交：去抖窗口内合并为一次批量请求（服务端单次失效 → 一次前缀变化）
  const pending = useRef<Map<string, { updates: Array<Record<string, unknown>>; keys: string[] }>>(new Map())
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flush = useCallback(async () => {
    if (pendingTimer.current) {
      clearTimeout(pendingTimer.current)
      pendingTimer.current = null
    }
    const merged: Array<Record<string, unknown>> = []
    const keys: string[] = []
    for (const item of pending.current.values()) {
      merged.push(...item.updates)
      keys.push(...item.keys)
    }
    pending.current.clear()
    if (merged.length === 0) return
    setBusy((prev) => {
      const next = { ...prev }
      for (const k of keys) next[k] = true
      return next
    })
    setError(null)
    const token = await ensureToken()
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (token) headers['x-panel-token'] = token
    try {
      const res = await fetch('/api/mcp-panel/policy', {
        method: 'POST',
        headers,
        body: JSON.stringify({ updates: merged }),
      })
      const body = await readJson<{ ok: boolean; error?: string; failed?: number; failures?: Array<{ error: string }> }>(res)
      if (!body.ok) throw new Error(body.error ?? 'policy update failed')
      if (body.failed && body.failed > 0) {
        setError(t('mp.toggleError', { error: body.failures?.[0]?.error ?? `${body.failed} failed` }))
      }
      load()
    } catch (err) {
      setError(t('mp.toggleError', { error: describeError(err, t) }))
      load()
    } finally {
      setBusy((prev) => {
        const next = { ...prev }
        for (const k of keys) next[k] = false
        return next
      })
    }
  }, [load, t])

  const submit = useCallback(
    (updates: Array<Record<string, unknown>>, key: string) => {
      // 生效时机感知：immediate 会改变本会话工具集 → 提示缓存代价；next-session 只记意图
      if (applyMode === 'immediate') showWarn(t('mp.cacheWarn'), false)
      else showWarn(t('mp.applyDeferredHint'), false)
      const serverName = typeof updates[0]?.serverName === 'string' ? String(updates[0].serverName) : undefined
      const row = serverName !== undefined ? view?.mcp.find((r) => r.serverName === serverName) : undefined
      const existing = pending.current.get(key)
      if (existing) {
        existing.updates = updates
      } else {
        pending.current.set(key, { updates, keys: [key] })
      }
      // 大包（工具多 / token 高）额外加重提示
      if (row && (row.tools > 50 || row.tokens > 10_000)) showWarn(t('mp.cacheWarn'), true)
      if (pendingTimer.current) clearTimeout(pendingTimer.current)
      pendingTimer.current = setTimeout(() => void flush(), POLICY_BATCH_DEBOUNCE_MS)
    },
    [applyMode, flush, showWarn, t, view],
  )

  useEffect(() => () => void flush(), [flush])

  const toggleTool = useCallback(
    async (row: McpRow, tool: McpToolInfo) => {
      const key = `${row.entryId}:${tool.name}`
      setToolBusy((prev) => ({ ...prev, [key]: true }))
      setError(null)
      const token = await ensureToken()
      const headers: Record<string, string> = { 'content-type': 'application/json' }
      if (token) headers['x-panel-token'] = token
      try {
        const res = await fetch('/api/mcp-panel/mcp/toolToggle', {
          method: 'POST',
          headers,
          body: JSON.stringify({ serverName: row.serverName, workspace: row.workspace, toolName: tool.name, disabled: !tool.disabled }),
        })
        const body = await readJson<{ ok: boolean; error?: string }>(res)
        if (!body.ok) throw new Error(body.error ?? 'tool toggle failed')
        load()
      } catch (err) {
        setError(t('mp.toggleError', { error: describeError(err, t) }))
        load()
      } finally {
        setToolBusy((prev) => ({ ...prev, [key]: false }))
      }
    },
    [load, t],
  )

  const switchMode = useCallback(
    async (mode: ApplyMode) => {
      if (mode === applyMode) return
      setBusy((prev) => ({ ...prev, applyMode: true }))
      const token = await ensureToken()
      const headers: Record<string, string> = { 'content-type': 'application/json' }
      if (token) headers['x-panel-token'] = token
      try {
        const res = await fetch('/api/mcp-panel/config', { method: 'POST', headers, body: JSON.stringify({ applyMode: mode }) })
        const body = await readJson<{ ok: boolean; applyMode?: ApplyMode; error?: string }>(res)
        if (!body.ok) throw new Error(body.error ?? 'config update failed')
        setApplyMode(body.applyMode ?? mode)
        load()
      } catch (err) {
        setError(t('mp.toggleError', { error: describeError(err, t) }))
      } finally {
        setBusy((prev) => ({ ...prev, applyMode: false }))
      }
    },
    [applyMode, load, t],
  )

  const commitPending = useCallback(async () => {
    showWarn(t('mp.cacheWarn'), true)
    setBusy((prev) => ({ ...prev, commit: true }))
    const token = await ensureToken()
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (token) headers['x-panel-token'] = token
    try {
      const res = await fetch('/api/mcp-panel/policy/commit', { method: 'POST', headers })
      const body = await readJson<{ ok: boolean; applied?: number; error?: string }>(res)
      if (!body.ok) throw new Error(body.error ?? 'commit failed')
      load()
      showWarn(t('mp.appliedPending', { n: body.applied ?? 0 }), false)
    } catch (err) {
      setError(t('mp.toggleError', { error: describeError(err, t) }))
    } finally {
      setBusy((prev) => ({ ...prev, commit: false }))
    }
  }, [load, showWarn, t])

  const confirmRemove = useCallback(async () => {
    const row = removing
    if (!row) return
    setRemovingBusy(true)
    setError(null)
    try {
      const token = await ensureToken()
      const headers: Record<string, string> = { 'content-type': 'application/json' }
      if (token) headers['x-panel-token'] = token
      const res = await fetch('/api/mcp-panel/mcp/remove', {
        method: 'POST',
        headers,
        body: JSON.stringify({ serverName: row.serverName, workspace: row.workspace }),
      })
      const body = await readJson<{ ok: boolean; error?: string; file?: string }>(res)
      if (!body.ok) throw new Error(body.error ?? 'remove failed')
      setRemoving(null)
      load()
    } catch (err) {
      setError(t('mp.removeError', { error: describeError(err, t) }))
    } finally {
      setRemovingBusy(false)
    }
  }, [ensureToken, load, removing, t])

  const hasPending = Boolean(view?.mcp.some((row) => row.pending))

  return (
    <div style={C.page}>
      <div style={C.header}>
        <div>
          <h2 style={C.title}>{t('mp.nav')}</h2>
          <p style={C.meta}>
            {view ? `${t('mp.preset')}: ${view.preset ?? '—'} · ${t('mp.session')}: ${view.sessionId ?? '—'}` : ''}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {/* 按钮文字保持简短，完整说明放在 title（悬停可见） */}
          <button type="button" style={C.refresh} title={t('mp.addBtnHint')} onClick={() => setShowAdd(true)}>
            {t('mp.addBtn')}
          </button>
          <button type="button" style={C.refresh} title={t('mp.importBtnHint')} onClick={() => setShowImport(true)}>
            {t('mp.importBtn')}
          </button>
          <button
            type="button"
            style={C.refresh}
            title={t('mp.refreshHint')}
            onClick={() => {
              void flush()
              load()
              loadPresets()
            }}
          >
            {t('mp.refresh')}
          </button>
        </div>
      </div>

      {error && <div style={C.error}>{error}</div>}

      {warn && (
        <div style={{ ...C.warn, ...(warn.severe ? C.warnSevere : {}) }} role="status">
          <span>{warn.text}</span>
          <button
            type="button"
            style={C.warnDismiss}
            onClick={() => {
              if (warnTimer.current) clearTimeout(warnTimer.current)
              setWarn(null)
            }}
          >
            {t('mp.warnDismiss')}
          </button>
        </div>
      )}

      {!view && !error && <div style={C.empty}>{t('mp.loading')}</div>}

      {view && (
        <>
          <div style={C.stats}>
            <div style={C.stat}>
              <span style={C.statValue}>{view.mcpTotal}</span>
              <span style={C.statLabel}>{t('mp.statServers')}</span>
            </div>
            <div style={C.stat}>
              <span style={C.statValue}>{view.mcpNative}</span>
              <span style={C.statLabel}>{t('mp.statNative')}</span>
            </div>
            <div style={C.stat}>
              <span style={C.statValue}>{view.mcpNameOnly}</span>
              <span style={C.statLabel}>{t('mp.statNameOnly')}</span>
            </div>
            <div style={C.stat}>
              <span style={C.statValue}>{view.mcpHidden + view.mcpDisabled}</span>
              <span style={C.statLabel}>{t('mp.statHidden')}</span>
            </div>
            <div style={C.stat}>
              <span style={C.statValue}>{view.mcpToolsTotal}</span>
              <span style={C.statLabel}>{t('mp.statTools', { n: view.mcpToolsTotal })}</span>
            </div>
            <div style={C.stat}>
              <span style={C.statValue}>~{formatK(view.mcpTokensTotal)}k</span>
              <span style={C.statLabel}>{t('mp.statTokens')}</span>
            </div>
          </div>

          <div style={C.card}>
            <div style={C.cardTop}>
              <h3 style={C.cardTitle}>{t('mp.middleLayerTitle')}</h3>
            </div>
            <p style={C.cardDesc}>{t('mp.middleLayerDesc')}</p>
          </div>

          <div style={C.card}>
            <div style={C.cardTop}>
              <h3 style={C.cardTitle}>{t('mp.applyTiming')}</h3>
              <div style={{ display: 'flex', gap: 6 }}>
                <button type="button" style={C.toggle(applyMode === 'immediate')} onClick={() => void switchMode('immediate')}>
                  {t('mp.applyImmediate')}
                </button>
                <button type="button" style={C.toggle(applyMode === 'next-session')} onClick={() => void switchMode('next-session')}>
                  {t('mp.applyNextSession')}
                </button>
              </div>
            </div>
            <p style={{ ...C.cardDesc, whiteSpace: 'pre-line' }}>{t('mp.applyModeDesc')}</p>
            {applyMode === 'next-session' && hasPending && (
              <button
                type="button"
                style={{ ...C.toggle(true), alignSelf: 'flex-start', marginTop: 2 }}
                disabled={Boolean(busy.commit)}
                onClick={() => void commitPending()}
              >
                {busy.commit ? t('mp.working') : t('mp.applyPendingBtn')}
              </button>
            )}
          </div>

          {view.errors.length > 0 && <div style={C.error}>{view.errors.join(' · ')}</div>}
          {view.mcp.length === 0 && <div style={C.empty}>{t('mp.empty')}</div>}
          {view.mcp.map((row) => (
            <ServerCard
              key={row.entryId}
              row={row}
              t={t}
              presets={presets}
              presetsError={presetsError}
              busy={Boolean(busy[`exposure:${row.serverName}`] || busy[`presets:${row.serverName}`])}
              toolBusy={toolBusy}
              submit={submit}
              toggleTool={(r, tool) => void toggleTool(r, tool)}
              onEdit={(r) => setEditing(r)}
              onRemove={(r) => setRemoving(r)}
            />
          ))}
        </>
      )}

      {showAdd && (
        <AddMcpModal
          t={t}
          workspace={view?.activeWorkspace ?? view?.cwd ?? null}
          onClose={() => setShowAdd(false)}
          onAdded={load}
        />
      )}

      {showImport && (
        <ImportMcpModal
          t={t}
          workspace={view?.activeWorkspace ?? view?.cwd ?? null}
          defaultExposure={defaultExposure}
          onClose={() => setShowImport(false)}
          onImported={load}
        />
      )}

      {editing && (
        <EditMcpModal
          t={t}
          row={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            load()
          }}
        />
      )}

      {removing && (
        <div style={confirmOverlay} role="dialog" aria-modal="true" onClick={() => (removingBusy ? undefined : setRemoving(null))}>
          <div style={confirmModal} onClick={(event) => event.stopPropagation()}>
            <h3 style={C.cardTitle}>{t('mp.removeTitle', { server: removing.serverName })}</h3>
            <p style={C.cardDesc}>{t('mp.removeConfirm')}</p>
            <p style={C.hint}>{removing.source === 'project' ? t('mp.editTargetProject') : t('mp.editTargetPatch')}</p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
              <button type="button" style={C.refresh} disabled={removingBusy} onClick={() => setRemoving(null)}>
                {t('mp.editCancel')}
              </button>
              <button
                type="button"
                style={{ ...C.refresh, color: 'var(--dsw-alias-state-error-primary)' }}
                disabled={removingBusy}
                onClick={() => void confirmRemove()}
              >
                {removingBusy ? t('mp.working') : t('mp.removeDo')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
