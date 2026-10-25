# dsh-newapi-meter (new-api 分支)

<div align="center">

**DeepSeek Harness 会话费用统计插件 · new-api 定制版(界面中英双语)**

[dsh-cost-meter](https://github.com/Han-1413141/dsh-cost-meter) 的定制 fork:原插件的全部功能(本会话费用 · 官方余额 · 预算图框 · 自定义 Provider 余额 · 历史记录 · 峰谷计价 · 官方价格同步 · Coding Plan 额度 · Token 热图等)保持不变,仅把 **额度卡的数据源换成 new-api(new/one-api 系自建或中转网关)的「额度 / 已用」查询**。

[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![upstream](https://img.shields.io/badge/upstream-Han--1413141%2Fdsh--cost--meter-4176E6)](https://github.com/Han-1413141/dsh-cost-meter)

[English](README.en.md) | **中文**

</div>

---

## 分支说明

本仓库的额度卡按分支切换目标厂商:

| 分支 | 额度卡数据源 |
|---|---|
| `cmdc-goat` | Command Code GOAT 订阅(`api.commandcode.ai/alpha/billing/credits`) |
| `oc-go` | OpenCode Go 订阅(`opencode.ai/zen/go/v1/usage`) |
| **`new-api`(本分支)** | **new-api / one-api 系网关的站点额度(`{站点}/v1/dashboard/billing/*`)** |

三个分支共享同一份账本(`$DSH_HOME/storages/cost-meter/ledger.json`)。切换分支后请在设置页重新确认「额度源 provider」(本分支)或套餐档位。

## 源仓库与致谢

本插件是 [dsh-cost-meter](https://github.com/Han-1413141/dsh-cost-meter) 的定制 fork。上游 `dsh-cost-meter` 是一个功能完整的 **DeepSeek Harness 会话费用统计插件**:提供本会话费用、官方余额查询、预算图框、自定义 Provider 余额、历史记录、峰谷计价、官方价格同步、Coding Plan 额度、Token 热图等功能,内置 90+ 模型价格目录与自动匹配,界面中英双语,由 [Han-1413141](https://github.com/Han-1413141) 以 [MIT](LICENSE) 许可开源维护。

**改动原因**:日常模型路由走的是 **new-api(new/one-api 系)网关**,额度/已用只能从站点自己的接口查,而原插件的 Go 额度卡只对接 `opencode.ai/zen/go/v1/usage`。因此 fork 本仓库,把额度卡改为查询 new-api 站点的「总额度 / 已用 / 剩余」;站点地址与 API Key **不在这里重复配置**,而是直接取 DSH「模型」设置里已配好的 provider(`llm-pi-ai.providers.<id>` 的 `baseURL` 与 `apiKeyEnv`)。除额度卡相关代码外,其余功能、结构、文档均继承上游。

**致谢**:感谢 [Han-1413141](https://github.com/Han-1413141) 及上游 dsh-cost-meter 的所有贡献者——本项目绝大部分代码与设计都来自上游,我们只是在其基础上做了一层针对性定制。上游仓库:[Han-1413141/dsh-cost-meter](https://github.com/Han-1413141/dsh-cost-meter)(MIT)。

---

## 本分支改了什么

| 改动 | 说明 |
|---|---|
| 额度接口 | 换成 new-api 的 OpenAI 兼容计费端点:`GET {站点}/v1/dashboard/billing/subscription`(总额)+ `GET {站点}/v1/dashboard/billing/usage`(已用),`Bearer sk-…` 认证 |
| 兜底路径 | 计费端点不可用时回退 `GET {站点}/api/user/self`(系统访问令牌):`quota`(剩余)+ `used_quota`(已用)+ `request_count`(累计调用) |
| 额度源 | **取自 DSH「模型」设置**:设置页下拉选择 provider,站点地址用它的 `baseURL`、Key 用它的 `apiKeyEnv`(DSH 凭据库 → 同名环境变量);不再单独填 Key |
| 卡片展示 | 「已用 / 总额 + 百分比 + 进度条 + 剩余」;余额单位按站点展示类型(USD / CNY / TOKENS)标注;`/api/user/self` 可用时附上累计调用次数 |
| 窗口 | new-api 只有一个「站点额度池」,故只渲染该档(滚动 5 小时 / 本周两档恒为空,不再显示两行「—」;主档位固定 `monthly`) |
| 安全 | **http 与 https 都支持**(自建网关常无 TLS);公网明文 HTTP 首次警告一次后照常请求,不拒绝;请求不跟随重定向;Key 只发往所选 provider 自己的主机;`cap ≤ 0` 等一律按坏响应报错,不把「读不到」显示成 0% |

## 安装

> 需求:Node.js ≥ 20 + DeepSeek Harness(带 `dsh plugin` 命令)。

```sh
# 方式一:本地目录(克隆或解压后)
dsh plugin --profile web add link:./dsh-subscribe-meter

# 方式二:git URL(仓库发布后,分支用 #new-api)
dsh plugin --profile web add github:ycm50/dsh-subscribe-meter#new-api

# 方式三:dshmarket(若已提交到市场)
dsh plugin --profile web add dsh-newapi-meter
```

安装后**重启** `dsh web` 生效:

```sh
dsh web
```

> 注意:本包 `lib/` 就是交付产物,没有编译步骤(`package.json` 已不含 `build`;`files` 只含 `lib`、`cordis.patch.yml`、`docs/provider-pricing.json`)。开发期自检用 `npm test`(=`scripts/verify-typert.mjs`,不随包发布):它会把每一代能定位到的 `@deepseek-ai/dsh-typert-loader` 都跑一遍真实 `validateTypertManifest()`,并检查 `lib/client.js` 的 codec 双键与 `exports` 打包契约;插件运行时不需要这些文件。

> 兼容性:`lib/typert.host.js` / `lib/client.js` 里的 strict codec 必须**同时**带 `schema: <zod v4>` 与 `create: () => <zod>`——0.1.5-rc.x 那代宿主只认 `schema`,0.1.7+ 只认 `create`,少写任一个键,该插件在这代宿主上会整份 typert 贡献注册失败(Remote 方法全丢、设置页与费用面板失效)。改 `lib/` 后先跑 `npm test`,再按上面的方式刷新 profile 里的已安装副本。

## 配置额度源(设置 → 模型 + 设置 → 费用)

1. **设置 → 模型** 里已经有一个指向 new-api 站点的 provider(例如 `umapi`):填好它的 `baseURL`(如 `https://你的站点` 或 `https://你的站点/v1`)与 Key(写入 DSH 凭据库,凭据名即该 provider 的 `apiKeyEnv`,如 `UMAPI_API_KEY`)。
2. **设置 → 费用 → 额度(new-api 卡)** 打开「启用」开关,在 **provider 下拉**里选第 1 步那个 provider —— 站点地址与 Key 都会自动取用,旁边会显示「Key 已就绪(来源:…)」或「Key 未配置」。
3. 需要时可调「额度显示位置」与「刷新间隔」;卡片右上角「刷新额度」立即查询。

查询口径(读 [QuantumNous/new-api](https://github.com/QuantumNous/new-api)、[songquanpeng/one-api](https://github.com/songquanpeng/one-api)、[Wei-Shaw/sub2api](https://github.com/Wei-Shaw/sub2api) 源码核对,2026-10):

**站点类型自动识别**:首次查询时探测,结果持久化在 `goQuota.apiKind` + `apiKindProvider`,换 provider 时自动清空;之后直接按已存类型请求(路径 404 时自动重探测并覆盖)。

| 类型 | 判定依据 |
|---|---|
| `oneapi` | `/v1/dashboard/billing/subscription` 返回 `hard_limit_usd`(one-api 与 new-api 是同一套接口,new-api 只是延续) |
| `sub2api` | 上面 404,而 `/v1/usage` 返回 `mode` / `planName` / `quota` / `remaining` 之一 |

one-api / new-api:

| 端点 | 认证 | 字段 | 口径 |
|---|---|---|---|
| `/v1/dashboard/billing/subscription` | `Bearer sk-…` | `hard_limit_usd` | **总额度 = 剩余 + 已用**(源码 `quota = remainQuota + usedQuota`) |
| `/v1/dashboard/billing/usage` | `Bearer sk-…` | `total_usage` | **已用 × 100**(OpenAI 美分制,源码 `amount * 100`) |
| `/api/user/self` | `Bearer <系统访问令牌>` | `quota` / `used_quota` / `request_count` | 兜底:剩余 + 已用 + 累计调用次数 |
| `/api/status` | 公开 | `quota_display_type`(老 one-api 为 `display_in_currency`) | 展示单位(USD / CNY / tokens),仅用于给读数加标签 |

sub2api(`/v1/usage` 三种形态 → 卡片三档):

| 形态 | 映射 |
|---|---|
| `mode=quota_limited` | `quota.limit/used` → 本月;`rate_limits` 的 `5h` → 滚动、`7d`(无则 `1d`)→ 本周 |
| 订阅套餐 | `subscription.daily/weekly/monthly_usage_usd` ÷ 对应 `_limit_usd` → 滚动 / 本周 / 本月;套餐名显示在「更新于」行 |
| 钱包余额 | 只有余额时用 `usage.total.cost` 反推「已用 ÷ (余额 + 已用)」,避免画不出进度条 |

两个计费端点同单位,故「已用 / 总额」的比值与百分比与展示单位无关;单位读不到时按 USD 显示。

> 说明:站点若开启了「按令牌统计额度」(`DisplayTokenStatEnabled`),上面两个计费端点返回的是**该 API Key(令牌)**的额度与已用,而不是账号总额度——这与 new-api 站点自身的口径一致。

> ⚠️ Key 的解析顺序:该 provider 的 `apiKeyEnv`(DSH 凭据库)→ 同名环境变量。本插件不再单独保存额度 Key,也不从旧配置读取。

## 模型计价

本分支的价格表与上游一致(含内置 **`commandcode` provider 表**,49 个模型,数据取自官方文档模型表,每条带 `sourceUrl` / `checkedAt`)。若你的模型路由指向 **new-api 网关**,通常只用上游模型 id(如 `deepseek-v4.1-flash`、`deepseek/deepseek-v4.1-flash`),主表与归一化匹配即可命中;若网关重命名了模型导致「今日费用」显示 ¥0,请在 **设置 → 费用 → 拓展价格表** 里补一条该 provider 的价格(与上游用法相同)。

- DeepSeek 系列按官方**峰谷两档**:谷 $0.15 / $0.60 / $0.003,峰 $0.30 / $1.20(峰时段 01–04 与 06–10 UTC 周一至周五,与 DeepSeek 官方同一窗口)。
- 其余模型按官方单档报价;官方 `-50% / -98% / -99%` 促销价按折后价录入。
- 官方调价后用 **同步官方价格** 只覆盖 DeepSeek 主表,provider 表需手动核对。

> 价格表更新后,启动时会自动为「有 token 但金额为 0」的历史桶补账(按谷价)。
> 若要把历史按真实峰谷时刻精确重算,切换一次「价格币种」会触发全量重放重定价。

## 与上游的关系

- 上游:[Han-1413141/dsh-cost-meter](https://github.com/Han-1413141/dsh-cost-meter)(MIT)
- 本仓库为其修改 fork,仅改动额度卡相关代码(见上方改动表),其余功能、结构、文档均继承上游;
- 上游插件更新时,本 fork 的改动会被覆盖——如有需要,请从上游新版重新应用本仓库 `lib/index.js` / `lib/newapi.js` / `lib/store.js` / `lib/typert.host.js` / `lib/client.js` 中的对应改动(见 [CHANGELOG.md](CHANGELOG.md) 改动清单)。

## 开发与验证

```sh
node --check lib/index.js && node --check lib/pricing.js \
  && node --check lib/store.js && node --check lib/typert.host.js \
  && node --check lib/client.js && node --check lib/newapi.js   # 语法检查
npm test                                                       # typert 清单/契约校验
dsh --profile web --dump-config         # 组合树校验
dsh --profile web --port 3099           # 真机启动(观察启动日志与 UI)
```

## License

[MIT](LICENSE) © 2026 dsh-cost-meter contributors(new-api 定制分支 © 2026)
