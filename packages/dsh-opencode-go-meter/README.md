# dsh-opencode-go-meter

<div align="center">

**DeepSeek Harness 会话费用统计插件 · OpenCode Go 定制版(界面中英双语)**

[dsh-cost-meter](https://github.com/Han-1413141/dsh-cost-meter) 的定制 fork:原插件的全部功能(本会话费用 · 官方余额 · 预算图框 · 自定义 Provider 余额 · 历史记录 · 峰谷计价 · 官方价格同步 · Coding Plan 额度 · Token 热图等)保持不变,额度卡面向 **OpenCode Go 订阅**(服务端返回百分比,界面只显示百分比)。

[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![upstream](https://img.shields.io/badge/upstream-Han--1413141%2Fdsh--cost--meter-4176E6)](https://github.com/Han-1413141/dsh-cost-meter)

[English](README.en.md) | **中文**

</div>

---

## 源仓库与致谢

本插件是 [dsh-cost-meter](https://github.com/Han-1413141/dsh-cost-meter) 的定制 fork。上游 `dsh-cost-meter` 是一个功能完整的 **DeepSeek Harness 会话费用统计插件**:提供本会话费用、官方余额查询、预算图框、自定义 Provider 余额、历史记录、峰谷计价、官方价格同步、Coding Plan 额度、Token 热图等功能,内置 90+ 模型价格目录与自动匹配,界面中英双语,由 [Han-1413141](https://github.com/Han-1413141) 以 [MIT](LICENSE) 许可开源维护。

**改动原因**:我们日常使用 **OpenCode Go** 订阅。原 `dsh-CommandCode-meter` 仓库把 Go 额度卡改成了
**Command Code GOAT** 的官方端点(`api.commandcode.ai`),而 OpenCode Go 走的是另一套契约。本分支把额度卡
**适配回 OpenCode Go**:端点 `GET https://opencode.ai/zen/go/v1/usage`(Bearer 认证),响应为
`usage.{rolling,weekly,monthly}.{status,percent,resetsAt}` —— **服务端直接给出百分比,因此在界面上只显示百分比**
(没有美元额度,也没有「月度额度池」概念)。凭据解析使用 DSH 凭据库 / 环境变量 **`OPENCODE_GO_API_KEY`**,
与 profile 里 `llm-pi-ai.providers.opencode-go.apiKeyEnv` 同名,可与其他 OpenCode Go 插件共用一把钥匙。

> 本分支与 `master`(**Command Code GOAT** 版)**完全独立、各自维护**:master 面向 GOAT 订阅,
> 本分支面向 OpenCode Go 订阅,两者的端点、凭据、数据形态都不同,不做互相兼容。

**致谢**:感谢 [Han-1413141](https://github.com/Han-1413141) 及上游 dsh-cost-meter 的所有贡献者——本项目绝大部分代码与设计都来自上游,我们只是在其基础上做了一层针对性定制。上游仓库:[Han-1413141/dsh-cost-meter](https://github.com/Han-1413141/dsh-cost-meter)(MIT)。

---

## 本分支相对上游的改动

上游 [dsh-cost-meter](https://github.com/Han-1413141/dsh-cost-meter) 的 Go 额度卡本来就对接 OpenCode Go;
`dsh-CommandCode-meter` 的 master 把它换成了 Command Code GOAT。**本分支保留上游的 OpenCode Go 语义**,
并把额度卡完整适配到 OpenCode Go 的真实契约:

| 改动 | 说明 |
|---|---|
| 额度接口 | `GET https://opencode.ai/zen/go/v1/usage`(Bearer 认证) |
| 响应契约 | `usage.{rolling,weekly,monthly} = { status, percent, resetsAt }` —— **服务端直接给出百分比**(权威值) |
| 显示形态 | **只显示百分比**(如 `6.00%`),不做任何美元折算;滚动 5 小时 / 本周 / 本月三档各带进度条 |
| 限流状态 | `status: 'rate-limited'` 是正常状态(显示徽标),不是错误 |
| 缺档处理 | 任一份额窗口缺失或字段非法即报错(不把「不可用」当 0,错误带 JSON 路径) |
| 凭据 | Key 解析:DSH 凭据库 `OPENCODE_GO_API_KEY` → 环境变量同名 → 旧配置 `goQuota.apiKey` 兜底 |
| 无月度池 | OpenCode Go 没有「额度池」概念,设置页**不含**「月度额度池」;快照也不含 `used/cap/remaining` |
| 侧边栏 | 与设置页同款三窗口样式;**预算图框去掉预算进度条**(保留预算、已用%、今日费用与占预算%、已用/额度) |
| 凭据 | Key 解析:**DSH 凭据库 `OPENCODE_GO_API_KEY`** → 环境变量同名 → 旧配置 `goQuota.apiKey` 兜底 |
| 文案 | 额度卡相关文案(标题 / 行标签 / 主档位 / 启用开关 / 右下角 / 引导语,i18n 中英各一套)统一为 OpenCode Go |

## 安装

> 需求:Node.js ≥ 20 + DeepSeek Harness(带 `dsh plugin` 命令)。

发布后(或本地路径):

```sh
# 方式一:本地目录(克隆或解压后)
dsh plugin --profile desktop add link:./dsh-opencode-go-meter

# 方式二:git URL(仓库发布后)
dsh plugin --profile desktop add github:ycm50/dsh-opencode-go-meter

# 方式三:dshmarket(若已提交到市场)
dsh plugin --profile desktop add dsh-opencode-go-meter
```

安装后**重启** `dsh web` 生效:

```sh
dsh web
```

> 注意:本包 `lib/` 就是交付产物,没有编译步骤(`package.json` 已不含 `build`;`files` 只含 `lib`、`cordis.patch.yml`、`docs/provider-pricing.json`)。开发期自检用 `npm test`(=`scripts/verify-typert.mjs`,不随包发布):它会把每一代能定位到的 `@deepseek-ai/dsh-typert-loader` 都跑一遍真实 `validateTypertManifest()`,并检查 `lib/client.js` 的 codec 双键与 `exports` 打包契约;插件运行时不需要这些文件。

> 兼容性:`lib/typert.host.js` / `lib/client.js` 里的 strict codec 必须**同时**带 `schema: <zod v4>` 与 `create: () => <zod>`——0.1.5-rc.x 那代宿主只认 `schema`,0.1.7+ 只认 `create`,少写任一个键,该插件在这代宿主上会整份 typert 贡献注册失败(Remote 方法全丢、设置页与费用面板失效)。改 `lib/` 后先跑 `npm test`,再按上面的方式刷新 profile 里的已安装副本。

OpenCode Go 的额度由服务端以**百分比**给出,分三个窗口:

| 窗口 | 字段 | 含义 |
|---|---|---|
| 滚动 5 小时 | `usage.rolling` | 从本窗首次请求起算(非固定时钟) |
| 本周 | `usage.weekly` | 自然周 |
| 本月 | `usage.monthly` | 自然月 |

每个窗口形如 `{ status, percent, resetsAt }`:

- `percent` 是**已用百分比**(权威值,插件不做任何换算);
- `status` 为 `'rate-limited'` 时表示该窗口正在限流 —— 这是**正常状态**(界面显示徽标),不是错误;
- 任一份额窗口缺失或字段非法都会**明确报错**(绝不把「不可用」当成 0,错误信息带 JSON 路径)。

> **没有美元额度,也没有「月度额度池」**:OpenCode Go 是订阅制,接口不提供 `used`/`cap` 金额,
> 因此设置页不含「月度额度池」,界面只显示百分比。这是与 `master`(Command Code GOAT 版)最大的差别。

接口文档与额度的权威来源以服务端响应为准(端点见上表)。

## 模型计价(opencode-go 路由)

如果你的模型路由指向 OpenCode Go(`provider: opencode-go`,见 profile 的 `llm-pi-ai` 配置),
价格表需要认识这个 provider,否则调用会**只记 token、金额恒 0**(「今日费用」显示 ¥0)。
价格表已内置 **`opencode-go` provider**,数据取自 `opencode.ai/docs/go`,每条都带 `sourceUrl` / `checkedAt`。

- DeepSeek 系列(含 V4 Flash / Pro)以官方公布单价为准。
- 其余模型按官方单档报价录入。
- 模型 id 用 Go 目录的写法(如 `glm-5.3`、`kimi-k2.7-code`);大小写与连接符差异由归一化匹配兜住。

> 说明:OpenCode Go 是**订阅制**(额度按百分比计),这里的单价是官方公布的**参考单价**,
> 用于「按量估算成本 / 与官方对比」,并非实际扣费口径。

若要自行增改,在 **设置 → 费用 → 拓展价格表** 中挂载/编辑;官方调价后用
**同步官方价格** 只覆盖 DeepSeek 主表,provider 表需手动核对。

> 价格表更新后,启动时会自动为「有 token 但金额为 0」的历史桶补账(按谷价)。
> 若要把历史按真实峰谷时刻精确重算,切换一次「价格币种」会触发全量重放重定价。

## 配置 OPENCODE_GO_API_KEY

在 **设置 → 费用 → 额度(Go 卡)→ 输入 API Key**(只写不回显,保存进 DSH 凭据库),或提前在 DSH 凭据库/环境变量中配置 `OPENCODE_GO_API_KEY`。Key 解析优先级:

1. DSH 凭据库(设置页保存的 Key 也存这里)
2. 环境变量 `OPENCODE_GO_API_KEY`
3. 旧配置 `goQuota.apiKey`(仅迁移用)

> 该名字与 profile 里 `llm-pi-ai.providers.opencode-go.apiKeyEnv` **同名**,因此额度查询与模型调用
> 共用同一把钥匙 —— 配一次即可,无需分别填写。
>
> 额度查询只在**显式启用** Go 额度卡时才出站请求;不需要时可关掉「启用 OpenCode Go 额度」开关。

## 与上游的关系

- 上游:[Han-1413141/dsh-cost-meter](https://github.com/Han-1413141/dsh-cost-meter)(MIT)
- 本仓库为其修改 fork,仅改动 Go 额度卡相关代码(见上方改动表),其余功能、结构、文档均继承上游;
- 上游插件更新时,本 fork 的改动会被覆盖——如有需要,请从上游新版重新应用本仓库 `lib/index.js` / `lib/store.js` / `lib/client.js` 中的对应改动(见 [CHANGELOG.md](CHANGELOG.md) 改动清单)。

## 开发与验证

```sh
node --check lib/index.js && node --check lib/pricing.js \
  && node --check lib/store.js && node --check lib/typert.host.js \
  && node --check lib/client.js         # 语法检查
dsh --profile web --dump-config         # 组合树校验
dsh --profile web --port 3099           # 真机启动(观察启动日志与 UI)
```

## License

[MIT](LICENSE) © 2026 dsh-cost-meter contributors(OpenCode Go 定制 fork © 2026)
