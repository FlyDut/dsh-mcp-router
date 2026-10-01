window.__ModuleLoader__.load({
	id: "dsh-mcp-router",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region \0rolldown/runtime.js
		var __create = Object.create;
		var __defProp = Object.defineProperty;
		var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
		var __getOwnPropNames = Object.getOwnPropertyNames;
		var __getProtoOf = Object.getPrototypeOf;
		var __hasOwnProp = Object.prototype.hasOwnProperty;
		var __copyProps = (to, from, except, desc) => {
			if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
				key = keys[i];
				if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
					get: ((k) => from[k]).bind(null, key),
					enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
				});
			}
			return to;
		};
		var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", {
			value: mod,
			enumerable: true
		}) : target, mod));
		//#endregion
		let react = require("react");
		react = __toESM(react, 1);
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/http.ts
		/** 带 HTTP 状态码的接口错误。 */
		var ApiError = class extends Error {
			status;
			constructor(message, status) {
				super(message);
				this.status = status;
			}
		};
		/** 非 JSON 响应的错误标记（消息前缀，便于跨模块识别）。 */
		const NON_JSON_PREFIX = "non-json-response";
		/** 读取 JSON 响应；非 JSON 时抛 {@link ApiError}（带状态码）。 */
		async function readJson(res) {
			const text = await res.text();
			try {
				return JSON.parse(text);
			} catch {
				throw new ApiError(`${NON_JSON_PREFIX}:${res.status}`, res.status);
			}
		}
		/** 把任意异常转成给用户看的一句话（含「重启 dsh web」的引导）。 */
		function describeError(error, t) {
			if (error instanceof ApiError && error.message.startsWith(NON_JSON_PREFIX)) return t("mp.errNotJson", { status: error.status });
			return error instanceof Error ? error.message : String(error);
		}
		//#endregion
		//#region src/client/auth.ts
		/**
		* 客户端认证 POST：面板与三个弹窗共用的 token 获取 + 认证请求封装。
		*
		* token 是服务端启动时生成的进程级随机令牌（`GET /token` 下发），用于阻断
		* 其它页面/扩展对写接口的跨源盲写；令牌在进程存活期内不变，模块级缓存
		* Promise 即可（多处并发写只发一次 token 请求，失败按「无令牌」降级 →
		* 服务端拒绝写，由调用方展示错误）。
		*/
		/** 进程级 token 缓存（Promise 缓存：并发调用共享同一次请求）。 */
		let tokenPromise = null;
		/** 取面板写接口令牌（失败返回 null，调用方按未授权处理）。 */
		function ensureToken() {
			if (!tokenPromise) tokenPromise = fetch("/api/dsh-mcp-router/token").then((r) => r.json()).then((b) => b?.token ?? null).catch(() => null);
			return tokenPromise;
		}
		/** 组装认证请求头（JSON + 令牌）。 */
		async function authHeaders() {
			const token = await ensureToken();
			const headers = { "content-type": "application/json" };
			if (token) headers["x-panel-token"] = token;
			return headers;
		}
		/** 认证 POST：自动带 token，响应统一走 readJson（非 JSON 时抛 ApiError）。 */
		async function post(path, payload) {
			return await readJson(await fetch(path, {
				method: "POST",
				headers: await authHeaders(),
				body: JSON.stringify(payload)
			}));
		}
		//#endregion
		//#region src/client/ui.ts
		/** 弹窗遮罩（全屏半透明黑 + 居中）。 */
		const overlay = {
			position: "fixed",
			inset: 0,
			background: "rgba(0, 0, 0, 0.45)",
			display: "flex",
			alignItems: "center",
			justifyContent: "center",
			zIndex: 1e3
		};
		/** 弹窗主体：宽度自适应（小屏留 24px 边距）、超高滚动、随主题卡片样式。 */
		function modal(widthPx, gap = 12) {
			return {
				width: `min(${widthPx}px, calc(100vw - 48px))`,
				maxHeight: "calc(100vh - 80px)",
				overflowY: "auto",
				background: "var(--dsw-alias-bg-layer-1)",
				border: "1px solid var(--dsw-alias-border-l2)",
				borderRadius: 10,
				padding: "16px 18px",
				display: "flex",
				flexDirection: "column",
				gap,
				boxShadow: "0 8px 30px rgba(0,0,0,0.25)"
			};
		}
		/** 弹窗标题（16px/600）。 */
		const title = {
			margin: 0,
			fontSize: 16,
			fontWeight: 600,
			color: "var(--dsw-alias-label-primary)"
		};
		/** 块状提示（可换行，行高 16px）。 */
		const hintBlock = {
			margin: 0,
			fontSize: 11,
			color: "var(--dsw-alias-label-tertiary)",
			lineHeight: "16px"
		};
		/** 表单字段标签。 */
		const label = {
			fontSize: 12,
			color: "var(--dsw-alias-label-secondary)"
		};
		/** 单行排布（可叠加额外属性，如 flexWrap）。 */
		function row(extra) {
			return {
				display: "flex",
				alignItems: "center",
				gap: 8,
				...extra
			};
		}
		/** 分段切换按钮（active 高亮信息色；padPx 微调左右内边距）。 */
		function tab(active, padPx = 14) {
			return {
				font: "inherit",
				cursor: "pointer",
				border: "1px solid",
				borderRadius: 6,
				padding: `4px ${padPx}px`,
				fontSize: 12,
				fontWeight: active ? 600 : 400,
				color: active ? "var(--dsw-alias-label-primary)" : "var(--dsw-alias-label-tertiary)",
				background: active ? "color-mix(in srgb, var(--dsw-alias-state-info-primary, #4a90d9) 16%, transparent)" : "transparent",
				borderColor: active ? "var(--dsw-alias-state-info-primary, #4a90d9)" : "var(--dsw-alias-border-l2)"
			};
		}
		/** 次要按钮（描边）。 */
		const action = {
			font: "inherit",
			cursor: "pointer",
			border: "1px solid var(--dsw-alias-border-l2)",
			background: "var(--dsw-alias-bg-layer-1)",
			color: "var(--dsw-alias-label-secondary)",
			borderRadius: 6,
			padding: "5px 14px",
			fontSize: 12
		};
		/** 主按钮（实心成功色）。 */
		const primary = {
			font: "inherit",
			cursor: "pointer",
			border: 0,
			borderRadius: 6,
			padding: "5px 16px",
			fontSize: 12,
			color: "var(--dsw-alias-label-inverse, #fff)",
			background: "var(--dsw-alias-state-success-primary)"
		};
		/** 请求进行中（半透明 + 进度光标）。 */
		const disabled = {
			opacity: .55,
			cursor: "progress"
		};
		/** 错误提示条（左缘红条）。 */
		const error = {
			fontSize: 12,
			color: "var(--dsw-alias-label-primary)",
			background: "color-mix(in srgb, var(--dsw-alias-state-error-primary) 14%, transparent)",
			borderLeft: "3px solid var(--dsw-alias-state-error-primary)",
			borderRadius: 6,
			padding: "8px 10px"
		};
		/** 成功提示条（左缘绿条）。 */
		const success = {
			fontSize: 12,
			color: "var(--dsw-alias-label-primary)",
			background: "color-mix(in srgb, var(--dsw-alias-state-success-primary) 14%, transparent)",
			borderLeft: "3px solid var(--dsw-alias-state-success-primary)",
			borderRadius: 6,
			padding: "8px 10px"
		};
		/** 等宽只读代码块（YAML 预览等）。 */
		const pre = {
			margin: 0,
			maxHeight: 220,
			overflow: "auto",
			fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
			fontSize: 11,
			lineHeight: "16px",
			color: "var(--dsw-alias-label-secondary)",
			background: "var(--dsw-alias-bg-layer-2)",
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 6,
			padding: "8px 10px",
			whiteSpace: "pre-wrap"
		};
		/** 等宽单行输入框（可叠加额外属性，如 flex: 1）。 */
		function monoInput(extra) {
			return {
				font: "inherit",
				fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
				fontSize: 12,
				lineHeight: "18px",
				background: "var(--dsw-alias-bg-layer-2)",
				color: "var(--dsw-alias-label-primary)",
				border: "1px solid var(--dsw-alias-border-l2)",
				borderRadius: 6,
				padding: "6px 8px",
				...extra
			};
		}
		/** 等宽多行文本域（粘贴 JSON 用，可纵向拖高）。 */
		const monoArea = {
			...monoInput(),
			padding: "8px 10px",
			resize: "vertical",
			minHeight: 120
		};
		/** 底部按钮排（可叠加额外属性，如 marginTop）。 */
		function footer(extra) {
			return {
				display: "flex",
				justifyContent: "flex-end",
				gap: 8,
				...extra
			};
		}
		//#endregion
		//#region src/client/add-mcp.tsx
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
		/** 类型选项（面板渲染顺序）：直接使用 dsh-mcp-client 的传输名。 */
		const TYPES = ["stdio", "streamable-http"];
		/** 与 mcp-convert.ts 的 serverName 校验一致（dsh-mcp-client 要求全进程唯一）。 */
		const NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
		/** 样式薄别名层：共享件来自 ui.ts；field/fieldLabel/radio 系为本弹窗特有。 */
		const C$4 = {
			overlay,
			modal: modal(680, 10),
			title,
			hint: hintBlock,
			field: {
				display: "flex",
				flexDirection: "column",
				gap: 4
			},
			fieldLabel: {
				fontSize: 12,
				fontWeight: 600,
				color: "var(--dsw-alias-label-primary)"
			},
			/** 必填星号（设计稿中的红色 *）。 */
			req: { color: "var(--dsw-alias-state-error-primary)" },
			radioRow: {
				display: "flex",
				alignItems: "center",
				gap: 16
			},
			radio: {
				display: "inline-flex",
				alignItems: "center",
				gap: 5,
				fontSize: 12,
				color: "var(--dsw-alias-label-primary)",
				cursor: "pointer"
			},
			input: monoInput(),
			area: {
				...monoArea,
				minHeight: 76
			},
			row: row(),
			tab,
			action,
			primary,
			disabled,
			error,
			pre,
			footer: footer({ marginTop: 4 })
		};
		/** 多行文本 → 去空行、去首尾空白的行数组（参数：每行一个，`--flag=value` 原样保留）。 */
		function toLines$1(text) {
			return text.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
		}
		/**
		* 多行 `KEY<sep>VALUE` → 字典（环境变量用 `=`、请求头用 `:`）。
		* 只切首个分隔符：value 里含 `=`（base64）或 `:`（URL）都原样保留。
		*/
		function toDict$1(text, sep) {
			const out = {};
			for (const line of toLines$1(text)) {
				const at = line.indexOf(sep);
				if (at <= 0) continue;
				const key = line.slice(0, at).trim();
				if (key.length === 0) continue;
				out[key] = line.slice(at + 1).trim();
			}
			return out;
		}
		/** 表单 → mcpServers 条目（键序与设计稿一致：type 开头，空的可选字段不落）。 */
		function buildConfig(input) {
			const config = { type: input.type };
			if (input.type === "stdio") {
				config.command = input.command.trim();
				const args = toLines$1(input.argsText);
				if (args.length > 0) config.args = args;
				const env = toDict$1(input.envText, "=");
				if (Object.keys(env).length > 0) config.env = env;
				return config;
			}
			config.url = input.url.trim();
			const headers = toDict$1(input.headersText, ":");
			if (Object.keys(headers).length > 0) config.headers = headers;
			return config;
		}
		function AddMcpModal(props) {
			const { t, workspace, onClose, onAdded } = props;
			const [type, setType] = (0, react.useState)("stdio");
			const [serverName, setServerName] = (0, react.useState)("");
			const [command, setCommand] = (0, react.useState)("");
			const [argsText, setArgsText] = (0, react.useState)("");
			const [envText, setEnvText] = (0, react.useState)("");
			const [url, setUrl] = (0, react.useState)("");
			const [headersText, setHeadersText] = (0, react.useState)("");
			const [target, setTarget] = (0, react.useState)("global");
			const [busy, setBusy] = (0, react.useState)(false);
			const [formError, setFormError] = (0, react.useState)(null);
			const [result, setResult] = (0, react.useState)(null);
			const config = (0, react.useMemo)(() => buildConfig({
				type,
				command,
				argsText,
				envText,
				url,
				headersText
			}), [
				type,
				command,
				argsText,
				envText,
				url,
				headersText
			]);
			const preview = (0, react.useMemo)(() => JSON.stringify(config, null, 2), [config]);
			const submit = (0, react.useCallback)(async () => {
				const name = serverName.trim();
				if (!NAME_PATTERN.test(name)) {
					setFormError(t("mp.addMcpNameInvalid"));
					return;
				}
				if (type === "stdio" && command.trim().length === 0) {
					setFormError(t("mp.addMcpCommandRequired"));
					return;
				}
				if (type !== "stdio" && url.trim().length === 0) {
					setFormError(t("mp.addMcpUrlRequired"));
					return;
				}
				setBusy(true);
				setFormError(null);
				setResult(null);
				try {
					const body = await post("/api/dsh-mcp-router/mcp/add", {
						json: JSON.stringify({ mcpServers: { [name]: config } }),
						target
					});
					if (!body.ok || typeof body.added !== "number") throw new Error(typeof body.error === "string" ? body.error : "add failed");
					onAdded();
					onClose();
				} catch (err) {
					setResult(t("mp.addMcpError", { error: describeError(err, t) }));
				} finally {
					setBusy(false);
				}
			}, [
				serverName,
				type,
				command,
				url,
				config,
				target,
				t,
				onAdded,
				onClose
			]);
			/** 必填星号（设计稿的红色 `*`）。 */
			const req = /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				style: C$4.req,
				children: " *"
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: C$4.overlay,
				role: "dialog",
				"aria-modal": "true",
				onClick: onClose,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: C$4.modal,
					onClick: (event) => event.stopPropagation(),
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
							style: C$4.title,
							children: t("mp.addMcp")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							style: C$4.hint,
							children: t("mp.addMcpFormHint")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: C$4.field,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								style: C$4.fieldLabel,
								children: [t("mp.addMcpType"), req]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: C$4.radioRow,
								role: "radiogroup",
								"aria-label": t("mp.addMcpType"),
								children: TYPES.map((value) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									style: C$4.radio,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										type: "radio",
										name: "dsh-mcp-router-add-type",
										checked: type === value,
										onChange: () => setType(value)
									}), value]
								}, value))
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: C$4.field,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								style: C$4.fieldLabel,
								children: [t("mp.addMcpTitleLabel"), req]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								style: C$4.input,
								value: serverName,
								onChange: (event) => setServerName(event.target.value),
								placeholder: "brave-search",
								spellCheck: false
							})]
						}),
						type === "stdio" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: C$4.field,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									style: C$4.fieldLabel,
									children: [t("mp.editCommand"), req]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									style: C$4.input,
									value: command,
									onChange: (event) => setCommand(event.target.value),
									placeholder: "npx",
									spellCheck: false
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: C$4.field,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: C$4.fieldLabel,
										children: t("mp.editArgs")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
										style: C$4.area,
										value: argsText,
										onChange: (event) => setArgsText(event.target.value),
										placeholder: "-y\n@brave/brave-search-mcp-server\n--transport\nstdio",
										spellCheck: false
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: C$4.hint,
										children: t("mp.editOnePerLine")
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: C$4.field,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: C$4.fieldLabel,
										children: t("mp.editEnv")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
										style: C$4.area,
										value: envText,
										onChange: (event) => setEnvText(event.target.value),
										placeholder: "KEY1=value1\nKEY2=value2",
										spellCheck: false
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: C$4.hint,
										children: t("mp.editOnePerLine")
									})
								]
							})
						] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: C$4.field,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								style: C$4.fieldLabel,
								children: [t("mp.editUrl"), req]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								style: C$4.input,
								value: url,
								onChange: (event) => setUrl(event.target.value),
								placeholder: "https://api.example.com/mcp",
								spellCheck: false
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: C$4.field,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: C$4.fieldLabel,
									children: t("mp.addMcpHeadersOptional")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
									style: C$4.area,
									value: headersText,
									onChange: (event) => setHeadersText(event.target.value),
									placeholder: "Authorization: Bearer your_token_here\nContent-Type: application/json",
									spellCheck: false
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: C$4.hint,
									children: t("mp.editOnePerLine")
								})
							]
						})] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: C$4.field,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: C$4.fieldLabel,
								children: t("mp.addMcpTarget")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: C$4.row,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										style: C$4.tab(target === "global"),
										onClick: () => setTarget("global"),
										children: t("mp.addMcpTargetGlobal")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										style: {
											...C$4.tab(target === "project"),
											...workspace ? {} : {
												opacity: .5,
												cursor: "not-allowed"
											}
										},
										disabled: !workspace,
										onClick: () => setTarget("project"),
										children: t("mp.addMcpTargetProject")
									}),
									target === "project" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: {
											...C$4.hint,
											flex: 1
										},
										children: workspace ?? t("mp.addMcpNoWorkspace")
									})
								]
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: C$4.field,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: C$4.fieldLabel,
								children: t("mp.addMcpPreviewTitle")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
								style: C$4.pre,
								children: preview
							})]
						}),
						formError && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: C$4.error,
							children: formError
						}),
						result && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: C$4.error,
							children: result
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: C$4.footer,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: C$4.action,
								disabled: busy,
								onClick: onClose,
								children: t("mp.addMcpCancel")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: {
									...C$4.primary,
									...busy ? C$4.disabled : {}
								},
								disabled: busy,
								onClick: () => void submit(),
								children: busy ? t("mp.working") : t("mp.addMcpConfirm")
							})]
						})
					]
				})
			});
		}
		//#endregion
		//#region src/client/edit-mcp.tsx
		/**
		* 编辑 MCP 弹窗：读取该行的可写目标与当前配置，改完写回源文件并同步运行时。
		*
		* - 可写行：全局行（profile patch）/ 项目行（`.dsh/mcps/mcp.json`）
		* - 只读行：预设组合行（`agent.cordis.yml`）——本组件不会打开（卡片按钮已禁用）
		* - 含 `!!js` 动态表达式的字段：以只读形式列出，保存时原样保留、绝不固化成明文
		*/
		/** 样式薄别名层：共享件来自 ui.ts；field/dynamic 为本弹窗特有。 */
		const C$3 = {
			overlay,
			modal: modal(680, 10),
			title,
			hint: hintBlock,
			field: {
				display: "flex",
				flexDirection: "column",
				gap: 3
			},
			label,
			input: monoInput(),
			row: row(),
			tab,
			action,
			primary,
			disabled,
			error,
			dynamic: {
				fontSize: 11,
				color: "var(--dsw-alias-label-tertiary)",
				background: "var(--dsw-alias-bg-layer-2)",
				border: "1px dashed var(--dsw-alias-border-l2)",
				borderRadius: 6,
				padding: "6px 8px",
				fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
				whiteSpace: "pre-wrap"
			},
			footer: footer({ marginTop: 4 })
		};
		/** 多行文本 → 字符串数组（去空行）。 */
		function toLines(text) {
			return text.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
		}
		/** 多行 `KEY=VALUE` → 字典。 */
		function toDict(text) {
			const out = {};
			for (const line of toLines(text)) {
				const at = line.indexOf("=");
				if (at <= 0) continue;
				out[line.slice(0, at).trim()] = line.slice(at + 1).trim();
			}
			return out;
		}
		function fromDict(dict) {
			if (!dict) return "";
			return Object.entries(dict).map(([key, value]) => `${key}=${value}`).join("\n");
		}
		function EditMcpModal(props) {
			const { t, row, onClose, onSaved } = props;
			const [detail, setDetail] = (0, react.useState)(null);
			const [error, setError] = (0, react.useState)(null);
			const [busy, setBusy] = (0, react.useState)(false);
			const [serverName, setServerName] = (0, react.useState)(row.serverName);
			const [transport, setTransport] = (0, react.useState)("stdio");
			const [command, setCommand] = (0, react.useState)("");
			const [argsText, setArgsText] = (0, react.useState)("");
			const [cwd, setCwd] = (0, react.useState)("");
			const [envText, setEnvText] = (0, react.useState)("");
			const [url, setUrl] = (0, react.useState)("");
			const [headersText, setHeadersText] = (0, react.useState)("");
			const [timeoutText, setTimeoutText] = (0, react.useState)("");
			(0, react.useEffect)(() => {
				const query = new URLSearchParams({ serverName: row.serverName });
				if (row.workspace) query.set("workspace", row.workspace);
				fetch(`/api/dsh-mcp-router/mcp/detail?${query.toString()}`).then((res) => readJson(res)).then((body) => {
					if (!body.ok) throw new Error(body.error ?? "detail failed");
					const data = body;
					setDetail(data);
					const config = data.config ?? {};
					setServerName(config.serverName ?? row.serverName);
					setTransport(config.transport === "streamable-http" ? "streamable-http" : "stdio");
					setCommand(config.command ?? "");
					setArgsText((config.args ?? []).join("\n"));
					setCwd(config.cwd ?? "");
					setEnvText(fromDict(config.env));
					setUrl(config.url ?? "");
					setHeadersText(fromDict(config.headers));
					setTimeoutText(config.toolCallTimeoutMs !== void 0 ? String(config.toolCallTimeoutMs) : "");
				}).catch((err) => setError(describeError(err, t)));
			}, [
				row.serverName,
				row.workspace,
				t
			]);
			const dynamicKeys = new Set((detail?.keys ?? []).filter((key) => key.dynamic).map((key) => key.name));
			const envDynamic = dynamicKeys.has("env");
			const headersDynamic = dynamicKeys.has("headers");
			const save = (0, react.useCallback)(async () => {
				setBusy(true);
				setError(null);
				const timeout = Number(timeoutText);
				const patch = {
					serverName: serverName.trim(),
					transport
				};
				if (transport === "stdio") {
					patch.command = command.trim();
					patch.args = toLines(argsText);
					if (!envDynamic) patch.env = toDict(envText);
					patch.cwd = cwd.trim();
				} else {
					patch.url = url.trim();
					if (!headersDynamic) patch.headers = toDict(headersText);
				}
				if (timeoutText.trim().length > 0 && Number.isFinite(timeout) && timeout > 0) patch.toolCallTimeoutMs = timeout;
				try {
					const headers = await authHeaders();
					const body = await readJson(await fetch("/api/dsh-mcp-router/mcp/update", {
						method: "POST",
						headers,
						body: JSON.stringify({
							serverName: row.serverName,
							workspace: row.workspace,
							patch
						})
					}));
					if (!body.ok) throw new Error(body.error ?? "update failed");
					onSaved();
					onClose();
				} catch (err) {
					setError(t("mp.editError", { error: describeError(err, t) }));
				} finally {
					setBusy(false);
				}
			}, [
				argsText,
				command,
				cwd,
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
				url
			]);
			const targetLabel = detail?.target.kind === "project" ? t("mp.editTargetProject") : t("mp.editTargetPatch");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: C$3.overlay,
				role: "dialog",
				"aria-modal": "true",
				onClick: onClose,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: C$3.modal,
					onClick: (event) => event.stopPropagation(),
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
							style: C$3.title,
							children: t("mp.editTitle", { server: row.serverName })
						}),
						detail && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
							style: C$3.hint,
							children: [
								targetLabel,
								": ",
								detail.target.file
							]
						}),
						dynamicKeys.size > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: C$3.dynamic,
							children: t("mp.editDynamicNote", { keys: [...dynamicKeys].join(", ") })
						}),
						error && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: C$3.error,
							children: error
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: C$3.field,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: C$3.label,
									children: t("mp.editServerName")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									style: C$3.input,
									value: serverName,
									onChange: (event) => setServerName(event.target.value),
									spellCheck: false
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: C$3.hint,
									children: t("mp.editServerNameHint")
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: C$3.row,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: C$3.label,
									children: t("mp.editTransport")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									style: C$3.tab(transport === "stdio"),
									onClick: () => setTransport("stdio"),
									children: "stdio"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									style: C$3.tab(transport === "streamable-http"),
									onClick: () => setTransport("streamable-http"),
									children: "streamable-http"
								})
							]
						}),
						transport === "stdio" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: C$3.field,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: C$3.label,
									children: t("mp.editCommand")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									style: C$3.input,
									value: command,
									onChange: (event) => setCommand(event.target.value),
									spellCheck: false
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: C$3.field,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: C$3.label,
										children: t("mp.editArgs")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
										style: {
											...C$3.input,
											minHeight: 60,
											resize: "vertical"
										},
										value: argsText,
										onChange: (event) => setArgsText(event.target.value),
										spellCheck: false
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: C$3.hint,
										children: t("mp.editOnePerLine")
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: C$3.field,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: C$3.label,
									children: t("mp.editEnv")
								}), envDynamic ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									style: C$3.dynamic,
									children: t("mp.editDynamicFieldKept", { field: "env" })
								}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
									style: {
										...C$3.input,
										minHeight: 60,
										resize: "vertical"
									},
									value: envText,
									onChange: (event) => setEnvText(event.target.value),
									placeholder: "KEY=VALUE",
									spellCheck: false
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: C$3.field,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: C$3.label,
									children: t("mp.editCwd")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									style: C$3.input,
									value: cwd,
									onChange: (event) => setCwd(event.target.value),
									spellCheck: false
								})]
							})
						] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: C$3.field,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: C$3.label,
								children: t("mp.editUrl")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								style: C$3.input,
								value: url,
								onChange: (event) => setUrl(event.target.value),
								spellCheck: false
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: C$3.field,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: C$3.label,
								children: t("mp.editHeaders")
							}), headersDynamic ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: C$3.dynamic,
								children: t("mp.editDynamicFieldKept", { field: "headers" })
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
								style: {
									...C$3.input,
									minHeight: 60,
									resize: "vertical"
								},
								value: headersText,
								onChange: (event) => setHeadersText(event.target.value),
								placeholder: "Authorization=Bearer …",
								spellCheck: false
							})]
						})] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: C$3.field,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: C$3.label,
								children: t("mp.editTimeout")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								style: C$3.input,
								value: timeoutText,
								onChange: (event) => setTimeoutText(event.target.value),
								placeholder: "60000",
								spellCheck: false
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: C$3.footer,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: C$3.action,
								disabled: busy,
								onClick: onClose,
								children: t("mp.editCancel")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: {
									...C$3.primary,
									...busy ? C$3.disabled : {}
								},
								disabled: busy || !detail,
								onClick: () => void save(),
								children: busy ? t("mp.working") : t("mp.editSave")
							})]
						})
					]
				})
			});
		}
		//#endregion
		//#region src/client/import-mcp.tsx
		/**
		* 从其它 Agent 导入 MCP 弹窗。
		*
		* 流程：自动扫描本机已知来源（opencode / zcode / Claude Code / Cursor / Gemini CLI / 项目级
		* .mcp.json 等，可追加自定义路径）→ 勾选要导入的服务器 → 选目标（全局 / 项目）与导入后的
		* 档位 → 复用现有 `/mcp/add` 落盘并由后端挂载 → 再对新导入项批量 `/policy` 设档位。
		*
		* 扫描是**只读**的：面板不会修改任何源文件，也不会同步源文件后续变化（一次性快照）。
		*/
		const EXPOSURES = [
			"name-only",
			"hidden",
			"off"
		];
		/** 样式薄别名层：共享件来自 ui.ts；group/item/badge 系列为本弹窗特有。 */
		const C$2 = {
			overlay,
			modal: modal(760, 10),
			title,
			hint: hintBlock,
			group: {
				border: "1px solid var(--dsw-alias-border-l2)",
				borderRadius: 8,
				padding: "8px 10px",
				display: "flex",
				flexDirection: "column",
				gap: 4
			},
			groupHead: {
				fontSize: 12,
				color: "var(--dsw-alias-label-secondary)",
				fontWeight: 600
			},
			item: {
				display: "flex",
				alignItems: "center",
				gap: 8,
				fontSize: 12
			},
			itemName: {
				color: "var(--dsw-alias-label-primary)",
				fontWeight: 500,
				flex: "0 0 auto"
			},
			itemDesc: {
				color: "var(--dsw-alias-label-tertiary)",
				flex: 1,
				overflow: "hidden",
				textOverflow: "ellipsis",
				whiteSpace: "nowrap"
			},
			badge: (color, bg) => ({
				fontSize: 11,
				lineHeight: "16px",
				padding: "0 6px",
				borderRadius: 999,
				color,
				background: bg,
				whiteSpace: "nowrap"
			}),
			input: monoInput({ flex: 1 }),
			row: row({ flexWrap: "wrap" }),
			label,
			tab: (active) => tab(active, 12),
			action,
			primary,
			disabled,
			error,
			success,
			footer: footer({ marginTop: 4 })
		};
		function ImportMcpModal(props) {
			const { t, workspace, defaultExposure, onClose, onImported } = props;
			const [sources, setSources] = (0, react.useState)([]);
			const [selected, setSelected] = (0, react.useState)({});
			const [customPath, setCustomPath] = (0, react.useState)("");
			const [target, setTarget] = (0, react.useState)("global");
			const [exposure, setExposure] = (0, react.useState)(defaultExposure ?? "name-only");
			const [scanning, setScanning] = (0, react.useState)(false);
			const [importing, setImporting] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)(null);
			const [result, setResult] = (0, react.useState)(null);
			const scan = (0, react.useCallback)(async (extraPaths = []) => {
				setScanning(true);
				setError(null);
				try {
					const body = await readJson(await fetch("/api/dsh-mcp-router/mcp/scan", {
						method: "POST",
						headers: await authHeaders(),
						body: JSON.stringify({ paths: extraPaths })
					}));
					if (!body.ok) throw new Error(body.error ?? "scan failed");
					setSources(body.sources ?? []);
				} catch (err) {
					setError(describeError(err, t));
				} finally {
					setScanning(false);
				}
			}, [t]);
			(0, react.useEffect)(() => {
				scan();
			}, [scan]);
			const toggle = (0, react.useCallback)((server) => {
				setSelected((prev) => {
					const next = { ...prev };
					if (next[server.name]) delete next[server.name];
					else next[server.name] = server;
					return next;
				});
			}, []);
			const chosen = Object.values(selected);
			const doImport = (0, react.useCallback)(async () => {
				if (chosen.length === 0) return;
				setImporting(true);
				setError(null);
				setResult(null);
				try {
					const mcpServers = {};
					for (const server of chosen) mcpServers[server.name] = server.config;
					const body = await readJson(await fetch("/api/dsh-mcp-router/mcp/add", {
						method: "POST",
						headers: await authHeaders(),
						body: JSON.stringify({
							json: JSON.stringify({ mcpServers }),
							target
						})
					}));
					if (!body.ok) throw new Error(body.error ?? "import failed");
					const names = body.names ?? chosen.map((server) => server.name);
					if (exposure !== "name-only" && names.length > 0) await fetch("/api/dsh-mcp-router/policy", {
						method: "POST",
						headers: await authHeaders(),
						body: JSON.stringify({ updates: names.map((name) => ({
							serverName: name,
							exposure
						})) })
					});
					setResult(t("mp.importDone", {
						n: body.added ?? chosen.length,
						skipped: body.skipped && body.skipped.length > 0 ? t("mp.importSkipped", { names: body.skipped.join(", ") }) : ""
					}));
					setSelected({});
					onImported();
					await scan();
				} catch (err) {
					setError(t("mp.importError", { error: describeError(err, t) }));
				} finally {
					setImporting(false);
				}
			}, [
				chosen,
				exposure,
				onImported,
				scan,
				t,
				target
			]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: C$2.overlay,
				role: "dialog",
				"aria-modal": "true",
				onClick: onClose,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: C$2.modal,
					onClick: (event) => event.stopPropagation(),
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
							style: C$2.title,
							children: t("mp.importTitle")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							style: C$2.hint,
							children: t("mp.importHint")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: C$2.row,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									style: C$2.input,
									value: customPath,
									onChange: (event) => setCustomPath(event.target.value),
									placeholder: t("mp.importCustomPathPh"),
									spellCheck: false
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									style: C$2.action,
									disabled: scanning || customPath.trim().length === 0,
									onClick: () => void scan([customPath.trim()]),
									children: scanning ? t("mp.working") : t("mp.importAddPath")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									style: C$2.action,
									disabled: scanning,
									onClick: () => void scan(),
									children: t("mp.importRescan")
								})
							]
						}),
						error && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: C$2.error,
							children: error
						}),
						result && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: C$2.success,
							children: result
						}),
						sources.map((source) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: C$2.group,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									style: C$2.groupHead,
									children: [
										source.label,
										" · ",
										source.file
									]
								}),
								!source.exists && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: C$2.hint,
									children: t("mp.importMissing")
								}),
								source.exists && source.skipped && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: C$2.hint,
									children: source.skipped
								}),
								source.exists && !source.skipped && source.errors && source.errors.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: C$2.hint,
									children: source.errors.join("；")
								}),
								source.exists && !source.skipped && source.servers && source.servers.length === 0 && !(source.errors ?? []).length && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: C$2.hint,
									children: t("mp.importNoServers")
								}),
								(source.servers ?? []).map((server) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									style: C$2.item,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											type: "checkbox",
											checked: Boolean(selected[server.name]),
											onChange: () => toggle(server)
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: C$2.itemName,
											children: server.name
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: C$2.badge(server.transport === "stdio" ? "var(--dsw-alias-state-info-primary, #4a90d9)" : "var(--dsw-alias-state-warn-primary)", server.transport === "stdio" ? "var(--dsw-alias-state-info-tertiary, rgba(74,144,217,0.15))" : "var(--dsw-alias-state-warn-tertiary)"),
											children: server.transport
										}),
										!server.enabled && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: C$2.badge("var(--dsw-alias-label-tertiary)", "var(--dsw-alias-fill-l2)"),
											children: t("mp.importDisabled")
										}),
										server.existing && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: C$2.badge("var(--dsw-alias-state-warn-primary)", "var(--dsw-alias-state-warn-tertiary)"),
											children: t("mp.importExisting")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: C$2.itemDesc,
											title: server.summary,
											children: server.summary
										})
									]
								}, `${source.id}:${server.name}`))
							]
						}, source.id)),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: C$2.row,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: C$2.label,
									children: t("mp.importTarget")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									style: C$2.tab(target === "global"),
									onClick: () => setTarget("global"),
									children: t("mp.addMcpTargetGlobal")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									style: {
										...C$2.tab(target === "project"),
										...workspace ? {} : {
											opacity: .5,
											cursor: "not-allowed"
										}
									},
									disabled: !workspace,
									onClick: () => setTarget("project"),
									children: t("mp.addMcpTargetProject")
								}),
								target === "project" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: C$2.hint,
									children: workspace ?? t("mp.addMcpNoWorkspace")
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: C$2.row,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: C$2.label,
								children: t("mp.importExposure")
							}), EXPOSURES.map((value) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: C$2.tab(exposure === value),
								onClick: () => setExposure(value),
								children: t(`mp.exposure${value === "name-only" ? "NameOnly" : value === "hidden" ? "Hidden" : "Off"}`)
							}, value))]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: C$2.footer,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: {
										...C$2.hint,
										flex: 1,
										alignSelf: "center"
									},
									children: t("mp.importSelected", { n: chosen.length })
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									style: C$2.action,
									disabled: importing,
									onClick: onClose,
									children: t("mp.editCancel")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									style: {
										...C$2.primary,
										...importing || chosen.length === 0 ? C$2.disabled : {}
									},
									disabled: importing || chosen.length === 0,
									onClick: () => void doImport(),
									children: importing ? t("mp.working") : t("mp.importConfirm")
								})
							]
						})
					]
				})
			});
		}
		//#endregion
		//#region src/client/server-card.tsx
		/**
		* MCP 服务器卡片：档位选择器（四档）+ 预设关联 + 工具级禁用。
		*
		* 交互契约：
		* - 档位是**唯一**的服务器状态控件（同时决定进程期望状态与上下文注入量）；
		* - 预设关联是纯运行时隔离（不改变物理运行状态），三模式 + 预设复选列表；
		* - 工具级禁用在 server 级档位之上按工具精确控制。
		* 所有写操作经父级传入的 `submit`（统一携带 x-panel-token 并处理错误）。
		*/
		const C$1 = {
			card: {
				background: "var(--dsw-alias-bg-layer-1)",
				border: "1px solid var(--dsw-alias-border-l2)",
				borderRadius: 8,
				padding: "10px 12px",
				display: "flex",
				flexDirection: "column",
				gap: 6
			},
			top: {
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				gap: 8,
				flexWrap: "wrap"
			},
			title: {
				margin: 0,
				fontSize: 14,
				fontWeight: 600,
				color: "var(--dsw-alias-label-primary)",
				display: "flex",
				alignItems: "center",
				gap: 6,
				flexWrap: "wrap"
			},
			meta: {
				fontSize: 11,
				color: "var(--dsw-alias-label-tertiary)"
			},
			badge: (color, bg) => ({
				fontSize: 11,
				lineHeight: "16px",
				padding: "0 7px",
				borderRadius: 999,
				color,
				background: bg,
				whiteSpace: "nowrap"
			}),
			segmented: {
				display: "flex",
				gap: 0,
				border: "1px solid var(--dsw-alias-border-l2)",
				borderRadius: 6,
				overflow: "hidden",
				alignSelf: "flex-start"
			},
			seg: (active) => ({
				font: "inherit",
				cursor: "pointer",
				border: 0,
				padding: "4px 10px",
				fontSize: 12,
				color: active ? "var(--dsw-alias-label-inverse, #fff)" : "var(--dsw-alias-label-secondary)",
				background: active ? "var(--dsw-alias-label-primary)" : "transparent",
				whiteSpace: "nowrap"
			}),
			hint: {
				margin: 0,
				fontSize: 11,
				color: "var(--dsw-alias-label-tertiary)",
				lineHeight: "16px"
			},
			fold: {
				font: "inherit",
				cursor: "pointer",
				border: 0,
				background: "transparent",
				color: "var(--dsw-alias-label-tertiary)",
				padding: "2px 0",
				fontSize: 12,
				alignSelf: "flex-start"
			},
			panel: {
				marginTop: 2,
				borderTop: "1px solid var(--dsw-alias-border-l2)",
				paddingTop: 6,
				display: "flex",
				flexDirection: "column",
				gap: 6
			},
			presetRow: {
				display: "flex",
				gap: 6,
				flexWrap: "wrap",
				alignItems: "center"
			},
			presetItem: {
				display: "inline-flex",
				alignItems: "center",
				gap: 4,
				fontSize: 12,
				color: "var(--dsw-alias-label-secondary)",
				background: "var(--dsw-alias-bg-layer-2)",
				border: "1px solid var(--dsw-alias-border-l2)",
				borderRadius: 999,
				padding: "1px 8px"
			},
			toolBar: {
				display: "flex",
				alignItems: "center",
				gap: 6,
				flexWrap: "wrap",
				fontSize: 11
			},
			toolFilter: {
				flex: "1 1 140px",
				minWidth: 110,
				font: "inherit",
				fontSize: 11,
				padding: "3px 8px",
				borderRadius: 6,
				color: "var(--dsw-alias-label-primary)",
				background: "color-mix(in srgb, var(--dsw-alias-label-primary) 7%, transparent)",
				border: "1px solid var(--dsw-alias-border-l2)"
			},
			toolBulkBtn: (disabled) => ({
				font: "inherit",
				cursor: disabled ? "not-allowed" : "pointer",
				border: "1px solid var(--dsw-alias-border-l2)",
				borderRadius: 6,
				padding: "3px 8px",
				fontSize: 11,
				opacity: disabled ? .5 : 1,
				color: "var(--dsw-alias-label-secondary)",
				background: "var(--dsw-alias-bg-layer-1)",
				whiteSpace: "nowrap"
			}),
			toolList: {
				marginTop: 2,
				borderTop: "1px solid var(--dsw-alias-border-l2)",
				paddingTop: 6,
				display: "flex",
				flexDirection: "column",
				gap: 4,
				maxHeight: 220,
				overflowY: "auto"
			},
			toolRow: {
				display: "flex",
				alignItems: "center",
				gap: 8,
				fontSize: 12
			},
			toolName: {
				flex: "0 0 auto",
				color: "var(--dsw-alias-label-primary)",
				fontWeight: 500
			},
			toolDesc: {
				flex: 1,
				color: "var(--dsw-alias-label-tertiary)",
				overflow: "hidden",
				textOverflow: "ellipsis",
				whiteSpace: "nowrap"
			},
			opBtn: (primary, disabled) => ({
				font: "inherit",
				cursor: disabled ? "not-allowed" : "pointer",
				border: "1px solid var(--dsw-alias-border-l2)",
				borderRadius: 6,
				padding: "3px 10px",
				fontSize: 11,
				opacity: disabled ? .5 : 1,
				color: primary ? "var(--dsw-alias-state-error-primary)" : "var(--dsw-alias-label-secondary)",
				background: "var(--dsw-alias-bg-layer-1)",
				borderColor: primary ? "color-mix(in srgb, var(--dsw-alias-state-error-primary) 45%, var(--dsw-alias-border-l2))" : "var(--dsw-alias-border-l2)",
				whiteSpace: "nowrap"
			}),
			actions: {
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				gap: 8,
				marginTop: 2,
				flexWrap: "wrap"
			},
			toolSwitch: (disabled) => ({
				font: "inherit",
				cursor: "pointer",
				border: 0,
				borderRadius: 5,
				padding: "2px 10px",
				fontSize: 11,
				flex: "0 0 auto",
				color: "var(--dsw-alias-label-inverse, #fff)",
				background: disabled ? "var(--dsw-alias-state-success-primary)" : "var(--dsw-alias-state-error-primary)",
				whiteSpace: "nowrap"
			}),
			busy: {
				opacity: .55,
				cursor: "progress"
			}
		};
		/** 三档在 UI 上的顺序与 i18n 后缀。 */
		const EXPOSURE_ORDER = [
			"name-only",
			"hidden",
			"off"
		];
		/** 工具批量操作的 busy key 后缀（与单工具 key `${entryId}:${toolName}` 区分）。 */
		const TOOL_BULK_KEY = "__bulk__";
		function exposureKey(exposure, kind) {
			return `mp.exposure${exposure === "name-only" ? "NameOnly" : exposure === "hidden" ? "Hidden" : "Off"}${kind === "label" ? "" : "Hint"}`;
		}
		function statusBadge(t, row) {
			switch (row.status) {
				case "active": return {
					label: t("mp.statusActive"),
					color: "var(--dsw-alias-state-success-primary)",
					bg: "var(--dsw-alias-state-success-tertiary)"
				};
				case "disabled": return {
					label: t("mp.statusDisabled"),
					color: "var(--dsw-alias-label-tertiary)",
					bg: "var(--dsw-alias-fill-l2)"
				};
				case "idle": return {
					label: t("mp.statusIdle"),
					color: "var(--dsw-alias-state-warn-primary)",
					bg: "var(--dsw-alias-state-warn-tertiary)"
				};
				default: return {
					label: t("mp.statusFailed"),
					color: "var(--dsw-alias-state-error-primary)",
					bg: "var(--dsw-alias-state-error-secondary)"
				};
			}
		}
		function formatK$1(n) {
			return n >= 1e3 ? (n / 1e3).toFixed(1).replace(/\.0$/, "") : String(n);
		}
		function ServerCard(props) {
			const { row, t, presets, presetsError, busy, toolBusy, submit, toggleTool, toolBulk, onEdit, onRemove } = props;
			const [presetOpen, setPresetOpen] = (0, react.useState)(false);
			const [toolsOpen, setToolsOpen] = (0, react.useState)(false);
			const [toolFilter, setToolFilter] = (0, react.useState)("");
			const st = statusBadge(t, row);
			const toolList = row.toolList ?? [];
			const scope = row.presetScope;
			const bulkBusy = Boolean(toolBusy[`${row.entryId}:${TOOL_BULK_KEY}`]);
			const toolQuery = toolFilter.trim().toLowerCase();
			const filteredTools = toolQuery.length === 0 ? toolList : toolList.filter((tool) => tool.name.toLowerCase().includes(toolQuery) || tool.description.toLowerCase().includes(toolQuery));
			/** 从注册全名剥出裸工具名（serverName 本身可能含下划线，不能用 `[^_]+`）。 */
			const bareToolName = (fullName) => {
				const prefix = `mcp__${row.serverName}__`;
				return fullName.startsWith(prefix) ? fullName.slice(prefix.length) : fullName;
			};
			const setExposure = (exposure) => {
				if (exposure === row.exposure) return;
				submit([{
					serverName: row.serverName,
					workspace: row.workspace,
					exposure
				}], `exposure:${row.serverName}`);
			};
			const setMode = (mode) => {
				const ids = mode === "all" ? [] : scope.ids;
				submit([{
					serverName: row.serverName,
					workspace: row.workspace,
					presets: {
						mode,
						ids
					}
				}], `presets:${row.serverName}`);
			};
			const togglePresetId = (id) => {
				const next = scope.ids.includes(id) ? scope.ids.filter((v) => v !== id) : [...scope.ids, id];
				submit([{
					serverName: row.serverName,
					workspace: row.workspace,
					presets: {
						mode: scope.mode,
						ids: next
					}
				}], `presets:${row.serverName}`);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: C$1.card,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: C$1.top,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("h3", {
							style: C$1.title,
							children: [
								row.serverName,
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: C$1.badge(st.color, st.bg),
									children: st.label
								}),
								row.source === "project" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: C$1.badge("var(--dsw-alias-label-tertiary)", "var(--dsw-alias-fill-l2)"),
									children: t("mp.projectBadge")
								}),
								!row.presetAllowed && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: C$1.badge("var(--dsw-alias-state-warn-primary)", "var(--dsw-alias-state-warn-tertiary)"),
									children: t("mp.presetBlocked")
								}),
								row.unregistered && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: C$1.badge("var(--dsw-alias-state-error-primary)", "var(--dsw-alias-state-error-secondary)"),
									title: t("mp.unregisteredHint"),
									children: t("mp.unregisteredBadge")
								}),
								row.pending && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: C$1.badge("var(--dsw-alias-state-warn-primary)", "var(--dsw-alias-state-warn-tertiary)"),
									children: t("mp.pendingBadge")
								})
							]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: {
								display: "flex",
								alignItems: "center",
								gap: 6
							},
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: {
									...C$1.segmented,
									...busy ? C$1.busy : {}
								},
								role: "group",
								"aria-label": t("mp.exposureTitle"),
								children: EXPOSURE_ORDER.map((exposure) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									disabled: busy,
									style: C$1.seg(exposure === row.exposure),
									onClick: () => setExposure(exposure),
									children: t(exposureKey(exposure, "label"))
								}, exposure))
							})
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: C$1.hint,
						children: t(exposureKey(row.exposure, "hint"))
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: C$1.meta,
						children: [
							t("mp.toolsCount", { n: row.tools }),
							" · ",
							t("mp.tokensCount", { n: formatK$1(row.tokens) }),
							row.transport ? ` · ${t("mp.transport")}: ${row.transport}` : "",
							row.workspace ? ` · ${t("mp.workspace")}: ${row.workspace}` : "",
							row.effectiveExposure !== row.exposure ? ` · ${t("mp.effective", { mode: t(exposureKey(row.effectiveExposure, "label")) })}` : ""
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: C$1.actions,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								display: "flex",
								gap: 10,
								alignItems: "center"
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								style: C$1.fold,
								onClick: () => setPresetOpen((v) => !v),
								children: [
									presetOpen ? "▾" : "▸",
									" ",
									t("mp.presetsTitle"),
									"：",
									t(`mp.presetMode.${scope.mode}`),
									scope.mode !== "all" ? ` (${scope.ids.length})` : ""
								]
							}), toolList.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								style: C$1.fold,
								onClick: () => setToolsOpen((v) => !v),
								children: [
									toolsOpen ? "▾" : "▸",
									" ",
									t("mp.toolsTitle"),
									" (",
									toolList.length,
									")"
								]
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								display: "flex",
								gap: 6,
								alignItems: "center"
							},
							children: [
								!row.writable && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: C$1.badge("var(--dsw-alias-label-tertiary)", "var(--dsw-alias-fill-l2)"),
									title: t("mp.readonlyHint"),
									children: t("mp.readonlyBadge")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									style: C$1.opBtn(false, !row.writable),
									disabled: !row.writable,
									title: row.writable ? t("mp.edit") : t("mp.readonlyHint"),
									onClick: () => onEdit(row),
									children: t("mp.edit")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									style: C$1.opBtn(true, !row.writable),
									disabled: !row.writable,
									title: row.writable ? t("mp.remove") : t("mp.readonlyHint"),
									onClick: () => onRemove(row),
									children: t("mp.remove")
								})
							]
						})]
					}),
					presetOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: C$1.panel,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: C$1.presetRow,
								children: [
									"all",
									"only",
									"except"
								].map((mode) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									disabled: busy,
									style: {
										...C$1.seg(mode === scope.mode),
										border: "1px solid var(--dsw-alias-border-l2)",
										borderRadius: 6,
										background: mode === scope.mode ? "var(--dsw-alias-label-primary)" : "transparent"
									},
									onClick: () => setMode(mode),
									children: t(`mp.presetMode.${mode}`)
								}, mode))
							}),
							scope.mode !== "all" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
								presetsError && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									style: C$1.hint,
									children: t("mp.presetsUnavailable", { error: presetsError })
								}),
								presets.length === 0 && !presetsError && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									style: C$1.hint,
									children: t("mp.presetsEmpty")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: C$1.presetRow,
									children: [presets.map((preset) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
										type: "button",
										disabled: busy,
										style: {
											...C$1.presetItem,
											cursor: "pointer",
											borderColor: scope.ids.includes(preset.id) ? "var(--dsw-alias-label-primary)" : "var(--dsw-alias-border-l2)",
											color: scope.ids.includes(preset.id) ? "var(--dsw-alias-label-primary)" : "var(--dsw-alias-label-tertiary)"
										},
										title: preset.description ?? preset.broken ?? preset.id,
										onClick: () => togglePresetId(preset.id),
										children: [
											scope.ids.includes(preset.id) ? "✓" : "+",
											" ",
											preset.name ?? preset.id,
											preset.broken ? " ⚠" : ""
										]
									}, preset.id)), scope.ids.filter((id) => !presets.some((preset) => preset.id === id)).map((id) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
										type: "button",
										disabled: busy,
										style: {
											...C$1.presetItem,
											cursor: "pointer"
										},
										onClick: () => togglePresetId(id),
										children: [
											"✓ ",
											id,
											" ",
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
												style: { opacity: .7 },
												children: [
													"(",
													t("mp.presetGone"),
													")"
												]
											})
										]
									}, id))]
								})
							] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: C$1.hint,
								children: t("mp.presetsHint")
							})
						]
					}),
					toolList.length > 0 && toolsOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: C$1.toolList,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: C$1.toolBar,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										type: "text",
										value: toolFilter,
										onChange: (event) => setToolFilter(event.target.value),
										placeholder: t("mp.toolFilterPlaceholder"),
										style: C$1.toolFilter
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										style: C$1.toolBulkBtn(bulkBusy),
										disabled: bulkBusy,
										onClick: () => toolBulk(row, void 0, true),
										children: t("mp.disableAllTools")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										style: C$1.toolBulkBtn(bulkBusy),
										disabled: bulkBusy,
										onClick: () => toolBulk(row, void 0, false),
										children: t("mp.enableAllTools")
									}),
									toolQuery.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										style: C$1.toolBulkBtn(bulkBusy || filteredTools.length === 0),
										disabled: bulkBusy || filteredTools.length === 0,
										onClick: () => toolBulk(row, filteredTools.map((tool) => tool.name), true),
										children: t("mp.disableFilteredTools", { n: filteredTools.length })
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										style: C$1.toolBulkBtn(bulkBusy || filteredTools.length === 0),
										disabled: bulkBusy || filteredTools.length === 0,
										onClick: () => toolBulk(row, filteredTools.map((tool) => tool.name), false),
										children: t("mp.enableFilteredTools", { n: filteredTools.length })
									})] }),
									bulkBusy && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: C$1.toolDesc,
										children: t("mp.working")
									})
								]
							}),
							filteredTools.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: C$1.toolDesc,
								children: t("mp.toolFilterEmpty")
							}),
							filteredTools.map((tool) => {
								const key = `${row.entryId}:${tool.name}`;
								const tBusy = Boolean(toolBusy[key]);
								return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: C$1.toolRow,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											style: {
												...C$1.toolSwitch(tool.disabled),
												...tBusy ? C$1.busy : {}
											},
											disabled: tBusy || bulkBusy,
											onClick: () => toggleTool(row, tool),
											children: tBusy ? t("mp.working") : tool.disabled ? t("mp.enable") : t("mp.disable")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: C$1.toolName,
											children: bareToolName(tool.name)
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: C$1.toolDesc,
											children: tool.description || "—"
										})
									]
								}, tool.name);
							})
						]
					})
				]
			});
		}
		//#endregion
		//#region src/client/session-param.ts
		/**
		* 会话透传：把「当前会话 id」拼进面板请求。
		*
		* 为什么需要（移植上游 74ed18e）：面板此前所有请求都不带 session，host 只能按
		* roots[0] 解析会话 —— 多会话并存时，卡片展示的是**启动期**那个会话的数据，
		* 而不是用户正在用的那个。host 侧早已支持 `?session=`（GET /state、GET /presets），
		* 这里只补前端透传，无新端点、无 host 语义改动。
		*
		* 本模块零依赖（不 import React），因此可以单独构建成 lib/session-param.js 供
		* selftest 直接断言（与 domain/exposure 同一模式）。
		*
		* 硬契约：拿不到会话时返回的 URL 与旧版**逐字节相同**（可独立回退）。
		*/
		/** 只有在传了非空 session 时才追加 `session=` 查询参数，否则原样返回。 */
		function withSessionParam(path, session) {
			if (typeof session !== "string" || session.length === 0) return path;
			return `${path}${path.includes("?") ? "&" : "?"}session=${encodeURIComponent(session)}`;
		}
		/**
		* 从宿主注入的 props 里防御式取当前会话 id。
		*
		* `useSessions` 是宿主提供的 React hook：宿主没注入（旧版宿主 / 非会话页面）时降级为
		* undefined，调用方随之退回**不带 session 的旧请求形态**，因此该接线可独立 revert。
		*
		* 注意：这里按 props 是否带 hook 决定是否调用（hook 的有无在一次挂载内是稳定的，
		* 不会出现两次渲染间 hook 数量变化）。
		*/
		function readCurrentSession(props) {
			const hook = props.useSessions;
			if (typeof hook !== "function") return void 0;
			try {
				const value = hook((state) => state?.current);
				return typeof value === "string" && value.length > 0 ? value : void 0;
			} catch {
				return;
			}
		}
		//#endregion
		//#region src/client/panel.tsx
		/**
		* MCP：统计头 + 中间层说明 + 生效时机 + 服务器卡片列表 + 添加 MCP 弹窗。
		*
		* 数据流：`GET /state`（注册表行 × 策略 × 预设隔离后的生效档位）与 `GET /presets`
		* 并行拉取；写操作统一走 `submit()`（携带进程级 x-panel-token）。
		* 样式全部 JS 内联（宿主全局 CSS 可能覆盖注入的 class），颜色走 --dsw-alias-* 主题变量。
		*/
		/** 策略提交去抖窗口（同窗口内的多次点击合并为一次批量请求 → 一次缓存失效）。 */
		const POLICY_BATCH_DEBOUNCE_MS = 400;
		/** 缓存警示条自动消失时长（ms）。 */
		const WARN_AUTO_DISMISS_MS = 12e3;
		const C = {
			page: {
				display: "flex",
				flexDirection: "column",
				gap: "12px",
				maxWidth: "820px",
				padding: "4px 2px"
			},
			header: {
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				gap: "8px"
			},
			title: {
				margin: 0,
				fontSize: 18,
				fontWeight: 600,
				color: "var(--dsw-alias-label-primary)"
			},
			refresh: {
				font: "inherit",
				cursor: "pointer",
				border: "1px solid var(--dsw-alias-border-l2)",
				background: "var(--dsw-alias-bg-layer-1)",
				color: "var(--dsw-alias-label-secondary)",
				borderRadius: 6,
				padding: "5px 12px",
				fontSize: 12
			},
			stats: {
				display: "flex",
				gap: "8px",
				flexWrap: "wrap"
			},
			stat: {
				flex: "1 1 0",
				minWidth: 110,
				background: "var(--dsw-alias-bg-layer-1)",
				border: "1px solid var(--dsw-alias-border-l2)",
				borderRadius: 8,
				padding: "10px 12px",
				display: "flex",
				flexDirection: "column",
				gap: 2
			},
			statValue: {
				fontSize: 18,
				fontWeight: 600,
				color: "var(--dsw-alias-label-primary)"
			},
			statLabel: {
				fontSize: 11,
				color: "var(--dsw-alias-label-tertiary)"
			},
			card: {
				background: "var(--dsw-alias-bg-layer-1)",
				border: "1px solid var(--dsw-alias-border-l2)",
				borderRadius: 8,
				padding: "10px 12px",
				display: "flex",
				flexDirection: "column",
				gap: 6
			},
			cardTop: {
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				gap: "8px",
				flexWrap: "wrap"
			},
			cardTitle: {
				margin: 0,
				fontSize: 14,
				fontWeight: 600,
				color: "var(--dsw-alias-label-primary)"
			},
			cardDesc: {
				margin: 0,
				fontSize: 12,
				color: "var(--dsw-alias-label-secondary)",
				lineHeight: "18px"
			},
			toggle: (active) => tab(active, 12),
			hint: {
				margin: 0,
				fontSize: 11,
				color: "var(--dsw-alias-label-tertiary)"
			},
			error,
			empty: {
				fontSize: 13,
				color: "var(--dsw-alias-label-tertiary)",
				padding: "16px 0",
				textAlign: "center"
			},
			warn: {
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				gap: "8px",
				fontSize: 12,
				lineHeight: "18px",
				color: "var(--dsw-alias-label-primary)",
				background: "color-mix(in srgb, var(--dsw-alias-state-warn-primary) 16%, transparent)",
				borderLeft: "3px solid var(--dsw-alias-state-warn-primary)",
				borderRadius: 6,
				padding: "8px 10px"
			},
			warnSevere: {
				background: "color-mix(in srgb, var(--dsw-alias-state-error-primary) 24%, transparent)",
				borderLeft: "3px solid var(--dsw-alias-state-error-primary)",
				fontWeight: 600
			},
			warnDismiss: {
				font: "inherit",
				cursor: "pointer",
				border: 0,
				background: "transparent",
				color: "inherit",
				opacity: .85,
				padding: "2px 6px",
				borderRadius: 4,
				fontSize: 12,
				whiteSpace: "nowrap"
			}
		};
		/** 删除二次确认框样式（轻量内联，复用共享 overlay/modal）。 */
		const confirmOverlay = overlay;
		const confirmModal = modal(480, 8);
		function formatK(n) {
			return n >= 1e3 ? (n / 1e3).toFixed(1).replace(/\.0$/, "") : String(n);
		}
		function McpPanelSection(props) {
			const { t } = props;
			const session = readCurrentSession(props);
			const [view, setView] = (0, react.useState)(null);
			const [presets, setPresets] = (0, react.useState)([]);
			const [presetsError, setPresetsError] = (0, react.useState)(void 0);
			const [applyMode, setApplyMode] = (0, react.useState)("immediate");
			const [error, setError] = (0, react.useState)(null);
			const [busy, setBusy] = (0, react.useState)({});
			const [toolBusy, setToolBusy] = (0, react.useState)({});
			const [warn, setWarn] = (0, react.useState)(null);
			const [showAdd, setShowAdd] = (0, react.useState)(false);
			const [showImport, setShowImport] = (0, react.useState)(false);
			/** 正在编辑的行（null = 未打开编辑弹窗）。 */
			const [editing, setEditing] = (0, react.useState)(null);
			/** 待确认删除的行（null = 未打开确认框）。 */
			const [removing, setRemoving] = (0, react.useState)(null);
			const [removingBusy, setRemovingBusy] = (0, react.useState)(false);
			const [defaultExposure, setDefaultExposure] = (0, react.useState)("name-only");
			const warnTimer = (0, react.useRef)(null);
			const seq = (0, react.useRef)(0);
			const showWarn = (0, react.useCallback)((text, severe) => {
				setWarn({
					text,
					severe
				});
				if (warnTimer.current) clearTimeout(warnTimer.current);
				warnTimer.current = setTimeout(() => setWarn(null), WARN_AUTO_DISMISS_MS);
			}, []);
			const load = (0, react.useCallback)(() => {
				const current = ++seq.current;
				setError(null);
				fetch(withSessionParam("/api/dsh-mcp-router/state", session)).then((res) => readJson(res)).then((body) => {
					if (!body.ok || !body.state) throw new Error(body.error ?? "bad response");
					if (current !== seq.current) return;
					setView(body.state);
				}).catch((err) => {
					if (current === seq.current) setError(describeError(err, t));
				});
			}, [t, session]);
			const loadPresets = (0, react.useCallback)(() => {
				fetch(withSessionParam("/api/dsh-mcp-router/presets", session)).then((res) => readJson(res)).then((body) => {
					if (!body.ok) return;
					setPresets(body.presets ?? []);
					setPresetsError(body.error);
				}).catch((err) => {
					setPresetsError(describeError(err, t));
				});
			}, [t, session]);
			(0, react.useEffect)(() => {
				load();
				loadPresets();
				fetch("/api/dsh-mcp-router/config").then((r) => readJson(r)).then((b) => {
					if (b.ok && b.applyMode) setApplyMode(b.applyMode);
					if (b.ok && typeof b.defaultExposure === "string") setDefaultExposure(b.defaultExposure);
				}).catch(() => {});
			}, [load, loadPresets]);
			(0, react.useEffect)(() => () => {
				if (warnTimer.current) clearTimeout(warnTimer.current);
			}, []);
			const pending = (0, react.useRef)(/* @__PURE__ */ new Map());
			const pendingTimer = (0, react.useRef)(null);
			const flush = (0, react.useCallback)(async () => {
				if (pendingTimer.current) {
					clearTimeout(pendingTimer.current);
					pendingTimer.current = null;
				}
				const merged = [];
				const keys = [];
				for (const item of pending.current.values()) {
					merged.push(...item.updates);
					keys.push(...item.keys);
				}
				pending.current.clear();
				if (merged.length === 0) return;
				setBusy((prev) => {
					const next = { ...prev };
					for (const k of keys) next[k] = true;
					return next;
				});
				setError(null);
				const headers = await authHeaders();
				try {
					const body = await readJson(await fetch("/api/dsh-mcp-router/policy", {
						method: "POST",
						headers,
						body: JSON.stringify({ updates: merged })
					}));
					if (!body.ok) throw new Error(body.error ?? "policy update failed");
					if (body.failed && body.failed > 0) setError(t("mp.toggleError", { error: body.failures?.[0]?.error ?? `${body.failed} failed` }));
					load();
				} catch (err) {
					setError(t("mp.toggleError", { error: describeError(err, t) }));
					load();
				} finally {
					setBusy((prev) => {
						const next = { ...prev };
						for (const k of keys) next[k] = false;
						return next;
					});
				}
			}, [load, t]);
			const submit = (0, react.useCallback)((updates, key) => {
				if (applyMode === "immediate") showWarn(t("mp.cacheWarn"), false);
				else showWarn(t("mp.applyDeferredHint"), false);
				const serverName = typeof updates[0]?.serverName === "string" ? String(updates[0].serverName) : void 0;
				const row = serverName !== void 0 ? view?.mcp.find((r) => r.serverName === serverName) : void 0;
				const existing = pending.current.get(key);
				if (existing) existing.updates = updates;
				else pending.current.set(key, {
					updates,
					keys: [key]
				});
				if (row && (row.tools > 50 || row.tokens > 1e4)) showWarn(t("mp.cacheWarn"), true);
				if (pendingTimer.current) clearTimeout(pendingTimer.current);
				pendingTimer.current = setTimeout(() => void flush(), POLICY_BATCH_DEBOUNCE_MS);
			}, [
				applyMode,
				flush,
				showWarn,
				t,
				view
			]);
			(0, react.useEffect)(() => () => void flush(), [flush]);
			const toggleTool = (0, react.useCallback)(async (row, tool) => {
				const key = `${row.entryId}:${tool.name}`;
				setToolBusy((prev) => ({
					...prev,
					[key]: true
				}));
				setError(null);
				const headers = await authHeaders();
				try {
					const body = await readJson(await fetch("/api/dsh-mcp-router/mcp/toolToggle", {
						method: "POST",
						headers,
						body: JSON.stringify({
							serverName: row.serverName,
							workspace: row.workspace,
							toolName: tool.name,
							disabled: !tool.disabled
						})
					}));
					if (!body.ok) throw new Error(body.error ?? "tool toggle failed");
					load();
				} catch (err) {
					setError(t("mp.toggleError", { error: describeError(err, t) }));
					load();
				} finally {
					setToolBusy((prev) => ({
						...prev,
						[key]: false
					}));
				}
			}, [load, t]);
			/**
			* 工具级批量启停（`/mcp/toolBulk`）。
			*
			* `toolNames === undefined` = 服务端按权威目录取「全部工具」；传数组 = 精确集合。
			* 「按当前过滤」传的是过滤命中的显式数组 —— 命中 0 项时服务端会拒绝而不是
			* 静默降级为「全部」（对 450 工具的 server 那是灾难性的）。
			*/
			const toggleToolBulk = (0, react.useCallback)(async (row, toolNames, disabled) => {
				const key = `${row.entryId}:${TOOL_BULK_KEY}`;
				setToolBusy((prev) => ({
					...prev,
					[key]: true
				}));
				setError(null);
				const headers = await authHeaders();
				try {
					const body = await readJson(await fetch("/api/dsh-mcp-router/mcp/toolBulk", {
						method: "POST",
						headers,
						body: JSON.stringify({
							serverName: row.serverName,
							workspace: row.workspace,
							disabled,
							toolNames
						})
					}));
					if (!body.ok) throw new Error(body.error ?? "tool bulk failed");
					const ignoredCount = body.ignoredToolNames?.length ?? 0;
					const ignoredNote = ignoredCount > 0 ? t("mp.toolBulkIgnored", { n: ignoredCount }) : "";
					showWarn(t("mp.toolBulkApplied", {
						n: body.changed ?? 0,
						ignored: ignoredNote
					}), false);
					load();
				} catch (err) {
					setError(t("mp.toggleError", { error: describeError(err, t) }));
					load();
				} finally {
					setToolBusy((prev) => ({
						...prev,
						[key]: false
					}));
				}
			}, [
				load,
				showWarn,
				t
			]);
			const switchMode = (0, react.useCallback)(async (mode) => {
				if (mode === applyMode) return;
				setBusy((prev) => ({
					...prev,
					applyMode: true
				}));
				const headers = await authHeaders();
				try {
					const body = await readJson(await fetch("/api/dsh-mcp-router/config", {
						method: "POST",
						headers,
						body: JSON.stringify({ applyMode: mode })
					}));
					if (!body.ok) throw new Error(body.error ?? "config update failed");
					setApplyMode(body.applyMode ?? mode);
					load();
				} catch (err) {
					setError(t("mp.toggleError", { error: describeError(err, t) }));
				} finally {
					setBusy((prev) => ({
						...prev,
						applyMode: false
					}));
				}
			}, [
				applyMode,
				load,
				t
			]);
			const commitPending = (0, react.useCallback)(async () => {
				if (typeof window !== "undefined" && !window.confirm(t("mp.commitConfirm"))) return;
				showWarn(t("mp.cacheWarn"), true);
				setBusy((prev) => ({
					...prev,
					commit: true
				}));
				const headers = await authHeaders();
				try {
					const body = await readJson(await fetch("/api/dsh-mcp-router/policy/commit", {
						method: "POST",
						headers,
						body: JSON.stringify({ confirm: true })
					}));
					if (!body.ok) throw new Error(body.error ?? "commit failed");
					load();
					showWarn(t("mp.appliedPending", { n: body.applied ?? 0 }), false);
				} catch (err) {
					setError(t("mp.toggleError", { error: describeError(err, t) }));
				} finally {
					setBusy((prev) => ({
						...prev,
						commit: false
					}));
				}
			}, [
				load,
				showWarn,
				t
			]);
			const confirmRemove = (0, react.useCallback)(async () => {
				const row = removing;
				if (!row) return;
				setRemovingBusy(true);
				setError(null);
				try {
					const headers = await authHeaders();
					const body = await readJson(await fetch("/api/dsh-mcp-router/mcp/remove", {
						method: "POST",
						headers,
						body: JSON.stringify({
							serverName: row.serverName,
							workspace: row.workspace
						})
					}));
					if (!body.ok) throw new Error(body.error ?? "remove failed");
					setRemoving(null);
					load();
				} catch (err) {
					setError(t("mp.removeError", { error: describeError(err, t) }));
				} finally {
					setRemovingBusy(false);
				}
			}, [
				load,
				removing,
				t
			]);
			const hasPending = Boolean(view?.mcp.some((row) => row.pending));
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: C.page,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: C.header,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
							style: C.title,
							children: t("mp.nav")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								display: "flex",
								gap: 8
							},
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									style: C.refresh,
									title: t("mp.addBtnHint"),
									onClick: () => setShowAdd(true),
									children: t("mp.addBtn")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									style: C.refresh,
									title: t("mp.importBtnHint"),
									onClick: () => setShowImport(true),
									children: t("mp.importBtn")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									style: C.refresh,
									title: t("mp.refreshHint"),
									onClick: () => {
										flush();
										load();
										loadPresets();
									},
									children: t("mp.refresh")
								})
							]
						})]
					}),
					error && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: C.error,
						children: error
					}),
					warn && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							...C.warn,
							...warn.severe ? C.warnSevere : {}
						},
						role: "status",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: warn.text }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							style: C.warnDismiss,
							onClick: () => {
								if (warnTimer.current) clearTimeout(warnTimer.current);
								setWarn(null);
							},
							children: t("mp.warnDismiss")
						})]
					}),
					!view && !error && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: C.empty,
						children: t("mp.loading")
					}),
					view && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: C.stats,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: C.stat,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: C.statValue,
										children: view.mcpTotal
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: C.statLabel,
										children: t("mp.statServers")
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: C.stat,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: C.statValue,
										children: view.mcpNameOnly
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: C.statLabel,
										children: t("mp.statNameOnly")
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: C.stat,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: C.statValue,
										children: view.mcpHidden + view.mcpDisabled
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: C.statLabel,
										children: t("mp.statHidden")
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: C.stat,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: C.statValue,
										children: view.mcpToolsTotal
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: C.statLabel,
										children: t("mp.statTools", { n: view.mcpToolsTotal })
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: C.stat,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										style: C.statValue,
										children: [
											"~",
											formatK(view.mcpTokensTotal),
											"k"
										]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: C.statLabel,
										children: t("mp.statTokens")
									})]
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: C.card,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: C.cardTop,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
									style: C.cardTitle,
									children: t("mp.middleLayerTitle")
								})
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: C.cardDesc,
								children: t("mp.middleLayerDesc")
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: C.card,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: C.cardTop,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
										style: C.cardTitle,
										children: t("mp.applyTiming")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										style: {
											display: "flex",
											gap: 6
										},
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											style: C.toggle(applyMode === "immediate"),
											onClick: () => void switchMode("immediate"),
											children: t("mp.applyImmediate")
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											style: C.toggle(applyMode === "next-session"),
											onClick: () => void switchMode("next-session"),
											children: t("mp.applyNextSession")
										})]
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									style: {
										...C.cardDesc,
										whiteSpace: "pre-line"
									},
									children: t("mp.applyModeDesc")
								}),
								applyMode === "next-session" && hasPending && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									style: {
										...C.toggle(true),
										alignSelf: "flex-start",
										marginTop: 2
									},
									disabled: Boolean(busy.commit),
									onClick: () => void commitPending(),
									children: busy.commit ? t("mp.working") : t("mp.applyPendingBtn")
								})
							]
						}),
						view.errors.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: C.error,
							children: view.errors.join(" · ")
						}),
						view.mcp.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: C.empty,
							children: t("mp.empty")
						}),
						view.mcp.map((row) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ServerCard, {
							row,
							t,
							presets,
							presetsError,
							busy: Boolean(busy[`exposure:${row.serverName}`] || busy[`presets:${row.serverName}`]),
							toolBusy,
							submit,
							toggleTool: (r, tool) => void toggleTool(r, tool),
							toolBulk: (r, names, disabled) => void toggleToolBulk(r, names, disabled),
							onEdit: (r) => setEditing(r),
							onRemove: (r) => setRemoving(r)
						}, row.entryId))
					] }),
					showAdd && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AddMcpModal, {
						t,
						workspace: view?.activeWorkspace ?? view?.cwd ?? null,
						onClose: () => setShowAdd(false),
						onAdded: load
					}),
					showImport && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ImportMcpModal, {
						t,
						workspace: view?.activeWorkspace ?? view?.cwd ?? null,
						defaultExposure,
						onClose: () => setShowImport(false),
						onImported: load
					}),
					editing && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(EditMcpModal, {
						t,
						row: editing,
						onClose: () => setEditing(null),
						onSaved: () => {
							setEditing(null);
							load();
						}
					}),
					removing && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: confirmOverlay,
						role: "dialog",
						"aria-modal": "true",
						onClick: () => removingBusy ? void 0 : setRemoving(null),
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: confirmModal,
							onClick: (event) => event.stopPropagation(),
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
									style: C.cardTitle,
									children: t("mp.removeTitle", { server: removing.serverName })
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									style: C.cardDesc,
									children: t("mp.removeConfirm")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									style: C.hint,
									children: removing.source === "project" ? t("mp.editTargetProject") : t("mp.editTargetPatch")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: {
										display: "flex",
										justifyContent: "flex-end",
										gap: 8,
										marginTop: 4
									},
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										style: C.refresh,
										disabled: removingBusy,
										onClick: () => setRemoving(null),
										children: t("mp.editCancel")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										style: {
											...C.refresh,
											color: "var(--dsw-alias-state-error-primary)"
										},
										disabled: removingBusy,
										onClick: () => void confirmRemove(),
										children: removingBusy ? t("mp.working") : t("mp.removeDo")
									})]
								})
							]
						})
					})
				]
			});
		}
		//#endregion
		//#region src/client/locales.ts
		/**
		* 双语字典：zh/en 真双语（不互为别名），语言跟随 DSH 界面设置。
		*
		* 术语约定（三档，均不注入工具 schema）：
		* - name-only  仅名称：只暴露服务器名，工具经 dsh_mcp_call 按需调用
		* - hidden     隐藏：完全不进上下文，可 dsh_mcp_search 检索、dsh_mcp_call 按需调用
		* - off        关闭：不可见、不可搜索、不可调用
		*/
		const NS = "dsh-mcp-router";
		const en = {
			"mp.nav": "MCP Router",
			"mp.refresh": "Refresh",
			"mp.loading": "Loading…",
			"mp.empty": "No MCP servers found.",
			"mp.working": "Working…",
			"mp.toggleError": "Failed: {error}",
			"mp.statServers": "servers",
			"mp.statNameOnly": "name only",
			"mp.statHidden": "hidden/off",
			"mp.statTools": "{n} tools",
			"mp.statTokens": "est. tokens",
			"mp.middleLayerTitle": "AI middle layer",
			"mp.middleLayerDesc": "dsh_mcp_search and dsh_mcp_call are always registered. No MCP tool schema is ever injected into the tool list — every server is reached on demand: dsh_mcp_call enables a hidden server, calls it, then reaps it after an idle window. This never changes your per-turn tool list, so it never invalidates the prompt cache.",
			"mp.applyTiming": "Apply timing",
			"mp.applyImmediate": "Immediate",
			"mp.applyNextSession": "Next session",
			"mp.applyModeDesc": "Applies to state changes (exposure / preset scope / tool toggles):\n· Immediate (default): the model-visible tool list changes on the next turn, invalidating this session's prefix cache from that turn onward (billed at miss rate, ~5-12.5× hit).\n· Next session: only the intent is recorded; the current session keeps its toolset for all remaining turns (zero cache invalidation) and applies at the next new session or after a DSH restart.\n· Both modes: on-demand calls through the middle layer (dsh_mcp_search / dsh_mcp_call) always work and never cause a cache miss.",
			"mp.applyPendingBtn": "Apply pending now",
			"mp.applyDeferredHint": "Intent recorded; it takes effect at the next new session or after a DSH restart.",
			"mp.appliedPending": "Applied {n} pending change(s).",
			"mp.pendingBadge": "Pending",
			"mp.cacheWarn": "Changing this mid-session invalidates the session's prompt cache: the next request is billed at miss rate (~5-12.5× hit). Prefer changing it at a session boundary.",
			"mp.commitConfirm": "Apply pending changes now?\n\nThis forces every next-session intent to take effect immediately: the very next request in this session will miss the entire prompt cache (billed at miss rate, ~5-12.5× hit). Continue?",
			"mp.warnDismiss": "Dismiss",
			"mp.statusActive": "Running",
			"mp.statusDisabled": "Stopped",
			"mp.statusIdle": "No tools",
			"mp.statusFailed": "Not running",
			"mp.unregisteredBadge": "Not registered",
			"mp.unregisteredHint": "The process is running but no tool has been registered for it — the tool count is shown as 0 (not backfilled from the directory snapshot). Check the server log, or restart it.",
			"mp.exposureTitle": "Exposure",
			"mp.exposureNameOnly": "Name only",
			"mp.exposureNameOnlyHint": "Only the server name is injected (a one-line index). The process runs; call tools on demand via dsh_mcp_call, which returns the tool list when the tool name is omitted.",
			"mp.exposureHidden": "Hidden",
			"mp.exposureHiddenHint": "Nothing is injected and the process is stopped. Discoverable via dsh_mcp_search and callable via dsh_mcp_call (keep-alive enable + idle reap).",
			"mp.exposureOff": "Off",
			"mp.exposureOffHint": "Completely off: invisible, not searchable, not callable.",
			"mp.effective": "now: {mode}",
			"mp.presetsTitle": "Preset scope",
			"mp.presetMode.all": "All presets",
			"mp.presetMode.only": "Only these",
			"mp.presetMode.except": "All except",
			"mp.presetsHint": "Runtime isolation: this server keeps running in the background; sessions on other presets simply cannot see or call it (and it never appears in dsh_mcp_search for them).",
			"mp.presetsEmpty": "No presets available.",
			"mp.presetsUnavailable": "Preset list unavailable ({error}); configured ids are still shown and enforced.",
			"mp.presetGone": "no longer exists",
			"mp.presetBlocked": "Blocked by preset scope",
			"mp.toolsTitle": "Tools",
			"mp.toolsCount": "{n} tools",
			"mp.tokensCount": "~{n}k tokens",
			"mp.transport": "transport",
			"mp.workspace": "workspace",
			"mp.projectBadge": "Project",
			"mp.enable": "Enable",
			"mp.disable": "Disable",
			"mp.toolFilterPlaceholder": "Filter by name / description",
			"mp.disableAllTools": "Disable all",
			"mp.enableAllTools": "Enable all",
			"mp.disableFilteredTools": "Disable {n} matched",
			"mp.enableFilteredTools": "Enable {n} matched",
			"mp.toolFilterEmpty": "No tool matches the filter.",
			"mp.toolBulkApplied": "Applied to {n} tool(s){ignored}",
			"mp.toolBulkIgnored": "; {n} named tool(s) are not in the current directory and were ignored",
			"mp.addBtn": "Add",
			"mp.addBtnHint": "Add an MCP server by filling in its connection details (global or project target)",
			"mp.importBtn": "Import",
			"mp.importBtnHint": "Scan this machine's other agent configs (opencode / zcode / Claude Code / Cursor / Gemini CLI / project .mcp.json) and import selected servers",
			"mp.refreshHint": "Reload the panel data",
			"mp.addMcp": "Add MCP",
			"mp.addMcpFormHint": "Fill in how to reach the server; the config preview below updates live.",
			"mp.addMcpType": "Type",
			"mp.addMcpTitleLabel": "MCP title (unique)",
			"mp.addMcpHeadersOptional": "Headers (optional)",
			"mp.addMcpPreviewTitle": "Config preview",
			"mp.addMcpNameInvalid": "Name must match [A-Za-z0-9_-]{1,32}",
			"mp.addMcpCommandRequired": "A command is required for stdio",
			"mp.addMcpUrlRequired": "A URL is required for streamable-http",
			"mp.addMcpTarget": "Target",
			"mp.addMcpTargetGlobal": "Global",
			"mp.addMcpTargetProject": "Project",
			"mp.addMcpNoWorkspace": "No session workspace — cannot add project MCP.",
			"mp.addMcpConfirm": "Add",
			"mp.addMcpCancel": "Close",
			"mp.addMcpError": "Failed: {error}",
			"mp.edit": "Edit",
			"mp.remove": "Delete",
			"mp.editTitle": "Edit MCP: {server}",
			"mp.editTargetPatch": "Writes to profile patch",
			"mp.editTargetProject": "Writes to project mcp.json",
			"mp.editDynamicNote": "This row contains dynamic (!!js) fields ({keys}); they are shown read-only and kept verbatim on save — editing them here would freeze the expression into its current value.",
			"mp.editDynamicFieldKept": "Contains a dynamic (!!js) expression — kept verbatim, not editable here.",
			"mp.editServerName": "Server name",
			"mp.editServerNameHint": "Renaming migrates the exposure level, preset scope and per-tool disables to the new name.",
			"mp.editTransport": "Transport",
			"mp.editCommand": "Command",
			"mp.editArgs": "Arguments",
			"mp.editOnePerLine": "One per line.",
			"mp.editEnv": "Environment",
			"mp.editCwd": "Working directory",
			"mp.editUrl": "URL",
			"mp.editHeaders": "Headers",
			"mp.editTimeout": "Tool call timeout (ms, empty = default)",
			"mp.editSave": "Save",
			"mp.editCancel": "Cancel",
			"mp.editError": "Save failed: {error}",
			"mp.removeTitle": "Delete MCP: {server}",
			"mp.removeConfirm": "This removes the row from its config file and unloads it. It cannot be undone from the panel.",
			"mp.removeDo": "Delete",
			"mp.removeError": "Delete failed: {error}",
			"mp.readonlyBadge": "Read-only",
			"mp.readonlyHint": "This MCP is declared in an agent preset composition (agent.cordis.yml). Writing that file at runtime remounts the whole preset and breaks MCP name uniqueness, so the panel cannot edit or delete it — set its level to \"Off\" to disable it, or edit the file directly.",
			"mp.importTitle": "Import from other agents",
			"mp.importHint": "Scans known MCP configurations on this machine (opencode, zcode, Claude Code, Cursor, Gemini CLI, project .mcp.json) — read-only. Import is a one-off snapshot; later source changes are not tracked.",
			"mp.importCustomPathPh": "Optional: add another JSON config path…",
			"mp.importAddPath": "Scan path",
			"mp.importRescan": "Rescan",
			"mp.importMissing": "Not found (skipped)",
			"mp.importNoServers": "No MCP servers in this file.",
			"mp.importDisabled": "disabled at source",
			"mp.importExisting": "already exists",
			"mp.importTarget": "Target",
			"mp.importExposure": "Level after import",
			"mp.importSelected": "{n} selected",
			"mp.importConfirm": "Import selected",
			"mp.importDone": "Imported {n} MCP(s). {skipped}",
			"mp.importSkipped": "Skipped (existing/failed): {names}",
			"mp.importError": "Import failed: {error}",
			"mp.errNotJson": "The server did not return JSON (HTTP {status}). This usually means the plugin was updated but dsh web has not been restarted — client assets are read from disk per request, while host-side code loads at startup. Restart dsh web and retry."
		};
		const zh = {
			"mp.nav": "MCP路由",
			"mp.refresh": "刷新",
			"mp.loading": "加载中…",
			"mp.empty": "未发现 MCP 服务器",
			"mp.working": "处理中…",
			"mp.toggleError": "全部：{error}",
			"mp.statServers": "个服务器",
			"mp.statNameOnly": "个仅名称",
			"mp.statHidden": "个隐藏/关闭",
			"mp.statTools": "{n} 个工具",
			"mp.statTokens": "约 token",
			"mp.middleLayerTitle": "AI 中间层",
			"mp.middleLayerDesc": "dsh_mcp_search 与 dsh_mcp_call 常驻。任何档位都不把 MCP 工具 schema 注入工具清单，全部按需调用：dsh_mcp_call 会临时启用被隐藏的服务器、调用、再按空闲窗口回收。这条路径不改变模型可见的工具集，因此不会造成前缀缓存失效。",
			"mp.applyTiming": "生效时机",
			"mp.applyImmediate": "立即生效",
			"mp.applyNextSession": "下次会话生效",
			"mp.applyModeDesc": "作用于状态变更（档位 / 预设关联 / 工具级禁用）：\n· 立即生效（默认）：下一轮对话就改变模型看到的工具集，该轮起本会话前缀缓存 100% 失效、按 miss 费率计费（约为 hit 的 5~12.5 倍）。\n· 下次会话生效：只记录意图，当前会话全程工具集不变（零缓存失效），到新开一个会话（其首次请求前）或重启 DSH 才生效。\n· 两者共同点：中间层按需调用（dsh_mcp_search / dsh_mcp_call）始终可用，且不改变每轮请求前缀，永不造成缓存 miss。",
			"mp.applyPendingBtn": "立即应用待生效变更",
			"mp.applyDeferredHint": "已记录意图，将在下次（新）会话或 DSH 重启后生效。",
			"mp.appliedPending": "已应用 {n} 项待生效变更。",
			"mp.pendingBadge": "待生效",
			"mp.cacheWarn": "会话中途变更会使本会话 Prompt Cache 失效，下次请求按 miss 费率计费（约为 hit 的 5~12.5 倍），建议在会话边界操作。",
			"mp.commitConfirm": "现在立即应用待生效变更？\n\n这会让所有「下次会话生效」的意图当场生效：本会话下一次请求将 100% miss 整段前缀缓存（按 miss 费率计费，约为 hit 的 5~12.5 倍）。继续？",
			"mp.warnDismiss": "知道了",
			"mp.statusActive": "运行中",
			"mp.statusDisabled": "已停止",
			"mp.statusIdle": "无工具",
			"mp.statusFailed": "未运行",
			"mp.unregisteredBadge": "未注册",
			"mp.unregisteredHint": "进程在跑，但一个工具都没注册上——工具全部 显示（不再用目录快照回填）。请查看该 server 日志或重启它。",
			"mp.exposureTitle": "曝光档位",
			"mp.exposureNameOnly": "仅名称",
			"mp.exposureNameOnlyHint": "上下文只注入服务器名（一行索引）；进程保持运行，工具经 dsh_mcp_call 按需调用（不传工具名即返回该服务器的工具清单）。",
			"mp.exposureHidden": "隐藏",
			"mp.exposureHiddenHint": "完全不注入上下文，进程停用；可用 dsh_mcp_search 关键词检索到，并用 dsh_mcp_call 按需调用（保活启用 + 空闲回收）。",
			"mp.exposureOff": "关闭",
			"mp.exposureOffHint": "彻底关闭：不可见、不可搜索、不可调用。",
			"mp.effective": "当前生效：{mode}",
			"mp.presetsTitle": "预设关联",
			"mp.presetMode.all": "全部预设",
			"mp.presetMode.only": "仅以下预设",
			"mp.presetMode.except": "排除以下预设",
			"mp.presetsHint": "运行时隔离：该服务器仍在后台运行，只是其他预设的会话看不到、也调不到它（dsh_mcp_search 同样不返回）。无需为不同会话反复开关进程。",
			"mp.presetsEmpty": "暂无可关联的预设。",
			"mp.presetsUnavailable": "预设列表不可得（{error}）；已配置的 id 仍会显示并继续生效。",
			"mp.presetGone": "已不存在",
			"mp.presetBlocked": "被预设关联隔离",
			"mp.toolsTitle": "工具",
			"mp.toolsCount": "{n} 个工具",
			"mp.tokensCount": "约 {n}k token",
			"mp.transport": "传输",
			"mp.workspace": "工作区",
			"mp.projectBadge": "项目",
			"mp.enable": "启用",
			"mp.disable": "禁用",
			"mp.toolFilterPlaceholder": "按名称 / 描述过滤",
			"mp.disableAllTools": "全部禁用",
			"mp.enableAllTools": "全部启用",
			"mp.disableFilteredTools": "禁用命中 {n} 个",
			"mp.enableFilteredTools": "启用命中 {n} 个",
			"mp.toolFilterEmpty": "没有工具匹配该过滤条件。",
			"mp.toolBulkApplied": "已处理 {n} 个工具{ignored}",
			"mp.toolBulkIgnored": "；另有 {n} 项不在当前工具目录中，已忽略",
			"mp.addBtn": "添加",
			"mp.addBtnHint": "填写连接方式添加一个 MCP（可选全局或项目目标）",
			"mp.importBtn": "导入",
			"mp.importBtnHint": "扫描本机其它 agent 的配置（opencode / zcode / Claude Code / Cursor / Gemini CLI / 项目 .mcp.json），勾选后导入",
			"mp.refreshHint": "重新拉取面板数据",
			"mp.addMcp": "添加 MCP",
			"mp.addMcpFormHint": "填写服务器的连接方式，下方「配置预览」会实时更新。",
			"mp.addMcpType": "类型",
			"mp.addMcpTitleLabel": "MCP 标题（唯一）",
			"mp.addMcpHeadersOptional": "请求头（可选）",
			"mp.addMcpPreviewTitle": "配置预览",
			"mp.addMcpNameInvalid": "名称需匹配 [A-Za-z0-9_-]{1,32}",
			"mp.addMcpCommandRequired": "stdio 类型需要填写命令",
			"mp.addMcpUrlRequired": "streamable-http 类型需要填写 URL",
			"mp.addMcpTarget": "目标",
			"mp.addMcpTargetGlobal": "全局",
			"mp.addMcpTargetProject": "项目",
			"mp.addMcpNoWorkspace": "无会话工作空间，无法添加项目 MCP。",
			"mp.addMcpConfirm": "确认添加",
			"mp.addMcpCancel": "关闭",
			"mp.addMcpError": "操作失败：{error}",
			"mp.edit": "编辑",
			"mp.remove": "删除",
			"mp.editTitle": "编辑 MCP：{server}",
			"mp.editTargetPatch": "写回 profile patch 文件",
			"mp.editTargetProject": "写回项目 mcp.json",
			"mp.editDynamicNote": "该行含动态（!!js）字段（{keys}）：面板只读展示，保存时原样保留 —— 在此编辑会把表达式固化成当前值。",
			"mp.editDynamicFieldKept": "该字段含动态（!!js）表达式 —— 原样保留，面板不可编辑。",
			"mp.editServerName": "服务器名",
			"mp.editServerNameHint": "改名会一并迁移档位、预设关联与工具级禁用。",
			"mp.editTransport": "传输方式",
			"mp.editCommand": "命令",
			"mp.editArgs": "参数",
			"mp.editOnePerLine": "每行一个。",
			"mp.editEnv": "环境变量",
			"mp.editCwd": "工作目录",
			"mp.editUrl": "URL",
			"mp.editHeaders": "请求头",
			"mp.editTimeout": "工具调用超时（ms，留空=默认）",
			"mp.editSave": "保存",
			"mp.editCancel": "取消",
			"mp.editError": "保存失败：{error}",
			"mp.removeTitle": "删除 MCP：{server}",
			"mp.removeConfirm": "将从它的配置文件中移除该行并卸载它，面板内无法撤销。",
			"mp.removeDo": "确认删除",
			"mp.removeError": "删除失败：{error}",
			"mp.readonlyBadge": "只读",
			"mp.readonlyHint": "该 MCP 声明在 agent 预设组合文件（agent.cordis.yml）里。运行期写该文件会让整个预设重挂并破坏 MCP 名字唯一性，因此面板不能编辑或删除它 —— 请把档位设为「关闭」使其失效，或直接编辑该文件。",
			"mp.importTitle": "从其它 Agent 导入",
			"mp.importHint": "扫描本机已知的 MCP 配置（opencode / zcode / Claude Code / Cursor / Gemini CLI / 项目 .mcp.json），只读不改源文件；导入是一次性快照，源文件后续变化不会同步。",
			"mp.importCustomPathPh": "可选：追加其它 JSON 配置路径…",
			"mp.importAddPath": "扫描该路径",
			"mp.importRescan": "重新扫描",
			"mp.importMissing": "文件不存在（已跳过）",
			"mp.importNoServers": "该文件里没有 MCP 服务器。",
			"mp.importDisabled": "源里已禁用",
			"mp.importExisting": "已存在",
			"mp.importTarget": "导入到",
			"mp.importExposure": "导入后档位",
			"mp.importSelected": "已选 {n} 个",
			"mp.importConfirm": "导入选中项",
			"mp.importDone": "已导入 {n} 个 MCP。{skipped}",
			"mp.importSkipped": "跳过（已存在/失败）：{names}",
			"mp.importError": "导入失败：{error}",
			"mp.errNotJson": "服务端没有返回 JSON（HTTP {status}）。通常是插件已更新但 dsh web 尚未重启：客户端资源是按请求从磁盘读取的，而 host 侧代码在启动时加载。请重启 dsh web 后重试。"
		};
		//#endregion
		//#region src/client/index.ts
		/**
		* Client 半区入口：注册 settings.section「MCP」页。
		* 参考 ui-settings-plugins 的 settings.section 注册形态（id/order/label/locale 必带）。
		*
		* 平台类型（slots/locale）在本仓库无闭包类型可用，这里声明最小契约（P2-3 可维护性
		* 批次，替换此前的 any），与宿主实际签名对齐即可 —— 注册参数不匹配会在启动时报错。
		*/
		const inject = ["slots", "locale"];
		function apply(ctx) {
			const t = ctx.locale.bind(NS);
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "dsh-mcp-router: dictionaries");
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "dsh-mcp-router",
				order: 30,
				label: () => t("mp.nav"),
				locale: NS
			}, McpPanelSection));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
