# dsh-opendesign-go-meter

<div align="center">

**DeepSeek Harness 会话费用统计插件 · OpenDesign Cloud 定制版(界面中英双语)**

[dsh-cost-meter](https://github.com/Han-1413141/dsh-cost-meter) 的 OpenDesign 定制 fork:原插件的全部功能(本会话费用 · 官方余额 · 预算图框 · 自定义 Provider 余额 · 历史记录 · 峰谷计价 · 官方价格同步 · Coding Plan 额度 · Token 热图等)保持不变,仅把 **Go 额度卡替换为 OpenDesign Cloud 订阅额度查询**。

[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![upstream](https://img.shields.io/badge/upstream-Han--1413141%2Fdsh--cost--meter-4176E6)](https://github.com/Han-1413141/dsh-cost-meter)

[English](README.en.md) | **中文**

</div>

---

## 源仓库与致谢

本插件是 [dsh-cost-meter](https://github.com/Han-1413141/dsh-cost-meter) 的定制 fork。上游 `dsh-cost-meter` 是一个功能完整的 **DeepSeek Harness 会话费用统计插件**:提供本会话费用、官方余额查询、预算图框、自定义 Provider 余额、历史记录、峰谷计价、官方价格同步、Coding Plan 额度、Token 热图等功能,内置 90+ 模型价格目录与自动匹配,界面中英双语,由 [Han-1413141](https://github.com/Han-1413141) 以 [MIT](LICENSE) 许可开源维护。

**改动原因**:我们日常把模型路由指向 **OpenDesign Cloud**(桌面端 / Vela CLI / `https://amr-link.open-design.ai/v1`),上游插件的 Go 额度卡只对接 `opencode.ai/zen/go/v1/usage`,查不了 OpenDesign 的订阅额度。因此 fork 本仓库,把 Go 额度卡整体换成 OpenDesign 官方额度接口,并把价格目录换成 OpenDesign 的 39 个模型。除这一层定制外,其余功能、结构均继承上游。

**致谢**:感谢 [Han-1413141](https://github.com/Han-1413141) 及上游 dsh-cost-meter 的所有贡献者——本项目绝大部分代码与设计都来自上游,我们只是在其基础上做了一层针对性定制。上游仓库:[Han-1413141/dsh-cost-meter](https://github.com/Han-1413141/dsh-cost-meter)(MIT)。

---

## 本 fork 改了什么

| 改动 | 说明 |
|---|---|
| 额度接口 | 换成 **OpenDesign Cloud 官方额度端点**(两步):`GET https://amr-api.open-design.ai/api/v1/workspaces/current` 取 workspaceId,再 `GET /api/v1/workspaces/{ws}/billing/funding-check` 取 `codingPlan.windows[]` |
| 两档窗口 | OpenDesign 只有 **滚动 5 小时(18000s)** 与 **7 天(604800s)** 两档,均为「已用 / 全部 + 进度条」;OpenDesign **没有**月度滚动窗,因此原来的「月」档已彻底移除 |
| 额度单位 | 接口返回的是 **Design Plan credits**,`1 USD = 10000 credits`;面板按原值展示,不反推美元 |
| 套餐档位 | 卡片额外显示当前套餐档位(tier)与钱包余额(balanceUsd),全部来自同一个 funding-check 响应 |
| 凭据 | 用 **Vela CLI 登录态 `controlKey`**(跑一次 `npx @powerformer/vela-cli login` 写入 `~/.amr/config.json`),不是 `sk-*` 推理 Key;解析顺序:DSH 凭据库 `VELA_CONTROL_KEY` → 环境变量 `VELA_CONTROL_KEY` → `~/.amr/config.json` |
| 价格表 | 内置 **`opendesign` provider 39 个模型目录价**,来自官方公开端点 `GET /api/v1/public/model-prices`(2026-10-30 抓取,含 cacheRead 缓存读价) |
| 文案 | 全部 "Command Code GOAT" → "OpenDesign Cloud",新增 `goQuotaTierNote`(中/英)文案 |

## 安装

> 需求:Node.js ≥ 20 + DeepSeek Harness(带 `dsh plugin` 命令)。

```sh
# 方式一:本地目录(克隆或解压后)
dsh plugin --profile web add link:./dsh-opendesign-go-meter

# 方式二:git URL
dsh plugin --profile web add github:ycm50/dsh-opendesign-go-meter

# 方式三:dshmarket(若已提交到市场)
dsh plugin --profile web add dsh-opendesign-go-meter
```

安装后**重启** `dsh web` 生效:

```sh
dsh web
```

> 注意:本包 `lib/` 就是交付产物,没有编译步骤(`package.json` 已不含 `build`;`files` 只含 `lib`、`cordis.patch.yml`、`docs/provider-pricing.json`)。开发期自检用 `npm test`(=`scripts/verify-typert.mjs`):它会把每一代能定位到的 `@deepseek-ai/dsh-typert-loader` 都跑一遍真实 `validateTypertManifest()`,并检查 `lib/client.js` 的 codec 双键与 `exports` 打包契约;插件运行时不需要这些文件。

> 兼容性:`lib/typert.host.js` / `lib/client.js` 里的 strict codec 必须**同时**带 `schema: <zod v4>` 与 `create: () => <zod>`——0.1.5-rc.x 那代宿主只认 `schema`,0.1.7+ 只认 `create`,少写任一个键,该插件在这代宿主上会整份 typert 贡献注册失败(Remote 方法全丢、设置页与费用面板失效)。改 `lib/` 后先跑 `npm test`。

## 登录:插件内置登录入口

额度查询认的是 **Vela 登录态**,不是 API Key。插件**内置了登录入口**——不用开终端:

1. 打开 **设置 → 费用 → OpenDesign 订阅额度**,点「登录 OpenDesign」;
2. 卡片上会显示 6 位验证码与「打开授权页」按钮;
3. 浏览器里确认验证码 → 插件自动检测到登录完成并立即刷新额度。

底层是后台拉起官方 CLI 的 `login` 子命令(设备授权流程),凭据由 CLI 自己写入
`~/.amr/config.json`。CLI 定位优先级:

1. `PATH` 上的 `vela`(自己装过 CLI);
2. npx 缓存里的 `@powerformer/vela-cli`(`%LOCALAPPDATA%/npm-cache/_npx/*`,直接跑,不走网络);
3. 都没有才退回 `npx --yes @powerformer/vela-cli login`(首次需要联网装包)。

> 也可以在终端手动登录,效果一样:
> ```sh
> npx @powerformer/vela-cli login
> ```

登录后插件会自动从 `~/.amr/config.json` 读到 `profiles.prod.controlKey`。也可以把同一个值放进 DSH 凭据库或环境变量 `VELA_CONTROL_KEY`(适合 CI / 多机)。

> ⚠️ 设置页**没有**手填 Key 的入口:controlKey 权限比 API Key 高(能读整份账单与工作区),不应该让人往输入框里粘。要在设置页里配,请用「DSH 凭据库」写 `VELA_CONTROL_KEY`。

## 额度口径(实测)

Go $10/月,官方文档写「5 小时 $10 / 7 天 $30」,那是**模型用量价值**;接口返回的是 Design Plan credits(1 USD = 10000 credits),所以实际是:

| 窗口 | 接口 limitCredits | 面板显示(美元) | 折合模型用量(0.5× 倍率) |
|---|---|---|---|
| 滚动 5 小时(18000s) | 50000 | **$10** | $10 |
| 7 天(604800s) | 150000 | **$30** | $30 |

> 面板按官方文档口径显示 `$10 / $30`,换算比 **5000 credits = $1**(50000/10 = 150000/30)。
> 注意这与钱包余额不是同一套单位:钱包是 **10000 credits = $1**(见 `billing/summary` 的
> `creditsPerUsd`)。两套单位差 2 倍,恰好对应 Design Plan 倍率的倒数。

各套餐(官方 `/model-credits` 页面):

| 套餐 | 月费 | Design Plan 月度上限 | 计划模型 Credits | 5 小时窗 | 7 天窗 |
|---|---|---|---|---|---|
| **Go** | **$10** | $120 | $0 | **$10** | **$30** |
| Plus | $20 | $160 | $20 | — | $40 |
| Pro | $100 | $360 | $120 | — | $90 |
| Max | $200 | $600 | $300 | — | $150 |

> 只有 Go 同时有 5 小时与 7 天两档;Plus / Pro / Max 只有 7 天窗,插件在那种账户下会自动只显示一行。

以上数值在 [lib/coding-plans.js](lib/coding-plans.js) 的 `OPENDESIGN_PLANS` 中集中维护,来源为官方页面(2026-10 抓取复核):

- <https://open-design.ai/model-credits/>(Design Plan 额度与倍率全表)
- <https://open-design.ai/help/billing/>(逐套餐 5 小时 / 7 天窗上限)

## 模型计价(opendesign 路由)

如果模型路由指向 OpenDesign 的 Provider API(`provider: open-design`,baseURL
`https://amr-link.open-design.ai/v1`),价格表需要认识这个 provider,否则调用会
**只记 token、金额恒 0**(「今日费用」显示 ¥0)。本 fork 已内置 **`opendesign` provider
价格表(39 个模型)**,数据取自官方公开端点 `/api/v1/public/model-prices`,每条都带
`sourceUrl` / `checkedAt`。

- 全部为目录 `flat` 价(含 cacheRead 缓存读价),按 1M tokens 计。
- 模型 id 用 Provider API 写法(如 `deepseek-v4.1-flash`、`glm-5.3-flash`、`kimi-k2.7-code`);
  大小写与连接符差异由归一化匹配兜住。
- 这是**按量目录价**,与 Design Plan credit 消耗是两套口径:前者用来把 token 折算成
  美元等值,后者是订阅额度本身。

若要自行增改,在 **设置 → 费用 → 拓展价格表** 中挂载/编辑;官方调价后用
**同步官方价格** 只覆盖 DeepSeek 主表,provider 表需手动核对。

## 与上游的关系

- 分支 `od-go` = 本 fork(OpenDesign 版)。
- 上游 `dsh-cost-meter` 的其它定制分支(如 `cmdc-goat`)在各自仓库/分支独立维护。
- 本分支**不含** Command Code / OpenCode Go 的任何端点或文案。

## 许可

[MIT](LICENSE),与上游一致。
