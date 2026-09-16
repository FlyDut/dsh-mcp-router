<p align="center">
  <strong style="font-size: 2.2em">🧩 MCP Manager</strong><br>
  <span style="font-size: 1.1em">DeepSeek Harness (DSH) Web plugin · Four exposure levels per MCP · Runtime isolation by agent preset · On-demand calls that cost no context</span>
</p>

<p align="center">
  <strong>English</strong> · <a href="./README.md">🌐 中文</a>
</p>

<p align="center">
  <img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg">
  <img alt="Version" src="https://img.shields.io/badge/version-0.6.0-green.svg">
</p>

---

## ✨ What it is

A settings panel that gives every MCP server an **exposure level** (how much of it enters the context) and a **preset scope** (which sessions may use it).

Injecting everything eats your context; turning everything off makes MCPs useless when you need them. So "how much does this MCP expose to the model" becomes one level per server, and "which sessions may use it" becomes a preset scope. Servers that are not injected stay reachable on demand through `mcp_search` / `mcp_call`.

![MCP panel](docs/images/mcp-panel.jpg)

## 🎚️ Four exposure levels

| Level | Process | Context injection | `mcp_search` | `mcp_call` |
| --- | --- | --- | --- | --- |
| **Native** `native` | running | every `mcp__<server>__*` tool schema | listed in the summary (marked injected) | callable |
| **Name only** `name-only` | running | just one line: server name + summary | listed in the summary | callable (omit the tool name to get the tool list) |
| **Hidden** `hidden` | stopped (keep-alive enabled on demand, reaped when idle) | nothing | returned only on a keyword hit | callable |
| **Off** `off` | stopped | nothing | never appears | refused |

A level decides two things at once: **whether the process runs** (native/name-only = running, hidden/off = stopped) and **how much enters the context**. It is the only state control you need.

## 🧩 Preset scope (runtime isolation)

| Mode | Meaning | Session without a preset |
| --- | --- | --- |
| All presets `all` (default) | available to every session | available |
| Only these `only` | available only to the listed presets | unavailable |
| All except `except` | available to every other preset | available |

A preset-isolated server **keeps running in the background**: sessions on other presets cannot see it, `mcp_search` does not return it, and `mcp_call` refuses it. All three checks share one function, so you never get "visible but uncallable" or the reverse.

> This is exactly the "one session uses this MCP, another does not" case — without toggling processes back and forth and without a restart.

## 🎯 Capabilities

| Capability | Detail |
| --- | --- |
| 🤖 **Always-on middle layer** | `mcp_search` (catalog retrieval) + `mcp_call` (keep-alive enable → call → idle reap); an unknown tool name makes `mcp_call` return that server's tool list |
| 🛠️ **Per-tool disable** | Fine-grained control above the server level; disabled tools leave retrieval and are refused on call |
| 📊 **Stopped-state backfill** | Hidden/off servers still show "N tools, ~N tokens" from the private last-good catalog snapshot |
| 📁 **Project-level MCP** | Reads `<workspace>/.dsh/mcps/**/mcp.json`, visible **only to sessions of that workspace**; hot-reloaded on file change |
| ✏️ **Edit / delete** | Change command, args, env, URL, headers and timeout right in the panel; deleting removes the config row, unloads the runtime row and clears its policy. Preset composition rows are read-only (with a documented alternative) |
| 📥 **Import from other agents** | Scans known MCP configs on this machine (opencode / zcode / Claude Code / Cursor / Gemini CLI / project `.mcp.json`) → pick → import as global or project, optionally setting the level. Source files are read-only; the import is a one-off snapshot |
| ➕ **Quick migration** | Paste another harness's `mcpServers` JSON (Claude Code, …) → preview → add as global (profile patch) or project (`.dsh/mcps/mcp.json`) |
| ⏱️ **Apply timing** | "Immediate" (next turn, with a cache-cost warning) or "Next session" (zero cache invalidation for the current session) |
| 💾 **Survives restart** | Policies persist to `~/.dsh/dsh-mcp-panel/state.json`; enable/disable intent is materialized into compositions at early startup |
| 🌐 **Bilingual UI** | All strings in zh/en, following the DSH interface language; light/dark themes |
| 🪶 **No standing context** | Registers no model tools beyond the two middle-layer ones; hidden/off MCPs cost no context |

