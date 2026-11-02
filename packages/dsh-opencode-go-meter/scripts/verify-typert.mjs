/**
 * 校验 dsh-CommandCode-meter **两个面**的 typert codec 形状,以及本包要同时兼容的
 * **两代宿主**契约。
 *
 * 背景:strict codec 的键名在两代 DSH 之间换过一次,且两代都是硬校验(不合格 →
 * 整份 typert 贡献不注册:Host 面 13 个 Remote 方法全丢,Client 面 `remote.$mount()`
 * 失败,设置页 / 费用面板静默失效):
 *
 *   | 世代 | Host 面 loader | Client 面 registry |
 *   | --- | --- | --- |
 *   | 0.1.5-rc.x(全局 `pnpm i -g` 那份) | `codec.schema` 必须是 zod v4 实例(`_zod` + `parse`) | `codec.schema.parse` 必须是函数 |
 *   | 0.1.7+(源码检出 `pnpm start:web`) | `codec.create` 必须是函数(惰性工厂) | `codec.create` 必须是函数 |
 *
 * 因此每个 strict codec 必须**同时**写两个键:
 *   `{ mode: 'strict', typeSymbol, schema: zodSchema, create: () => zodSchema }`
 * 缺 `schema` → 老宿主拒收;缺 `create` → 新宿主拒收。generator 产物只写其中一代的
 * 那个键,手写清单不能照抄单键形状。
 *
 * 用法(仓库根目录直接跑,不需要 tsx):
 *   npm test
 *   node scripts/verify-typert.mjs [--plugin <包目录>] [--anchor <DSH 检出根>]
 *
 * 能定位到的每一代 loader 都会被真实 `validateTypertManifest()` 校验一遍(去重后
 * 逐个报告);一个都定位不到时退化为脚本内置的并集契约校验(仍能拦住单键写法)。
 * `--plugin` 可指向已安装副本,校验 DSH 实际加载的那一份。
 *
 * 退出码 0 = 通过;1 = 契约不合规;2 = 环境不具备(定位不到清单 / 依赖 / 产物)。
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')

/** 极简参数解析:`--flag value`,其余位置参数按锚点处理。 */
function parseArgs(argv) {
  const flags = {}
  const rest = []
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--plugin' || argument === '--anchor') {
      flags[argument.slice(2)] = argv[index + 1]
      index += 1
    } else if (!argument.startsWith('-')) {
      rest.push(argument)
    }
  }
  return { flags, rest }
}

const { flags, rest } = parseArgs(process.argv.slice(2))
const pluginRoot = resolve(flags.plugin ?? repoRoot)
const hostManifestPath = join(pluginRoot, 'lib', 'typert.host.js')
const clientBundlePath = join(pluginRoot, 'lib', 'client.js')

const LOADER_PKG = '@deepseek-ai/dsh-typert-loader'

/** 已安装副本所在 profile 的 node_modules 列表,用于兜底解析清单的运行时依赖。 */
function profileModuleDirs() {
  const dirs = []
  try {
    const root = join(homedir(), '.dsh', 'profiles')
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (entry.isDirectory()) dirs.push(join(root, entry.name, 'node_modules'))
    }
  } catch {
    // 没有 ~/.dsh/profiles:依赖必须装在本地
  }
  return dirs
}

/**
 * 兄弟目录里的 DSH 源码检出:本 fork 常与 harness 检出并排放
 * (如 `A:\Downloads\dsh-CommandCode-meter` 与 `A:\Downloads\deepseek-harness`),
 * 自动纳入校验,免得默认 `npm test` 只覆盖到全局那份旧宿主。
 */
