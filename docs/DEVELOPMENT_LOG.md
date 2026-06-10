# TokenLens 开发记录

> 用途：跨电脑、跨线程接续开发时，先读本文件，再读 `docs/PRD.md`。

## 2026-06-10 当前状态

已完成：

- 状态栏只显示主权益值或 `未查询`，不再显示费用、Token、缓存或近 24h 消耗。
- 移除了 `tokenLens.statusBarDisplay` 配置和 dashboard 设置页里的状态栏显示下拉框。
- 新建 `docs/PRD.md`，路线调整为中国大模型优先，国外主流模型后置。
- 引入账户权益思路，避免把所有厂商硬套成“余额/已用/充值”。

本次继续推进：

- 在类型层新增 `EntitlementInfo`，保留旧 `BalanceInfo` 作为兼容层。
- DeepSeek `/user/balance` 改为余额型权益：
  - `total_balance` -> 可用余额。
  - `topped_up_balance` -> 充值余额。
  - `granted_balance` -> 赠送余额。
  - 不再推导“已用”，不展示“累计充值”。
- Dashboard 第一张 KPI 从“账户余额”改为按权益动态显示。
- Provider 表余额列改为“权益”。
- 设置页改为 provider-first：
  - “API 配置”改为“服务商配置”。
  - 默认渲染 DeepSeek 服务商卡。
  - 展示权益类型、API Key、API Base、模型和能力状态。
  - “刷新余额/余额查询间隔/API 查询”文案迁移为“刷新权益/权益刷新间隔/权益查询”。
- 设置页已增加服务商模板添加入口：
  - 当前可添加 Kimi、GLM、Qoder、阿里百炼/通义、硅基流动、火山方舟。
  - 每个 provider 卡片可保存自己的 API Key 和 API Base。
  - DeepSeek 作为默认 provider，不在 UI 中提供移除按钮。
  - Kimi 模板已升级为已支持权益查询，GLM/Qoder/百炼等仍是保守模板。
- Kimi adapter 已完成：
  - 默认 Base URL：`https://api.moonshot.cn`。
  - 权益接口：`/v1/users/me/balance`。
  - 映射可用余额、现金余额、代金券余额；用量仍走请求拦截。
- 后端 `ApiMonitor` 支持 provider-level API Key 优先，旧全局 API Key 作为兼容 fallback。
  - 旧全局 API Key 只允许 fallback 到 DeepSeek，不能给 Kimi/GLM/Qoder 等非 DeepSeek provider 使用。
- 后端轮询已按 `ProviderConfig.capabilities` 受控：
  - `entitlement === false` 时跳过 `fetchBalance()`。
  - `usageApi === false` 时跳过 `fetchRecentUsage()`。
  - 这可以避免未确认厂商模板被通用 adapter 误请求。
- 后端已增加 provider 级运行状态，用于面板显示“可用 / 未配置 / 待适配 / 查询失败”。
- 已新增最小测试脚本 `npm test`，覆盖 DeepSeek/Kimi 权益映射、能力开关和 API Key fallback 策略。

## 当前未完成

- GLM、阿里百炼/Qoder、硅基流动、火山方舟、MiniMax、百度千帆、腾讯混元：仍需逐家官方文档确认权益或账单接口。
- `BalanceInfo` 旧字段仍在兼容层中，后续等缓存迁移稳定后再清理。
- Provider 配置已开始迁移到 provider-level key，但旧 `tokenLens.apiKey/apiBase` 仍作为 DeepSeek 兼容入口。
- “添加服务商”目前是模板级编辑器，还不是完整 adapter 管理器；模板能力必须保守声明。

## 已知风险

- 不同厂商的权益口径差异很大：余额、现金、赠金、代金券、credits、套餐额度、账单费用不能混用。
- 没有官方文档确认的接口不要猜测，不要在 adapter 里硬编码。
- 当前 `out/` 是编译产物，运行 `npm run compile` 会更新它；改源码后需要编译。
- 仓库已有未提交改动，后续不要回滚不相关文件。

## 下一步建议

1. 运行 `npm test`，确认权益映射和 provider 策略通过。
2. 用 DeepSeek mock 或真实 API Key 验证面板：
   - 第一张卡显示账户余额。
   - 明细显示充值余额、赠送余额。
   - 不显示已用或累计充值。
3. 验证设置页服务商模板：
   - 添加 Kimi/GLM/Qoder 等模板。
   - 保存 provider-level API Key/API Base。
   - 未声明权益 API 的模板不会触发后台权益查询。
4. 用 Kimi provider-level API Key 验证：
   - 权益卡显示 Kimi 可用余额。
   - 明细显示现金余额、代金券余额。
   - 用量仍来自 HTTP 请求拦截。
5. 做中国厂商调研表第二轮，不要盲目加接口：
   - GLM：现金余额、赠金、资源包、积分、Coding Plan 周期额度。
   - 阿里百炼/Qoder：credits/权益/账单是否有 API。
   - 硅基流动：余额接口是否公开。
   - 火山方舟：Agent/Coding Plan 套餐额度和用量详情接口权限。
   - MiniMax、百度千帆、腾讯混元：权益字段和账单查询能力。

## 常用命令

```powershell
npm run compile
rg -n "BalanceInfo|EntitlementInfo|totalCharged|totalUsed" src media docs
rg -n "已用|充值|账户余额|账户权益|权益" src media docs
rg -n "刷新余额|余额查询|API 查询|DeepSeek API Key|API 配置" src media package.json docs
git status --short
```

## 关键文件

- `src/providers/base.ts`：Provider、Usage、Entitlement/Balance 类型。
- `src/providers/deepseek.ts`：DeepSeek adapter。
- `src/providers/openaiCompat.ts`：OpenAI-compatible 通用 adapter。
- `src/views/statusBarManager.ts`：右下角状态栏。
- `src/views/dashboardPanel.ts`：Webview 快照和页面结构。
- `media/dashboard.js`：Webview 前端渲染逻辑。
- `docs/PRD.md`：产品需求和路线。

## 官方资料

- DeepSeek Balance API: https://api-docs.deepseek.com/api/get-user-balance
- DeepSeek Token Usage: https://api-docs.deepseek.com/quick_start/token_usage
- Kimi Balance API: https://platform.moonshot.cn/docs/api/balance
- 智谱用户权益: https://docs.bigmodel.cn/cn/guide/platform/equity-explain
- GLM Coding Plan: https://docs.bigmodel.cn/cn/coding-plan/overview
- 阿里云百炼 API: https://help.aliyun.com/zh/model-studio/qwen-api-reference/
- SiliconFlow Chat Completions: https://docs.siliconflow.cn/cn/api-reference/chat-completions/chat-completions
- 火山方舟 API 目录: https://www.volcengine.com/docs/82379/1494384