## 📦 Install

```sh
dsh plugin --profile web add "github:lilyblessing/dsh-mcp-panel#main"
```

Artifacts are committed (`lib/`), so a git source installs in one line with no build authorization. **Restart `dsh web`** afterwards (the bundle layer is composed at startup; hot reload does not apply), then the settings page shows "MCP Manager".

> 📦 Published on **npm** as `dsh-mcp-panel`.

### Upgrading from 0.5.x (dsh-mcp-skill-panel)

1. **The skill feature is gone** (use a dedicated skill-manager plugin); the panel entry is now "MCP Manager".
2. **Package name and mount id changed** — reinstall once in the profile:

```sh
cd ~/.dsh/profiles/web
pnpm remove dsh-mcp-skill-panel
pnpm add "file:/path/to/dsh-mcp-panel"     # or github:lilyblessing/dsh-mcp-panel#main
# and rename dsh-mcp-skill-panel → dsh-mcp-panel in package.json's dsh.profile.bundles
```

3. **Data directory migrates automatically**: when `~/.dsh/dsh-mcp-panel/state.json` is absent, `state.json` and `catalog.json` are moved over from `~/.dsh/dsh-mcp-skill-panel/`.
4. **Policy structure migrates v1 → v2** (old `autoManage` + toggles + per-tool disables → per-server level + preset scope + disabled tools); the original file is backed up as `state.v1.json`:

   | Old state | New level |
   | --- | --- |
   | disabled + old `autoManage: true` | **hidden** (keeps "callable on demand") |
   | disabled + old `autoManage: false` | **off** |
   | enabled | **native** |

## 🚀 Usage

1. Settings → **MCP Manager**
2. Each card: server name, status badge, the **four-level selector**, stats (tools, token estimate, transport, workspace)
3. **Level selector**: Native / Name only / Hidden / Off — click to apply (immediate mode warns about the cache cost)
4. **Preset scope** (collapsible): All presets / Only these / All except + a preset multi-select. Deleted preset ids are marked "no longer exists" but never silently dropped from your config
5. **Tools** (collapsible): enable/disable individual tools of that server
6. **Apply timing**: switch between "Immediate" and "Next session"; pending intents in the latter can be forced with "Apply pending now"
7. **Add MCP**: the "Add" button at the top right → paste `mcpServers` JSON, pick the global/project target, confirm
8. **Edit / delete**: each card has Edit and Delete at the bottom right. Editing rewrites the row's own config source (global rows → profile patch, project rows → `.dsh/mcps/mcp.json`); deleting asks for confirmation. Rows declared in an agent preset composition (`agent.cordis.yml`) show a "Read-only" badge and disable both buttons (see the write-back matrix below for why)
9. **Import from other agents**: the "Import" button at the top right → auto-scan known sources → tick the servers to bring over (custom JSON paths can be added) → choose target and level → confirm

> Status badges: 🟢 Running (has tools) / ⚪ Stopped (level is hidden or off) / 🟡 No tools (process up, tool list empty) / 🔴 Not running (expected to run but the process is down — usually a failed server start).

## 🔌 HTTP API

