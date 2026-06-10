# TokenLens 产品需求文档

## 1. 产品定位

TokenLens 是一个面向个人开发者的 VS Code 插件，用来监控 AI 编程工具和大模型 API 的账户余额、套餐余量、Token 用量、费用、缓存命中率和上下文窗口占比。

产品原则：

- 状态栏只做轻量提醒：只显示当前主账户余额或“未查询”。
- 左侧用量面板承载详情：费用、Token、缓存命中、模型分布、近 24 小时和历史趋势都放在面板中。
- DeepSeek 是首个落地样板，但前端、后端和数据结构都不能写成 DeepSeek 专用。
- 优先补齐中国主流大模型厂商，再补国外主流模型厂商。

## 2. 核心场景

- 我在 VS Code 中使用 Claude Code、Codex、Copilot、Cline、Continue、Aider 等 AI 编程工具，希望知道这次会话用了多少 Token、花了多少钱。
- 我使用 DeepSeek、GLM、通义、Kimi、MiniMax 等国内大模型 API，希望状态栏能快速看到余额，面板能看到详细消耗。
- 我想比较不同模型和服务商的费用、缓存命中率、上下文窗口占比，以便调整模型和提示词策略。
- 我希望插件可以先通过拦截 API 响应或解析本地日志工作，后续再逐步接入各厂商官方余额/账单接口。

## 3. v1 范围

v1 以 DeepSeek 为优先样板，做通用架构的最小闭环。

必须完成：

- 状态栏只显示余额：`$(pulse) ¥14.21` 或 `$(pulse) 未查询`。
- DeepSeek 权益查询：调用 `/user/balance`，展示当前可用余额及充值余额/赠送余额拆分；不展示“已用”或“累计充值”，因为官方接口没有返回这些口径。
- DeepSeek 用量统计：通过 HTTP 拦截和本地日志解析获取 usage。
- DeepSeek 缓存命中：读取 `prompt_cache_hit_tokens` 和 `prompt_cache_miss_tokens`。
- 左侧面板展示：余额、会话费用、Token、请求数、缓存命中、趋势图、模型费用分布、Provider 表、Model 表、近期记录。
- Provider 抽象：余额、账单、用量 API、拦截解析、定价、缓存指标都通过能力声明扩展。

不做：

- 不在状态栏显示费用、Token、今日消耗、近 24 小时消耗或缓存命中。
- 不承诺 v1 就适配所有国内厂商的余额接口。
- 不把 OpenAI、Anthropic、Gemini 作为 v1 优先级。

## 4. 厂商优先级

### P0：中国优先样板

| 厂商 | v1 能力 | 说明 |
| --- | --- | --- |
| DeepSeek | 余额、拦截用量、缓存命中、定价 | 首个完整 adapter。余额走 `/user/balance`，只能显示当前余额、充值余额、赠送余额；用量主要依赖 API 响应 usage 和本地日志。 |

### P1：中国主流优先补齐

| 厂商 | 优先支持方式 | 余额/账单策略 |
| --- | --- | --- |
| 智谱 GLM | OpenAI-compatible 解析器 + GLM 配置模板 | 先验证官方控制台/开放平台是否提供余额或账单 API。 |
| 阿里云百炼 / 通义千问 | OpenAI-compatible、Anthropic-compatible、DashScope 原生接口分层支持 | 云厂商账单可能更偏向账户费用，先作为账单 adapter 处理。 |
| Moonshot / Kimi | Kimi 专属余额 adapter + OpenAI-compatible 拦截解析 | 余额走 `/v1/users/me/balance`，展示可用余额、现金余额、代金券余额；用量暂走拦截。 |
| MiniMax | OpenAI-compatible 或官方 ChatCompletion adapter | 优先解析 usage，余额/套餐余量后置验证。 |
| 硅基流动 | OpenAI-compatible 解析器 | 重点支持多模型路由后的 provider/model 识别。 |
| 火山方舟 | OpenAI-compatible 解析器 + Ark 配置模板 | 账单通常走云平台能力，先做用量统计。 |
| 百度千帆 | OpenAI-compatible 或千帆原生 adapter | 先解析 usage，再补余额/账单。 |
| 腾讯混元 | OpenAI-compatible 或混元原生 adapter | 先解析 usage，再补余额/账单。 |