function siblingCheckouts() {
  const roots = new Set([dirname(repoRoot), dirname(resolve(process.cwd()))])
  const candidates = []
  for (const root of roots) {
    let entries
    try {
      entries = readdirSync(root, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      candidates.push(join(root, entry.name))
    }
  }
  return candidates
}

/** 候选锚点:显式参数/环境变量 + cwd 及其祖先(JS 解析 node_modules 的正常语义)。 */
function anchors() {
  const explicit = [
    ...(flags.anchor ? [flags.anchor] : []),
    ...rest,
    ...(process.env.DSH_TYPERT_ANCHOR ? [process.env.DSH_TYPERT_ANCHOR] : []),
  ]
  const walked = []
  let current = resolve(process.cwd())
  for (;;) {
    walked.push(current)
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return [...explicit, ...walked, pluginRoot, repoRoot, ...siblingCheckouts(), ...profileModuleDirs()]
}

/**
 * 收集所有可定位的 loader 入口(去重)。全局安装与源码检出各有一代,两代契约不同,
 * 必须都过;源码检出优先用构建产物,没有才退到 `.ts`(Node 24 可直接类型剥离)。
 */
function loaderEntries() {
  const found = new Map()
  const add = (candidate) => {
    if (candidate === undefined) return
    const absolute = resolve(candidate)
    if (existsSync(absolute)) found.set(absolute, absolute)
  }
  for (const anchor of anchors()) {
    try {
      add(createRequire(join(anchor, 'package.json')).resolve(LOADER_PKG))
    } catch {
      // 该锚点解析不到包名,继续看检出布局
    }
    const loaderRoot = join(anchor, 'packages', 'typert', 'loader')
    const built = join(loaderRoot, 'lib', 'index.js')
    add(existsSync(built) ? built : join(loaderRoot, 'src', 'index.ts'))
  }
  return [...found.values()]
}

/** 读 loader 自己的 package.json 版本号,用于报告是"哪一代"。 */
function loaderVersion(entry) {
  let dir = dirname(entry)
  for (;;) {
    const manifest = join(dir, 'package.json')
    if (existsSync(manifest)) {
      try {
        const pkg = JSON.parse(readFileSync(manifest, 'utf8'))
        if (pkg.name === LOADER_PKG) return pkg.version ?? '未知版本'
      } catch {
        // 不是目标包或解析失败,继续上溯
      }
    }
    const parent = dirname(dir)
    if (parent === dir) return '未知版本'
    dir = parent
  }
}

/**
 * 清单模块顶层 import 的运行时依赖(当前只有 zod)解析。
 * 若清单目录没装依赖(未 pnpm install 的检出),回落到 profile 里的已安装副本
 * (DSH 实际运行的那一份)。createRequire 只给 CJS 入口,故再按 package.json
 * 的 exports 取 ESM 入口("import" / "module" / "default")。
 */
function resolveDependency(specifier) {
  const anchors = [pluginRoot, repoRoot, process.cwd(), ...profileModuleDirs()]
  for (const anchor of anchors) {
    let cjs
    try {
      cjs = createRequire(join(anchor, 'package.json')).resolve(specifier)
    } catch {
      continue
    }
    let dir = dirname(cjs)
    for (;;) {
      const manifest = join(dir, 'package.json')
      if (existsSync(manifest)) {
        const pkg = JSON.parse(readFileSync(manifest, 'utf8'))
        const root = resolve(dir, pkg.exports?.['.']?.import
          ?? pkg.exports?.['.']?.module
          ?? pkg.exports?.['.']?.default
          ?? pkg.module
          ?? pkg.main
          ?? 'index.js')
        return existsSync(root) ? pathToFileURL(root).href : pathToFileURL(cjs).href
      }
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
    return pathToFileURL(cjs).href
  }
  return undefined
}

/** 单个 codec 的**并集**契约:src-json 放行,strict 必须 schema(zod v4)+ create 都在。 */
function checkCodec(codec, subject, problems) {
  if (codec === null || typeof codec !== 'object') {
    problems.push(`${subject}: codec 缺失或不是对象`)
    return
  }
  if (codec.mode === 'src-json') return
  if (typeof codec.typeSymbol !== 'string' || codec.typeSymbol.length === 0) {
    problems.push(`${subject}: typeSymbol 缺失(必须是非空字符串)`)
  }
  if (typeof codec.create !== 'function') {
    problems.push(`${subject}: 缺少 create() 惰性工厂(0.1.7+ 宿主强制;老宿主不需要这个键)`)
  }
  const schema = codec.schema
  if (typeof schema !== 'object' || schema === null || !('_zod' in schema) || typeof schema.parse !== 'function') {
    problems.push(`${subject}: 缺少 zod v4 schema(codec.schema,0.1.5-rc.x 宿主强制;新宿主不需要这个键)`)
  }
}

/** 不依赖宿主 loader 的结构校验,用于一个 loader 都定位不到时的兜底。 */
function checkManifestShape(manifest, problems) {
  if (!Array.isArray(manifest?.invocations)) {
    problems.push('manifest.invocations 不是数组')
    return 0
  }
  for (const invocation of manifest.invocations) {
    const id = typeof invocation?.id === 'string' ? invocation.id : '<无 id>'
    checkCodec(invocation?.result, `${id} result`, problems)
    for (const parameter of invocation?.parameters ?? []) {
      checkCodec(parameter?.codec, `${id} parameter ${parameter?.name ?? '?'}`, problems)
    }
    if (invocation?.uplink !== undefined) checkCodec(invocation.uplink?.codec, `${id} uplink`, problems)
    if (invocation?.invocation?.kind === 'context') {
      checkCodec(invocation.invocation.codec, `${id} Context`, problems)
    }
  }
  for (const schema of manifest?.schemas ?? []) {
    if (typeof schema?.create !== 'function' || typeof schema?.schema?.parse !== 'function') {
      problems.push(`schema "${schema?.name ?? '?'}": 需要同时带 create() 与 zod v4 schema`)
    }
  }
  return manifest.invocations.length
}

/** Client 面包子(esbuild 产物,无法 import:需要 window)按文本做并集契约校验。 */
function checkClientFace(text, problems) {
  const strict = text.match(/mode:\s*"strict"/g)?.length ?? 0
  const typeSymbols = text.match(/typeSymbol:\s*"/g)?.length ?? 0
  const create = text.match(/create:\s*\(\)\s*=>/g)?.length ?? 0
  const schema = text.match(/(?<![A-Za-z_$])schema:\s*[A-Za-z_$][\w$]*/g)?.length ?? 0
  if (strict === 0) {
    problems.push('lib/client.js: 未找到任何 strict codec 描述符(产物是否被改写/裁剪?)')
  }
  if (typeSymbols !== strict) {
    problems.push(`lib/client.js: typeSymbol 数(${typeSymbols})与 strict codec 数(${strict})不一致`)
  }
  if (schema !== strict) {
    problems.push(`lib/client.js: strict codec ${strict} 个,带 codec.schema 的只有 ${schema} 个——0.1.5-rc.x 的客户端 registry 只认 schema.parse,缺了那代宿主会拒收`)
  }
  if (create !== strict) {
    problems.push(`lib/client.js: strict codec ${strict} 个,带 create() 的只有 ${create} 个——0.1.7+ 的客户端 registry 强制 create,缺了会在 remote.$mount() 时整份被拒`)
  }
  return strict
}

/** 打包契约:宿主按 exports["./typert"] / exports["./client"] 解析两个面。 */
function checkPackageExports(problems) {
  const pkg = JSON.parse(readFileSync(join(pluginRoot, 'package.json'), 'utf8'))
  for (const [key, fallback] of [['./typert', 'lib/typert.host.js'], ['./client', 'lib/client.js']]) {
    const target = pkg.exports?.[key]?.default
    if (typeof target !== 'string') {
      problems.push(`package.json: 缺少 exports["${key}"]`)
    } else if (!existsSync(join(pluginRoot, target))) {
      problems.push(`package.json: exports["${key}"] 指向的 ${target} 不存在`)
    }
    if (!existsSync(join(pluginRoot, fallback))) {
      problems.push(`缺少产物 ${join(pluginRoot, fallback)}`)
    }
  }
  return pkg
}

if (!existsSync(hostManifestPath)) {
  console.error(`verify-typert: 缺少 ${hostManifestPath}`)
  process.exit(2)
}

const problems = []
const pkg = checkPackageExports(problems)

// Host 面:清单顶层 import 了 zod,先解析运行时依赖。
const zodUrl = resolveDependency('zod')
if (zodUrl === undefined) {
  console.error('verify-typert: 无法解析清单依赖 zod。')
  console.error(`  在 ${pluginRoot} 执行 pnpm install,或用 --plugin 指向已安装副本:`)
  console.error('  --plugin "%USERPROFILE%\\.dsh\\profiles\\<profile>\\node_modules\\<包名>"')
  process.exit(2)
}

const mod = await import(pathToFileURL(hostManifestPath).href)
const manifest = mod.TYPERT ?? mod.default
// 清单自报的包名优先:validateTypertManifest 会拒绝“清单包名 != 校验包名”。
const pkgName = typeof manifest?.package === 'string' ? manifest.package : pkg.name

const entries = loaderEntries()
const invocationCount = manifest?.invocations?.length ?? 0
const checked = []
if (entries.length === 0) {
  console.log(`verify-typert: 提示 — 定位不到 ${LOADER_PKG},退化为内置并集契约校验(可用 --anchor 指向 DSH 检出根)。`)
  checkManifestShape(manifest, problems)
  checked.push('内置并集校验')
} else {
  for (const entry of entries) {
    const version = loaderVersion(entry)
    let validateTypertManifest
    try {
      ({ validateTypertManifest } = await import(pathToFileURL(entry).href))
    } catch (error) {
      problems.push(`loader ${version} 无法导入(${entry}): ${error instanceof Error ? error.message : String(error)}`)
      continue
    }
    try {
      validateTypertManifest(pkgName, manifest)
      checked.push(`loader ${version}`)
    } catch (error) {
      problems.push(`loader ${version} 拒绝清单: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

const clientStrict = checkClientFace(readFileSync(clientBundlePath, 'utf8'), problems)

if (problems.length > 0) {
  console.error(`verify-typert: FAIL — ${pkgName}`)
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}

console.log(`verify-typert: OK — ${pkgName}:host 面 ${String(invocationCount)} 个 invocation 通过 ${checked.join(' + ')};client 面 ${String(clientStrict)} 个 strict codec 同时带 schema 与 create;exports 打包契约完好。`)
process.exit(0)
