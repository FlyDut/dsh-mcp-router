/**
 * MCP 服务器卡片：档位选择器（四档）+ 预设关联 + 工具级禁用。
 *
 * 交互契约：
 * - 档位是**唯一**的服务器状态控件（同时决定进程期望状态与上下文注入量）；
 * - 预设关联是纯运行时隔离（不改变物理运行状态），三模式 + 预设复选列表；
 * - 工具级禁用在 server 级档位之上按工具精确控制。
 * 所有写操作经父级传入的 `submit`（统一携带 x-panel-token 并处理错误）。
 */
import React, { useState } from 'react'
import type { Exposure, McpRow, McpToolInfo, PresetOption, PresetScope } from '../shared-types'

export interface ServerCardProps {
  row: McpRow
  t: (key: string, params?: Record<string, string | number>) => string
  /** 可关联的预设列表（不可得时为空数组 + presetsError）。 */
  presets: PresetOption[]
  presetsError?: string
  busy: boolean
  toolBusy: Record<string, boolean>
  /** 提交一次策略更新（父级负责鉴权头、错误提示与刷新）。 */
  submit: (updates: Array<Record<string, unknown>>, key: string) => void
  /** 工具级禁用开关（走 /mcp/toolToggle）。 */
  toggleTool: (row: McpRow, tool: McpToolInfo) => void
}

const C = {
  card: {
    background: 'var(--dsw-alias-bg-layer-1)',
    border: '1px solid var(--dsw-alias-border-l2)',
    borderRadius: 8,
    padding: '10px 12px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 6,
  },
  top: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' as const },
  title: {
    margin: 0,
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--dsw-alias-label-primary)',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap' as const,
  },
  meta: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' },
  badge: (color: string, bg: string): React.CSSProperties => ({
    fontSize: 11,
    lineHeight: '16px',
    padding: '0 7px',
    borderRadius: 999,
    color,
    background: bg,
    whiteSpace: 'nowrap' as const,
  }),
  segmented: { display: 'flex', gap: 0, border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 6, overflow: 'hidden', alignSelf: 'flex-start' as const },
  seg: (active: boolean): React.CSSProperties => ({
    font: 'inherit',
    cursor: 'pointer',
    border: 0,
    padding: '4px 10px',
    fontSize: 12,
    color: active ? 'var(--dsw-alias-label-inverse, #fff)' : 'var(--dsw-alias-label-secondary)',
    background: active ? 'var(--dsw-alias-label-primary)' : 'transparent',
    whiteSpace: 'nowrap' as const,
  }),
  hint: { margin: 0, fontSize: 11, color: 'var(--dsw-alias-label-tertiary)', lineHeight: '16px' },
  fold: {
    font: 'inherit',
    cursor: 'pointer',
    border: 0,
    background: 'transparent',
    color: 'var(--dsw-alias-label-tertiary)',
    padding: '2px 0',
    fontSize: 12,
    alignSelf: 'flex-start' as const,
  },
  panel: {
    marginTop: 2,
    borderTop: '1px solid var(--dsw-alias-border-l2)',
    paddingTop: 6,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 6,
  },
  presetRow: { display: 'flex', gap: 6, flexWrap: 'wrap' as const, alignItems: 'center' },
  presetItem: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    fontSize: 12,
    color: 'var(--dsw-alias-label-secondary)',
    background: 'var(--dsw-alias-bg-layer-2)',
    border: '1px solid var(--dsw-alias-border-l2)',
    borderRadius: 999,
    padding: '1px 8px',
  },
  toolList: {
    marginTop: 2,
    borderTop: '1px solid var(--dsw-alias-border-l2)',
    paddingTop: 6,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
    maxHeight: 220,
    overflowY: 'auto' as const,
  },
  toolRow: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 },
  toolName: { flex: '0 0 auto', color: 'var(--dsw-alias-label-primary)', fontWeight: 500 },
  toolDesc: { flex: 1, color: 'var(--dsw-alias-label-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  toolSwitch: (disabled: boolean): React.CSSProperties => ({
    font: 'inherit',
    cursor: 'pointer',
    border: 0,
    borderRadius: 5,
    padding: '2px 10px',
    fontSize: 11,
    flex: '0 0 auto',
    color: 'var(--dsw-alias-label-inverse, #fff)',
    background: disabled ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-error-primary)',
    whiteSpace: 'nowrap' as const,
  }),
  busy: { opacity: 0.55, cursor: 'progress' } as React.CSSProperties,
}