Prefix `/api/mcp-panel` (the legacy prefixes `/api/mcp-skill-panel` and `/api/runtime-inventory` still work).

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/state?session=<id>` | Panel view (registry rows × policy × effective level after preset isolation) |
| GET | `/presets?session=<id>` | Agent presets available for scoping |
| POST | `/policy` | `{ updates: [{ serverName, workspace?, exposure?, presets?, disabledTools? }] }` batch policy write |
| POST | `/policy/commit` | Force pending "next session" intents to take effect now (costs a cache miss) |
| POST | `/mcp/toolToggle` | `{ serverName, workspace?, toolName, disabled }` per-tool disable |
| GET | `/mcp/detail?serverName=&workspace=` | Edit-form seed: writable target, current config, dynamic (`!!js`) key list |
| POST | `/mcp/update` | `{ serverName, workspace?, patch: {…} }` edit and write back to the config source |
| POST | `/mcp/remove` | `{ serverName, workspace? }` delete (preset composition rows return 400 with the alternative) |
| POST | `/mcp/scan` | `{ paths?: string[] }` scan other agents' MCP configs (read-only; built-in list + custom paths) |
| GET / POST | `/config` | Read / write apply timing |
| POST | `/mcp/preview`, `/mcp/add` | Quick migration preview / add |
| GET | `/debug`, POST `/debug/collect` | Diagnostics |
| GET | `/token` | Process-scoped random token (the panel sends it as `x-panel-token`) |

> **Write authorization**: every POST must carry `x-panel-token` matching the process token, otherwise 401 — this blocks cross-origin / DNS-rebinding blind writes to the local control endpoints. GET read endpoints stay open.

## ⚙️ How it works

```
┌ panel ──────────────────────────────────────────────────────┐
│  collect.ts (view) · routes.ts (endpoints) · client/* (UI)   │
└──────────────────────┬──────────────────────────────────────┘
┌ policy (single source of truth) ────────────────────────────┐
│  domain/policy.ts   intent (persisted) / effective (runtime) │
│  domain/exposure.ts level rules · preset scope · v1→v2 (pure)│
└──────────────────────┬──────────────────────────────────────┘
┌ runtime ────────────────────────────────────────────────────┐
│  domain/registry.ts  three sources → one ServerRef snapshot  │
│  catalog.ts          tool catalog / search / last-good cache │
│  mcpcall.ts          keep-alive + idle reaper + the two tools│
└──────────────────────┬──────────────────────────────────────┘
┌ assembly (single injection point) ──────────────────────────┐
│  domain/assembly.ts  one system-prompt/assemble listener:    │
│                      filter tools by level + name-only index │
└─────────────────────────────────────────────────────────────┘
```

**One decision function** shared by the assembly filter, `mcp_search`, `mcp_call` and the panel badges — `decideExposure({ policy, running, aiActive, presetId })`:

1. preset not allowed → `off` (runtime isolation; physical state untouched)
2. `off` / `hidden` → as configured
3. `native` / `name-only`: process running and not inside an AI keep-alive window → as configured; otherwise degrade to `hidden` (tools stay out of context, `mcp_call` still works — capability is never silently lost)

**Config write-back matrix** (where edit/delete actually write):

| Row source | File | Edit / delete |
| --- | --- | --- |
| Global row | `~/.dsh/profiles/<profile>/cordis.patch.yml` (inside the loader these rows belong to the root tree whose `tree.filename` is `cordis.yml`, reset to empty on every boot — so the real target is the sibling patch file) | Text-level rewrite/removal of the row block, then the loader is synced |
| Project row | `<workspace>/.dsh/mcps/**/mcp.json` | Change/remove the JSON key, then remount the workspace |
| Preset composition row | `<preset>/agent.cordis.yml` | **Read-only**: writing it at runtime triggers the standing-remount incident; the panel marks it read-only and points at the "Off" level instead |

Writes always hit the file first and the runtime second — the other order leaves a "runtime changed but nothing persisted" half state. Fields holding `!!js` expressions are shown read-only and kept verbatim on save, so an imported `${VAR}` is never frozen into a plaintext secret.

**Why persistence takes two steps**: `dsh-agent-presets` detects composition-file changes via an `{mtimeMs, size}` stamp and remounts the standing composition without disposing the old one → writing the composition at runtime causes global `serverName` collisions and failed session creation (a measured incident). Policies therefore only write the plugin's own `state.json`; materialization into compositions happens at early startup (before any standing mount is attached), with three rules: **first adoption** (adopt the file's state, never overwrite a hand-edited row), **respect external edits** (align the ledger only), **materialize** (write only when the desired state differs).

## ⚠️ Known limitations

- **A preset standing row's process can only be started/stopped by a restart**: since rc.1 those rows are not in the loader, so the plugin cannot toggle them at runtime (writing the composition at runtime triggers the remount incident). Runtime visibility/callability is enforced immediately by the assembly and middle layers; the process state follows the next materialization.
- Changing level/scope/tool toggles mid-session invalidates that session's prompt cache (the panel warns); use "Next session" to avoid it.
- The "Name only" level adds a small standing index (one line per server); hidden/off add nothing.
- A preset id that no longer exists stays in your config (marked in the UI) instead of being silently removed.
- Project-level MCPs are visible only to sessions of the **same workspace** (matched by session cwd; no `.git` upward search).
- **Preset composition rows are read-only**: MCP rows inside `agent.cordis.yml` cannot be edited or deleted from the panel (framework constraint — writing that file remounts the whole preset and breaks MCP name uniqueness). Use the "Off" level to disable them, or edit the file directly.
- **Project-level MCPs cannot be renamed** from the panel: their name comes from the config key under `.dsh/mcps`, while the runtime mount name also carries a path-hash suffix. Edit the file to rename.
- **Imports do not track source changes** (one-off snapshot) and never modify the source files.
- **No TOML support**: Codex's `~/.codex/config.toml` and Zed's `context_servers` are listed as "skipped" in scan results.

## 🛠️ Development

```sh
pnpm install
pnpm setup          # junction the DSH closure into node_modules (type resolution)
pnpm typecheck
pnpm build          # tsdown → lib/*.js + tsc dts → lib/types
pnpm verify         # artifact checks (externals, entries, client wrapper)
node scripts/selftest-exposure.mjs   # domain logic: levels / preset scope / migration / sync rules
node scripts/selftest-policy.mjs     # policy store end-to-end: dir move / v1→v2 / apply timing (temp HOME)
node scripts/selftest-mcp.mjs        # catalog search / composition text / project scan / JSON conversion
```

## 📋 Changelog

### v0.6.1 — edit / delete / import from other agents

- **Edit**: change serverName, transport, command, args, env, cwd, URL, headers and tool timeout in the panel; the config source is rewritten and the runtime synced. Renaming migrates the level, preset scope and per-tool disables (including the `mcp__old__` → `mcp__new__` prefix rewrite)
- **Delete**: confirm, then remove the config row, unload the loader row and clear the policy
- **Import from other agents**: scans opencode / zcode / Claude Code / Cursor / Gemini CLI / project `.mcp.json` (plus custom paths), sniffs formats (`mcpServers` / `mcp` / `mcp.servers` / `servers` / bare map) and normalises fields (`type: local|remote`, array `command`, `environment` → `env`); the level can be set during import
- **Read-only protection**: rows declared in an agent preset composition are badged read-only with the reason and an alternative
- **Dynamic-expression protection**: `!!js` fields stay read-only in the form and verbatim on disk, so an imported `${VAR}` never becomes a plaintext secret
- **Error surfacing**: when the server answers with something that is not JSON — most commonly "plugin updated but dsh web not restarted" (client assets are read from disk per request, host-side code loads at startup) — the panel now says "restart dsh web and retry" instead of the browser-native `JSON.parse: unexpected keyword`
- **Fixes (inherited from v0.6.0)**: global-row disable state was never persisted (root-tree rows must materialise into the sibling `cordis.patch.yml`); "no `disabled` key" was mistaken for "row missing", so flags could never be written; composition text editing only matched unindented `- id:` lines

### v0.6.0 — four exposure levels + preset runtime isolation (breaking)

- **Skill feature removed**; the plugin is now a single control plane for MCP visibility and usability
- **Four levels** replace "enable/disable + global autoManage": native / name-only / hidden / off
- **Preset scope** (runtime isolation): `all` / `only` / `except` + multi-select, enforced identically in assembly, `mcp_search` and `mcp_call`, with the process left running
- **`mcp_call` accepts a server alone** and returns its tool list when the tool name is unknown
- **`mcp_search` layering**: lists native + name-only servers, counts hidden ones, hides off/isolated ones entirely
- **Architecture**: three separate `system-prompt/assemble` filters merged into one assembly layer; the live-row and preset-row build paths unified into a registry; intent/effective policy tables replace the desired/lastApplied/pending state tangle
- **Renamed** to `dsh-mcp-panel` (entry "MCP Manager", HTTP prefix `/api/mcp-panel`, legacy prefixes kept)
- **Automatic migration** of the data directory and of `state.json` v1 → v2, with a `state.v1.json` backup

## 📄 License

MIT
