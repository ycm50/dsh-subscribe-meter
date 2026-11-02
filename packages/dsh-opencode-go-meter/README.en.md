# dsh-opencode-go-meter

<div align="center">

**DeepSeek Harness session cost tracking plugin · OpenCode Go edition (bilingual UI)**

A customized fork of [dsh-cost-meter](https://github.com/Han-1413141/dsh-cost-meter). All upstream features (per-conversation cost · official balance · budget box · custom provider balance · history · peak/off-peak pricing · official price sync · coding-plan quotas · token heat grid, …) are unchanged — only the **OpenCode Go quota card was replaced with the Command Code GOAT subscription quota**.

[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![upstream](https://img.shields.io/badge/upstream-Han--1413141%2Fdsh--cost--meter-4176E6)](https://github.com/Han-1413141/dsh-cost-meter)

English | [中文](README.md)

</div>

---

## Upstream & acknowledgements

This plugin is a customized fork of [dsh-cost-meter](https://github.com/Han-1413141/dsh-cost-meter). The upstream `dsh-cost-meter` is a feature-complete **DeepSeek Harness session cost tracking plugin**: per-conversation cost, official balance query, budget box, custom provider balance, history, peak/off-peak pricing, official price sync, Coding Plan quotas, token heat grid, and more — with a built-in 90+ model price catalog and auto-matching, in a bilingual (zh/en) UI. It is maintained by [Han-1413141](https://github.com/Han-1413141) under the [MIT](LICENSE) license.

**Why this branch**: we use the **OpenCode Go** subscription. The sibling `dsh-CommandCode-meter` repo repointed its Go-quota card at **Command Code GOAT** (`api.commandcode.ai`), which is a different contract. This branch adapts the quota card **to OpenCode Go properly**: endpoint `GET https://opencode.ai/zen/go/v1/usage` (Bearer auth), response `usage.{rolling,weekly,monthly}.{status,percent,resetsAt}` — the server returns **percentages directly**, so the UI **shows percentages only** (no dollar amounts and no “monthly credit pool” concept). Credentials resolve through the DSH credential store / **`OPENCODE_GO_API_KEY`** environment variable, the same name as `llm-pi-ai.providers.opencode-go.apiKeyEnv` in the profile — so quota queries and model calls share one key.

> This branch and `master` (the **Command Code GOAT** variant) are **fully independent and separately maintained**:
> master targets GOAT subscriptions, this branch targets OpenCode Go subscriptions. Their endpoints, credentials and
> data shapes differ, and no cross-compatibility is attempted.

**Acknowledgements**: thanks to [Han-1413141](https://github.com/Han-1413141) and all contributors of upstream dsh-cost-meter — the vast majority of this project's code and design comes from upstream; we only layered a targeted customization on top. Upstream repo: [Han-1413141/dsh-cost-meter](https://github.com/Han-1413141/dsh-cost-meter) (MIT).

---

## What changed in this fork

| Change | Details |
|---|---|
| Quota endpoint | `GET https://opencode.ai/zen/go/v1/usage` (Bearer auth) |
| Response contract | `usage.{rolling,weekly,monthly} = { status, percent, resetsAt }` — the **server supplies the percentage** (authoritative) |
| Display | **Percentages only** (e.g. `6.00%`), with no dollar conversion; the rolling-5h / weekly / monthly windows each have a progress bar |
| Rate-limited state | `status: 'rate-limited'` is a normal state (badge shown), not an error |
| Missing windows | Any missing or malformed quota window is an error (never treat “unavailable” as zero; the message carries the JSON path) |
| Credentials | Key resolution: DSH credential store `OPENCODE_GO_API_KEY` → same-name env var → legacy config `goQuota.apiKey` fallback |
| No pool | OpenCode Go has no “credit pool”; Settings shows no monthly-pool field, and snapshots carry no `used/cap/remaining` |
| Copy | All quota-card strings (title, row label, primary window, enable switch, corner, guide text; zh/en) are OpenCode Go |

## Installation

> Requirements: Node.js ≥ 20 + DeepSeek Harness (a version with the `dsh plugin` command).

```sh
# Option 1: local directory (after cloning or extracting)
dsh plugin --profile desktop add link:./dsh-opencode-go-meter

# Option 2: git URL (once the repo is published)
dsh plugin --profile desktop add github:ycm50/dsh-opencode-go-meter

# Option 3: dshmarket (if submitted to the marketplace)
dsh plugin --profile desktop add dsh-opencode-go-meter
```

After installing, **restart** `dsh web` (plugin rows, the Typert manifest and the client bundle are all scanned at startup):

```sh
dsh web
```

> Note: `lib/` **is** the shipped artifact — there is no compile step (`package.json` no longer defines `build`; `files` only includes `lib`, `cordis.patch.yml`, `docs/provider-pricing.json`). For development, `npm test` (= `scripts/verify-typert.mjs`, not shipped) runs the real `validateTypertManifest()` from every `@deepseek-ai/dsh-typert-loader` generation it can locate, and checks the codec keys in `lib/client.js` plus the `exports` packaging contract. The plugin does not need these files at runtime.

> Compatibility: every strict codec in `lib/typert.host.js` / `lib/client.js` must carry **both** `schema: <zod v4>` and `create: () => <zod>` — the 0.1.5-rc.x host generation only reads `schema`, 0.1.7+ only reads `create`. Dropping either key makes that generation reject the whole typert contribution (all Remote methods gone; settings page and cost panel silently break). After editing `lib/`, run `npm test` and refresh the installed copy in the profile as described above.

## Configuring OPENCODE_GO_API_KEY

Enter the key in **Settings → Cost → Quota (Go card) → API key input** (write-only, never echoed; stored in the DSH credential store), or set `OPENCODE_GO_API_KEY` in the DSH credential vault / environment beforehand. Resolution order:

1. DSH credential store (the Settings input saves here too)
2. Environment variable `OPENCODE_GO_API_KEY`
3. Legacy config `goQuota.apiKey` (migration only)

> The name matches `llm-pi-ai.providers.opencode-go.apiKeyEnv` in the profile, so **model calls and quota queries
> share one key** — configure it once.
>
> The endpoint is only contacted after you explicitly enable the Go quota card; turn the switch off when you do not need it.

## The OpenCode Go quota contract

OpenCode Go reports usage as **percentages**, split across three windows:

| Window | Field | Meaning |
|---|---|---|
| Rolling 5 hours | `usage.rolling` | Opens on the first request of the window (not a fixed clock) |
| Weekly | `usage.weekly` | Calendar week |
| Monthly | `usage.monthly` | Calendar month |

Each window looks like `{ status, percent, resetsAt }`:

- `percent` is the **used percentage** (authoritative — the plugin performs no conversion);
- `status: 'rate-limited'` means the window is currently throttled — a **normal state** (a badge is shown), not an error;
- any missing or malformed quota window is reported as an **explicit error** (never treated as zero; the message carries the JSON path).

> **No dollar amounts and no “monthly credit pool”**: OpenCode Go is subscription-based and the API exposes no
> `used`/`cap` amounts, so Settings has no monthly-pool field and the UI shows percentages only. This is the main
> difference from `master` (the Command Code GOAT variant).

The authoritative source for quotas is the server response itself (endpoint above).

- <https://opencode.ai/docs/go> (OpenCode Go subscription catalogue + reference unit prices)

## Model pricing (the `opencode-go` route)

If your model route points at OpenCode Go (`provider: opencode-go` in the profile's `llm-pi-ai` config),
the price table has to know that provider — otherwise calls record **tokens only and a cost of 0**
(so "Today's cost" reads ¥0). The price table ships a built-in **`opencode-go` provider**, sourced from
`opencode.ai/docs/go`, with `sourceUrl` / `checkedAt` on every entry.

- The DeepSeek family (including V4 Flash / Pro) uses the officially published unit prices.
- Other models use the official flat rates.
- Model ids follow the Go catalogue (e.g. `glm-5.3`, `kimi-k2.7-code`); case and separator differences
  are absorbed by canonical matching.

> Note: OpenCode Go is **subscription-based** (quota measured in percentages). The unit prices here are the
> official **reference prices**, used to estimate cost by usage volume and to compare against the official
> figures — they are not the actual billing basis.

To add or change entries yourself, use **Settings → Cost → Extended price table**. **Sync official
prices** only overwrites the DeepSeek main table; provider tables must be checked by hand.

> After a price-table update, startup automatically re-costs historical buckets that have tokens but a
> zero amount (billed at off-peak). To re-price history precisely at its real peak/off-peak instants,
> toggling the **pricing currency** once triggers a full replay recompute.

## Relation to upstream

- Upstream: [Han-1413141/dsh-cost-meter](https://github.com/Han-1413141/dsh-cost-meter) (MIT)
- This repo is a modified fork; only the Go-quota card code changed (see the table above) — everything else inherits upstream;
- When the upstream plugin updates, this fork's edits get overwritten — to rebase, re-apply the corresponding changes in this repo's `lib/index.js` / `lib/store.js` / `lib/client.js` onto the new upstream (see [CHANGELOG.md](CHANGELOG.md) for the itemized diff).

## Development & verification

```sh
node --check lib/index.js && node --check lib/pricing.js \
  && node --check lib/store.js && node --check lib/typert.host.js \
  && node --check lib/client.js         # syntax checks
dsh --profile web --dump-config         # composition-tree check
dsh --profile web --port 3099           # real startup (watch logs and the UI)
```

## License

[MIT](LICENSE) © 2026 dsh-cost-meter contributors (OpenCode Go fork © 2026)
