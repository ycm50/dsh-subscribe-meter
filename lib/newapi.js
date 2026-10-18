/**
 * 网关额度 adapter:一个模块同时支持两类站点,并负责**类型探测**。
 *
 * 两类站点的额度接口完全不同(已读源码核对,2026-10):
 *
 *  A. one-api / new-api(同源,new-api 是 one-api 的延续)
 *     - GET {base}/v1/dashboard/billing/subscription  → { hard_limit_usd }  总额 = 剩余 + 已用
 *     - GET {base}/v1/dashboard/billing/usage         → { total_usage }     已用 × 100(美分制)
 *     - GET {base}/api/user/self                      → { quota, used_quota, request_count }(访问令牌)
 *     - GET {base}/api/status                         → quota_display_type / display_in_currency(单位)
 *     - 业务错误也返回 200 + body.error,故必须看字段而不是只看状态码。
 *
 *  B. sub2api(Wei-Shaw/sub2api,Claude/OpenAI/Gemini 订阅拼车网关)
 *     - 没有 /v1/dashboard/billing/*(返回 404 {"code":"PATH_NOT_SUPPORTED"})
 *     - GET {base}/v1/usage,三种形态:
 *         ① mode=quota_limited : { quota:{limit,used,remaining,unit}, remaining, rate_limits:[{window:"5h"|"1d"|"7d",limit,used,reset_at?}] }
 *         ② mode=unrestricted + 订阅套餐 : { planName, remaining, subscription:{daily_usage_usd,daily_limit_usd,weekly_usage_usd,weekly_limit_usd,monthly_usage_usd,monthly_limit_usd} }
 *         ③ mode=unrestricted + 钱包 : { planName:"钱包余额", balance, remaining, unit:"USD" }
 *       三种形态都可能带 usage.today.{requests,cost,total_tokens} 与 model_stats。
 *
 * 探测策略(只在「还不知道类型」或「已存类型失效」时执行,结果由宿主持久化):
 *   先试 A 的 subscription(200 且有 hard_limit_usd / 无 error 字段)→ oneapi;
 *   再试 B 的 /v1/usage(200 且是对象,含 mode/planName/quota/remaining 之一)→ sub2api;
 *   都不成立则报错并带上两边的状态码,便于判断是站点改版还是 Key 无权限。
 *
 * 安全:公网明文 HTTP 拒绝(环回/内网放行);不跟随重定向;Key 只发往所选 provider 自己的主机。
 */
import { fetchWithRetry } from './net.js'

/** 支持的站点类型(会持久化到 config.goQuota.apiKind)。 */
export const GATEWAY_KINDS = ['oneapi', 'sub2api']

/** OpenAI 兼容计费端点(相对站点根路径)。 */
export const NEWAPI_SUBSCRIPTION_PATH = '/v1/dashboard/billing/subscription'
/** OpenAI 兼容用量端点(相对站点根路径)。 */
export const NEWAPI_USAGE_PATH = '/v1/dashboard/billing/usage'
/** 管理端用户信息端点(需系统访问令牌)。 */
export const NEWAPI_SELF_PATH = '/api/user/self'
/** 公开站点信息端点(读展示单位)。 */
export const NEWAPI_STATUS_PATH = '/api/status'
/** sub2api 的额度/用量端点。 */
export const SUB2API_USAGE_PATH = '/v1/usage'

/** new-api 的额度展示类型 → 面板用的单位标签。 */
const DISPLAY_UNITS = { USD: 'USD', CNY: 'CNY', TOKENS: 'tokens' }

/** 404/405 视为「该路径不存在」,用于触发类型重探测。 */
export class UnsupportedPathError extends Error {
  constructor(message) {
    super(message)
    this.name = 'UnsupportedPathError'
    this.unsupportedPath = true
  }
}

/** @param {unknown} value */
function asRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null
}

/**
 * 兼容两种信封:计费端点是裸对象,管理端是 { success, data }。
 * 有 data 对象时取 data,否则取原对象。
 * @param {unknown} data
 */
