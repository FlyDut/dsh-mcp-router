/**
 * 添加 MCP 弹窗（表单式）—— 替代早期的「粘贴 mcpServers JSON」输入框。
 *
 * 交互（对齐设计稿 1/2）：类型（stdio / streamable-http）→ 唯一标题 → 随类型切换的
 * 连接字段 →「配置预览」实时显示将写入的 JSON。确认后走既有 `/mcp/add`：
 * 全局写 <profile>/cordis.patch.yml 并立即挂载，项目写
 * <workspace>/.dsh/mcps/mcp.json 并重扫挂载。
 *
 * 表单形状与 `mcp-convert.ts` 的解析口径一致（`type`/`command`/`args`/`env` 或
 * `type`/`url`/`headers`），因此宿主侧无需新增端点；类型直接使用 dsh-mcp-client 的
 * 传输名（`stdio` / `streamable-http`），不暴露 http / sse 等下游别名。
 * `${VAR}` 占位在全局 patch 里转成 `!!js`、项目挂载时解析 process.env。
 */
import React, { useCallback, useMemo, useState } from 'react'
import { post } from './auth'
import { describeError } from './http'
import {
  action,
  disabled as disabledStyle,
  error as errorStyle,
  footer,
  hintBlock,
  modal,
  monoArea,
  monoInput,
  overlay,
  pre,
  primary,
  row,
  tab,
  title,
} from './ui'

interface Props {
  /** locale 翻译函数（由父级传入，保持与宿主 locale 插槽一致）。 */
  t: (key: string, params?: Record<string, string | number>) => string
  /** 当前会话工作空间（cwd）；null = 无会话上下文，此时禁止「项目」目标。 */
  workspace: string | null
  /** 关闭弹窗。 */
  onClose: () => void
  /** 添加成功（含部分成功）后回调：父级负责刷新 MCP 列表。 */
  onAdded: () => void
}

type AddType = 'stdio' | 'streamable-http'
type Target = 'global' | 'project'

/** 类型选项（面板渲染顺序）：直接使用 dsh-mcp-client 的传输名。 */
const TYPES: AddType[] = ['stdio', 'streamable-http']
/** 与 mcp-convert.ts 的 serverName 校验一致（dsh-mcp-client 要求全进程唯一）。 */
const NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

/** 样式薄别名层：共享件来自 ui.ts；field/fieldLabel/radio 系为本弹窗特有。 */
const C = {
  overlay,
  modal: modal(680, 10),
  title,
  hint: hintBlock,
  field: { display: 'flex', flexDirection: 'column' as const, gap: 4 },
  fieldLabel: { fontSize: 12, fontWeight: 600, color: 'var(--dsw-alias-label-primary)' },
  /** 必填星号（设计稿中的红色 *）。 */
  req: { color: 'var(--dsw-alias-state-error-primary)' },
  radioRow: { display: 'flex', alignItems: 'center', gap: 16 },
  radio: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    fontSize: 12,
    color: 'var(--dsw-alias-label-primary)',
    cursor: 'pointer',
  },
  input: monoInput(),
  area: { ...monoArea, minHeight: 76 },
  row: row(),
  tab,
  action,
  primary,
  disabled: disabledStyle,
  error: errorStyle,
  pre,
  footer: footer({ marginTop: 4 }),
}

/** 多行文本 → 去空行、去首尾空白的行数组（参数：每行一个，`--flag=value` 原样保留）。 */
function toLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

/**
 * 多行 `KEY<sep>VALUE` → 字典（环境变量用 `=`、请求头用 `:`）。
 * 只切首个分隔符：value 里含 `=`（base64）或 `:`（URL）都原样保留。
 */
function toDict(text: string, sep: '=' | ':'): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of toLines(text)) {
    const at = line.indexOf(sep)
    if (at <= 0) continue
    const key = line.slice(0, at).trim()
    if (key.length === 0) continue
    out[key] = line.slice(at + 1).trim()
  }
  return out
}

/** 表单 → mcpServers 条目（键序与设计稿一致：type 开头，空的可选字段不落）。 */
function buildConfig(input: {
  type: AddType
  command: string
  argsText: string
  envText: string
  url: string
  headersText: string
}): Record<string, unknown> {
  const config: Record<string, unknown> = { type: input.type }
  if (input.type === 'stdio') {
    config.command = input.command.trim()
    const args = toLines(input.argsText)
    if (args.length > 0) config.args = args
    const env = toDict(input.envText, '=')
    if (Object.keys(env).length > 0) config.env = env
    return config
  }
  config.url = input.url.trim()
  const headers = toDict(input.headersText, ':')
  if (Object.keys(headers).length > 0) config.headers = headers
  return config
}