/** 四档在 UI 上的顺序与 i18n 后缀。 */
const EXPOSURE_ORDER: Exposure[] = ['native', 'name-only', 'hidden', 'off']

function exposureKey(exposure: Exposure, kind: 'label' | 'hint'): string {
  const suffix = exposure === 'name-only' ? 'NameOnly' : exposure === 'native' ? 'Native' : exposure === 'hidden' ? 'Hidden' : 'Off'
  return `mp.exposure${suffix}${kind === 'label' ? '' : 'Hint'}`
}

function statusBadge(t: ServerCardProps['t'], row: McpRow): { label: string; color: string; bg: string } {
  switch (row.status) {
    case 'active':
      return { label: t('mp.statusActive'), color: 'var(--dsw-alias-state-success-primary)', bg: 'var(--dsw-alias-state-success-tertiary)' }
    case 'disabled':
      return { label: t('mp.statusDisabled'), color: 'var(--dsw-alias-label-tertiary)', bg: 'var(--dsw-alias-fill-l2)' }
    case 'idle':
      return { label: t('mp.statusIdle'), color: 'var(--dsw-alias-state-warn-primary)', bg: 'var(--dsw-alias-state-warn-tertiary)' }
    default:
      return { label: t('mp.statusFailed'), color: 'var(--dsw-alias-state-error-primary)', bg: 'var(--dsw-alias-state-error-secondary)' }
  }
}

function formatK(n: number): string {
  return n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') : String(n)
}

