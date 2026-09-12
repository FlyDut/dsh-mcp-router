/**
 * 编辑 MCP 弹窗：读取该行的可写目标与当前配置，改完写回源文件并同步运行时。
 *
 * - 可写行：全局行（profile patch）/ 项目行（`.dsh/mcps/mcp.json`）
 * - 只读行：预设组合行（`agent.cordis.yml`）——本组件不会打开（卡片按钮已禁用）
 * - 含 `!!js` 动态表达式的字段：以只读形式列出，保存时原样保留、绝不固化成明文
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { McpRow } from '../shared-types'
import { describeError, readJson } from './http'

interface Props {
  t: (key: string, params?: Record<string, string | number>) => string
  row: McpRow
  onClose: () => void
  onSaved: () => void
}

interface DetailConfig {
  serverName?: string
  transport?: string
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  url?: string
  headers?: Record<string, string>
  toolCallTimeoutMs?: number
}

interface Detail {
  serverName: string
  target: { kind: 'patch' | 'project' | 'readonly'; file: string }
  config: DetailConfig
  keys: Array<{ name: string; dynamic: boolean }>
  readonly?: string
}

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
    width: 'min(680px, calc(100vw - 48px))',
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
  field: { display: 'flex', flexDirection: 'column' as const, gap: 3 },
  label: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' },
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
  },
  row: { display: 'flex', gap: 8, alignItems: 'center' },
  tab: (active: boolean): React.CSSProperties => ({
    font: 'inherit',
    cursor: 'pointer',
    border: '1px solid',
    borderRadius: 6,
    padding: '4px 14px',
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
  dynamic: {
    fontSize: 11,
    color: 'var(--dsw-alias-label-tertiary)',
    background: 'var(--dsw-alias-bg-layer-2)',
    border: '1px dashed var(--dsw-alias-border-l2)',
    borderRadius: 6,
    padding: '6px 8px',
    fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
    whiteSpace: 'pre-wrap' as const,
  },
  footer: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 },
}

/** 多行文本 → 字符串数组（去空行）。 */
function toLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

/** 多行 `KEY=VALUE` → 字典。 */
function toDict(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of toLines(text)) {
    const at = line.indexOf('=')
    if (at <= 0) continue
    out[line.slice(0, at).trim()] = line.slice(at + 1).trim()
  }
  return out
}

function fromDict(dict: Record<string, string> | undefined): string {
  if (!dict) return ''
  return Object.entries(dict)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
}

