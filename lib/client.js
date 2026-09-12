window.__ModuleLoader__.load({
	id: "dsh-mcp-panel",
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
		//#region src/client/add-mcp.tsx
		/**
		* 添加 MCP 弹窗（快速迁移）：粘贴其它 harness 的 mcpServers JSON，
		* 在弹窗内选择「全局 / 项目」目标，转换预览后确认添加。
		*
		* - 全局：写入 <profile>/cordis.patch.yml（- insert: 块，${VAR} → !!js 表达式）+ 立即挂载
		* - 项目：写入 <workspace>/.dsh/mcps/mcp.json（与子目录扫描去重规则一致）+ 重扫挂载
		* 全部逻辑（token / 预览 / 添加 / 结果展示）都在本组件内部，对 views.tsx 零侵入。
		* 样式走宿主 --dsw-alias-* 主题变量（与 views.tsx 一致），本地私有 C，不导出。
		*/
		const C$2 = {
			overlay: {
				position: "fixed",
				inset: 0,
				background: "rgba(0, 0, 0, 0.45)",
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				zIndex: 1e3
			},
			modal: {
				width: "min(680px, calc(100vw - 48px))",
				maxHeight: "calc(100vh - 80px)",
				overflowY: "auto",
				background: "var(--dsw-alias-bg-layer-1)",
				border: "1px solid var(--dsw-alias-border-l2)",
				borderRadius: 10,
				padding: "16px 18px",
				display: "flex",
				flexDirection: "column",
				gap: 12,
				boxShadow: "0 8px 30px rgba(0,0,0,0.25)"
			},
			title: {
				margin: 0,
				fontSize: 16,
				fontWeight: 600,
				color: "var(--dsw-alias-label-primary)"
			},
			textarea: {
				font: "inherit",
				fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
				fontSize: 12,
				lineHeight: "18px",
				background: "var(--dsw-alias-bg-layer-2)",
				color: "var(--dsw-alias-label-primary)",
				border: "1px solid var(--dsw-alias-border-l2)",
				borderRadius: 6,
				padding: "8px 10px",
				resize: "vertical",
				minHeight: 120
			},
			row: {
				display: "flex",
				alignItems: "center",
				gap: 8
			},
			label: {
				fontSize: 12,
				color: "var(--dsw-alias-label-secondary)"
			},
			tab: (active) => ({
				font: "inherit",
				cursor: "pointer",
				border: "1px solid",
				borderRadius: 6,
				padding: "4px 14px",
				fontSize: 12,
				fontWeight: active ? 600 : 400,
				color: active ? "var(--dsw-alias-label-primary)" : "var(--dsw-alias-label-tertiary)",
				background: active ? "color-mix(in srgb, var(--dsw-alias-state-info-primary, #4a90d9) 16%, transparent)" : "transparent",
				borderColor: active ? "var(--dsw-alias-state-info-primary, #4a90d9)" : "var(--dsw-alias-border-l2)"
			}),
			hint: {
				margin: 0,
				fontSize: 11,
				color: "var(--dsw-alias-label-tertiary)",
				overflow: "hidden",
				textOverflow: "ellipsis",
				whiteSpace: "nowrap"
			},
			action: {
				font: "inherit",
				cursor: "pointer",
				border: "1px solid var(--dsw-alias-border-l2)",
				background: "var(--dsw-alias-bg-layer-1)",
				color: "var(--dsw-alias-label-secondary)",
				borderRadius: 6,
				padding: "5px 14px",
				fontSize: 12
			},
			primary: {
				font: "inherit",
				cursor: "pointer",
				border: 0,
				borderRadius: 6,
				padding: "5px 16px",
				fontSize: 12,
				color: "var(--dsw-alias-label-inverse, #fff)",
				background: "var(--dsw-alias-state-success-primary)"
			},
			primaryDisabled: {
				opacity: .55,
				cursor: "progress"
			},
			error: {
				fontSize: 12,
				color: "var(--dsw-alias-label-primary)",
				background: "color-mix(in srgb, var(--dsw-alias-state-error-primary) 14%, transparent)",
				borderLeft: "3px solid var(--dsw-alias-state-error-primary)",
				borderRadius: 6,
				padding: "8px 10px"
			},
			success: {
				fontSize: 12,
				color: "var(--dsw-alias-label-primary)",
				background: "color-mix(in srgb, var(--dsw-alias-state-success-primary) 14%, transparent)",
				borderLeft: "3px solid var(--dsw-alias-state-success-primary)",
				borderRadius: 6,
				padding: "8px 10px"
			},
			pre: {
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
			},
			footer: {
				display: "flex",
				justifyContent: "flex-end",
				gap: 8
			}
		};
		function AddMcpModal(props) {
			const { t, workspace, onClose, onAdded } = props;
			const [json, setJson] = (0, react.useState)("");
			const [target, setTarget] = (0, react.useState)("global");
			const [preview, setPreview] = (0, react.useState)(null);
			const [result, setResult] = (0, react.useState)(null);
			const [busy, setBusy] = (0, react.useState)(null);
			const tokenPromise = (0, react.useRef)(null);
			const ensureToken = (0, react.useCallback)(() => {
				if (!tokenPromise.current) tokenPromise.current = fetch("/api/mcp-panel/token").then((r) => r.json()).then((b) => b?.token ?? null).catch(() => null);
				return tokenPromise.current;
			}, []);
			const post = (0, react.useCallback)(async (path, payload) => {
				const token = await ensureToken();
				const headers = { "content-type": "application/json" };
				if (token) headers["x-panel-token"] = token;
				return await (await fetch(path, {
					method: "POST",
					headers,
					body: JSON.stringify(payload)
				})).json();
			}, [ensureToken]);
			const doPreview = (0, react.useCallback)(async () => {
				setBusy("preview");
				setResult(null);
				setPreview(null);
				try {
					const body = await post("/api/mcp-panel/mcp/preview", { json });
					if (!body.ok || typeof body.yaml !== "string") throw new Error(typeof body.error === "string" ? body.error : "preview failed");
					setPreview({
						names: Array.isArray(body.names) ? body.names : [],
						yaml: body.yaml
					});
				} catch (error) {
					setResult({
						ok: false,
						text: t("mp.addMcpError", { error: error instanceof Error ? error.message : String(error) })
					});
				} finally {
					setBusy(null);
				}
			}, [
				post,
				json,
				t
			]);
			const doAdd = (0, react.useCallback)(async () => {
				if (!json.trim()) return;
				setBusy("add");
				setResult(null);
				try {
					const body = await post("/api/mcp-panel/mcp/add", {
						json,
						target
					});
					if (!body.ok || typeof body.added !== "number") throw new Error(typeof body.error === "string" ? body.error : "add failed");
					onAdded();
					onClose();
				} catch (error) {
					setResult({
						ok: false,
						text: t("mp.addMcpError", { error: error instanceof Error ? error.message : String(error) })
					});
				} finally {
					setBusy(null);
				}
			}, [
				post,
				json,
				target,
				workspace,
				t,
				onAdded,
				onClose
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
							children: t("mp.addMcp")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							style: C$2.hint,
							children: t("mp.addMcpPasteHint")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
							value: json,
							onChange: (event) => setJson(event.target.value),
							placeholder: "{ \"mcpServers\": { \"my-server\": { \"command\": \"…\" } } }",
							style: C$2.textarea,
							rows: 7,
							spellCheck: false
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: C$2.row,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: C$2.label,
									children: t("mp.addMcpTarget")
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
									style: {
										...C$2.hint,
										flex: 1
									},
									children: workspace ? `${t("mp.workspace")}: ${workspace}` : t("mp.addMcpNoWorkspace")
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: C$2.row,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: C$2.action,
								disabled: busy !== null,
								onClick: () => void doPreview(),
								children: busy === "preview" ? t("mp.working") : t("mp.addMcpPreview")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: C$2.hint,
								children: preview ? `${t("mp.addMcpPreviewNames")}: ${preview.names.join(", ")}` : ""
							})]
						}),
						result && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: result.ok ? C$2.success : C$2.error,
							children: result.text
						}),
						preview && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
							style: C$2.pre,
							children: preview.yaml
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: C$2.footer,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: C$2.action,
								disabled: busy !== null,
								onClick: onClose,
								children: t("mp.addMcpCancel")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: {
									...C$2.primary,
									...busy !== null ? C$2.primaryDisabled : {}
								},
								disabled: busy !== null,
								onClick: () => void doAdd(),
								children: busy === "add" ? t("mp.working") : t("mp.addMcpConfirm")
							})]
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
		/** 四档在 UI 上的顺序与 i18n 后缀。 */
		const EXPOSURE_ORDER = [
			"native",
			"name-only",
			"hidden",
			"off"
		];
		function exposureKey(exposure, kind) {
			return `mp.exposure${exposure === "name-only" ? "NameOnly" : exposure === "native" ? "Native" : exposure === "hidden" ? "Hidden" : "Off"}${kind === "label" ? "" : "Hint"}`;
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
			const { row, t, presets, presetsError, busy, toolBusy, submit, toggleTool } = props;
			const [presetOpen, setPresetOpen] = (0, react.useState)(false);
			const [toolsOpen, setToolsOpen] = (0, react.useState)(false);
			const st = statusBadge(t, row);
			const toolList = row.toolList ?? [];
			const scope = row.presetScope;
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
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
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
					toolList.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
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
					}), toolsOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: C$1.toolList,
						children: toolList.map((tool) => {
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
										disabled: tBusy,
										onClick: () => toggleTool(row, tool),
										children: tBusy ? t("mp.working") : tool.disabled ? t("mp.enable") : t("mp.disable")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: C$1.toolName,
										children: tool.name.replace(/^mcp__[^_]+__/, "")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: C$1.toolDesc,
										children: tool.description || "—"
									})
								]
							}, tool.name);
						})
					})] })
				]
			});
		}
		//#endregion
		//#region src/client/panel.tsx
		/**
		* MCP 管理面板：统计头 + 中间层说明 + 生效时机 + 服务器卡片列表 + 添加 MCP 弹窗。
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
			meta: {
				margin: "2px 0 0",
				fontSize: 12,
				color: "var(--dsw-alias-label-tertiary)"
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
			toggle: (active) => ({
				font: "inherit",
				cursor: "pointer",
				border: "1px solid",
				borderRadius: 6,
				padding: "4px 12px",
				fontSize: 12,
				fontWeight: active ? 600 : 400,
				color: active ? "var(--dsw-alias-label-primary)" : "var(--dsw-alias-label-tertiary)",
				background: active ? "color-mix(in srgb, var(--dsw-alias-state-info-primary, #4a90d9) 16%, transparent)" : "transparent",
				borderColor: active ? "var(--dsw-alias-state-info-primary, #4a90d9)" : "var(--dsw-alias-border-l2)"
			}),
			hint: {
				margin: 0,
				fontSize: 11,
				color: "var(--dsw-alias-label-tertiary)"
			},
			error: {
				fontSize: 12,
				color: "var(--dsw-alias-label-primary)",
				background: "color-mix(in srgb, var(--dsw-alias-state-error-primary) 14%, transparent)",
				borderLeft: "3px solid var(--dsw-alias-state-error-primary)",
				borderRadius: 6,
				padding: "8px 10px"
			},
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
		/** 进程级随机令牌缓存（token 全程不变，复用免重复请求）。 */
		let tokenPromise = null;
		function ensureToken() {
			if (!tokenPromise) tokenPromise = fetch("/api/mcp-panel/token").then((r) => r.json()).then((b) => b?.token ?? null).catch(() => null);
			return tokenPromise;
		}
		function formatK(n) {
			return n >= 1e3 ? (n / 1e3).toFixed(1).replace(/\.0$/, "") : String(n);
		}
		function McpPanelSection(props) {
			const { t } = props;
			const [view, setView] = (0, react.useState)(null);
			const [presets, setPresets] = (0, react.useState)([]);
			const [presetsError, setPresetsError] = (0, react.useState)(void 0);
			const [applyMode, setApplyMode] = (0, react.useState)("immediate");
			const [error, setError] = (0, react.useState)(null);
			const [busy, setBusy] = (0, react.useState)({});
			const [toolBusy, setToolBusy] = (0, react.useState)({});
			const [warn, setWarn] = (0, react.useState)(null);
			const [showAdd, setShowAdd] = (0, react.useState)(false);
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
				fetch("/api/mcp-panel/state").then((res) => res.json()).then((body) => {
					if (!body.ok || !body.state) throw new Error(body.error ?? "bad response");
					if (current !== seq.current) return;
					setView(body.state);
				}).catch((err) => {
					if (current === seq.current) setError(err instanceof Error ? err.message : String(err));
				});
			}, []);
			const loadPresets = (0, react.useCallback)(() => {
				fetch("/api/mcp-panel/presets").then((res) => res.json()).then((body) => {
					if (!body.ok) return;
					setPresets(body.presets ?? []);
					setPresetsError(body.error);
				}).catch(() => {});
			}, []);
			(0, react.useEffect)(() => {
				load();
				loadPresets();
				fetch("/api/mcp-panel/config").then((r) => r.json()).then((b) => {
					if (b.ok && b.applyMode) setApplyMode(b.applyMode);
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
				const token = await ensureToken();
				const headers = { "content-type": "application/json" };
				if (token) headers["x-panel-token"] = token;
				try {
					const body = await (await fetch("/api/mcp-panel/policy", {
						method: "POST",
						headers,
						body: JSON.stringify({ updates: merged })
					})).json();
					if (!body.ok) throw new Error(body.error ?? "policy update failed");
					if (body.failed && body.failed > 0) setError(t("mp.toggleError", { error: body.failures?.[0]?.error ?? `${body.failed} failed` }));
					load();
				} catch (err) {
					setError(t("mp.toggleError", { error: err instanceof Error ? err.message : String(err) }));
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
				const token = await ensureToken();
				const headers = { "content-type": "application/json" };
				if (token) headers["x-panel-token"] = token;
				try {
					const body = await (await fetch("/api/mcp-panel/mcp/toolToggle", {
						method: "POST",
						headers,
						body: JSON.stringify({
							serverName: row.serverName,
							workspace: row.workspace,
							toolName: tool.name,
							disabled: !tool.disabled
						})
					})).json();
					if (!body.ok) throw new Error(body.error ?? "tool toggle failed");
					load();
				} catch (err) {
					setError(t("mp.toggleError", { error: err instanceof Error ? err.message : String(err) }));
					load();
				} finally {
					setToolBusy((prev) => ({
						...prev,
						[key]: false
					}));
				}
			}, [load, t]);
			const switchMode = (0, react.useCallback)(async (mode) => {
				if (mode === applyMode) return;
				setBusy((prev) => ({
					...prev,
					applyMode: true
				}));
				const token = await ensureToken();
				const headers = { "content-type": "application/json" };
				if (token) headers["x-panel-token"] = token;
				try {
					const body = await (await fetch("/api/mcp-panel/config", {
						method: "POST",
						headers,
						body: JSON.stringify({ applyMode: mode })
					})).json();
					if (!body.ok) throw new Error(body.error ?? "config update failed");
					setApplyMode(body.applyMode ?? mode);
					load();
				} catch (err) {
					setError(t("mp.toggleError", { error: err instanceof Error ? err.message : String(err) }));
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
				showWarn(t("mp.cacheWarn"), true);
				setBusy((prev) => ({
					...prev,
					commit: true
				}));
				const token = await ensureToken();
				const headers = { "content-type": "application/json" };
				if (token) headers["x-panel-token"] = token;
				try {
					const body = await (await fetch("/api/mcp-panel/policy/commit", {
						method: "POST",
						headers
					})).json();
					if (!body.ok) throw new Error(body.error ?? "commit failed");
					load();
					showWarn(t("mp.appliedPending", { n: body.applied ?? 0 }), false);
				} catch (err) {
					setError(t("mp.toggleError", { error: err instanceof Error ? err.message : String(err) }));
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
			const hasPending = Boolean(view?.mcp.some((row) => row.pending));
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: C.page,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: C.header,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
							style: C.title,
							children: t("mp.nav")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							style: C.meta,
							children: view ? `${t("mp.preset")}: ${view.preset ?? "—"} · ${t("mp.session")}: ${view.sessionId ?? "—"}` : ""
						})] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								display: "flex",
								gap: 8
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: C.refresh,
								onClick: () => setShowAdd(true),
								children: t("mp.addMcp")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: C.refresh,
								onClick: () => {
									flush();
									load();
									loadPresets();
								},
								children: t("mp.refresh")
							})]
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
										children: view.mcpNative
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: C.statLabel,
										children: t("mp.statNative")
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
							toggleTool: (r, tool) => void toggleTool(r, tool)
						}, row.entryId))
					] }),
					showAdd && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AddMcpModal, {
						t,
						workspace: view?.activeWorkspace ?? view?.cwd ?? null,
						onClose: () => setShowAdd(false),
						onAdded: load
					})
				]
			});
		}
		//#endregion
		//#region src/client/locales.ts
		/**
		* 双语字典：zh/en 真双语（不互为别名），语言跟随 DSH 界面设置。
		*
		* 术语约定（四档）：
		* - native     原生注入：工具清单直接进上下文（DSH 原生方式）
		* - name-only  仅名称：只暴露服务器名，工具经 mcp_call 按需调用
		* - hidden     隐藏：完全不进上下文，可 mcp_search 检索、mcp_call 按需调用
		* - off        关闭：不可见、不可搜索、不可调用
		*/
		const NS = "mcp-panel";
		const en = {
			"mp.nav": "MCP Manager",
			"mp.refresh": "Refresh",
			"mp.loading": "Loading…",
			"mp.empty": "No MCP servers found.",
			"mp.session": "Session",
			"mp.preset": "Preset",
			"mp.working": "Working…",
			"mp.toggleError": "Failed: {error}",
			"mp.statServers": "servers",
			"mp.statNative": "injected",
			"mp.statNameOnly": "name only",
			"mp.statHidden": "hidden/off",
			"mp.statTools": "{n} tools",
			"mp.statTokens": "est. tokens",
			"mp.middleLayerTitle": "AI middle layer",
			"mp.middleLayerDesc": "mcp_search and mcp_call are always registered. Servers not set to \"Native\" stay out of the tool list and are used on demand: mcp_call enables a hidden server, calls it, then reaps it after an idle window. This never changes your per-turn tool list, so it never invalidates the prompt cache.",
			"mp.applyTiming": "Apply timing",
			"mp.applyImmediate": "Immediate",
			"mp.applyNextSession": "Next session",
			"mp.applyModeDesc": "Applies to state changes (exposure / preset scope / tool toggles):\n· Immediate (default): the model-visible tool list changes on the next turn, invalidating this session's prefix cache from that turn onward (billed at miss rate, ~5-12.5× hit).\n· Next session: only the intent is recorded; the current session keeps its toolset for all remaining turns (zero cache invalidation) and applies at the next new session or after a DSH restart.\n· Both modes: on-demand calls through the middle layer (mcp_search / mcp_call) always work and never cause a cache miss.",
			"mp.applyPendingBtn": "Apply pending now",
			"mp.applyDeferredHint": "Intent recorded; it takes effect at the next new session or after a DSH restart.",
			"mp.appliedPending": "Applied {n} pending change(s).",
			"mp.pendingBadge": "Pending",
			"mp.cacheWarn": "Changing this mid-session invalidates the session's prompt cache: the next request is billed at miss rate (~5-12.5× hit). Prefer changing it at a session boundary.",
			"mp.warnDismiss": "Dismiss",
			"mp.statusActive": "Running",
			"mp.statusDisabled": "Stopped",
			"mp.statusIdle": "No tools",
			"mp.statusFailed": "Not running",
			"mp.exposureTitle": "Exposure",
			"mp.exposureNative": "Native",
			"mp.exposureNativeHint": "Every tool schema is injected into the context (classic DSH behaviour); the process runs.",
			"mp.exposureNameOnly": "Name only",
			"mp.exposureNameOnlyHint": "Only the server name is injected (a one-line index). The process runs; call tools on demand via mcp_call, which returns the tool list when the tool name is omitted.",
			"mp.exposureHidden": "Hidden",
			"mp.exposureHiddenHint": "Nothing is injected and the process is stopped. Discoverable via mcp_search and callable via mcp_call (keep-alive enable + idle reap).",
			"mp.exposureOff": "Off",
			"mp.exposureOffHint": "Completely off: invisible, not searchable, not callable.",
			"mp.effective": "now: {mode}",
			"mp.presetsTitle": "Preset scope",
			"mp.presetMode.all": "All presets",
			"mp.presetMode.only": "Only these",
			"mp.presetMode.except": "All except",
			"mp.presetsHint": "Runtime isolation: this server keeps running in the background; sessions on other presets simply cannot see or call it (and it never appears in mcp_search for them).",
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
			"mp.addMcp": "Add MCP",
			"mp.addMcpPasteHint": "Paste mcpServers JSON from another harness (e.g. Claude Code .mcp.json), then preview and confirm.",
			"mp.addMcpTarget": "Target",
			"mp.addMcpTargetGlobal": "Global",
			"mp.addMcpTargetProject": "Project",
			"mp.addMcpNoWorkspace": "No session workspace — cannot add project MCP.",
			"mp.addMcpPreview": "Preview",
			"mp.addMcpPreviewNames": "Parsed",
			"mp.addMcpConfirm": "Add",
			"mp.addMcpCancel": "Close",
			"mp.addMcpSuccess": "Added {n} {target} MCP(s).",
			"mp.addMcpSkipped": "Skipped {n} (existing/failed): {names}",
			"mp.addMcpError": "Failed: {error}"
		};
		const zh = {
			"mp.nav": "MCP 管理面板",
			"mp.refresh": "刷新",
			"mp.loading": "加载中…",
			"mp.empty": "未发现 MCP 服务器",
			"mp.session": "会话",
			"mp.preset": "预设",
			"mp.working": "处理中…",
			"mp.toggleError": "操作失败：{error}",
			"mp.statServers": "个服务器",
			"mp.statNative": "个原生注入",
			"mp.statNameOnly": "个仅名称",
			"mp.statHidden": "个隐藏/关闭",
			"mp.statTools": "{n} 个工具",
			"mp.statTokens": "约 token",
			"mp.middleLayerTitle": "AI 中间层",
			"mp.middleLayerDesc": "mcp_search 与 mcp_call 常驻。未设为「原生注入」的服务器不进工具清单，需要时按需调用：mcp_call 会临时启用被隐藏的服务器、调用、再按空闲窗口回收。这条路径不改变模型可见的工具集，因此不会造成前缀缓存失效。",
			"mp.applyTiming": "生效时机",
			"mp.applyImmediate": "立即生效",
			"mp.applyNextSession": "下次会话生效",
			"mp.applyModeDesc": "作用于状态变更（档位 / 预设关联 / 工具级禁用）：\n· 立即生效（默认）：下一轮对话就改变模型看到的工具集，该轮起本会话前缀缓存 100% 失效、按 miss 费率计费（约为 hit 的 5~12.5 倍）。\n· 下次会话生效：只记录意图，当前会话全程工具集不变（零缓存失效），到新开一个会话（其首次请求前）或重启 DSH 才生效。\n· 两者共同点：中间层按需调用（mcp_search / mcp_call）始终可用，且不改变每轮请求前缀，永不造成缓存 miss。",
			"mp.applyPendingBtn": "立即应用待生效变更",
			"mp.applyDeferredHint": "已记录意图，将在下次（新）会话或 DSH 重启后生效。",
			"mp.appliedPending": "已应用 {n} 项待生效变更。",
			"mp.pendingBadge": "待生效",
			"mp.cacheWarn": "会话中途变更会使本会话 Prompt Cache 失效，下次请求按 miss 费率计费（约为 hit 的 5~12.5 倍），建议在会话边界操作。",
			"mp.warnDismiss": "知道了",
			"mp.statusActive": "运行中",
			"mp.statusDisabled": "已停止",
			"mp.statusIdle": "无工具",
			"mp.statusFailed": "未运行",
			"mp.exposureTitle": "曝光档位",
			"mp.exposureNative": "原生注入",
			"mp.exposureNativeHint": "全部工具 schema 直接注入上下文（DSH 原生方式）；进程保持运行。",
			"mp.exposureNameOnly": "仅名称",
			"mp.exposureNameOnlyHint": "上下文只注入服务器名（一行索引）；进程保持运行，工具经 mcp_call 按需调用（不传工具名即返回该服务器的工具清单）。",
			"mp.exposureHidden": "隐藏",
			"mp.exposureHiddenHint": "完全不注入上下文，进程停用；可用 mcp_search 关键词检索到，并用 mcp_call 按需调用（保活启用 + 空闲回收）。",
			"mp.exposureOff": "关闭",
			"mp.exposureOffHint": "彻底关闭：不可见、不可搜索、不可调用。",
			"mp.effective": "当前生效：{mode}",
			"mp.presetsTitle": "预设关联",
			"mp.presetMode.all": "全部预设",
			"mp.presetMode.only": "仅以下预设",
			"mp.presetMode.except": "排除以下预设",
			"mp.presetsHint": "运行时隔离：该服务器仍在后台运行，只是其他预设的会话看不到、也调不到它（mcp_search 同样不返回）。无需为不同会话反复开关进程。",
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
			"mp.addMcp": "添加 MCP",
			"mp.addMcpPasteHint": "粘贴其它 harness 的 mcpServers JSON（如 Claude Code 的 .mcp.json），转换预览后确认添加。",
			"mp.addMcpTarget": "目标",
			"mp.addMcpTargetGlobal": "全局",
			"mp.addMcpTargetProject": "项目",
			"mp.addMcpNoWorkspace": "无会话工作空间，无法添加项目 MCP。",
			"mp.addMcpPreview": "转换预览",
			"mp.addMcpPreviewNames": "解析到",
			"mp.addMcpConfirm": "确认添加",
			"mp.addMcpCancel": "关闭",
			"mp.addMcpSuccess": "已添加 {n} 个{target} MCP。",
			"mp.addMcpSkipped": "跳过 {n} 个（已存在/失败）：{names}",
			"mp.addMcpError": "操作失败：{error}"
		};
		//#endregion
		//#region src/client/index.ts
		/**
		* Client 半区入口：注册 settings.section「MCP 管理面板」页。
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
			}), "mcp-panel: dictionaries");
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "mcp-panel",
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
