# Changelog

本项目为 [dsh-cost-meter](https://github.com/Han-1413141/dsh-cost-meter) v1.6.12 的 **OpenDesign Cloud 定制 fork**(分支 `od-go`)。上游逐条开发记录见上游仓库 `CHANGELOG.md`;本文件只记录本 fork 相对上游 v1.6.12 的改动。

> 历史说明:本仓库早期是 Command Code GOAT 版(分支 `cmdc-goat`,版本号 `1.6.12-goat.N`)。`od-go` 分支把 Go 额度卡整体换成 OpenDesign Cloud,并**移除**全部 Command Code / OpenCode Go 端点与文案;下方 goat.N 的条目是那段历史的原始记录,保留仅作溯源,所述端点与配置在当前分支已不存在。

## 1.6.12-od.2 (2026-10-30)

### 变更:窗口按美元展示 + 内置 Vela 登录入口

**额度数字**:此前直接透传接口的 credits(50000 / 150000),面板显示成 50000/150000,与官方文档口径($10 / $30)不一致。

根因是两套 credits 单位并存:
- 钱包余额:`billing/summary` 的 `creditsPerUsd = 10000`(10000 credits = $1);
- Design Plan 窗口:Go 的 5 小时窗 50000、7 天窗 150000,官方文档明写「5 小时 $10 / 7 天 $30」→ **5000 credits = $1**。
两套差 2 倍,恰是 Design Plan 倍率的倒数关系。

**改动**:
- `coding-plans.js`:新增 `OPENDESIGN_WINDOW_CREDITS_PER_USD = 5000`(窗口),保留 `OPENDESIGN_CREDITS_PER_USD = 10000`(钱包);新增 `parseVelaLoginOutput()` / `velaConfigPath()`。
- `index.js`:窗口 `used` / `cap` 按 5000 credits = $1 折算,面板显示 **`$10 / $30`**;新增 `resolveVelaCli()` 与三个 RPC(`getLoginState` / `startVelaLogin` / `cancelVelaLogin`),内置设备登录入口。
- `client.js`:额度卡片新增登录区块(状态行 + 登录/取消按钮 + 验证码 + 打开授权页),中英双语文案;新增 `lg` loginState codec 与三个 invocation。
- `typert.host.js`:`loginStateSchema` + `_loginState$codec` + 三个 invocation 与方法文档(host 面 13 → 16)。
- README / README.en:额度表改为美元口径,新增「登录:插件内置登录入口」一节。

**CLI 定位踩坑(实测)**:Windows 上后台 `spawn('npx.cmd', ..., {shell:true})` 会卡住——既不输出也不退出。改为按 `PATH → npx 缓存(直接跑 vela.cjs)→ npx` 三级定位,实测从卡死变为 **4 秒出激活 URL**。

**验证**:`npm test` 通过(host 16 invocation / client 25 codec);真实凭据跑通,窗口返回 `5h used=1.58 cap=10`、`7d used=1.58 cap=30`(即 $1.58 / $10、$1.58 / $30);登录流程在沙箱 HOME 下 5 秒内拿到激活 URL 与 6 位验证码。

## 1.6.12-od.1 (2026-10-30)

### 变更:Go 额度卡由 Command Code GOAT 换成 OpenDesign Cloud

**背景**:模型路由已改指向 OpenDesign Cloud(桌面端 / Vela CLI / `https://amr-link.open-design.ai/v1`),旧卡片查的 `api.commandcode.ai/alpha/billing/credits` 与本账号无关。

**接口**(2026-10-30 用真实账号实测):

```
GET https://amr-api.open-design.ai/api/v1/workspaces/current          → { workspaceId, personalMembershipTier }
GET https://amr-api.open-design.ai/api/v1/workspaces/{ws}/billing/funding-check[?modelId=]
    Authorization: Bearer <Vela controlKey>
```

返回 `{ balanceUsd, modelCovered, funding, fundingCheck, codingPlan: { tier, eligible, windows[] } }`,其中每个 window 为
`{ policyId, durationSeconds, resetMode, usedCredits, limitCredits, remainingCredits, windowStart, resetsAt }`。

**关键事实**:

- `durationSeconds` **18000 = 滚动 5 小时**、**604800 = 7 天**;仅 Go 同时有这两档,Plus/Pro/Max 只有 7 天档。
- 单位是 **Design Plan credits**,`1 USD = 10000 credits`(同域 `/api/v1/billing/summary` 的 `creditsPerUsd` 可交叉验证)。
- 官方文档「Go 5 小时 $10 / 7 天 $30」是**模型用量价值**;0.5× 倍率下折合 50000 / 150000 credits,与接口一致,面板按接口原值展示、不反推。
- OpenDesign **没有月度滚动窗**,月度上限体现在 Design Plan 总额,故「月」档整体移除。

**认证**:额度接口认 **Vela CLI 登录态 `controlKey`**,不是 `sk-*` 推理 Key(实测 `sk-*` 打过去一律 `401 {"error":"unauthenticated"}`)。登录态由 `npx @powerformer/vela-cli login` 写入 `~/.amr/config.json`。

**改动**:

- `lib/coding-plans.js`:新增 `opendesign` adapter(`credentialEnvs: ['VELA_CONTROL_KEY']`)、`OPENDESIGN_PLANS` / `OPENDESIGN_CREDITS_PER_USD` / `OPENDESIGN_API_ORIGIN`、纯函数 `parseOpenDesignFunding()`、两步查询 `queryOpenDesignQuota()`、登录态读取 `readVelaControlKey()`;删除 `parseCommandCodeCredits` 与 `COMMAND_CODE_PLANS`。
- `lib/index.js`:额度查询改为 OpenDesign;凭据链为 **DSH 凭据库 `VELA_CONTROL_KEY` → 环境变量 → `~/.amr/config.json`**;快照新增 `tier` / `balanceUsd` / `creditsPerUsd`;中英文案全部替换。
- `lib/client.js`:主档位与右下角 chip 由三档(`rolling/weekly/monthly`)缩为两档(`rolling/weekly`);删除「月度额度池」输入项与 `poolTooSmall` 警告,改为 `goQuotaTierNote`(显示套餐档位与钱包余额);Coding Plan 列表里的 provider id 改为 `opendesign`。
- `lib/pricing.js`:`commandcode` provider 价格表替换为 **`opendesign` 39 个模型目录价**,来源 `GET /api/v1/public/model-prices`(含 cacheRead)。
- `lib/store.js` / `lib/typert.host.js`:`goQuota.main` 枚举缩为 `rolling|weekly`;密钥目标 `goQuota` → `VELA_CONTROL_KEY`;旧的 `monthlyPool` 字段保留但恒为 null(兼容旧账本)。
- `lib/plan-billing.js`:`commandcode` → `opendesign`。
- `package.json`:包名 `dsh-opendesign-go-meter`,network 权限 `api.commandcode.ai` → `amr-api.open-design.ai`,描述与关键词同步。
- `docs/provider-pricing.json`:重新生成,含 `opendesign` 39 个模型。
- `README.md` / `README.en.md` / `cordis.patch.yml`:全部改写为 OpenDesign 版。

**验证**:`npm test`(verify-typert)通过(host 面 13 个 invocation、client 面 22 个 strict codec 双键、exports 契约);用真实 `~/.amr/config.json` 跑通两步查询,得到 `5h 8.8% / 7d 2.9%`;错误路径(missing key / 401)均返回 `soft` 错误。

## 1.6.12-goat.4 (2026-09-22)

### 修复:typert codec 形状在「0.1.5-rc.x / 0.1.7+」两代宿主间不兼容,插件 typert 贡献整份注册失败

**现象**:在 `A:\Downloads\deepseek-harness` 源码检出(0.1.7-alpha.1)上启动 Web 后,页面「Failed to load plugins」显示 `dsh-opendesign-go-meter: failed`,启动日志(`%USERPROFILE%\.dsh\logs\startup-*.log`)里:

```
dsh: warning: 1 entry did not activate
typert-loader (@deepseek-ai/dsh-typert-loader): AggregateError: typert-loader: 1 typert contributor(s) failed to register:
  - typert-loader: dsh-opendesign-go-meter invocation "dsh-opendesign-go-meter#costMeter/getState" result codec has no create() factory
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
`pnpm dsh plugin --profile web add A:\Downloads\dsh-opendesign-go-meter`(该命令把参数原样转发给 profile 目录内的 pnpm;注意它会把 profile 依赖从 `github:ycm50/dsh-commandCode-meter` 改写成本地路径,若要保持 git 依赖,请先提交并推送本仓库,再 `pnpm dsh plugin --profile web add dsh-opendesign-go-meter`)。校验副本是否已修好:
`node scripts/verify-typert.mjs --plugin "%USERPROFILE%\.dsh\profiles\web\node_modules\dsh-opendesign-go-meter"`。

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
