/**
 * 历史 CSV 入账:把「导出 CSV」或别处算出的按天汇总表合并进账本。
 *
 * 设计取舍:
 *  - **幂等优先**:账本里已有用量(calls > 0)的日期默认跳过,同一份 CSV 导多少次
 *    结果都一样,不会把金额翻倍;冲突日期会随结果一并回报。
 *  - **金额按 CSV 原值入账**:CSV 往往是别的机器/别的价目算出来的,本机价目表未必
 *    能复现同一数字;tokens 只做展示与统计,不参与计价。
 *  - **补齐 byProviderModel**:导入数据没有 provider:model 明细,写入单条
 *    `csv-import:imported` 桶,保证按模型/按渠道的统计逻辑不会因为缺桶而报错或归零。
 *
 * 表头接受本项目导出的英文列名,也接受常见别名(见 COLUMN_ALIASES),大小写与
 * 前后空格不敏感;带 BOM、CRLF、空行、引号包裹的字段都能处理。
 */

import { zeroDay, localDayKey } from './store.js'

/** 导出表头 → 内部字段名。别名一并接受,便于外部工具生成的表直接导入。 */
const COLUMN_ALIASES = {
  date: 'date', day: 'date', 日期: 'date',
  input_tokens: 'input', input: 'input', inputtokens: 'input', 输入: 'input', 输入tokens: 'input',
  output_tokens: 'output', output: 'output', outputtokens: 'output', 输出: 'output', 输出tokens: 'output',
  cache_read_tokens: 'cacheRead', cache_read: 'cacheRead', cache_read_input_tokens: 'cacheRead', cacheRead: 'cacheRead', cacheReadTokens: 'cacheRead', 缓存读: 'cacheRead',
  cache_write_tokens: 'cacheWrite', cache_write: 'cacheWrite', cache_creation_input_tokens: 'cacheWrite', cacheWrite: 'cacheWrite', cacheWriteTokens: 'cacheWrite', 缓存写: 'cacheWrite',
  reasoning_tokens: 'reasoning', reasoning: 'reasoning', reasoningtokens: 'reasoning', 推理: 'reasoning',
  calls: 'calls', 调用: 'calls', 调用数: 'calls',
  cost_usd: 'cost', cost: 'cost', usd: 'cost', 费用: 'cost', 金额: 'cost',
  api_cost_usd: 'apiCost', api_cost: 'apiCost', apicost: 'apiCost', 实际费用: 'apiCost',
}

/** 导入数据的合成会话 id 前缀(会话排行里可一眼认出是外部导入的)。 */
const IMPORT_SESSION_PREFIX = 'csv-import:'
/** 导入数据在 byProviderModel 里的合成键(不参与 Plan 分类,不污染真实渠道统计)。 */
const IMPORT_PROVIDER_KEY = 'csv-import:imported'

/**
 * 解析一行 CSV(支持引号包裹、引号内的逗号与双写引号转义)。
 * @param line - 原始行文本(不含换行)。
 * @returns 字段数组。
 */
export function splitCsvLine(line) {
  const fields = []
  let current = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"'
          i += 1
        } else {
          quoted = false
        }
      } else {
        current += ch
      }
      continue
    }
    if (ch === '"') {
      quoted = true
      continue
    }
    if (ch === ',') {
      fields.push(current)
      current = ''
      continue
    }
    current += ch
  }
  fields.push(current)
  return fields
}

/** 数值清洗:非有限/负数一律 0(与账本 sanitizeNum 同口径)。 */
function numOf(value) {
  const n = Number(String(value ?? '').replace(/[^0-9.eE+-]/g, ''))
  return Number.isFinite(n) && n > 0 ? n : 0
}

/**
 * 解析历史 CSV 文本。
 * @param text - 文件内容(可带 BOM)。
 * @returns {{ rows: object[], errors: string[] }} rows 按日期升序去重;errors 为逐行报错。
 */