function unwrap(data) {
  const record = asRecord(data)
  if (record === null) return null
  const inner = asRecord(record.data)
  return inner ?? record
}

/**
 * 严格取数:只接受有限数字或纯数值字符串。Number(null)/Number('')/Number(false)
 * 都是 0,若直接强转会把「字段缺失」伪造成 0(而 0 是合法读数)。
 * @param {unknown} value
 */
function toStrictNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN
  if (typeof value === 'string') {
    const text = value.trim()
    if (text.length > 0 && /^[+-]?(\d+(\.\d+)?|\.\d+)([eE][+-]?\d+)?$/.test(text)) return Number(text)
    return NaN
  }
  return NaN
}

/**
 * 规范化站点地址:去掉尾部斜杠与 OpenAI 兼容的 /v1 后缀。
 * 保留路径前缀(站点可能挂在子路径下,如 https://host/newapi)。
 * @param {unknown} raw
 * @returns {string | null} 规范化后的 base,非法时 null。
 */
export function normalizeNewApiBaseUrl(raw) {
  const text = String(raw ?? '').trim()
  if (text.length === 0) return null
  let url
  try {
    url = new URL(text)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  let path = url.pathname.replace(/\/+$/, '')
  path = path.replace(/\/v\d+$/i, '')
  return `${url.protocol}//${url.host}${path}`
}

/**
 * 明文 HTTP 只允许环回/内网(自建站点常见于局域网),公网域名必须 https,
 * 否则 Key 会在链路上明文暴露。
 * @param {string} base - normalizeNewApiBaseUrl 的产物。
 */
export function isInsecurePublicBase(base) {
  let host = ''
  let protocol = ''
  try {
    const url = new URL(base)
    host = url.hostname.toLowerCase()
    protocol = url.protocol
  } catch {
    return true
  }
  if (protocol === 'https:') return false
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]') return false
  if (/^10\./.test(host) || /^192\.168\./.test(host)) return false
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false
  return true
}

/**
 * 解析 /v1/dashboard/billing/subscription:总额度(剩余 + 已用)。
 * @param {unknown} data
 * @returns {{ cap: number } | null}
 */
export function parseNewApiSubscription(data) {
  const body = unwrap(data)
  if (body === null) return null
  // 业务错误也走 200:带 error 字段时视为失败(one-api/new-api 同款行为)。
  if (asRecord(body.error) !== null) return null
  const cap = toStrictNumber(body.hard_limit_usd)
  if (!Number.isFinite(cap)) {
    const soft = toStrictNumber(body.soft_limit_usd)
    if (!Number.isFinite(soft)) return null
    return { cap: soft }
  }
  return { cap }
}

/**
 * 解析 /v1/dashboard/billing/usage:total_usage 是「已用 × 100」(OpenAI 美分制),
 * 故除以 100 还原成与 subscription 同单位的已用量。
 * @param {unknown} data
 * @returns {{ used: number } | null}
 */
export function parseNewApiUsage(data) {
  const body = unwrap(data)
  if (body === null) return null
  if (asRecord(body.error) !== null) return null
  const cents = toStrictNumber(body.total_usage)
  if (!Number.isFinite(cents) || cents < 0) return null
  return { used: cents / 100 }
}

/**
 * 解析 /api/user/self:quota = 剩余,used_quota = 已用,request_count = 调用次数。
 * @param {unknown} data
 * @returns {{ remaining: number, used: number, requests: number | null } | null}
 */
export function parseNewApiSelf(data) {
  const body = unwrap(data)
  if (body === null) return null
  const remaining = toStrictNumber(body.quota)
  const used = toStrictNumber(body.used_quota)
  if (!Number.isFinite(remaining) || remaining < 0) return null
  if (!Number.isFinite(used) || used < 0) return null
  const requests = toStrictNumber(body.request_count)
  return { remaining, used, requests: Number.isFinite(requests) ? requests : null }
}

