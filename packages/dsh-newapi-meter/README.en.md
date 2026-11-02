# dsh-newapi-meter (new-api branch)

<div align="center">

**DeepSeek Harness session cost tracking plugin · new-api edition (bilingual UI)**

A new-api–customized fork of [dsh-cost-meter](https://github.com/Han-1413141/dsh-cost-meter). All upstream features (per-conversation cost · official balance · budget box · custom provider balance · history · peak/off-peak pricing · official price sync · coding-plan quotas · token heat grid, …) are unchanged — only the **quota card's data source was replaced with the total/used quota of a new-api (new/one-api family) gateway**.

[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![upstream](https://img.shields.io/badge/upstream-Han--1413141%2Fdsh--cost--meter-4176E6)](https://github.com/Han-1413141/dsh-cost-meter)

English | [中文](README.md)

</div>

---

## Branches

The quota card targets a different vendor per branch:

| Branch | Quota card data source |
|---|---|
| `cmdc-goat` | Command Code GOAT subscription (`api.commandcode.ai/alpha/billing/credits`) |
| `oc-go` | OpenCode Go subscription (`opencode.ai/zen/go/v1/usage`) |
| **`new-api` (this branch)** | **A new-api / one-api gateway's site quota (`{base}/v1/dashboard/billing/*`)** |

All three branches share one ledger (`$DSH_HOME/storages/cost-meter/ledger.json`); after switching branches, re-check the “quota source provider” (this branch) or the plan tier in Settings.

## Upstream & acknowledgements

This plugin is a customized fork of [dsh-cost-meter](https://github.com/Han-1413141/dsh-cost-meter). The upstream `dsh-cost-meter` is a feature-complete **DeepSeek Harness session cost tracking plugin**: per-conversation cost, official balance query, budget box, custom provider balance, history, peak/off-peak pricing, official price sync, Coding Plan quotas, token heat grid, and more — with a built-in 90+ model price catalog and auto-matching, in a bilingual (zh/en) UI. It is maintained by [Han-1413141](https://github.com/Han-1413141) under the [MIT](LICENSE) license.

**Why this fork**: our model traffic goes through a **new-api (new/one-api family) gateway**, whose total/used quota is only exposed by that site's own endpoints, while the upstream Go-quota card only talks to `opencode.ai/zen/go/v1/usage`. This repo therefore forks the project and repoints the quota card at the new-api billing endpoints. The site address and API key are **not configured here** — they are taken from the provider already configured under DSH **Settings → Models** (`llm-pi-ai.providers.<id>`: its `baseURL` and `apiKeyEnv`). Everything except the quota-card code — features, structure, docs — is inherited from upstream.

**Acknowledgements**: thanks to [Han-1413141](https://github.com/Han-1413141) and all contributors of upstream dsh-cost-meter — the vast majority of this project's code and design comes from upstream; we only layered a targeted customization on top. Upstream repo: [Han-1413141/dsh-cost-meter](https://github.com/Han-1413141/dsh-cost-meter) (MIT).

---

## What changed on this branch

| Change | Details |
|---|---|
| Quota endpoint | Switched to new-api's OpenAI-compatible billing endpoints: `GET {base}/v1/dashboard/billing/subscription` (total) + `GET {base}/v1/dashboard/billing/usage` (used), authenticated with `Bearer sk-…` |
| Fallback path | When the billing endpoints are unavailable, falls back to `GET {base}/api/user/self` (system access token): `quota` (remaining) + `used_quota` (used) + `request_count` (total calls) |
| Quota source | **Taken from DSH Settings → Models**: pick a provider in the Settings dropdown; its `baseURL` is the site address and its `apiKeyEnv` is the credential name (DSH credential store → same-named environment variable). No separate key field |
| Card display | “Used / total + percent + progress bar + remaining”; the unit follows the site's display type (USD / CNY / TOKENS); total call count is appended when `/api/user/self` is readable |
| Windows | new-api has a single site quota pool, so only that window renders (rolling 5h / weekly are always empty and no longer show as two “—” rows; the primary window is fixed to `monthly`) |
| Safety | **Both http and https are supported** (self-hosted gateways often have no TLS); plaintext HTTP on a public host warns once and then proceeds — it is no longer refused; redirects are not followed; the key only goes to the selected provider's own host; `cap ≤ 0` and similar are reported as bad responses instead of a fake 0% |

## Installation

> Requirements: Node.js ≥ 20 + DeepSeek Harness (a version with the `dsh plugin` command).

```sh
# Option 1: local directory (after cloning or extracting)
dsh plugin --profile web add link:./dsh-subscribe-meter

# Option 2: git URL (once published; use #new-api for this branch)
dsh plugin --profile web add github:ycm50/dsh-subscribe-meter#new-api

# Option 3: dshmarket (if submitted to the marketplace)
dsh plugin --profile web add dsh-newapi-meter
```

After installing, **restart** `dsh web` (plugin rows, the Typert manifest and the client bundle are all scanned at startup):

```sh
dsh web
```

> Note: `lib/` **is** the shipped artifact — there is no compile step (`package.json` no longer defines `build`; `files` only includes `lib`, `cordis.patch.yml`, `docs/provider-pricing.json`). For development, `npm test` (= `scripts/verify-typert.mjs`, not shipped) runs the real `validateTypertManifest()` from every `@deepseek-ai/dsh-typert-loader` generation it can locate, and checks the codec keys in `lib/client.js` plus the `exports` packaging contract. The plugin does not need these files at runtime.

> Compatibility: every strict codec in `lib/typert.host.js` / `lib/client.js` must carry **both** `schema: <zod v4>` and `create: () => <zod>` — the 0.1.5-rc.x host generation only reads `schema`, 0.1.7+ only reads `create`. Dropping either key makes that generation reject the whole typert contribution (all Remote methods gone; settings page and cost panel silently break). After editing `lib/`, run `npm test` and refresh the installed copy in the profile as described above.

## Configuring the quota source (Settings → Models + Settings → Cost)

1. Under **Settings → Models**, a provider pointing at your new-api site already exists (e.g. `umapi`): fill in its `baseURL` (e.g. `https://your-site` or `https://your-site/v1`) and its key (stored in the DSH credential store under the provider's `apiKeyEnv`, e.g. `UMAPI_API_KEY`).
2. Under **Settings → Cost → Quota (new-api card)**, turn the switch on and pick that provider in the **provider dropdown** — the site address and key are then used automatically; the row below reports “Key ready (source: …)” or “Key not configured”.
3. Optionally adjust the display position and refresh interval; the card's “Refresh quota” button queries immediately.

Quota semantics (checked against the [QuantumNous/new-api](https://github.com/QuantumNous/new-api), [songquanpeng/one-api](https://github.com/songquanpeng/one-api) and [Wei-Shaw/sub2api](https://github.com/Wei-Shaw/sub2api) sources, 2026-10):

**Site type is auto-detected**: detected on the first query, persisted as `goQuota.apiKind` + `apiKindProvider`, cleared whenever the provider changes, and reused afterwards (a 404 on the stored path triggers one re-detection that overwrites it).

| Kind | Detection |
|---|---|
| `oneapi` | `/v1/dashboard/billing/subscription` returns `hard_limit_usd` (one-api and new-api share this API; new-api is its continuation) |
| `sub2api` | that path 404s while `/v1/usage` returns one of `mode` / `planName` / `quota` / `remaining` |

one-api / new-api:

| Endpoint | Auth | Field | Meaning |
|---|---|---|---|
| `/v1/dashboard/billing/subscription` | `Bearer sk-…` | `hard_limit_usd` | **Total quota = remaining + used** (source: `quota = remainQuota + usedQuota`) |
| `/v1/dashboard/billing/usage` | `Bearer sk-…` | `total_usage` | **Used × 100** (OpenAI cents; source: `amount * 100`) |
| `/api/user/self` | `Bearer <dashboard access token>` | `quota` / `used_quota` / `request_count` | Fallback: remaining + used + total calls |
| `/api/status` | public | `quota_display_type` (older one-api: `display_in_currency`) | Display unit (USD / CNY / tokens), used only as a label |

sub2api (`/v1/usage`, three shapes → the card's three windows):

| Shape | Mapping |
|---|---|
| `mode=quota_limited` | `quota.limit/used` → monthly; `rate_limits` `5h` → rolling, `7d` (or `1d`) → weekly |
| Subscription plan | `subscription.daily/weekly/monthly_usage_usd` ÷ the matching `_limit_usd` → rolling / weekly / monthly; the plan name is shown on the “Updated …” line |
| Wallet balance | balance only: `usage.total.cost` reconstructs “used ÷ (balance + used)” so the progress bar still works |

Both billing endpoints share one unit, so the used/total ratio and percentage are unit-independent; when the unit cannot be read, USD is assumed.

> Note: if the site enables per-token quota statistics (`DisplayTokenStatEnabled`), the two billing endpoints report **that API key's (token's)** quota and usage rather than the account totals — which is new-api's own behaviour.

> ⚠️ Key resolution order: the provider's `apiKeyEnv` (DSH credential store) → same-named environment variable. This plugin no longer stores a separate quota key, and does not read the legacy config field.

## Model pricing

This branch's price tables match upstream (including the built-in **`commandcode` provider table**, 49 models, each with `sourceUrl` / `checkedAt`). If your model route points at a **new-api gateway**, it usually keeps upstream model ids (such as `deepseek-v4.1-flash` or `deepseek/deepseek-v4.1-flash`) that the main table and canonical matching already cover; if the gateway renames models and “Today's cost” reads 0, add a price entry for that provider under **Settings → Cost → Extended price table** (same workflow as upstream).

- The DeepSeek family uses the official **peak / off-peak** tiers: off-peak $0.15 / $0.60 / $0.003, peak $0.30 / $1.20 (peak windows 01–04 and 06–10 UTC, Mon–Fri — the same windows DeepSeek itself uses).
- Other models use the official flat rates; official `-50% / -98% / -99%` promo prices are recorded at the discounted value with the list price noted.
- **Sync official prices** only overwrites the DeepSeek main table; provider tables must be checked by hand.

> After a price-table update, startup automatically re-costs historical buckets that have tokens but a zero amount (billed at off-peak). To re-price history precisely at its real peak/off-peak instants, toggling the **pricing currency** once triggers a full replay recompute.

## Relation to upstream

- Upstream: [Han-1413141/dsh-cost-meter](https://github.com/Han-1413141/dsh-cost-meter) (MIT)
- This repo is a modified fork; only the quota-card code changed (see the table above) — everything else inherits upstream;
- When the upstream plugin updates, this fork's edits get overwritten — to rebase, re-apply the corresponding changes in this repo's `lib/index.js` / `lib/newapi.js` / `lib/store.js` / `lib/typert.host.js` / `lib/client.js` onto the new upstream (see [CHANGELOG.md](CHANGELOG.md) for the itemized diff).

## Development & verification

```sh
node --check lib/index.js && node --check lib/pricing.js \
  && node --check lib/store.js && node --check lib/typert.host.js \
  && node --check lib/client.js && node --check lib/newapi.js   # syntax checks
npm test                                                       # typert manifest / contract check
dsh --profile web --dump-config         # composition-tree check
dsh --profile web --port 3099           # real startup (watch logs and the UI)
```

## License

[MIT](LICENSE) © 2026 dsh-cost-meter contributors (new-api fork © 2026)
