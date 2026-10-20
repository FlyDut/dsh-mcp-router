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
  /** 工具级批量启停（走 /mcp/toolBulk）；`toolNames === undefined` = 服务端权威目录里的「全部工具」。 */
  toolBulk: (row: McpRow, toolNames: string[] | undefined, disabled: boolean) => void
  /** 编辑该行的配置源（弹窗）。 */
  onEdit: (row: McpRow) => void
  /** 删除该行（弹窗二次确认）。 */
  onRemove: (row: McpRow) => void
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
  toolBar: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' as const, fontSize: 11 },
  toolFilter: {
    flex: '1 1 140px',
    minWidth: 110,
    font: 'inherit',
    fontSize: 11,
    padding: '3px 8px',
    borderRadius: 6,
    color: 'var(--dsw-alias-label-primary)',
    background: 'color-mix(in srgb, var(--dsw-alias-label-primary) 7%, transparent)',
    border: '1px solid var(--dsw-alias-border-l2)',
  },
  toolBulkBtn: (disabled: boolean): React.CSSProperties => ({
    font: 'inherit',
    cursor: disabled ? 'not-allowed' : 'pointer',
    border: '1px solid var(--dsw-alias-border-l2)',
    borderRadius: 6,
    padding: '3px 8px',
    fontSize: 11,
    opacity: disabled ? 0.5 : 1,
    color: 'var(--dsw-alias-label-secondary)',
    background: 'var(--dsw-alias-bg-layer-1)',
    whiteSpace: 'nowrap' as const,
  }),
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
  opBtn: (primary: boolean, disabled: boolean): React.CSSProperties => ({
    font: 'inherit',
    cursor: disabled ? 'not-allowed' : 'pointer',
    border: '1px solid var(--dsw-alias-border-l2)',
    borderRadius: 6,
    padding: '3px 10px',
    fontSize: 11,
    opacity: disabled ? 0.5 : 1,
    color: primary ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-label-secondary)',
    background: 'var(--dsw-alias-bg-layer-1)',
    borderColor: primary ? 'color-mix(in srgb, var(--dsw-alias-state-error-primary) 45%, var(--dsw-alias-border-l2))' : 'var(--dsw-alias-border-l2)',
    whiteSpace: 'nowrap' as const,
  }),
  actions: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 2, flexWrap: 'wrap' as const },
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

/** 三档在 UI 上的顺序与 i18n 后缀。 */
const EXPOSURE_ORDER: Exposure[] = ['name-only', 'hidden', 'off']

/** 工具批量操作的 busy key 后缀（与单工具 key `${entryId}:${toolName}` 区分）。 */
export const TOOL_BULK_KEY = '__bulk__'