/**
 * 解析 /api/status,只取展示单位(用于给读数加标签),取不到返回 ''。
 * one-api 老版本没有 quota_display_type,只有 display_in_currency 布尔:
 * true = 金额(USD),false = 令牌数。
 * @param {unknown} data
 * @returns {{ unit: string, quotaPerUnit: number | null }}
 */
export function parseNewApiStatus(data) {
  const body = unwrap(data)
  if (body === null) return { unit: '', quotaPerUnit: null }
  const type = String(body.quota_display_type ?? '').trim().toUpperCase()
  let unit = DISPLAY_UNITS[type] ?? ''
  if (unit.length === 0 && typeof body.display_in_currency === 'boolean') {
    unit = body.display_in_currency ? 'USD' : 'tokens'
  }
  const perUnit = toStrictNumber(body.quota_per_unit)
  return { unit, quotaPerUnit: Number.isFinite(perUnit) ? perUnit : null }
}

/**
 * 把「总额 / 已用」归一化成卡片窗口结构(与 coding-plans 的窗口同形)。
 * cap 必须 > 0:为 0 说明该站点没给出有效额度(如未登录/无权限),按坏响应处理,
 * 不能显示成 0% 的「成功」。
 * @param {{ cap: number, used: number, unit?: string, requests?: number | null,
 *   resetsAt?: string, plan?: string }} input
 */
export function buildNewApiWindow({ cap, used, unit = '', requests = null, resetsAt = '', plan = '' }) {
  if (!Number.isFinite(cap) || cap <= 0) return null
  if (!Number.isFinite(used) || used < 0) return null
  const clampedUsed = Math.min(used, cap)
  return {
    percent: Math.max(0, Math.min(100, (used / cap) * 100)),
    used: clampedUsed,
    cap,
    remaining: Math.max(0, cap - used),
    unit,
    requests,
    resetsAt,
    plan,
  }
}

/**
 * 解析 sub2api 的 GET /v1/usage(三种形态)。
 *
 * ① 额度型:`quota { limit, used, remaining, unit }` → monthly;
 *    另附 `rate_limits[{ window:"5h"|"1d"|"7d", limit, used, reset_at }]` →
 *    5h 记 rolling、7d 记 weekly(没有 7d 时用 1d 顶到 weekly)。
 * ② 订阅型:`subscription.daily/weekly/monthly_usage_usd` 与对应 `_limit_usd` →
 *    rolling / weekly / monthly。
 * ③ 钱包型:只有 `balance`/`remaining`,用 `usage.total.cost` 反推「已用 / (余额 + 已用)」。
 *
 * @param {unknown} data - /v1/usage 的响应体。
 * @returns {{ windows: { rolling?: object, weekly?: object, monthly?: object },
 *   plan: string, requests: number | null } | null}
 */
