# dsh-opendesign-go-meter

<div align="center">

**DeepSeek Harness session cost meter plugin · OpenDesign Cloud edition (bilingual UI)**

A custom fork of [dsh-cost-meter](https://github.com/Han-1413141/dsh-cost-meter) that keeps every upstream feature (session cost, official balance, budget box, custom-provider balance, history, peak/off-peak pricing, official price sync, coding-plan quotas, token heatmap, …) and swaps the Go quota card for **OpenDesign Cloud subscription quota**.

[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![upstream](https://img.shields.io/badge/upstream-Han--1413141%2Fdsh--cost--meter-4176E6)](https://github.com/Han-1413141/dsh-cost-meter)

**English** | [中文](README.md)

</div>

---

## Upstream and credits

This plugin is a custom fork of [dsh-cost-meter](https://github.com/Han-1413141/dsh-cost-meter), a complete **DeepSeek Harness session cost meter**: session cost, official balance, budget box, custom-provider balance, history, peak/off-peak pricing, official price sync, coding-plan quotas, token heatmap, a 90+ model price catalog with automatic matching, and a bilingual UI, maintained by [Han-1413141](https://github.com/Han-1413141) under [MIT](LICENSE).

**Why fork**: we route models through **OpenDesign Cloud** (desktop app / Vela CLI / `https://amr-link.open-design.ai/v1`). Upstream's Go quota card only talks to `opencode.ai/zen/go/v1/usage` and cannot read OpenDesign quotas. This fork replaces that card with the official OpenDesign quota endpoint and ships OpenDesign's 39-model price catalog.

**Credits**: the vast majority of this code and design comes from upstream dsh-cost-meter and its contributors — [Han-1413141/dsh-cost-meter](https://github.com/Han-1413141/dsh-cost-meter) (MIT). Our changes are the OpenDesign-specific layer described below.

---

## What this fork changes

| Change | Detail |
|---|---|
| Quota endpoint | **OpenDesign Cloud official quota API** in two steps: `GET https://amr-api.open-design.ai/api/v1/workspaces/current` for the workspaceId, then `GET /api/v1/workspaces/{ws}/billing/funding-check` for `codingPlan.windows[]` |
| Two windows | OpenDesign has only **rolling 5 hours (18000s)** and **7 days (604800s)**; both render as "used / total + progress bar". OpenDesign has **no monthly rolling window**, so the old monthly slot is gone entirely |
| Units | The API returns **Design Plan credits**, `1 USD = 10000 credits`; values are shown as returned, never reverse-derived |
| Plan tier | The card also shows the current tier and wallet balance, both taken from the same funding-check response |
| Credentials | Uses the **Vela CLI sign-in `controlKey`** (run `npx @powerformer/vela-cli login` once; it writes `~/.amr/config.json`), not an `sk-*` inference key. Resolution order: DSH credential store `VELA_CONTROL_KEY` → env `VELA_CONTROL_KEY` → `~/.amr/config.json` |
| Price table | Ships an **`opendesign` provider with 39 models**, from the public `GET /api/v1/public/model-prices` endpoint (fetched 2026-10-30, cacheRead included) |
| Copy | All "Command Code GOAT" text is now "OpenDesign Cloud"; adds a `goQuotaTierNote` string (zh/en) |

## Install

> Requires Node.js ≥ 20 and DeepSeek Harness with the `dsh plugin` command.

```sh
# Local directory
dsh plugin --profile web add link:./dsh-opendesign-go-meter

# Git URL
dsh plugin --profile web add github:ycm50/dsh-opendesign-go-meter

# dshmarket (if published there)
dsh plugin --profile web add dsh-opendesign-go-meter
```

Restart `dsh web` afterwards:

```sh
dsh web
```

> `lib/` is the shipped artifact — there is no build step (`package.json` has no `build`; `files` lists only `lib`, `cordis.patch.yml` and `docs/provider-pricing.json`). Use `npm test` (= `scripts/verify-typert.mjs`) during development.

> Compatibility: the strict codecs in `lib/typert.host.js` and `lib/client.js` must carry **both** `schema: <zod v4>` and `create: () => <zod>` — the 0.1.5-rc.x host only reads `schema` while 0.1.7+ only reads `create`. Missing either key makes the whole typert contribution fail to register on that host generation (all remote methods gone, settings page and cost panel dead). Run `npm test` after editing `lib/`.

## Sign in: built-in login entry

Quota queries use the **Vela sign-in**, not an API key. The plugin ships a **built-in login entry** — no terminal needed:

1. Open **Settings → Cost → OpenDesign subscription quota** and click "Sign in to OpenDesign";
2. The card shows a 6-character code and an "Open approval page" button;
3. Confirm the code in the browser — the plugin detects completion and refreshes the quota immediately.

Under the hood it launches the official CLI's `login` subcommand (device authorization); the CLI itself writes credentials to `~/.amr/config.json`. CLI resolution order:

1. `vela` on `PATH` (if you installed the CLI yourself);
2. the npx cache copy of `@powerformer/vela-cli` (`%LOCALAPPDATA%/npm-cache/_npx/*`, run directly, no network);
3. only if neither exists, fall back to `npx --yes @powerformer/vela-cli login` (needs network the first time).

> Signing in from a terminal works too and is equivalent:
> ```sh
> npx @powerformer/vela-cli login
> ```

The plugin then reads `profiles.prod.controlKey` from `~/.amr/config.json` automatically. The same value can live in the DSH credential store or the `VELA_CONTROL_KEY` environment variable (handy for CI or multiple machines).

> ⚠️ There is deliberately **no** manual key field in Settings: a controlKey outranks an API key (it can read the whole billing ledger and workspace), so it should not be pasted into a text box. To configure it from Settings, store `VELA_CONTROL_KEY` in the DSH credential store instead.

## Quota semantics (measured)

Go is $10/month; the docs say "5 hours $10 / 7 days $30", but those are **model-usage dollars**. The API returns Design Plan credits (1 USD = 10000 credits), so the real numbers are:

| Window | API limitCredits | Shown in the panel | Model usage at 0.5× |
|---|---|---|---|
| Rolling 5 hours (18000s) | 50000 | **$10** | $10 |
| 7 days (604800s) | 150000 | **$30** | $30 |

> The panel shows the official documentation figures **$10 / $30**, converted at **5000 credits = $1** (50000/10 = 150000/30).
> This is a different unit from the wallet balance, which is **10000 credits = $1** (see `creditsPerUsd` in `billing/summary`).
> The 2× gap is exactly the reciprocal of the Design Plan multiplier.

Plans (official `/model-credits` page):

| Plan | Price | Design Plan monthly | Plan-model credits | 5-hour | 7-day |
|---|---|---|---|---|---|
| **Go** | **$10** | $120 | $0 | **$10** | **$30** |
| Plus | $20 | $160 | $20 | — | $40 |
| Pro | $100 | $360 | $120 | — | $90 |
| Max | $200 | $600 | $300 | — | $150 |

> Only Go has both a 5-hour and a 7-day window; Plus / Pro / Max only have the 7-day window, and the card automatically shows a single row on those accounts.

These values live in `OPENDESIGN_PLANS` in [lib/coding-plans.js](lib/coding-plans.js), sourced from the official pages (re-checked 2026-10):

- <https://open-design.ai/model-credits/>
- <https://open-design.ai/help/billing/>

## Model pricing (the `opendesign` route)

If models are routed to OpenDesign's Provider API (`provider: open-design`, baseURL
`https://amr-link.open-design.ai/v1`), the price table must know that provider, otherwise
calls record tokens but cost stays 0 ("today's cost" shows ¥0). This fork ships an
**`opendesign` provider table with 39 models** from the public
`/api/v1/public/model-prices` endpoint, each entry carrying `sourceUrl` / `checkedAt`.

- All entries are catalog `flat` prices per 1M tokens (cacheRead included).
- Model ids use the Provider API spelling (`deepseek-v4.1-flash`, `glm-5.3-flash`, `kimi-k2.7-code`); case and separator differences are absorbed by normalized matching.
- This is the **pay-as-you-go catalog price** and is a different scale from Design Plan credits: the former converts tokens into USD-equivalents, the latter is the subscription allowance itself.

Edit or mount entries under **Settings → Cost → Extended price table**. **Sync official prices** only rewrites the DeepSeek main table; provider tables are checked manually.

## Relationship to upstream

- Branch `od-go` is this fork (OpenDesign edition).
- Other dsh-cost-meter forks (e.g. `cmdc-goat`) live in their own repositories/branches.
- This branch contains **no** Command Code / OpenCode Go endpoints or copy.

## License

[MIT](LICENSE), same as upstream.