### P2：国外主流随后补齐

| 厂商 | 优先支持方式 | 余额/账单策略 |
| --- | --- | --- |
| OpenAI | Usage/Costs API + OpenAI-compatible 解析器 | 多数场景是组织账单成本，不是普通余额。 |
| Anthropic / Claude | Messages usage + prompt cache 字段映射 | 重点映射 cache read/cache creation。 |
| Google Gemini | Gemini usage metadata adapter | 账单通常走 Google Cloud。 |
| Mistral | OpenAI-compatible 解析器 | 余额/账单后置。 |
| Cohere | 原生 usage adapter | 余额/账单后置。 |
| OpenRouter | OpenAI-compatible 解析器 + OpenRouter 专属余额/credits adapter | 多上游模型需要保留 routed provider 信息。 |

### P3：生态增强

- 手动导入账单 CSV。
- 自定义 OpenAI-compatible provider。
- Provider 响应样例库。
- Adapter 测试夹具。
- 月度报告、预算告警和异常消耗提醒。

## 5. Provider 抽象

每个 Provider 声明自己的能力，而不是继承一个假设所有厂商都一样的接口。

### 账户权益模型

不同厂商的账户体系不一致，不能统一硬套“余额/已用/充值”三行。TokenLens 使用账户权益模型承接余额、套餐、credits 和账单。

权益类型：

- `balance`：现金余额、赠送余额、代金券余额等金额型权益，例如 DeepSeek、Kimi。
- `quota`：包月/订阅/周期套餐余量，例如 GLM Coding Plan、火山 Agent/Coding Plan。
- `credits`：以 credits、points、积分等单位计量的权益，例如 Qoder 这类待确认产品。
- `billing`：账单周期成本、组织成本、云平台消费，例如 OpenAI、阿里云百炼等云厂商场景。
- `usageOnly`：没有公开权益查询接口，只能通过请求响应或本地日志统计 usage。
- `unknown`：官方字段尚未确认，禁止在实现中猜测接口或字段。

展示原则：

- 状态栏只显示主权益值，例如 `¥14.21`、`120 credits`、`Pro 余 320 prompts` 或 `未查询`。
- 左侧第一张 KPI 卡使用厂商返回的权益类型动态命名，例如“账户余额”“套餐余量”“Credits”“账单费用”。
- 明细行来自 adapter 的 `items[]`，例如“充值余额/赠送余额”“代金券余额/现金余额”“周期额度/到期时间”。
- 未经官方确认的字段只能写进调研表，不能进入 adapter 实现。

能力类型：

- `balance`：账户余额、套餐余量、赠余额、充值余额。
- `billing`：账单周期成本、组织成本、云平台费用。
- `usageApi`：官方 usage API 或 costs API。
- `interceptParser`：从 OpenAI-compatible、Anthropic-compatible 或原生响应中解析 usage。
- `pricing`：模型价格、货币、缓存折扣。
- `cacheMetrics`：缓存读取、缓存写入、缓存未命中、估算节省。

统一用量字段：

- `provider`
- `model`
- `inputTokens`
- `outputTokens`
- `cachedInputTokens`
- `cacheWriteTokens`
- `cost`
- `currency`
- `endpoint`
- `source`

余额、套餐和账单分开：

- 中国平台优先显示账户余额、套餐余量、赠送余额、充值余额、credits 等权益。
- 国外平台如果没有普通余额接口，显示账单周期成本或组织用量。
- 面板中可以同时展示“余额”和“周期成本”，状态栏只选择主余额显示。

### 厂商调研状态表