export function parseSub2apiUsage(data) {
  const body = unwrap(data)
  if (body === null) return null
  // 不是 sub2api 的响应(没有这几个特征键)就交给上层判定为「类型不符」。
  const looksLikeSub2api = 'mode' in body || 'planName' in body || 'quota' in body || 'remaining' in body
  if (!looksLikeSub2api) return null

  const plan = typeof body.planName === 'string' ? body.planName : ''
  const unit = typeof body.unit === 'string' && body.unit.length > 0 ? body.unit : 'USD'
  const usage = asRecord(body.usage)
  const today = usage === null ? null : asRecord(usage.today)
  const requestsRaw = today === null ? NaN : toStrictNumber(today.requests)
  const requestsOf = Number.isFinite(requestsRaw) ? requestsRaw : null
  const windows = {}

  // ① 额度型
  const quota = asRecord(body.quota)
  if (quota !== null) {
    const win = buildNewApiWindow({
      cap: toStrictNumber(quota.limit),
      used: toStrictNumber(quota.used),
      unit: typeof quota.unit === 'string' ? quota.unit : unit,
      requests: requestsOf,
      plan,
    })
    if (win !== null) windows.monthly = win
  }
  for (const raw of Array.isArray(body.rate_limits) ? body.rate_limits : []) {
    const entry = asRecord(raw)
    if (entry === null) continue
    const window = String(entry.window ?? '').trim()
    const resetsAt = typeof entry.reset_at === 'string' ? entry.reset_at : ''
    const win = buildNewApiWindow({
      cap: toStrictNumber(entry.limit),
      used: toStrictNumber(entry.used),
      unit,
      requests: null,
      resetsAt,
      plan,
    })
    if (win === null) continue
    if (window === '5h') windows.rolling ??= win
    else if (window === '7d') windows.weekly ??= win
    else if (window === '1d') windows.weekly ??= win
  }

  // ② 订阅型
  const subscription = asRecord(body.subscription)
  if (subscription !== null) {
    const pairs = [
      ['rolling', 'daily_usage_usd', 'daily_limit_usd'],
      ['weekly', 'weekly_usage_usd', 'weekly_limit_usd'],
      ['monthly', 'monthly_usage_usd', 'monthly_limit_usd'],
    ]
    for (const [slot, usageKey, limitKey] of pairs) {
      const win = buildNewApiWindow({
        cap: toStrictNumber(subscription[limitKey]),
        used: toStrictNumber(subscription[usageKey]),
        unit,
        requests: slot === 'monthly' ? requestsOf : null,
        plan,
      })
      if (win !== null && windows[slot] === undefined) windows[slot] = win
    }
  }

  // ③ 钱包型:只有余额,用累计花费反推「已用 / 总额」,避免只有剩余额时无法画进度条。
  if (windows.monthly === undefined) {
    const remaining = toStrictNumber(body.remaining)
    const spent = usage === null ? NaN : toStrictNumber(asRecord(usage.total)?.cost)
    if (Number.isFinite(remaining) && remaining >= 0 && Number.isFinite(spent) && spent >= 0) {
      const win = buildNewApiWindow({ cap: remaining + spent, used: spent, unit, requests: requestsOf, plan })
      if (win !== null) windows.monthly = win
    }
  }

  if (windows.rolling === undefined && windows.weekly === undefined && windows.monthly === undefined) return null
  return { windows, plan, requests: requestsOf }
}

/** 构造请求头(Key 只发往调用方给的主机)。 */
function headersOf(apiKey) {
  return {
    authorization: `Bearer ${apiKey}`,
    accept: 'application/json',
    'user-agent': 'dsh-newapi-meter/1.7 (DeepSeek Harness plugin)',
  }
}

/**
 * 探测站点类型:one-api/new-api 的计费端点优先,其次 sub2api 的 /v1/usage。
 * 探测时顺带把响应体带回来,避免「探完再查」多打一次请求。
 *
 * @param {{ base: string, apiKey: string }} options
 * @returns {Promise<{ kind: 'oneapi' | 'sub2api' | null, subscription?: object | null,
 *   usage?: object | null, subscriptionStatus: number, usageStatus: number }>}
 */
export async function detectGatewayKind({ base, apiKey }) {
  const headers = headersOf(apiKey)
  let subscriptionStatus = 0
  let usageStatus = 0
  let subscription = null
  let usage = null

  try {
    const response = await fetchWithRetry(`${base}${NEWAPI_SUBSCRIPTION_PATH}`, { headers }, { timeoutMs: 15000, attempts: 2 })
    subscriptionStatus = response.status
    if (response.ok) {
      const data = await response.json().catch(() => null)
      if (data !== null && typeof data === 'object') {
        subscription = data
        if (parseNewApiSubscription(data) !== null) {
          return { kind: 'oneapi', subscription, subscriptionStatus, usageStatus }
        }
      }
    }
  } catch {
    subscriptionStatus = 0
  }

  try {
    const response = await fetchWithRetry(`${base}${SUB2API_USAGE_PATH}`, { headers }, { timeoutMs: 15000, attempts: 2 })
    usageStatus = response.status
    if (response.ok) {
      const data = await response.json().catch(() => null)
      if (data !== null && typeof data === 'object') {
        usage = data
        if (parseSub2apiUsage(data) !== null) return { kind: 'sub2api', subscription, usage, subscriptionStatus, usageStatus }
      }
    }
  } catch {
    usageStatus = 0
  }

  return { kind: null, subscription, usage, subscriptionStatus, usageStatus }
}

