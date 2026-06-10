# TokenLens — Agent & LLM Usage Monitor

![Version](https://img.shields.io/badge/version-0.1.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)

TokenLens 是一个功能强大的 VS Code 插件，专为 AI 开发者设计。它能实时监控 Claude Code、Codex、Copilot、Cline、Continue 等 AI 编程工具与 DeepSeek、OpenAI、Anthropic、Kimi 等大模型 API 的 Token 用量、费用、账户权益和缓存命中率。

## ✨ 核心特性

*   **🔍 自动拦截监控**：无需配置 API Key，通过 HTTP 拦截技术自动捕获 VS Code 内所有扩展发出的 LLM API 请求。
*   **💰 实时费用追踪**：根据自定义定价表，实时计算每次对话的费用，支持多币种（CNY/USD）。
*   **📊 可视化仪表盘**：左侧侧边栏提供详细的用量面板，包含趋势图、热力图、模型分布及历史记录。
*   **🎯 缓存命中分析**：深度解析 DeepSeek 等模型的缓存命中情况，帮你评估 Prompt 优化效果。
*   **️ 账户权益管理**：支持 DeepSeek、Kimi 等平台的余额查询，状态栏实时显示当前可用额度。
*   **🛠️ 多服务商支持**：采用 Provider 抽象架构，轻松扩展支持智谱 GLM、阿里百炼、硅基流动等国内外主流模型。
*   **📂 本地日志解析**：支持扫描 Continue、Cline、Aider 等工具的本地缓存文件，补全历史用量数据。

## 运行截图

### 状态栏实时监控
![状态栏](https://github.com/JohnsonJinyu/TokenLens-Monitor/raw/main/media/screenshots/statusBar.png)

### 用量面板 - 总览
![用量面板](https://github.com/JohnsonJinyu/TokenLens-Monitor/raw/main/media/screenshots/dashboard.png)

## 🚀 快速开始

### 1. 安装插件
在 VS Code 扩展市场搜索 "TokenLens" 并点击安装。

### 2. 配置 API Key (可选)
如果你希望查看账户余额或进行更精确的官方用量同步，可以在设置中配置 API Key：
1. 打开设置 (`Ctrl+,` / `Cmd+,`)。
2. 搜索 `tokenLens.providers`。
3. 在对应的服务商卡片中填入你的 API Key。

### 3. 开启监控
插件默认在启动时自动开启监控。你可以通过以下方式管理：
*   **状态栏**：右下角显示当前主账户权益。
*   **命令面板**：运行 `TokenLens: 开启/暂停监控`。
*   **用量面板**：点击左侧活动栏的 TokenLens 图标查看详细统计。

## ⚙️ 配置说明

| 配置项 | 说明 | 默认值 |
| :--- | :--- | :--- |
| `tokenLens.interceptEnabled` | 启用 Agent/API 请求拦截 | `true` |
| `tokenLens.autoStart` | VSCode 启动时自动开始监控 | `true` |
| `tokenLens.balanceCheckInterval` | 账户权益自动刷新间隔（分钟） | `5` |
| `tokenLens.costAlertThreshold` | 会话费用告警阈值（元） | `10` |
| `tokenLens.pricing` | 自定义模型定价（每百万 tokens） | `{...}` |

## 🛡️ 隐私与安全

*   **本地存储**：所有用量数据和 API Key 仅存储在本地 VS Code 全局状态中，绝不会上传到任何第三方服务器。
*   **透明拦截**：HTTP 拦截器仅针对已知的 LLM API 域名（如 `api.deepseek.com`, `api.openai.com` 等）生效，不会干扰其他网络请求。
*   **开源代码**：本项目完全开源，你可以随时审查源代码逻辑。

## 📝 常见问题

**Q: 为什么状态栏显示“未查询”？**
A: 请检查是否在设置中配置了对应服务商的 API Key，并确保网络可以访问该服务商的 API。

**Q: 拦截器会影响其他扩展吗？**
A: 拦截器采用透明转发机制，仅在后台记录数据，不会影响原始请求的发送和响应。如果发现兼容性问题，可在设置中关闭 `interceptEnabled`。

**Q: 如何导出用量报告？**
A: 在用量面板顶部点击“导出报告”按钮，或使用命令 `TokenLens: 导出用量报告`。

## 🤝 贡献

欢迎提交 Issue 或 Pull Request！如果你有想要支持的新的模型服务商，可以参考 `src/providers` 目录下的结构进行适配。

## 📄 许可证

本项目遵循 [MIT License](LICENSE)。