export function AddMcpModal(props: Props): React.ReactElement {
  const { t, workspace, onClose, onAdded } = props
  const [type, setType] = useState<AddType>('stdio')
  const [serverName, setServerName] = useState('')
  const [command, setCommand] = useState('')
  const [argsText, setArgsText] = useState('')
  const [envText, setEnvText] = useState('')
  const [url, setUrl] = useState('')
  const [headersText, setHeadersText] = useState('')
  const [target, setTarget] = useState<Target>('global')
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)

  const config = useMemo(
    () => buildConfig({ type, command, argsText, envText, url, headersText }),
    [type, command, argsText, envText, url, headersText],
  )
  const preview = useMemo(() => JSON.stringify(config, null, 2), [config])

  const submit = useCallback(async () => {
    const name = serverName.trim()
    // 客户端先做形状校验（服务端仍会独立校验，这里只为省一次往返与更早的提示）
    if (!NAME_PATTERN.test(name)) {
      setFormError(t('mp.addMcpNameInvalid'))
      return
    }
    if (type === 'stdio' && command.trim().length === 0) {
      setFormError(t('mp.addMcpCommandRequired'))
      return
    }
    if (type !== 'stdio' && url.trim().length === 0) {
      setFormError(t('mp.addMcpUrlRequired'))
      return
    }
    setBusy(true)
    setFormError(null)
    setResult(null)
    try {
      // 项目目标不提交 workspace：由后端取「最近进入会话的工作区」写入（随切换实时），
      // 避免面板缓存的工作区过期导致加到旧项目。workspace prop 仅作展示提示。
      const body = await post<{ ok: boolean; added?: number; error?: string; skipped?: string[] }>(
        '/api/dsh-mcp-router/mcp/add',
        { json: JSON.stringify({ mcpServers: { [name]: config } }), target },
      )
      if (!body.ok || typeof body.added !== 'number') {
        throw new Error(typeof body.error === 'string' ? body.error : 'add failed')
      }
      // 成功（含部分成功：已存在/挂载失败被跳过）：关闭弹窗，父级刷新列表
      onAdded()
      onClose()
    } catch (err) {
      // 失败：留在弹窗内展示原因（名称非法、已存在、挂载失败等）
      setResult(t('mp.addMcpError', { error: describeError(err, t) }))
    } finally {
      setBusy(false)
    }
  }, [serverName, type, command, url, config, target, t, onAdded, onClose])

  /** 必填星号（设计稿的红色 `*`）。 */
  const req = <span style={C.req}> *</span>

  return (
    <div style={C.overlay} role="dialog" aria-modal="true" onClick={onClose}>
      <div style={C.modal} onClick={(event) => event.stopPropagation()}>
        <h3 style={C.title}>{t('mp.addMcp')}</h3>
        <p style={C.hint}>{t('mp.addMcpFormHint')}</p>

        <div style={C.field}>
          <span style={C.fieldLabel}>
            {t('mp.addMcpType')}
            {req}
          </span>
          <div style={C.radioRow} role="radiogroup" aria-label={t('mp.addMcpType')}>
            {TYPES.map((value) => (
              <label key={value} style={C.radio}>
                <input type="radio" name="dsh-mcp-router-add-type" checked={type === value} onChange={() => setType(value)} />
                {value}
              </label>
            ))}
          </div>
        </div>

        <div style={C.field}>
          <span style={C.fieldLabel}>
            {t('mp.addMcpTitleLabel')}
            {req}
          </span>
          <input
            style={C.input}
            value={serverName}
            onChange={(event) => setServerName(event.target.value)}
            placeholder="brave-search"
            spellCheck={false}
          />
        </div>

        {type === 'stdio' ? (
          <>
            <div style={C.field}>
              <span style={C.fieldLabel}>
                {t('mp.editCommand')}
                {req}
              </span>
              <input
                style={C.input}
                value={command}
                onChange={(event) => setCommand(event.target.value)}
                placeholder="npx"
                spellCheck={false}
              />
            </div>
            <div style={C.field}>
              <span style={C.fieldLabel}>{t('mp.editArgs')}</span>
              <textarea
                style={C.area}
                value={argsText}
                onChange={(event) => setArgsText(event.target.value)}
                placeholder={'-y\n@brave/brave-search-mcp-server\n--transport\nstdio'}
                spellCheck={false}
              />
              <span style={C.hint}>{t('mp.editOnePerLine')}</span>
            </div>
            <div style={C.field}>
              <span style={C.fieldLabel}>{t('mp.editEnv')}</span>
              <textarea
                style={C.area}
                value={envText}
                onChange={(event) => setEnvText(event.target.value)}
                placeholder={'KEY1=value1\nKEY2=value2'}
                spellCheck={false}
              />
              <span style={C.hint}>{t('mp.editOnePerLine')}</span>
            </div>
          </>
        ) : (
          <>
            <div style={C.field}>
              <span style={C.fieldLabel}>
                {t('mp.editUrl')}
                {req}
              </span>
              <input
                style={C.input}
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://api.example.com/mcp"
                spellCheck={false}
              />
            </div>
            <div style={C.field}>
              <span style={C.fieldLabel}>{t('mp.addMcpHeadersOptional')}</span>
              <textarea
                style={C.area}
                value={headersText}
                onChange={(event) => setHeadersText(event.target.value)}
                placeholder={'Authorization: Bearer your_token_here\nContent-Type: application/json'}
                spellCheck={false}
              />
              <span style={C.hint}>{t('mp.editOnePerLine')}</span>
            </div>
          </>
        )}

        <div style={C.field}>
          <span style={C.fieldLabel}>{t('mp.addMcpTarget')}</span>
          <div style={C.row}>
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
            {target === 'project' && (
              <span style={{ ...C.hint, flex: 1 }}>{workspace ?? t('mp.addMcpNoWorkspace')}</span>
            )}
          </div>
        </div>

        <div style={C.field}>
          <span style={C.fieldLabel}>{t('mp.addMcpPreviewTitle')}</span>
          <pre style={C.pre}>{preview}</pre>
        </div>

        {formError && <div style={C.error}>{formError}</div>}
        {result && <div style={C.error}>{result}</div>}

        <div style={C.footer}>
          <button type="button" style={C.action} disabled={busy} onClick={onClose}>
            {t('mp.addMcpCancel')}
          </button>
          <button
            type="button"
            style={{ ...C.primary, ...(busy ? C.disabled : {}) }}
            disabled={busy}
            onClick={() => void submit()}
          >
            {busy ? t('mp.working') : t('mp.addMcpConfirm')}
          </button>
        </div>
      </div>
    </div>
  )
}
