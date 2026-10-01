<p align="center">
  <strong style="font-size: 2.2em">🧩 MCP Router</strong><br>
  <span style="font-size: 1.1em">DeepSeek Harness（DSH）Web 插件 · MCP 按需调用的路由</span>
</p>

---

## 📌 来源

本项目 fork 自 **[lilyblessing/dsh-mcp-skill-panel](https://github.com/lilyblessing/dsh-mcp-skill-panel)**（仓库最初的形态是 `dsh-runtime-inventory` —— 一个 MCP 与技能的运行时清单 / 启停面板）。

本来只是根据自己的要求进行小修改，后来改的有点多，合并上游麻烦，而且每次更新也不方便。干脆直接分叉出来算了，保留了原来最核心的MCP路由，尽量让插件KISS。在此基础上又做了MCP的导入、新增

> 架构分层、档位语义与各项设计决策见 [docs/design.md](docs/design.md)。

## 📦 安装（本地）

远程仓库尚未建立，目前只在本地维护：

```sh
dsh plugin --profile web add "file:/path/to/dsh-mcp-router"
```

安装后重启 `dsh web`（host 代码在启动时加载），设置页出现「MCP路由」入口。

## 📄 License

MIT（与上游一致）。