| 厂商 | 当前归类 | 已确认字段/能力 | 状态 |
| --- | --- | --- | --- |
| DeepSeek | `balance` | `/user/balance` 返回 `total_balance`、`granted_balance`、`topped_up_balance` | 已确认，v1 实现 |
| Kimi / Moonshot | `balance` | `/v1/users/me/balance` 返回 `available_balance`、`voucher_balance`、`cash_balance` | 已确认，已实现余额 adapter |
| 智谱 GLM | `balance` + `quota` | 平台存在现金余额、赠金、资源包、积分，GLM Coding Plan 存在套餐周期和限额 | 待逐项 adapter |
| 阿里云百炼 | `billing` / `usageOnly` | API usage 可解析，账户权益更偏云账单体系 | 待确认权益查询 API |
| Qoder | `credits` 候选 | 用户侧表述为 credits，但官方 API 字段未确认 | 只写调研，不硬编码 |
| 硅基流动 | `usageOnly` 候选 | OpenAI-compatible usage/cache 字段可解析 | 余额接口待确认 |
| 火山方舟 | `quota` + `usageOnly` | Agent/Coding Plan 存在套餐额度和用量详情 | 待确认接口参数和权限 |
| MiniMax | `usageOnly` 候选 | ChatCompletion usage 待验证 | 权益接口待确认 |
| 百度千帆 | `billing` / `usageOnly` 候选 | 云厂商账单体系 | 待确认 |
| 腾讯混元 | `billing` / `usageOnly` 候选 | 云厂商账单体系 | 待确认 |
| OpenAI | `billing` | Usage/Costs API | 国外后置 |
| Anthropic | `usageOnly` / `billing` | Messages usage、prompt cache read/write | 国外后置 |

## 6. 数据采集方案

### API 查询

用于余额、账单、官方 usage API。

- 优点：数据权威。
- 风险：各厂商接口不统一，部分接口需要组织权限或云账号权限。
- 策略：adapter 逐个验证，不做未经验证的端点猜测。

### HTTP 拦截

用于捕获 VS Code 内 AI 工具发出的 LLM 请求和响应。

- 优点：不依赖厂商是否提供 usage 查询接口。
- 风险：只能捕获当前进程可见请求；流式响应和压缩响应需要兼容处理。
- 策略：优先支持 OpenAI-compatible 和 Anthropic-compatible 响应格式。

### 本地日志解析

用于 Claude Code、Codex、Continue、Cline、Aider 等工具的本地缓存或日志。

- 优点：可以补足历史会话。
- 风险：各工具日志格式变化快。
- 策略：用解析器插件化处理，保留原始 source。

## 7. 前端展示

状态栏：

- 只显示主余额。
- 有余额：`$(pulse) ¥14.21`。
- 无余额：`$(pulse) 未查询`。
- tooltip 只显示余额、Provider、API 查询状态、HTTP 拦截状态，并引导打开面板。

左侧面板：

- KPI：余额、会话费用、Token 用量、请求数、缓存命中率。
- 图表：费用/Token 趋势、历史热力图、模型费用分布。
- 表格：Provider 汇总、Model 汇总、近期请求记录。
- 设置：服务商配置、API Key、API Base、权益刷新间隔、拦截开关、缓存命中显示、通知、告警阈值、主题。

### 设置页 provider-first 设计

设置页不再呈现为 DeepSeek-only，而是以“服务商配置”为入口。v1 默认 DeepSeek 可用，其他中国厂商先以配置模板进入，能力开关控制后端是否真的发起权益或用量 API 查询。

- DeepSeek 服务商卡显示：服务商名称、权益类型、API Key、API Base、模型列表、能力状态。
- 能力状态包括：权益查询、用量 API、请求拦截、缓存指标、定价规则。
- “刷新余额”统一改为“刷新权益”，“余额查询间隔”统一改为“权益刷新间隔”。
- 旧全局 `tokenLens.apiKey` 和 `tokenLens.apiBase` 保留为 DeepSeek 兼容入口。
- 设置页提供中国厂商模板入口：Kimi、GLM、Qoder、阿里百炼/通义、硅基流动、火山方舟。模板只保存 provider-level API Key/API Base/能力声明，不代表 adapter 已完成。
- Kimi 标记为 `balance` 类型并启用权益查询；专属 adapter 只查 `/v1/users/me/balance`，不使用通用 OpenAI-compatible provider 猜接口。
- GLM、Qoder、阿里百炼、硅基流动、火山方舟等未确认权益 API 的厂商，后端必须跳过权益 API 轮询，只保留拦截解析或待适配状态。
- 后续新增 Kimi、GLM、Qoder、阿里百炼等厂商时，每个 provider 独立维护 API Key 和 API Base。