/**
 * 查询 one-api / new-api 的额度(计费端点优先,失败回退 /api/user/self)。
 * @param {{ base: string, apiKey: string, t: Function, locale: string,
 *   status: number, subscription: object | null }} options
 * @returns {Promise<{ windows: object, plan: string }>}
 */
async function queryOneApi({ base, apiKey, t, locale, status, subscription }) {
  const headers = headersOf(apiKey)
  // 单位探测放最后:失败也不影响额度结果。
  const readUnit = async () => {
    try {
      const response = await fetchWithRetry(`${base}${NEWAPI_STATUS_PATH}`, { headers: { accept: 'application/json' } }, { timeoutMs: 8000, attempts: 2 })
      if (!response.ok) return ''
      const parsed = parseNewApiStatus(await response.json())
      return parsed.unit
    } catch {
      return ''
    }
  }

  // 探测阶段已拿过 subscription 就复用;「按已存类型直接查」时这里自己补一次,
  // 否则会因为 subscription 为空而误走 /api/user/self 兜底(甚至触发多余的重探测)。
  let sub = subscription
  let subStatus = Number(status) || 0
  let subscriptionResponse = null
  if (sub === null || sub === undefined) {
    subscriptionResponse = await fetchWithRetry(`${base}${NEWAPI_SUBSCRIPTION_PATH}`, { headers }, { timeoutMs: 15000, attempts: 2 }).catch(() => null)
    subStatus = subscriptionResponse?.status ?? 0
    sub = subscriptionResponse?.ok === true ? await subscriptionResponse.json().catch(() => null) : null
  }

  const [unit, usageResponse] = await Promise.all([
    readUnit(),
    fetchWithRetry(`${base}${NEWAPI_USAGE_PATH}`, { headers }, { timeoutMs: 15000, attempts: 2 }).catch(() => null),
  ])

  const capParsed = sub === null || sub === undefined ? null : parseNewApiSubscription(sub)
  if (capParsed !== null && usageResponse?.ok === true) {
    const spend = parseNewApiUsage(await usageResponse.json().catch(() => null))
    if (spend !== null) {
      const monthly = buildNewApiWindow({ cap: capParsed.cap, used: spend.used, unit, requests: null })
      if (monthly !== null) return { windows: { monthly }, plan: '' }
    }
  }

  // 回退:系统访问令牌 + 管理端用户信息(quota 剩余 / used_quota 已用)。
  const response = await fetchWithRetry(`${base}${NEWAPI_SELF_PATH}`, { headers }, { timeoutMs: 15000, attempts: 2 }).catch(() => null)
  if (response?.ok === true) {
    const self = parseNewApiSelf(await response.json().catch(() => null))
    if (self !== null) {
      const monthly = buildNewApiWindow({ cap: self.remaining + self.used, used: self.used, unit, requests: self.requests })
      if (monthly !== null) return { windows: { monthly }, plan: '' }
    }
  }

  if (subStatus === 401 || subStatus === 403) {
    const error = new Error(t(locale, 'newApiUnauthorized', { code: String(subStatus) }))
    error.soft = true
    throw error
  }
  if (subStatus === 404 || subStatus === 405) {
    throw new UnsupportedPathError(t(locale, 'newApiNoUsage', { url: `${base}${NEWAPI_SUBSCRIPTION_PATH}` }))
  }
  throw new Error(t(locale, 'newApiNoUsage', { url: `${base}${NEWAPI_SUBSCRIPTION_PATH}` }))
}