export function ServerCard(props: ServerCardProps): React.ReactElement {
  const { row, t, presets, presetsError, busy, toolBusy, submit, toggleTool } = props
  const [presetOpen, setPresetOpen] = useState(false)
  const [toolsOpen, setToolsOpen] = useState(false)
  const st = statusBadge(t, row)
  const toolList = row.toolList ?? []
  const scope = row.presetScope

  const setExposure = (exposure: Exposure): void => {
    if (exposure === row.exposure) return
    submit([{ serverName: row.serverName, workspace: row.workspace, exposure }], `exposure:${row.serverName}`)
  }

  const setMode = (mode: PresetScope['mode']): void => {
    const ids = mode === 'all' ? [] : scope.ids
    submit([{ serverName: row.serverName, workspace: row.workspace, presets: { mode, ids } }], `presets:${row.serverName}`)
  }

  const togglePresetId = (id: string): void => {
    const next = scope.ids.includes(id) ? scope.ids.filter((v) => v !== id) : [...scope.ids, id]
    submit([{ serverName: row.serverName, workspace: row.workspace, presets: { mode: scope.mode, ids: next } }], `presets:${row.serverName}`)
  }

  return (
    <div style={C.card}>
      <div style={C.top}>
        <h3 style={C.title}>
          {row.serverName}
          <span style={C.badge(st.color, st.bg)}>{st.label}</span>
          {row.source === 'project' && (
            <span style={C.badge('var(--dsw-alias-label-tertiary)', 'var(--dsw-alias-fill-l2)')}>{t('mp.projectBadge')}</span>
          )}
          {!row.presetAllowed && (
            <span style={C.badge('var(--dsw-alias-state-warn-primary)', 'var(--dsw-alias-state-warn-tertiary)')}>
              {t('mp.presetBlocked')}
            </span>
          )}
          {row.pending && (
            <span style={C.badge('var(--dsw-alias-state-warn-primary)', 'var(--dsw-alias-state-warn-tertiary)')}>
              {t('mp.pendingBadge')}
            </span>
          )}
        </h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ ...C.segmented, ...(busy ? C.busy : {}) }} role="group" aria-label={t('mp.exposureTitle')}>
            {EXPOSURE_ORDER.map((exposure) => (
              <button
                key={exposure}
                type="button"
                disabled={busy}
                style={C.seg(exposure === row.exposure)}
                onClick={() => setExposure(exposure)}
              >
                {t(exposureKey(exposure, 'label'))}
              </button>
            ))}
          </div>
        </div>
      </div>

      <p style={C.hint}>{t(exposureKey(row.exposure, 'hint'))}</p>

      <div style={C.meta}>
        {t('mp.toolsCount', { n: row.tools })} · {t('mp.tokensCount', { n: formatK(row.tokens) })}
        {row.transport ? ` · ${t('mp.transport')}: ${row.transport}` : ''}
        {row.workspace ? ` · ${t('mp.workspace')}: ${row.workspace}` : ''}
        {row.effectiveExposure !== row.exposure ? ` · ${t('mp.effective', { mode: t(exposureKey(row.effectiveExposure, 'label')) })}` : ''}
      </div>

      <button type="button" style={C.fold} onClick={() => setPresetOpen((v) => !v)}>
        {presetOpen ? '▾' : '▸'} {t('mp.presetsTitle')}：{t(`mp.presetMode.${scope.mode}`)}
        {scope.mode !== 'all' ? ` (${scope.ids.length})` : ''}
      </button>
      {presetOpen && (
        <div style={C.panel}>
          <div style={C.presetRow}>
            {(['all', 'only', 'except'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                disabled={busy}
                style={{ ...C.seg(mode === scope.mode), border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 6, background: mode === scope.mode ? 'var(--dsw-alias-label-primary)' : 'transparent' }}
                onClick={() => setMode(mode)}
              >
                {t(`mp.presetMode.${mode}`)}
              </button>
            ))}
          </div>
          {scope.mode !== 'all' && (
            <>
              {presetsError && <p style={C.hint}>{t('mp.presetsUnavailable', { error: presetsError })}</p>}
              {presets.length === 0 && !presetsError && <p style={C.hint}>{t('mp.presetsEmpty')}</p>}
              <div style={C.presetRow}>
                {presets.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    disabled={busy}
                    style={{
                      ...C.presetItem,
                      cursor: 'pointer',
                      borderColor: scope.ids.includes(preset.id) ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-border-l2)',
                      color: scope.ids.includes(preset.id) ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-tertiary)',
                    }}
                    title={preset.description ?? preset.broken ?? preset.id}
                    onClick={() => togglePresetId(preset.id)}
                  >
                    {scope.ids.includes(preset.id) ? '✓' : '+'} {preset.name ?? preset.id}
                    {preset.broken ? ' ⚠' : ''}
                  </button>
                ))}
                {/* 已配置但已不存在的预设 id：保留展示（不自动清理用户配置） */}
                {scope.ids
                  .filter((id) => !presets.some((preset) => preset.id === id))
                  .map((id) => (
                    <button key={id} type="button" disabled={busy} style={{ ...C.presetItem, cursor: 'pointer' }} onClick={() => togglePresetId(id)}>
                      ✓ {id} <span style={{ opacity: 0.7 }}>({t('mp.presetGone')})</span>
                    </button>
                  ))}
              </div>
            </>
          )}
          <p style={C.hint}>{t('mp.presetsHint')}</p>
        </div>
      )}

      {toolList.length > 0 && (
        <>
          <button type="button" style={C.fold} onClick={() => setToolsOpen((v) => !v)}>
            {toolsOpen ? '▾' : '▸'} {t('mp.toolsTitle')} ({toolList.length})
          </button>
          {toolsOpen && (
            <div style={C.toolList}>
              {toolList.map((tool) => {
                const key = `${row.entryId}:${tool.name}`
                const tBusy = Boolean(toolBusy[key])
                return (
                  <div key={tool.name} style={C.toolRow}>
                    <button
                      type="button"
                      style={{ ...C.toolSwitch(tool.disabled), ...(tBusy ? C.busy : {}) }}
                      disabled={tBusy}
                      onClick={() => toggleTool(row, tool)}
                    >
                      {tBusy ? t('mp.working') : tool.disabled ? t('mp.enable') : t('mp.disable')}
                    </button>
                    <span style={C.toolName}>{tool.name.replace(/^mcp__[^_]+__/, '')}</span>
                    <span style={C.toolDesc}>{tool.description || '—'}</span>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
