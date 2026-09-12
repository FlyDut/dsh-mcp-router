/**
 * 从其它 Agent 导入 MCP 弹窗。
 *
 * 流程：自动扫描本机已知来源（opencode / zcode / Claude Code / Cursor / Gemini CLI / 项目级
 * .mcp.json 等，可追加自定义路径）→ 勾选要导入的服务器 → 选目标（全局 / 项目）与导入后的
 * 档位 → 复用现有 `/mcp/add` 落盘并由后端挂载 → 再对新导入项批量 `/policy` 设档位。
 *
 * 扫描是**只读**的：面板不会修改任何源文件，也不会同步源文件后续变化（一次性快照）。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { describeError, readJson } from './http'

interface Props {
  t: (key: string, params?: Record<string, string | number>) => string
  workspace: string | null
  defaultExposure: string
  onClose: () => void
  onImported: () => void
}

interface ScannedServer {
  name: string
  transport: string
  summary: string
  enabled: boolean
  notes: string[]
  config: Record<string, unknown>
  existing: boolean
}

interface ScanSource {
  id: string
  label: string
  file: string
  exists: boolean
  supported?: boolean
  skipped?: string
  note?: string
  format?: string | null
  errors?: string[]
  warnings?: string[]
  servers?: ScannedServer[]
}

type Target = 'global' | 'project'
type Exposure = 'native' | 'name-only' | 'hidden' | 'off'

const EXPOSURES: Exposure[] = ['native', 'name-only', 'hidden', 'off']

const C = {
  overlay: {
    position: 'fixed' as const,
    inset: 0,
    background: 'rgba(0, 0, 0, 0.45)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  modal: {
    width: 'min(760px, calc(100vw - 48px))',
    maxHeight: 'calc(100vh - 80px)',
    overflowY: 'auto' as const,
    background: 'var(--dsw-alias-bg-layer-1)',
    border: '1px solid var(--dsw-alias-border-l2)',
    borderRadius: 10,
    padding: '16px 18px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 10,
    boxShadow: '0 8px 30px rgba(0,0,0,0.25)',
  },
  title: { margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--dsw-alias-label-primary)' },
  hint: { margin: 0, fontSize: 11, color: 'var(--dsw-alias-label-tertiary)', lineHeight: '16px' },
  group: {
    border: '1px solid var(--dsw-alias-border-l2)',
    borderRadius: 8,
    padding: '8px 10px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
  },
  groupHead: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', fontWeight: 600 },
  item: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 },
  itemName: { color: 'var(--dsw-alias-label-primary)', fontWeight: 500, flex: '0 0 auto' },
  itemDesc: { color: 'var(--dsw-alias-label-tertiary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  badge: (color: string, bg: string): React.CSSProperties => ({
    fontSize: 11,
    lineHeight: '16px',
    padding: '0 6px',
    borderRadius: 999,
    color,
    background: bg,
    whiteSpace: 'nowrap' as const,
  }),
  input: {
    font: 'inherit',
    fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
    fontSize: 12,
    lineHeight: '18px',
    background: 'var(--dsw-alias-bg-layer-2)',
    color: 'var(--dsw-alias-label-primary)',
    border: '1px solid var(--dsw-alias-border-l2)',
    borderRadius: 6,
    padding: '6px 8px',
    flex: 1,
  },
  row: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' as const },
  label: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' },
  tab: (active: boolean): React.CSSProperties => ({
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
  action: {
    font: 'inherit',
    cursor: 'pointer',
    border: '1px solid var(--dsw-alias-border-l2)',
    background: 'var(--dsw-alias-bg-layer-1)',
    color: 'var(--dsw-alias-label-secondary)',
    borderRadius: 6,
    padding: '5px 14px',
    fontSize: 12,
  },
  primary: {
    font: 'inherit',
    cursor: 'pointer',
    border: 0,
    borderRadius: 6,
    padding: '5px 16px',
    fontSize: 12,
    color: 'var(--dsw-alias-label-inverse, #fff)',
    background: 'var(--dsw-alias-state-success-primary)',
  },
  disabled: { opacity: 0.55, cursor: 'progress' } as React.CSSProperties,
  error: {
    fontSize: 12,
    color: 'var(--dsw-alias-label-primary)',
    background: 'color-mix(in srgb, var(--dsw-alias-state-error-primary) 14%, transparent)',
    borderLeft: '3px solid var(--dsw-alias-state-error-primary)',
    borderRadius: 6,
    padding: '8px 10px',
  },
  success: {
    fontSize: 12,
    color: 'var(--dsw-alias-label-primary)',
    background: 'color-mix(in srgb, var(--dsw-alias-state-success-primary) 14%, transparent)',
    borderLeft: '3px solid var(--dsw-alias-state-success-primary)',
    borderRadius: 6,
    padding: '8px 10px',
  },
  footer: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 },
}

export function ImportMcpModal(props: Props): React.ReactElement {
  const { t, workspace, defaultExposure, onClose, onImported } = props
  const [sources, setSources] = useState<ScanSource[]>([])
  const [selected, setSelected] = useState<Record<string, ScannedServer>>({})
  const [customPath, setCustomPath] = useState('')
  const [target, setTarget] = useState<Target>('global')
  const [exposure, setExposure] = useState<Exposure>((defaultExposure as Exposure) ?? 'native')
  const [scanning, setScanning] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)

  const tokenPromise = useRef<Promise<string | null> | null>(null)
  const ensureToken = useCallback(() => {
    if (!tokenPromise.current) {
      tokenPromise.current = fetch('/api/mcp-panel/token')
        .then((r) => r.json() as Promise<{ token?: string }>)
        .then((b) => b?.token ?? null)
        .catch(() => null)
    }
    return tokenPromise.current
  }, [])

  const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    const token = await ensureToken()
    if (token) headers['x-panel-token'] = token
    return headers
  }, [ensureToken])

  const scan = useCallback(
    async (extraPaths: string[] = []) => {
      setScanning(true)
      setError(null)
      try {
        const res = await fetch('/api/mcp-panel/mcp/scan', {
          method: 'POST',
          headers: await authHeaders(),
          body: JSON.stringify({ paths: extraPaths }),
        })
        const body = await readJson<{ ok: boolean; error?: string; sources?: ScanSource[] }>(res)
        if (!body.ok) throw new Error(body.error ?? 'scan failed')
        setSources(body.sources ?? [])
      } catch (err) {
        setError(describeError(err, t))
      } finally {
        setScanning(false)
      }
    },
    [authHeaders, t],
  )

  useEffect(() => {
    void scan()
  }, [scan])

  const toggle = useCallback((server: ScannedServer) => {
    setSelected((prev) => {
      const next = { ...prev }
      if (next[server.name]) delete next[server.name]
      else next[server.name] = server
      return next
    })
  }, [])

  const chosen = Object.values(selected)

  const doImport = useCallback(async () => {
    if (chosen.length === 0) return
    setImporting(true)
    setError(null)
    setResult(null)
    try {
      const mcpServers: Record<string, unknown> = {}
      for (const server of chosen) mcpServers[server.name] = server.config
      const res = await fetch('/api/mcp-panel/mcp/add', {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ json: JSON.stringify({ mcpServers }), target }),
      })
      const body = await readJson<{
        ok: boolean
        error?: string
        added?: number
        skipped?: string[]
        names?: string[]
      }>(res)
      if (!body.ok) throw new Error(body.error ?? 'import failed')
      const names = body.names ?? chosen.map((server) => server.name)
      // 导入后统一设档位（原生注入以外的档位才有必要写策略）
      if (exposure !== 'native' && names.length > 0) {
        await fetch('/api/mcp-panel/policy', {
          method: 'POST',
          headers: await authHeaders(),
          body: JSON.stringify({ updates: names.map((name) => ({ serverName: name, exposure })) }),
        })
      }
      setResult(
        t('mp.importDone', {
          n: body.added ?? chosen.length,
          skipped: body.skipped && body.skipped.length > 0 ? t('mp.importSkipped', { names: body.skipped.join(', ') }) : '',
        }),
      )
      setSelected({})
      onImported()
      await scan()
    } catch (err) {
      setError(t('mp.importError', { error: describeError(err, t) }))
    } finally {
      setImporting(false)
    }
  }, [authHeaders, chosen, exposure, onImported, scan, t, target])

  return (
    <div style={C.overlay} role="dialog" aria-modal="true" onClick={onClose}>
      <div style={C.modal} onClick={(event) => event.stopPropagation()}>
        <h3 style={C.title}>{t('mp.importTitle')}</h3>
        <p style={C.hint}>{t('mp.importHint')}</p>

        <div style={C.row}>
          <input
            style={C.input}
            value={customPath}
            onChange={(event) => setCustomPath(event.target.value)}
            placeholder={t('mp.importCustomPathPh')}
            spellCheck={false}
          />
          <button
            type="button"
            style={C.action}
            disabled={scanning || customPath.trim().length === 0}
            onClick={() => void scan([customPath.trim()])}
          >
            {scanning ? t('mp.working') : t('mp.importAddPath')}
          </button>
          <button type="button" style={C.action} disabled={scanning} onClick={() => void scan()}>
            {t('mp.importRescan')}
          </button>
        </div>

        {error && <div style={C.error}>{error}</div>}
        {result && <div style={C.success}>{result}</div>}

        {sources.map((source) => (
          <div key={source.id} style={C.group}>
            <span style={C.groupHead}>
              {source.label} · {source.file}
            </span>
            {!source.exists && <span style={C.hint}>{t('mp.importMissing')}</span>}
            {source.exists && source.skipped && <span style={C.hint}>{source.skipped}</span>}
            {source.exists && !source.skipped && source.errors && source.errors.length > 0 && (
              <span style={C.hint}>{source.errors.join('；')}</span>
            )}
            {source.exists && !source.skipped && source.servers && source.servers.length === 0 && !(source.errors ?? []).length && (
              <span style={C.hint}>{t('mp.importNoServers')}</span>
            )}
            {(source.servers ?? []).map((server) => (
              <label key={`${source.id}:${server.name}`} style={C.item}>
                <input type="checkbox" checked={Boolean(selected[server.name])} onChange={() => toggle(server)} />
                <span style={C.itemName}>{server.name}</span>
                <span style={C.badge(
                  server.transport === 'stdio' ? 'var(--dsw-alias-state-info-primary, #4a90d9)' : 'var(--dsw-alias-state-warn-primary)',
                  server.transport === 'stdio' ? 'var(--dsw-alias-state-info-tertiary, rgba(74,144,217,0.15))' : 'var(--dsw-alias-state-warn-tertiary)',
                )}>
                  {server.transport}
                </span>
                {!server.enabled && (
                  <span style={C.badge('var(--dsw-alias-label-tertiary)', 'var(--dsw-alias-fill-l2)')}>{t('mp.importDisabled')}</span>
                )}
                {server.existing && (
                  <span style={C.badge('var(--dsw-alias-state-warn-primary)', 'var(--dsw-alias-state-warn-tertiary)')}>{t('mp.importExisting')}</span>
                )}
                <span style={C.itemDesc} title={server.summary}>
                  {server.summary}
                </span>
              </label>
            ))}
          </div>
        ))}

        <div style={C.row}>
          <span style={C.label}>{t('mp.importTarget')}</span>
          <button type="button" style={C.tab(target === 'global')} onClick={() => setTarget('global')}>
            {t('mp.addMcpTargetGlobal')}
          </button>
          <button
            type="button"
            style={{ ...C.tab(target === 'project'), ...(workspace ? {} : { opacity: 0.5, cursor: 'not-allowed' }) }}
            disabled={!workspace}
            onClick={() => setTarget('project')}
          >
            {t('mp.addMcpTargetProject')}
          </button>
          {target === 'project' && <span style={C.hint}>{workspace ?? t('mp.addMcpNoWorkspace')}</span>}
        </div>

        <div style={C.row}>
          <span style={C.label}>{t('mp.importExposure')}</span>
          {EXPOSURES.map((value) => (
            <button key={value} type="button" style={C.tab(exposure === value)} onClick={() => setExposure(value)}>
              {t(`mp.exposure${value === 'name-only' ? 'NameOnly' : value === 'native' ? 'Native' : value === 'hidden' ? 'Hidden' : 'Off'}`)}
            </button>
          ))}
        </div>

        <div style={C.footer}>
          <span style={{ ...C.hint, flex: 1, alignSelf: 'center' }}>{t('mp.importSelected', { n: chosen.length })}</span>
          <button type="button" style={C.action} disabled={importing} onClick={onClose}>
            {t('mp.editCancel')}
          </button>
          <button
            type="button"
            style={{ ...C.primary, ...(importing || chosen.length === 0 ? C.disabled : {}) }}
            disabled={importing || chosen.length === 0}
            onClick={() => void doImport()}
          >
            {importing ? t('mp.working') : t('mp.importConfirm')}
          </button>
        </div>
      </div>
    </div>
  )
}