export function parseHistoryCsv(text) {
  const errors = []
  const raw = typeof text === 'string' ? text : ''
  const lines = raw.replace(/\uFEFF/g, '').split(/\r\n|\n|\r/)
  const byDate = new Map()
  let header = null
  let headerIndex = -1
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line.length === 0) continue
    const fields = splitCsvLine(line)
    if (header === null) {
      const mapped = fields.map(field => COLUMN_ALIASES[field.trim().toLowerCase()] ?? COLUMN_ALIASES[field.trim()] ?? null)
      if (mapped.includes('date') && (mapped.includes('cost') || mapped.includes('input'))) {
        header = mapped
        headerIndex = i
        continue
      }
      // 第一个非空行不是表头:按"无表头、按默认列序"兜底提示,而不是静默跳过。
      if (i === 0) {
        errors.push('未找到表头(需要至少包含 date 与 cost_usd 两列)')
        return { rows: [], errors }
      }
      continue
    }
    const cells = {}
    for (let c = 0; c < header.length; c++) {
      if (header[c] === null) continue
      cells[header[c]] = fields[c] ?? ''
    }
    const dateRaw = String(cells.date ?? '').trim()
    // 日期键容忍 'YYYY-M-D' / 'YYYY/MM/DD' / 带时间的 ISO 串,统一成 YYYY-MM-DD。
    const normalized = normalizeDateKey(dateRaw)
    if (normalized === null) {
      errors.push(`第 ${i + 1} 行日期无法识别:「${dateRaw}」`)
      continue
    }
    const row = {
      date: normalized,
      input: numOf(cells.input),
      output: numOf(cells.output),
      cacheRead: numOf(cells.cacheRead),
      cacheWrite: numOf(cells.cacheWrite),
      reasoning: numOf(cells.reasoning),
      calls: numOf(cells.calls),
      cost: numOf(cells.cost),
      apiCost: cells.apiCost === undefined ? null : numOf(cells.apiCost),
    }
    // 同一天出现多行时累加(常见于按会话导出的表被拼在一起)。
    const prev = byDate.get(normalized)
    if (prev === undefined) byDate.set(normalized, row)
    else {
      byDate.set(normalized, {
        date: normalized,
        input: prev.input + row.input,
        output: prev.output + row.output,
        cacheRead: prev.cacheRead + row.cacheRead,
        cacheWrite: prev.cacheWrite + row.cacheWrite,
        reasoning: prev.reasoning + row.reasoning,
        calls: prev.calls + row.calls,
        cost: prev.cost + row.cost,
        apiCost: prev.apiCost === null && row.apiCost === null ? null : (prev.apiCost ?? 0) + (row.apiCost ?? 0),
      })
    }
  }
  if (header === null && errors.length === 0) errors.push('文件里没有可解析的数据行')
  const rows = [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  // 无用量的整行(全 0)直接丢弃:导入它们没有意义,还会把一天"占"成已有。
  const kept = rows.filter(row => row.calls > 0 || row.input > 0 || row.output > 0 || row.cost > 0)
  if (kept.length === 0 && errors.length === 0) errors.push('CSV 里没有带用量的日期(调次数与 tokens 与金额全为 0)')
  void headerIndex
  return { rows: kept, errors }
}

/**
 * 日期串归一化成 YYYY-MM-DD;无法识别返回 null。
 * @param raw - 原始日期字段。
 */
