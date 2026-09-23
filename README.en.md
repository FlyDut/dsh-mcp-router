<p align="center">
  <strong style="font-size: 2.2em">🧩 MCP Manager</strong><br>
  <span style="font-size: 1.1em">DeepSeek Harness (DSH) Web plugin · Four exposure levels per MCP · Runtime isolation by agent preset · On-demand calls that cost no context</span>
</p>

<p align="center">
  <strong>English</strong> · <a href="./README.md">🌐 中文</a>
</p>

<p align="center">
  <img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg">
  <img alt="Version" src="https://img.shields.io/badge/version-0.7.0-green.svg">
</p>

---

## ✨ What it is

A settings panel that gives every MCP server an **exposure level** (how much of it enters the context) and a **preset scope** (which sessions may use it).

Injecting everything eats your context; turning everything off makes MCPs useless when you need them. So "how much does this MCP expose to the model" becomes one level per server, and "which sessions may use it" becomes a preset scope. Servers that are not injected stay reachable on demand through `dsh_mcp_search` / `dsh_mcp_call`.

![MCP panel](docs/images/mcp-panel.jpg)

## 🎚️ Four exposure levels

| Level | Process | Context injection | `dsh_mcp_search` | `dsh_mcp_call` |
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

A preset-isolated server **keeps running in the background**: sessions on other presets cannot see it, `dsh_mcp_search` does not return it, and `dsh_mcp_call` refuses it. All three checks share one function, so you never get "visible but uncallable" or the reverse.

> This is exactly the "one session uses this MCP, another does not" case — without toggling processes back and forth and without a restart.

## 🎯 Capabilities