function exposureKey(exposure: Exposure, kind: 'label' | 'hint'): string {
  const suffix = exposure === 'name-only' ? 'NameOnly' : exposure === 'hidden' ? 'Hidden' : 'Off'
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
  const { row, t, presets, presetsError, busy, toolBusy, submit, toggleTool, toolBulk, onEdit, onRemove } = props
  const [presetOpen, setPresetOpen] = useState(false)
  const [toolsOpen, setToolsOpen] = useState(false)
  const [toolFilter, setToolFilter] = useState('')
  const st = statusBadge(t, row)
  const toolList = row.toolList ?? []
  const scope = row.presetScope
  const bulkBusy = Boolean(toolBusy[`${row.entryId}:${TOOL_BULK_KEY}`])
  const toolQuery = toolFilter.trim().toLowerCase()
  const filteredTools =
    toolQuery.length === 0
      ? toolList
      : toolList.filter(
          (tool) => tool.name.toLowerCase().includes(toolQuery) || tool.description.toLowerCase().includes(toolQuery),
        )
  /** 从注册全名剥出裸工具名（serverName 本身可能含下划线，不能用 `[^_]+`）。 */
  const bareToolName = (fullName: string): string => {
    const prefix = `mcp__${row.serverName}__`
    return fullName.startsWith(prefix) ? fullName.slice(prefix.length) : fullName
  }

  /**
   * 插件提供的运行时 server（source === 'runtime'）：
   * - 档位固定为「仅名称」：进程归插件所有，router 停不掉，设 hidden 也只会让工具
   *   不可见却仍注入服务器说明（instructions），语义反而混乱，因此不提供档位选择；
   * - 不显示预设关联、编辑、删除等服务器级操作（这些配置由插件自己拥有）；
   * - 工具列表照常展示（含搜索与工具级开关），这是用户查看/控制工具的唯一入口。
   */
  const isRuntime = row.source === 'runtime'

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
          {row.unregistered && (
            <span
              style={C.badge('var(--dsw-alias-state-error-primary)', 'var(--dsw-alias-state-error-secondary)')}
              title={t('mp.unregisteredHint')}
            >
              {t('mp.unregisteredBadge')}
            </span>
          )}
          {row.pending && (
            <span style={C.badge('var(--dsw-alias-state-warn-primary)', 'var(--dsw-alias-state-warn-tertiary)')}>
              {t('mp.pendingBadge')}
            </span>
          )}
        </h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {isRuntime ? (
            <span
              style={C.badge('var(--dsw-alias-label-secondary)', 'var(--dsw-alias-fill-l2)')}
              title={t('mp.runtimeFixedHint')}
            >
              {t('mp.runtimeFixed')}
            </span>
          ) : (
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
          )}
        </div>
      </div>

      <p style={C.hint}>{isRuntime ? t('mp.runtimeFixedHint') : t(exposureKey(row.exposure, 'hint'))}</p>

      <div style={C.meta}>
        {t('mp.toolsCount', { n: row.tools })} · {t('mp.tokensCount', { n: formatK(row.tokens) })}
        {row.transport ? ` · ${t('mp.transport')}: ${row.transport}` : ''}
        {row.workspace ? ` · ${t('mp.workspace')}: ${row.workspace}` : ''}
        {row.effectiveExposure !== row.exposure ? ` · ${t('mp.effective', { mode: t(exposureKey(row.effectiveExposure, 'label')) })}` : ''}
      </div>

      <div style={C.actions}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {!isRuntime && (
            <button type="button" style={C.fold} onClick={() => setPresetOpen((v) => !v)}>
              {presetOpen ? '▾' : '▸'} {t('mp.presetsTitle')}：{t(`mp.presetMode.${scope.mode}`)}
              {scope.mode !== 'all' ? ` (${scope.ids.length})` : ''}
            </button>
          )}
          {toolList.length > 0 && (
            <button type="button" style={C.fold} onClick={() => setToolsOpen((v) => !v)}>
              {toolsOpen ? '▾' : '▸'} {t('mp.toolsTitle')} ({toolList.length})
            </button>
          )}
        </div>
        {!isRuntime && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {!row.writable && (
              <span
                style={C.badge('var(--dsw-alias-label-tertiary)', 'var(--dsw-alias-fill-l2)')}
                title={t('mp.readonlyHint')}
              >
                {t('mp.readonlyBadge')}
              </span>
            )}
            <button
              type="button"
              style={C.opBtn(false, !row.writable)}
              disabled={!row.writable}
              title={row.writable ? t('mp.edit') : t('mp.readonlyHint')}
              onClick={() => onEdit(row)}
            >
              {t('mp.edit')}
            </button>
            <button
              type="button"
              style={C.opBtn(true, !row.writable)}
              disabled={!row.writable}
              title={row.writable ? t('mp.remove') : t('mp.readonlyHint')}
              onClick={() => onRemove(row)}
            >
              {t('mp.remove')}
            </button>
          </div>
        )}
      </div>
      {!isRuntime && presetOpen && (
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

      {toolList.length > 0 && toolsOpen && (
            <div style={C.toolList}>
              <div style={C.toolBar}>
                <input
                  type="text"
                  value={toolFilter}
                  onChange={(event) => setToolFilter(event.target.value)}
                  placeholder={t('mp.toolFilterPlaceholder')}
                  style={C.toolFilter}
                />
                <button
                  type="button"
                  style={C.toolBulkBtn(bulkBusy)}
                  disabled={bulkBusy}
                  onClick={() => toolBulk(row, undefined, true)}
                >
                  {t('mp.disableAllTools')}
                </button>
                <button
                  type="button"
                  style={C.toolBulkBtn(bulkBusy)}
                  disabled={bulkBusy}
                  onClick={() => toolBulk(row, undefined, false)}
                >
                  {t('mp.enableAllTools')}
                </button>
                {toolQuery.length > 0 && (
                  <>
                    <button
                      type="button"
                      style={C.toolBulkBtn(bulkBusy || filteredTools.length === 0)}
                      disabled={bulkBusy || filteredTools.length === 0}
                      onClick={() => toolBulk(row, filteredTools.map((tool) => tool.name), true)}
                    >
                      {t('mp.disableFilteredTools', { n: filteredTools.length })}
                    </button>
                    <button
                      type="button"
                      style={C.toolBulkBtn(bulkBusy || filteredTools.length === 0)}
                      disabled={bulkBusy || filteredTools.length === 0}
                      onClick={() => toolBulk(row, filteredTools.map((tool) => tool.name), false)}
                    >
                      {t('mp.enableFilteredTools', { n: filteredTools.length })}
                    </button>
                  </>
                )}
                {bulkBusy && <span style={C.toolDesc}>{t('mp.working')}</span>}
              </div>
              {filteredTools.length === 0 && <div style={C.toolDesc}>{t('mp.toolFilterEmpty')}</div>}
              {filteredTools.map((tool) => {
                const key = `${row.entryId}:${tool.name}`
                const tBusy = Boolean(toolBusy[key])
                return (
                  <div key={tool.name} style={C.toolRow}>
                    <button
                      type="button"
                      style={{ ...C.toolSwitch(tool.disabled), ...(tBusy ? C.busy : {}) }}
                      disabled={tBusy || bulkBusy}
                      onClick={() => toggleTool(row, tool)}
                    >
                      {tBusy ? t('mp.working') : tool.disabled ? t('mp.enable') : t('mp.disable')}
                    </button>
                    <span style={C.toolName}>{bareToolName(tool.name)}</span>
                    <span style={C.toolDesc}>{tool.description || '—'}</span>
                  </div>
                )
              })}
            </div>
          )}
    </div>
  )
}
