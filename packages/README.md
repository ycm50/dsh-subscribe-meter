# packages/

一个仓库，四个计量变体。每个子目录都是一个**完整、可独立安装**的 DSH 插件包
（各自带 `package.json` 的 `dsh.bundle` 清单和 `cordis.patch.yml`），互不依赖：

| 目录 | 包名 | 额度来源 |
| --- | --- | --- |
| `dsh-newapi-meter` | `dsh-newapi-meter` | 自建网关（one-api / new-api / sub2api，自动识别） |
| `dsh-opencode-go-meter` | `dsh-opencode-go-meter` | OpenCode Go（滚动 5 小时 / 周 / 月百分比） |
| `dsh-opendesign-go-meter` | `dsh-opendesign-go-meter` | OpenDesign Cloud（5 小时 / 7 天已用-全部） |

仓库根目录本身是第四个变体（Command Code GOAT 版，包名 `dsh-CommandCode-meter`），
保持原位置不变，因此早已在用的 `dsh plugin add github:ycm50/dsh-subscribe-meter`
安装方式不受影响。

## 安装某个变体

```sh
# 从子目录安装（pnpm 的 git 子目录写法）
dsh plugin --profile <profile> add "github:ycm50/dsh-subscribe-meter#path:/packages/dsh-newapi-meter"

# 或者装仓库根目录的 Command Code GOAT 版
dsh plugin --profile <profile> add github:ycm50/dsh-subscribe-meter
```

四个变体都提供同一个 `service:cost-meter`，loader 行 id 都是 `cost-meter`，
**同一个 profile 里只应装其中一个**——装两个会出现重复行 id，并在市场诊断里报出来。

原来按分支发布的 `new-api` / `oc-go` / `od-go` 分支原样保留，仍在用的安装地址
（`github:ycm50/dsh-subscribe-meter#new-api` 等）继续可用；本目录只是把这三份代码
搬到了 `main` 分支下，好让插件市场（只认仓库或子目录，不认分支）能收录它们。

分支布局：

- `main`（默认分支）：四个订阅查询插件都在这里——根目录是 Command Code GOAT 版，
  `packages/` 下是另外三个变体。
- `cmdc-goat`：只有 Command Code GOAT 这一个插件，根目录即插件本体，适合只装它。
- `new-api` / `oc-go` / `od-go`：历史分支，保持原样供旧安装地址使用。