export function normalizeDateKey(raw) {
  const value = String(raw ?? '').trim()
  if (value.length === 0) return null
  const iso = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(value)
  if (iso !== null) {
    const month = Number(iso[2])
    const day = Number(iso[3])
    if (month < 1 || month > 12 || day < 1 || day > 31) return null
    return `${iso[1]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return null
  return localDayKey(parsed)
}

/**
 * 把 CSV 行合并进账本(幂等:已有用量的日期默认跳过)。
 *
 * @param ledger - 已打开的账本(需有 days 与 scheduleWrite)。
 * @param rows - parseHistoryCsv 的 rows。
 * @param options.mode - 'skip'(默认,跳过已有天)| 'add'(累加进已有天)| 'replace'(覆盖已有天)。
 * @returns {{ added: string[], merged: string[], skipped: string[] }} 新增/累加或覆盖/跳过 的日期。
 */
export function mergeHistoryRows(ledger, rows, options = {}) {
  const mode = options.mode === 'add' || options.mode === 'replace' ? options.mode : 'skip'
  const result = { added: [], merged: [], skipped: [] }
  for (const row of rows) {
    const existing = ledger.days[row.date]
    const hasUsage = existing !== undefined && existing !== null
      && ((existing.calls ?? 0) > 0 || (existing.input ?? 0) > 0 || (existing.cost ?? 0) > 0)
    if (hasUsage && mode === 'skip') {
      result.skipped.push(row.date)
      continue
    }
    const target = hasUsage ? existing : zeroDay(row.date)
    // apiCost 缺省时按 cost 计(与「旧快照全额按 API」同口径),但不允许超过 cost。
    const apiCostOf = cost => (row.apiCost === null ? cost : Math.min(row.apiCost, cost))
    const apiCost = apiCostOf(row.cost)
    if (!hasUsage) {
      target.input = row.input
      target.output = row.output
      target.cacheRead = row.cacheRead
      target.cacheWrite = row.cacheWrite
      target.reasoning = row.reasoning
      target.calls = row.calls
      target.cost = row.cost
      target.apiCost = apiCost
      target.byProviderModel = {
        [IMPORT_PROVIDER_KEY]: {
          input: row.input,
          output: row.output,
          cacheRead: row.cacheRead,
          cacheWrite: row.cacheWrite,
          reasoning: row.reasoning,
          calls: row.calls,
          cost: row.cost,
          apiCost,
        },
      }
      target.sessions = [{
        id: `${IMPORT_SESSION_PREFIX}${row.date}`,
        title: 'CSV',
        input: row.input,
        output: row.output,
        cacheRead: row.cacheRead,
        cacheWrite: row.cacheWrite,
        reasoning: row.reasoning,
        calls: row.calls,
        cost: row.cost,
        apiCost,
        byProviderModel: {},
      }]
      ledger.days[row.date] = target
      result.added.push(row.date)
      continue
    }
    // 已有天:累加(把 CSV 的量并入,并保留账本自己的会话明细)。
    if (mode === 'replace') {
      target.input = row.input
      target.output = row.output
      target.cacheRead = row.cacheRead
      target.cacheWrite = row.cacheWrite
      target.reasoning = row.reasoning
      target.calls = row.calls
      target.cost = row.cost
      target.apiCost = apiCost
    } else {
      target.input = (target.input ?? 0) + row.input
      target.output = (target.output ?? 0) + row.output
      target.cacheRead = (target.cacheRead ?? 0) + row.cacheRead
      target.cacheWrite = (target.cacheWrite ?? 0) + row.cacheWrite
      target.reasoning = (target.reasoning ?? 0) + row.reasoning
      target.calls = (target.calls ?? 0) + row.calls
      target.cost = (target.cost ?? 0) + row.cost
      target.apiCost = (target.apiCost ?? 0) + apiCost
    }
    target.byProviderModel = target.byProviderModel !== null && typeof target.byProviderModel === 'object' ? target.byProviderModel : {}
    const bucket = target.byProviderModel[IMPORT_PROVIDER_KEY] ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 0, cost: 0, apiCost: 0 }
    target.byProviderModel[IMPORT_PROVIDER_KEY] = mode === 'replace'
      ? { input: row.input, output: row.output, cacheRead: row.cacheRead, cacheWrite: row.cacheWrite, reasoning: row.reasoning, calls: row.calls, cost: row.cost, apiCost }
      : {
          input: bucket.input + row.input,
          output: bucket.output + row.output,
          cacheRead: bucket.cacheRead + row.cacheRead,
          cacheWrite: bucket.cacheWrite + row.cacheWrite,
          reasoning: bucket.reasoning + row.reasoning,
          calls: bucket.calls + row.calls,
          cost: bucket.cost + row.cost,
          apiCost: (bucket.apiCost ?? 0) + apiCost,
        }
    result.merged.push(row.date)
  }
  // 日期键按升序重建,历史记录视图才整齐(与 importLegacyHistory 同策略)。
  if (result.added.length > 0 || result.merged.length > 0) {
    const ordered = {}
    for (const key of Object.keys(ledger.days).sort()) ordered[key] = ledger.days[key]
    ledger.days = ordered
    if (typeof ledger.prune === 'function') ledger.prune()
    if (typeof ledger.scheduleWrite === 'function') ledger.scheduleWrite()
  }
  return result
}