| Capability | Detail |
| --- | --- |
| 🤖 **Always-on middle layer** | `dsh_mcp_search` (catalog retrieval) + `dsh_mcp_call` (keep-alive enable → call → idle reap); an unknown tool name makes `dsh_mcp_call` return that server's tool list |
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
| POST | `/policy/commit` | Force pending "next session" intents to take effect now (**requires body `{ confirm: true }`**, otherwise 400; costs a cache miss) |
| POST | `/mcp/toolToggle` | `{ serverName, workspace?, toolName, disabled }` per-tool disable |
| POST | `/mcp/toolBulk` | `{ serverName, workspace?, disabled, toolNames? }` per-tool **bulk** toggle. `toolNames` is a **three-state contract**: omitted = every tool of that server (the only way to mean "all"); an array = exact set (`[]` is a valid no-op); a non-array, or a non-empty array matching nothing → 400 (never silently degraded to "all" — the panel's "bulk by filter" sends `[]` whenever the filter matches nothing). The response carries `changed` and `ignoredToolNames` (named tools absent from the current directory, making catalogue drift visible) |
| GET | `/mcp/detail?serverName=&workspace=` | Edit-form seed: writable target, current config, dynamic (`!!js`) key list; **`env`/`headers` values are masked as `***MASKED***`** (keys preserved) |
| POST | `/mcp/update` | `{ serverName, workspace?, patch: {…} }` edit and write back to the config source; a masked value means "keep the current one" |
| POST | `/mcp/remove` | `{ serverName, workspace? }` delete (preset composition rows return 400 with the alternative) |
| POST | `/mcp/scan` | `{ paths?: string[] }` scan other agents' MCP configs (read-only; built-in list + custom paths; token required, and **deliberately not masked** because its only purpose is importing the result verbatim) |
| GET / POST | `/config` | Read / write apply timing |
| POST | `/mcp/preview`, `/mcp/add` | Quick migration preview / add |
| GET | `/debug`, POST `/debug/collect` | Diagnostics |
| GET | `/token` | Process-scoped random token (the panel sends it as `x-panel-token`) |

> **Write authorization**: every POST must carry `x-panel-token` matching the process token, otherwise 401 — this blocks cross-origin / DNS-rebinding blind writes to the local control endpoints. GET read endpoints stay open.
> **Escape-hatch confirmation**: `POST /policy/commit` additionally requires body `{ confirm: true }` (400 otherwise). It is the only exit from the next-session "zero cache invalidation" promise — without the gate, any script or model could void that promise with a bare POST (the next turn misses the whole prefix cache), and the result would look exactly like a user-initiated click. The panel button confirms first, too.
> **Masking and "sentinel means keep"**: `env`/`headers` values are masked in `GET /mcp/detail`; the write path interprets the sentinel as "keep the current value" (restore when a live value exists, drop the key otherwise). The pair is what lets the panel round-trip a whole form without losing secrets or writing the sentinel into the config.

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

**One decision function** shared by the assembly filter, `dsh_mcp_search`, `dsh_mcp_call` and the panel badges — `decideExposure({ policy, running, aiActive, presetId })`:

1. preset not allowed → `off` (runtime isolation; physical state untouched)
2. `off` / `hidden` → as configured
3. `native` / `name-only`: process running and not inside an AI keep-alive window → as configured; otherwise degrade to `hidden` (tools stay out of context, `dsh_mcp_call` still works — capability is never silently lost)

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
pnpm setup          # link the DSH closure into node_modules (junction on Windows, symlink on POSIX)
pnpm typecheck
pnpm build          # tsdown → lib/*.js + tsc dts → lib/types
pnpm verify         # artifact checks (externals, entries, client wrapper, dependency-free pure bundles)
pnpm selftest       # run all 6 self-tests (or pnpm selftest:mcp etc. individually)
```

## 📋 Changelog

### v0.7.0 — context-bloat control + a batch of real bug fixes (equivalent ports from upstream 0.5.7–0.6.0)

This release does not merge the upstream branch (upstream 0.6.0 still carries the skill panel plus the gateway/standing-row architecture). Instead it ports the upstream fixes and two high-value optimisations one by one:

- **⚠️ Breaking: control tools renamed** `mcp_search` → `dsh_mcp_search`, `mcp_call` → `dsh_mcp_call`. Reason: the claude.ai subscription gateway treats the `mcp_` prefix as a reserved connector name — a tool table containing those two names makes the **whole request 400** with a bogus quota-exhausted error (upstream A/B/A evidence: 5/5 requests failed with them, 111/111 succeeded without). The names now come from `MCP_SEARCH_TOOL` / `MCP_CALL_TOOL`, with a self-test guard "must not start with `mcp_`"
- **`dsh_mcp_search` layered retrieval**: `server=X` returns a **capability summary** (visible total + first 5 bare names) by default; `all:true` returns the full list, paginated (20 per page, max 100); a new `query + server` searches **inside one server**. Previously a 420-tool server dumped the whole table into context, bloating then shrinking it and breaking the prefix cache
- **Snapshot/prune now cover preset rows**: `snapshotEnabled` used to walk only the loader, while preset standing rows are not in it — so their tool catalogue was never captured, and the prune `alive` set could delete their last-good snapshot. It now works off the registry snapshot (loader ∪ preset ∪ project)
- **Honest reporting for unregistered rows**: when a process runs but registers zero tools, the tool/token counts show 0 with a new "Not registered" badge instead of being backfilled from the directory snapshot
- **`/mcp/add` dedup covers preset rows**: it used to check only the loader plus patch text, so an already-installed preset server was considered absent and a duplicate row was written (same-scope serverName conflict)
- **Masked echo**: `GET /mcp/detail` masks `env`/`headers` values as `***MASKED***`; the write path treats the sentinel as "keep the current value" (implemented as a pair, so the panel's whole-form round-trip neither loses secrets nor writes the sentinel). `/mcp/scan` is deliberately not masked (token-gated, and its purpose is verbatim import)
- **`readBody` hardening**: `StringDecoder` decodes chunk by chunk (multi-byte characters split across chunks no longer mojibake); on overflow it detaches listeners and drains instead of destroying the socket (which used to make the 400 unreachable)
- **Escape-hatch confirmation**: `POST /policy/commit` requires `{ confirm: true }` (the panel confirms too). A bare POST used to let any script or model void the next-session "zero cache invalidation" promise
- **Per-tool bulk toggle**: new `POST /mcp/toolBulk` (three-state `toolNames` contract — `[]` is never "all") plus a filter box and bulk buttons in the panel; one write instead of N `toolToggle` writes
- **Session passthrough**: panel requests now carry the current session (`?session=`). They used to omit it entirely, so the host resolved `roots[0]` — with several sessions open the cards showed the session from startup time
- **Tooling**: `pnpm setup` now works on POSIX (it used to shell out to Windows `mklink /J` only); the 6 self-tests are wired as `pnpm selftest` and into `prepublishOnly`
- **Drive-by fix**: bare tool-name rendering (`^mcp__[^_]+__` left a prefix behind for server names containing underscores)

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
- **Preset scope** (runtime isolation): `all` / `only` / `except` + multi-select, enforced identically in assembly, `dsh_mcp_search` and `dsh_mcp_call`, with the process left running
- **`dsh_mcp_call` accepts a server alone** and returns its tool list when the tool name is unknown
- **`dsh_mcp_search` layering**: lists native + name-only servers, counts hidden ones, hides off/isolated ones entirely
- **Architecture**: three separate `system-prompt/assemble` filters merged into one assembly layer; the live-row and preset-row build paths unified into a registry; intent/effective policy tables replace the desired/lastApplied/pending state tangle
- **Renamed** to `dsh-mcp-panel` (entry "MCP Manager", HTTP prefix `/api/mcp-panel`, legacy prefixes kept)
- **Automatic migration** of the data directory and of `state.json` v1 → v2, with a `state.v1.json` backup

## 📄 License

MIT