export function EditMcpModal(props: Props): React.ReactElement {
  const { t, row, onClose, onSaved } = props
  const [detail, setDetail] = useState<Detail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // 表单字段
  const [serverName, setServerName] = useState(row.serverName)
  const [transport, setTransport] = useState<'stdio' | 'streamable-http'>('stdio')
  const [command, setCommand] = useState('')
  const [argsText, setArgsText] = useState('')
  const [cwd, setCwd] = useState('')
  const [envText, setEnvText] = useState('')
  const [url, setUrl] = useState('')
  const [headersText, setHeadersText] = useState('')
  const [timeoutText, setTimeoutText] = useState('')

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

  useEffect(() => {
    const query = new URLSearchParams({ serverName: row.serverName })
    if (row.workspace) query.set('workspace', row.workspace)
    fetch(`/api/mcp-panel/mcp/detail?${query.toString()}`)
      .then((res) => readJson<{ ok: boolean; error?: string } & Partial<Detail>>(res))
      .then((body) => {
        if (!body.ok) throw new Error(body.error ?? 'detail failed')
        const data = body as Detail
        setDetail(data)
        const config = data.config ?? {}
        setServerName(config.serverName ?? row.serverName)
        setTransport(config.transport === 'streamable-http' ? 'streamable-http' : 'stdio')
        setCommand(config.command ?? '')
        setArgsText((config.args ?? []).join('\n'))
        setCwd(config.cwd ?? '')
        setEnvText(fromDict(config.env))
        setUrl(config.url ?? '')
        setHeadersText(fromDict(config.headers))
        setTimeoutText(config.toolCallTimeoutMs !== undefined ? String(config.toolCallTimeoutMs) : '')
      })
      .catch((err: unknown) => setError(describeError(err, t)))
  }, [row.serverName, row.workspace, t])

  const dynamicKeys = new Set((detail?.keys ?? []).filter((key) => key.dynamic).map((key) => key.name))
  const envDynamic = dynamicKeys.has('env')
  const headersDynamic = dynamicKeys.has('headers')

  const save = useCallback(async () => {
    setBusy(true)
    setError(null)
    const timeout = Number(timeoutText)
    const patch: Record<string, unknown> = { serverName: serverName.trim(), transport }
    if (transport === 'stdio') {
      patch.command = command.trim()
      patch.args = toLines(argsText)
      if (!envDynamic) patch.env = toDict(envText)
      patch.cwd = cwd.trim()
    } else {
      patch.url = url.trim()
      if (!headersDynamic) patch.headers = toDict(headersText)
    }
    if (timeoutText.trim().length > 0 && Number.isFinite(timeout) && timeout > 0) patch.toolCallTimeoutMs = timeout
    try {
      const token = await ensureToken()
      const headers: Record<string, string> = { 'content-type': 'application/json' }
      if (token) headers['x-panel-token'] = token
      const res = await fetch('/api/mcp-panel/mcp/update', {
        method: 'POST',
        headers,
        body: JSON.stringify({ serverName: row.serverName, workspace: row.workspace, patch }),
      })
      const body = await readJson<{ ok: boolean; error?: string }>(res)
      if (!body.ok) throw new Error(body.error ?? 'update failed')
      onSaved()
      onClose()
    } catch (err) {
      setError(t('mp.editError', { error: describeError(err, t) }))
    } finally {
      setBusy(false)
    }
  }, [
    argsText,
    command,
    cwd,
    ensureToken,
    envDynamic,
    envText,
    headersDynamic,
    headersText,
    onClose,
    onSaved,
    row.serverName,
    row.workspace,
    serverName,
    t,
    timeoutText,
    transport,
    url,
  ])

  const targetLabel = detail?.target.kind === 'project' ? t('mp.editTargetProject') : t('mp.editTargetPatch')

  return (
    <div style={C.overlay} role="dialog" aria-modal="true" onClick={onClose}>
      <div style={C.modal} onClick={(event) => event.stopPropagation()}>
        <h3 style={C.title}>{t('mp.editTitle', { server: row.serverName })}</h3>
        {detail && (
          <p style={C.hint}>
            {targetLabel}: {detail.target.file}
          </p>
        )}
        {dynamicKeys.size > 0 && (
          <div style={C.dynamic}>
            {t('mp.editDynamicNote', { keys: [...dynamicKeys].join(', ') })}
          </div>
        )}
        {error && <div style={C.error}>{error}</div>}

        <div style={C.field}>
          <span style={C.label}>{t('mp.editServerName')}</span>
          <input style={C.input} value={serverName} onChange={(event) => setServerName(event.target.value)} spellCheck={false} />
          <span style={C.hint}>{t('mp.editServerNameHint')}</span>
        </div>

        <div style={C.row}>
          <span style={C.label}>{t('mp.editTransport')}</span>
          <button type="button" style={C.tab(transport === 'stdio')} onClick={() => setTransport('stdio')}>
            stdio
          </button>
          <button type="button" style={C.tab(transport === 'streamable-http')} onClick={() => setTransport('streamable-http')}>
            streamable-http
          </button>
        </div>

        {transport === 'stdio' ? (
          <>
            <div style={C.field}>
              <span style={C.label}>{t('mp.editCommand')}</span>
              <input style={C.input} value={command} onChange={(event) => setCommand(event.target.value)} spellCheck={false} />
            </div>
            <div style={C.field}>
              <span style={C.label}>{t('mp.editArgs')}</span>
              <textarea
                style={{ ...C.input, minHeight: 60, resize: 'vertical' as const }}
                value={argsText}
                onChange={(event) => setArgsText(event.target.value)}
                spellCheck={false}
              />
              <span style={C.hint}>{t('mp.editOnePerLine')}</span>
            </div>
            <div style={C.field}>
              <span style={C.label}>{t('mp.editEnv')}</span>
              {envDynamic ? (
                <div style={C.dynamic}>{t('mp.editDynamicFieldKept', { field: 'env' })}</div>
              ) : (
                <textarea
                  style={{ ...C.input, minHeight: 60, resize: 'vertical' as const }}
                  value={envText}
                  onChange={(event) => setEnvText(event.target.value)}
                  placeholder="KEY=VALUE"
                  spellCheck={false}
                />
              )}
            </div>
            <div style={C.field}>
              <span style={C.label}>{t('mp.editCwd')}</span>
              <input style={C.input} value={cwd} onChange={(event) => setCwd(event.target.value)} spellCheck={false} />
            </div>
          </>
        ) : (
          <>
            <div style={C.field}>
              <span style={C.label}>{t('mp.editUrl')}</span>
              <input style={C.input} value={url} onChange={(event) => setUrl(event.target.value)} spellCheck={false} />
            </div>
            <div style={C.field}>
              <span style={C.label}>{t('mp.editHeaders')}</span>
              {headersDynamic ? (
                <div style={C.dynamic}>{t('mp.editDynamicFieldKept', { field: 'headers' })}</div>
              ) : (
                <textarea
                  style={{ ...C.input, minHeight: 60, resize: 'vertical' as const }}
                  value={headersText}
                  onChange={(event) => setHeadersText(event.target.value)}
                  placeholder="Authorization=Bearer …"
                  spellCheck={false}
                />
              )}
            </div>
          </>
        )}

        <div style={C.field}>
          <span style={C.label}>{t('mp.editTimeout')}</span>
          <input style={C.input} value={timeoutText} onChange={(event) => setTimeoutText(event.target.value)} placeholder="60000" spellCheck={false} />
        </div>

        <div style={C.footer}>
          <button type="button" style={C.action} disabled={busy} onClick={onClose}>
            {t('mp.editCancel')}
          </button>
          <button type="button" style={{ ...C.primary, ...(busy ? C.disabled : {}) }} disabled={busy || !detail} onClick={() => void save()}>
            {busy ? t('mp.working') : t('mp.editSave')}
          </button>
        </div>
      </div>
    </div>
  )
}