/**
 * 查询 sub2api 的额度/用量(GET /v1/usage)。
 * @param {{ base: string, apiKey: string, t: Function, locale: string }} options
 * @returns {Promise<{ windows: object, plan: string }>}
 */
async function querySub2api({ base, apiKey, t, locale }) {
  const response = await fetchWithRetry(`${base}${SUB2API_USAGE_PATH}`, { headers: headersOf(apiKey) }, { timeoutMs: 15000, attempts: 2 })
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      const error = new Error(t(locale, 'newApiUnauthorized', { code: String(response.status) }))
      error.soft = true
      throw error
    }
    if (response.status === 404 || response.status === 405) {
      throw new UnsupportedPathError(t(locale, 'newApiNoUsage', { url: `${base}${SUB2API_USAGE_PATH}` }))
    }
    throw new Error(t(locale, 'newApiHttp', { code: String(response.status), url: `${base}${SUB2API_USAGE_PATH}` }))
  }
  const parsed = parseSub2apiUsage(await response.json().catch(() => null))
  if (parsed === null) throw new UnsupportedPathError(t(locale, 'newApiNoUsage', { url: `${base}${SUB2API_USAGE_PATH}` }))
  return { windows: parsed.windows, plan: parsed.plan }
}

/**
 * 查询网关额度(自动识别 one-api/new-api 与 sub2api)。
 *
 * `kind` 为宿主持久化的站点类型:
 *  - 有值 → 直接按该类型请求;若该路径已不存在(404)则**重新探测**并返回新类型,
 *    由宿主覆盖持久化结果(站点改版/换 provider 后自愈);
 *  - 无值(首次/换 provider 后清空)→ 探测后查询。
 *
 * @param {{ baseURL: string, apiKey: string, kind?: string | null,
 *   t: (locale: string, code: string, vars?: object) => string, locale: string }} options
 * @returns {Promise<{ kind: 'oneapi' | 'sub2api', windows: object, plan: string }>}
 */
export async function queryGatewayQuota({ baseURL, apiKey, kind = null, t, locale }) {
  const base = normalizeNewApiBaseUrl(baseURL)
  if (base === null) throw new Error(t(locale, 'newApiBadBase', { url: String(baseURL ?? '') }))
  if (isInsecurePublicBase(base)) {
    const error = new Error(t(locale, 'newApiInsecureBase', { url: base }))
    error.soft = true
    throw error
  }

  // 已知类型:按它查,404 时重探测(只重试一次)。
  if (kind === 'oneapi') {
    try {
      const result = await queryOneApi({ base, apiKey, t, locale, status: 0, subscription: null })
      return { kind: 'oneapi', ...result }
    } catch (error) {
      if (error?.unsupportedPath !== true) throw error
    }
  } else if (kind === 'sub2api') {
    try {
      const result = await querySub2api({ base, apiKey, t, locale })
      return { kind: 'sub2api', ...result }
    } catch (error) {
      if (error?.unsupportedPath !== true) throw error
    }
  }

  const detected = await detectGatewayKind({ base, apiKey })
  if (detected.kind === 'oneapi') {
    const result = await queryOneApi({
      base,
      apiKey,
      t,
      locale,
      status: detected.subscriptionStatus,
      subscription: detected.subscription,
    })
    return { kind: 'oneapi', ...result }
  }
  if (detected.kind === 'sub2api') {
    const parsed = parseSub2apiUsage(detected.usage)
    if (parsed !== null) return { kind: 'sub2api', windows: parsed.windows, plan: parsed.plan }
  }

  // 两边都认不出来:把两次探测的状态码一起报出来,便于判断是站点改版还是 Key 无权限。
  const error = new Error(t(locale, 'newApiKindUnknown', {
    billing: String(detected.subscriptionStatus),
    usage: String(detected.usageStatus),
  }))
  if (detected.subscriptionStatus === 401 || detected.usageStatus === 401) error.soft = true
  throw error
}
