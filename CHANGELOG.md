# Changelog

本项目为 [dsh-cost-meter](https://github.com/Han-1413141/dsh-cost-meter) v1.6.12 的定制 fork。上游逐条开发记录见上游仓库 `CHANGELOG.md`;本文件只记录本 fork 相对上游 v1.6.12 的改动。

> 分支说明:本仓库的额度卡按分支切换目标厂商 —— `cmdc-goat`(Command Code GOAT)、`oc-go`(OpenCode Go)、**`new-api`(new-api / one-api 系自建或中转网关,本分支)**。分支之间共享同一份账本(`$DSH_HOME/storages/cost-meter/ledger.json`),切换分支后建议在设置页重新确认额度源与主档位。

## 1.7.0-newapi.4 (2026-10-18)

### 新增:站点类型自动识别(one-api / new-api / sub2api),探测结果按 provider 持久化

**背景**:one-api 与 new-api 是同一套计费接口(new-api 是 one-api 的延续,`/v1/dashboard/billing/*` 完全一致),而 sub2api 是另一套(`/v1/usage`,且 `/v1/dashboard/billing/*` 返回 `404 {"code":"PATH_NOT_SUPPORTED"}`)。原先只按 new-api 写死请求,遇到 sub2api 站点会一直报「未解析出总额/已用」。既然两者可以靠「计费端点是否 404」可靠区分,就不再为 one-api / sub2api 各开一个分支。

**改动**:

- `lib/newapi.js`:
  - 新增 `detectGatewayKind()`:先试 `/v1/dashboard/billing/subscription`(200 且有 `hard_limit_usd` → `oneapi`),再试 `/v1/usage`(含 `mode`/`planName`/`quota`/`remaining` → `sub2api`),都不成立时把两次状态码一起报出(`newApiKindUnknown`)。
  - 新增 `queryGatewayQuota()`:`kind` 已知就直接按它请求;若该路径 404(`UnsupportedPathError`)则自动重探测并返回新类型,由宿主覆盖保存;`kind` 为空时探测后查询。探测阶段拿到的响应体会复用,不会「探完再查」多打一次。
  - 新增 `parseSub2apiUsage()`,覆盖三种返回形态:`mode=quota_limited`(`quota.limit/used` → 本月,`rate_limits` 的 `5h` → 滚动、`7d`/`1d` → 本周)、订阅套餐(`subscription.daily/weekly/monthly_usage_usd` ÷ 对应 `_limit_usd`)、钱包余额(用 `usage.total.cost` 反推已用)。
  - `parseNewApiStatus()` 兼容老 one-api 的 `display_in_currency` 布尔(无 `quota_display_type` 时);计费端点带 `error` 字段(业务错误也走 200)时判为失败。
  - `queryOneApi()` 在「按已存类型直接查」时自行补拉 subscription,避免因复用不到探测结果而误走 `/api/user/self` 甚至触发多余重探测。
- `lib/index.js`:`queryGoQuota()` 读写 `goQuota.apiKind` / `apiKindProvider`,类型变化时回写活配置并 `ledger.flush()` 落盘;窗口清洗后附上 sub2api 的套餐名(`plan`);新增 `newApiKindUnknown` 中英文案。
- `lib/store.js`:默认值 `apiKind` / `apiKindProvider`;`sanitizeConfig()` 只接受 `oneapi` / `sub2api` / 空串且两者必须成对;`applyConfigPatch()` 在 **providerId 变化时清空** 探测结果(同 provider 重选保留);非法值拒绝并给出 `goQuotaApiKind` 文案。
- `lib/typert.host.js`:`config.goQuota.apiKind` / `apiKindProvider`;快照 `goQuota.plan`(optional,sub2api 套餐名)。
- `lib/client.js`:`goQuota.plan` 追加到「更新于 …」行(如 `更新于 09:16 · 12 次调用 · Wallet`)。

**不改的东西**:分支仍是 `new-api` 一个(不再新增 one-api / sub2api 分支);包名、账本目录、设置项结构不变;换 provider 后首次刷新会自动重探测,用户无需手动切换任何开关。

**校验**:adapter 断言覆盖「探测即命中 billing(不探 usage)」「sub2api 探测顺序 billing→usage」「三种形态映射」「已存类型跳过探测」「已存类型 404 自愈」「两路皆不通时报状态码」「明文 HTTP 拒绝且不发请求」;宿主断言覆盖「探测结果写入 config 且只落盘一次」「缓存命中不再探测」「换 provider 清空类型」「同 provider 保留」「非法类型被拒」。

## 1.7.0-newapi.3 (2026-10-18)

### 修复:设置页已出额度,但左侧侧边栏图框为空

**现象**:`设置 → 费用 → 额度` 已经显示「本月 0.00$ / 10.00$ 0.00%」,但主界面左侧(侧边栏额度图框 / 右下角 chip / 输入框横条)什么都没有。

**根因**:账本是三个分支共用的,本机那份是 goat 分支留下的 `goQuota.main = "rolling"`;上一版归一化写的是 `oneOf(main, [...], 'monthly')`——`rolling` 是合法值,于是被**原样保留**。而 new-api 只有 `monthly` 一档,`rolling/weekly` 恒为 `null`,侧边栏那条路径是:

```js
const N = main === "weekly" || main === "monthly" ? main : "rolling"
const x = ... && state.goQuota?.[N] !== null      // N=rolling → null → x=false → 整块不渲染
```

设置页之所以正常,是因为上一版已经改成「只渲染有数据的窗口行」,与 `main` 无关。

**改动**:

- `lib/store.js`:`sanitizeConfig()` 里把 `goQuota.main` **强制**归位为 `"monthly"`(不再 `oneOf` 回落),旧账本一加载即修正。
- `lib/client.js`:新增 `goMainWindowOf(config, quota)`——按「配置值有数据就用它,否则依次回退 monthly → rolling → weekly」解析主档位,并替换全部 5 处按 `main` 取窗口的位置(侧边栏图框 `goBoxBody`、角落 chip/tooltip、输入框横条、设置页卡片、`Fa` 角落 chips)。即使配置没归位、或快照是旧的,也不会再落到空窗口上。
- 侧边栏图框的窗口列表与 tooltip 也只列有数据的窗口,不再出现两行「—」。

## 1.7.0-newapi.2 (2026-10-18)

### 修复:provider 下拉为空(settings.get 不存在);插件改名 dsh-newapi-meter

**现象**:装到 profile 并重启后,**设置 → 费用 → 额度** 的 provider 下拉是空的,额度卡提示「DSH「模型」设置里没有任何 provider」,而 **设置 → 模型** 里明明列着 `umapi` / `星空` / `卡扣AI管家` / `opencode-go`。

**根因**:读 app.asar 内 `@deepseek-ai/dsh-settings` 源码确认,`SettingsForms` **没有 `get(ns)` 方法**(只有 `configure` / `describe` / `update` / `schema` / `prepareDocument`),我此前写的 `settings.get('llm-pi-ai')` 永远返回 `undefined`——而 `typeof settings?.get === 'function'` 守卫只是让它静默退化成空数组,所以既不报错也不出数。

**改动**:

- `lib/index.js`:新增 `readProviderTable()`,按三条路径依次读取 provider 表:
  1. `settings.describe()`(主路径)——返回 `{ ns, value }[]`,`ns` 是 profile **entry id**(`llm-pi-ai`),`value` 是运行中的实时配置(源码 `describe()` 的 `entry.options.id` 即 ns);
  2. `settings.get(ns)`(兼容个别实现);
  3. `loader.entries()`(组合态配置兜底,与 dsh-compact-value 读组合同一来源)。
- 区分两种空状态:读不到「模型」配置(`goQuotaProvidersUnreadable`,指向宿主接口问题)与配置里确实没有可用 provider(`goQuotaNoProviders`),面板提示因此能指向真正原因。
- 新增测试覆盖:`test-host-wiring.mjs` 现在同时断言 `describe()` / `get()` / `loader` 三条读取路径,以及两条空状态文案。
- **插件改名**:`dsh-CommandCode-meter` → **`dsh-newapi-meter`**(package.json、cordis.patch.yml、typert `package` 与全部 `typeSymbol`、client bundle 的 module id 与 localStorage 键、日志前缀与 UA、README/CHANGELOG 全文)。仅 `new-api` 分支改名,其余分支不变。账本目录仍是 `storages/cost-meter/`(按服务名,不随包名变),历史数据不受影响。

**升级注意**:包名变了,profile 里旧的 `dsh-CommandCode-meter` 依赖不会自动消失,需要先移除再装新包(否则两条 loader 行都会尝试挂载):

```sh
pnpm dsh plugin --profile desktop remove dsh-CommandCode-meter
pnpm dsh plugin --profile desktop add link:A:\Downloads\dsh-subscribe-meter
```

重启 `dsh web` 后,回到 **设置 → 费用 → 额度** 重新选一次 provider(配置里旧的 providerId 是按新包名独立存的)。

## 1.7.0-newapi.1 (2026-10-18)

### 新增:额度卡改为查询 new-api 站点的「额度 / 已用」,站点与 Key 取自 DSH「模型」设置里的 provider

**动机**:GOAT 卡的接口是 Command Code 官方端点,查不了自建 / 中转的 new-api(one-api 系)网关余额。本分支把额度卡整块换成 new-api 额度查询,并复用「模型」设置里已配置好的 provider,不再让用户在本插件里重复填站点地址与 Key。

**接口口径**(读 [QuantumNous/new-api](https://github.com/QuantumNous/new-api) 源码核对,2026-10):

| 端点 | 认证 | 返回 | 口径 |
| --- | --- | --- | --- |
| `GET {base}/v1/dashboard/billing/subscription` | `Bearer sk-…` | `hard_limit_usd` | **总额度 = 剩余 + 已用**(源码 `quota = remainQuota + usedQuota`) |
| `GET {base}/v1/dashboard/billing/usage` | `Bearer sk-…` | `total_usage` | **已用 × 100**(OpenAI 美分制,源码 `amount * 100`) |
| `GET {base}/api/user/self` | `Bearer <系统访问令牌>` | `quota` / `used_quota` / `request_count` | 兜底路径:剩余 + 已用 + 累计调用次数 |
| `GET {base}/api/status` | 公开 | `quota_display_type` | 展示单位(USD / CNY / TOKENS),仅用于给读数加标签 |

两个计费端点同单位,故「已用 / 总额」的比值与百分比与展示单位无关;单位读不到时按 USD 显示。

**改动**:

- `lib/newapi.js`(新):站点地址规范化(去尾部 `/` 与 `/v1`)、`subscription` / `usage` / `/api/user/self` / `/api/status` 四个纯函数解析器、窗口归一化与查询编排。首选计费端点,失败回退管理端 `/api/user/self`;`cap ≤ 0`、字段缺失等一律按坏响应报错,**不把「读不到」伪造成 0%**。公网明文 HTTP 直接拒绝(环回 / 内网放行),请求不跟随重定向,Key 只会发往所选 provider 自己的主机。
- `lib/index.js`:新增 `listModelProviders()`(读 `settings.get('llm-pi-ai').providers`,与「模型」界面同源)与 `resolveProviderKey()`(该 provider 的 `apiKeyEnv` → DSH 凭据库 → 同名环境变量);`queryGoQuota()` 改为按 `goQuota.providerId` 查询,结果映射到卡片窗口(`rolling/weekly` 恒为 null,`monthly` 承载额度池);快照新增 `modelProviders`(不含任何密钥值,只带 Key 是否已就绪);新增 8 条中英文案与 `__testNewApi` 测试导出。
- `lib/typert.host.js`:`config.goQuota.providerId`;窗口 schema 增加 `unit` / `requests`;`state.modelProviders`(optional,旧快照不击穿)。
- `lib/store.js`:`goQuota.providerId` 默认值与校验;`main` 归一化为 `monthly`(new-api 只有额度池一档);文案与注释更新。
- `lib/client.js`:设置页「月度额度池」数字输入换成 **provider 下拉**(选项来自快照 `state.modelProviders`,显示名称 · 主机),手动 Key 输入换成 **Key 状态说明**(Key 已就绪 / 未配置 + 环境变量名);额度卡只渲染有数据的窗口行(不再出现两行「—」);数值文本按站点单位显示(USD 沿用 `$`,其余带单位名);累计调用次数附加在「更新于 …」后;中英文案由 GOAT 改为 new-api。
- 覆盖测试(未随包提交):`lib/newapi.js` 解析器 / 查询 / 回退 / 软错误断言,以及宿主侧「provider 发现 → Key 解析 → 查询」链路断言,均通过。

**配置方式**:设置 → 模型 里已有一个 new-api 站点的 provider(填好 `baseURL` 与该 provider 的 Key)→ 设置 → 费用 → 额度选它即可。Key 与模型请求共用同一把,不再单独填写。

## 1.6.12-goat.4 (2026-09-22)

### 修复:typert codec 形状在「0.1.5-rc.x / 0.1.7+」两代宿主间不兼容,插件 typert 贡献整份注册失败

**现象**:在 `A:\Downloads\deepseek-harness` 源码检出(0.1.7-alpha.1)上启动 Web 后,页面「Failed to load plugins」显示 `dsh-newapi-meter: failed`,启动日志(`%USERPROFILE%\.dsh\logs\startup-*.log`)里:

```
dsh: warning: 1 entry did not activate
typert-loader (@deepseek-ai/dsh-typert-loader): AggregateError: typert-loader: 1 typert contributor(s) failed to register:
  - typert-loader: dsh-newapi-meter invocation "dsh-newapi-meter#costMeter/getState" result codec has no create() factory
```

插件本体能加载(账本读写正常),但 `lib/typert.host.js` 的手写清单在 `validateTypertManifest()` 入口被**整份拒绝**,`ctx.costMeter` 的 13 个 Remote 方法一个都没挂上;`lib/client.js` 里同名的 22 个 codec 也会在 `remote.$mount()` 时被拒——设置页与费用面板随之失效。

**根因**:strict codec 的键名在两代 DSH 之间换过一次,而两代都是硬校验;手写清单只写某一个键,必然被另一代整份拒收(全局安装与源码检出共用同一个 `~/.dsh/profiles/web`,所以两边会轮流报错):

| 世代 | Host 面 loader | Client 面 registry |
| --- | --- | --- |
| 0.1.5-rc.x(全局 `pnpm i -g` 那份,loader 0.1.5-rc.2) | `requireStrictCodec()` 要求 `codec.schema` 是 zod v4 实例(`_zod` + `parse`) | `validateCodec()` 要求 `codec.schema.parse` 是函数 |
| 0.1.7+(源码检出,loader 0.1.7-alpha.1) | `requireStrictCodec()`([packages/typert/loader/src/index.ts](../deepseek-harness/packages/typert/loader/src/index.ts) 第 281 行)要求 `codec.create` 是函数 | `validateCodec()`([packages/typert/registry/src/client.ts](../deepseek-harness/packages/typert/registry/src/client.ts))要求 `codec.create` 是函数 |

两代都只在**入口**校验一次(Host 面 `validateTypertManifest()` 逐个 invocation;Client 面 `remote.$mount()`),任一 codec 不合格 → 该包贡献整体不注册:Host 面 13 个 Remote 方法全丢、Client 面设置页与费用面板静默失效。generator 产物跟着当前世代只写其中一个键(对照 [packages/api/settings-controller/lib/typert.remote-client.js](../deepseek-harness/packages/api/settings-controller/lib/typert.remote-client.js) 只有 `create`),手写清单不能照抄单键形状。

**改动**:

- `lib/typert.host.js`:12 个 codec(`_state$` / `_patch$` / `_fetch$` / `_provider$` / `_credTarget$` / `_credValue$` / `_day$` / `_date$` / `_topSessions$` / `_limit$` / `_sort$` / `_dir$`)统一改为**双键** `{ mode: 'strict', typeSymbol, schema: X, create: () => X }`(`schema` 给 0.1.5-rc.x,`create` 给 0.1.7+);文件头注释写明这条硬约束。
- `lib/client.js`:22 处 codec 描述符同样补成双键。此前误判为「客户端只查 mode」——实际客户端 registry 的 `validateCodec()` 也硬校验(老世代查 `schema.parse`,新世代查 `create`)。
- `scripts/verify-typert.mjs`(新):`npm test` 现在把每一代能定位到的 `@deepseek-ai/dsh-typert-loader` 都跑一遍真实 `validateTypertManifest()`(全局安装那代 + 兄弟目录里的检出,逐个报告版本号),再按文本校验 Client 面 22 个 codec 的双键与 `exports["./typert"]` / `exports["./client"]` 打包契约;一个 loader 都定位不到时退化为主脚本内置的并集校验。`--plugin <目录>` 可直接校验已安装副本,`--anchor <检出根>` 指定额外锚点。
- `package.json`:`test` 改为 `node scripts/verify-typert.mjs`(不再依赖未随包安装的 `tsx`);删掉指向不存在文件的 `build` 脚本(本包 `lib/` 即交付产物,无编译步骤),新增 `prepublishOnly` 在发布前跑同一校验。

**部署**:DSH 加载的是 profile 里的**已安装副本**,改本仓库不会自动生效,需刷新副本后重启,例如
`pnpm dsh plugin --profile web add A:\Downloads\dsh-CommandCode-meter`(该命令把参数原样转发给 profile 目录内的 pnpm;注意它会把 profile 依赖从 `github:ycm50/dsh-commandCode-meter` 改写成本地路径,若要保持 git 依赖,请先提交并推送本仓库,再 `pnpm dsh plugin --profile web add dsh-CommandCode-meter`)。校验副本是否已修好:
`node scripts/verify-typert.mjs --plugin "%USERPROFILE%\.dsh\profiles\web\node_modules\dsh-CommandCode-meter"`。

## 1.6.12-goat.3 (2026-09-11)

### 修复:commandcode 路由的调用费用恒为 0

**现象**:`今日费用` 显示 ¥0,但账本里当天有 220 次调用、60 万输入 token、2240 万 cacheRead——token 都记下了,金额全是 0。

**根因**:调用走 provider `commandcode`(`https://api.commandcode.ai/provider/v1`),而价格表里**既没有 `commandcode` 这个 provider,主表也没有 `deepseek-v4.1-flash`**。`providerPriceEntryFor` 于是走到「未定价」分支返回 `priced: false` → `cost` 恒 0;而「今日费用」用的正是 `apiCost`(真金白银口径),于是显示 ¥0。这不是本轮之前两个版本引入的,而是本 fork 一直存在的缺口——`docs/provider-pricing.json` 里也从来没有 commandcode。

**改动**:

- **新增 `commandcode` provider 价格表**([lib/pricing.js](lib/pricing.js),49 个模型),数据取自官方文档 <https://commandcode.ai/docs/plans/goat> 的「Every model on the GOAT plan is listed below」表,每条都带 `sourceUrl` / `checkedAt`。模型 id 采用 Provider API 写法(与本机 `settings.yaml` 中 commandcode provider 的模型 id 一致)。
  - DeepSeek 系列按官方**峰谷两档**计价(谷 $0.15/$0.60/$0.003、峰 $0.30/$1.20,窗口 01–04 与 06–10 UTC 周一至周五,与 DeepSeek 官方同一窗口),复用既有 `billingMode: 'deepseek-peak'` 与周末全谷价规则。官方只公布了峰的输入/输出;缓存读峰值按官方每对价格恒为 2× 的规律推为 2× 并**显式写出**——若不写,`completeTier` 会用 `cacheMiss` 兜底,把 2240 万缓存读按未命中价计费($4.63,虚高 19 倍)。
  - 其余模型按官方单档报价;官方标注 `-50% / -98% / -99%` 的促销价按折后价录入并附挂牌价注释。
  - 免费模型(LongCat 2.0 / Laguna S 2.1)显式记零价而非「未定价」,语义是「确定不花钱」。
- **启动补账**([lib/store.js](lib/store.js)):`repairLedgerPricing` 此前**跳过**所有 `deepseek-peak` 桶(担心用正午近似重算会压低峰时已计费用)。改为:峰谷桶**有 token 但金额为 0** 时仍然补账,已有金额的保持不动——零金额桶不存在「误伤」问题,补一个谷价下界远好于恒 0。这一条保证修复对**已记录的历史**生效,而不只是对新调用生效。
- `PROVIDER_MODEL_FAMILIES` 补 `commandcode` 分组(设置页拓展价格表按家族展示)。

**实测**(本机 ledger,2026-09-11):修复后当天由 `$0` → `$0.2433`(≈¥1.75),与按谷价手算逐位一致(`(595137×0.15 + 144492×0.60 + 22428288×0.003) / 1e6`);历史 4 天金额一字未动。

> 注:当日补账按**谷价**计(日粒度桶无法还原峰谷拆分),实际账单在峰时段会略高;自修复起的新调用按真实时刻走峰谷两档,是准确的。若需把历史一次性按真实时刻重算,可切换一次「价格币种」(设置 → 费用)触发全量重放重定价。

## 1.6.12-goat.2 (2026-09)

### 计费口径修正:月度额度池不再硬编码

按官方文档复核 GOAT 定价与限额后,修正月度池的计费口径(来源见下)。

- **套餐表集中维护**:新增 `COMMAND_CODE_PLANS` / `COMMAND_CODE_PLAN_IDS` / `DEFAULT_COMMAND_CODE_PLAN` / `GOAT_WINDOW_CAPS` / `normalizeMonthlyPool`([lib/coding-plans.js](lib/coding-plans.js)),收录全部 6 个套餐的月费、月度 Credits 与 5 小时 / 周上限:

  | 套餐 | 月费 | 月度 Credits | 5h 上限 | 周上限 |
  |---|---|---|---|---|
  | Go | $1 | $10 | $3 | $6 |
  | **GOAT** | **$10** | **$70** | **$14** | **$35** |
  | Pro | $20 | $80 | $16 | $40 |
  | Max 10× | $100 | $150 | $45 | $90 |
  | Max 20× | $200 | $300 | $90 | $180 |
  | Team Pro | $40 | $40 | $12 | $24 |

- **月度池改为可配置**:新增 `goQuota.monthlyPool`(设置页「月度额度池」数字输入框,留空 = GOAT 默认 $70)。原因是官方 `monthlyCredits` 是**当前计费模型那一档**的剩余额,而非账户全局剩余——各模型月度额度从 $70(GLM-5.2 / GPT-5.6 Sol / Tencent Hy3)、$60(DeepSeek V4 Flash 系列 / Kimi K2.7 Code)、$47(MiniMax M3)、$40(GLM-5.3 Flash / Gemini 3.8 Flash)到 $20 不等。用固定 $70 去减 $40 档的模型会算出虚高甚至为负的已用。
- **一致性告警**:接口剩余额 > 配置池(池填小了 / 官方给了更高档位)时不再算出负数,而是把 `poolTooSmall` 透出;侧边栏与设置页 GOAT 卡片显示警告文案(`goQuotaPoolTooSmall`),提示把池改成主力模型对应额度。
- **文案修正**:`goQuotaNoUsage` 由「缺少 windowLimits 字段」改为「未解析出任何用量窗口(缺少 windowLimits 与 monthlyCredits)」,与实际判定逻辑一致——现在只要有月度 Credits 就能出数,不再因缺 `windowLimits` 直接报错。
- **默认值来源**:`GOAT_MONTHLY_POOL` 由字面量 70 改为取 `COMMAND_CODE_PLANS.goat.monthlyCredits`,避免套餐表与常量两处漂移。
- **未改动**:5 小时 / 周两档仍原样采信接口 `windowLimits.*.used/cap`(官方上限 $14 / $35 由官方返回,不依赖本地常量)。

**数据来源**(2026-09 抓取复核):

- <https://commandcode.ai/docs/plans/goat> — GOAT:$10/月 → $70 等效用量,7× 倍数
- <https://commandcode.ai/docs/resources/pricing-limits> — 全套餐对照表 + 各模型费率
- <https://commandcode.ai/docs/resources/usage-limits> — 逐套餐 5 小时 / 周上限;「1 credit = $1 用量」仅在满额模型成立

## 1.6.12-goat.1 (2026)

### 核心:Go 额度卡 → Command Code GOAT

- **接口替换**:`lib/index.js` 中 `GO_QUOTA_URL` 由 `https://opencode.ai/zen/go/v1/usage` 改为 `https://api.commandcode.ai/alpha/billing/credits`(Bearer 认证,`fetchWithRetry` 15s 超时,UA `dsh-cost-meter/1.6 (DeepSeek Harness plugin)`)。
- **响应解析**:新增 `windowOfCommandCode(raw)` 解析官方 `windowLimits.fiveHour / weekly`(used/cap/resetAt,`resetAt` 为 epoch **毫秒**),月度池按 `monthlyCredits` 计算:
  - `used = GOAT_MONTHLY_POOL − monthlyCredits`,`cap = GOAT_MONTHLY_POOL`;
  - 新增常量 `GOAT_MONTHLY_POOL = 70`(Go=$10 / Pro=$80 / Max 10x=$150 / Max 20x=$300,注释说明);
  - `emptyGoQuota()` 返回结构扩展为 `{status,message,fetchedAt,rolling,weekly,monthly}`。
- **错误处理**:401/403 → 软错误「未订阅」(goQuotaNoSub);缺 `windowLimits` → goQuotaNoUsage(新文案「缺少 windowLimits 字段」);全部消息文案 "OpenCode Go" → "Command Code GOAT"。

### 凭据

- **Key 解析重写**:`resolveGoKey` 优先级 = DSH 凭据库 `COMMANDCODE_API_KEY` → 环境变量 `COMMANDCODE_API_KEY` → 旧配置 `goQuota.apiKey`;删除 `findGoKeyInAuthJson`(不再读取 opencode 登录态)。
- `lib/store.js`:`SECRET_REF_MAP.goQuota` 由 `'OPENCODE_GO_API_KEY'` 改为 `'COMMANDCODE_API_KEY'`,设置页保存的 Key 与查询解析一致。

### 客户端 UI(lib/client.js)

- **设置页 Go 面板 + 侧边栏 GOAT 图框**:三档窗口(滚动 5 小时 / 本周 / 月度池)全部显示「已用 / 全部」数值(`goQuotaUsedOf` 新 i18n 键,`{used} / {cap}`)+ 各自进度条;月度池 percent = 已用/70×100。
- **侧边栏**:GOAT 图框主体改为三行 `cm-go-row`(短标签 + 进度条 + 已用/全部),与设置页同款样式;窄栏 rail 保留主窗口百分比。
- **预算图框**:移除预算进度条渲染(`cm-bbox-bar` 行删除),保留预算 / 已用% / 今日费用与占预算% / 已用/额度。
- **文案**:中英双语全部 "OpenCode Go" → "Command Code GOAT";新增 `goQuotaUsedOf`、`goQuotaKeyLabel`(Command Code API Key)等键。

### 已知差异

- 月度池显示为「已用 %」(池 − 剩余),因为 Go 卡片客户端只渲染基于 percent 的窗口;官方 CLI `/usage` 显示 5h/周百分比 + 剩余余额,口径略有不同。
- ~~`GOAT_MONTHLY_POOL = 70` 为硬编码常量,更换套餐需同步修改。~~ → 见 1.6.12-goat.2:已改为可配置(`goQuota.monthlyPool`)并集中到套餐表。
- 上游更新会覆盖本 fork 的全部改动;迁移方式见 README「与上游的关系」。