后端迁移规则：

- `ProviderConfig.apiKey` 优先。
- provider 未配置 API Key 时，DeepSeek 可以 fallback 到旧全局 `tokenLens.apiKey`。
- 旧全局 `tokenLens.apiKey` 不能给非 DeepSeek 服务商兜底，避免 Kimi/GLM/Qoder 等误拿 DeepSeek Key。
- `ProviderConfig.capabilities` 用于驱动设置页和监控页的能力展示。
- `capabilities.entitlement === false` 时，`ApiMonitor` 不调用 `fetchBalance()`。
- `capabilities.usageApi === false` 时，`ApiMonitor` 不调用 `fetchRecentUsage()`，用量主要来自请求拦截或本地日志。
- Dashboard 使用 provider 级运行状态显示“可用 / 未配置 / 待适配 / 查询失败”，运行状态不写入用户配置。
- 未经官方文档确认的权益 API 不进入 adapter，只在调研表中标记。

## 8. Roadmap

### v1：DeepSeek 样板闭环

- DeepSeek 账户权益：可用余额、充值余额、赠送余额。
- DeepSeek usage 拦截解析。
- DeepSeek 缓存命中。
- Kimi 账户权益：可用余额、现金余额、代金券余额。
- 左侧图表。
- 状态栏只显示余额。
- PRD 和后续路线。

### v1.5：中国厂商配置模板

- GLM、通义、Kimi、MiniMax、硅基流动、火山方舟配置模板。
- 设置页支持添加、保存、移除 provider 模板；DeepSeek 保留不可移除的默认入口。
- OpenAI-compatible 通用 usage 解析器增强。
- Provider 能力矩阵在面板中可见。

### v2：中国厂商 adapter 补齐

- 逐个验证中国厂商余额/账单接口。
- 百度千帆、腾讯混元补入配置模板和 adapter。
- 增加厂商响应样例和自动化测试。

### v3：国外主流模型支持

- OpenAI Usage/Costs。
- Anthropic Messages usage 和 prompt cache。
- Gemini usage metadata。
- Mistral、Cohere、OpenRouter。

### v4：生态增强

- 预算告警。
- 月度报告。
- CSV 导入。
- 自定义 provider 向导。
- Provider 测试夹具和示例响应库。

## 9. 验收标准

- 状态栏在任何用量变化后仍只显示余额或“未查询”。
- 左侧面板仍保留费用、Token、缓存、趋势和模型分布。
- DeepSeek 配置 API Key 后可以刷新余额。
- DeepSeek 或 OpenAI-compatible 响应中出现 usage 时，可以记录 Token 和费用。
- 缓存命中字段能进入统一 cache metrics。
- 新增厂商 adapter 时，不需要修改 dashboard 的核心数据结构。

## 10. 参考资料

- DeepSeek Balance API: https://api-docs.deepseek.com/api/get-user-balance
- DeepSeek Token Usage: https://api-docs.deepseek.com/quick_start/token_usage
- DeepSeek Anthropic API: https://api-docs.deepseek.com/guides/anthropic_api
- OpenAI Usage API: https://platform.openai.com/docs/api-reference/usage
- Anthropic Prompt Caching: https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
- 智谱开放文档: https://docs.bigmodel.cn/cn/guide/start/introduction
- 阿里云百炼 API: https://help.aliyun.com/zh/model-studio/qwen-api-reference/
- Kimi Balance API: https://platform.moonshot.cn/docs/api/balance
