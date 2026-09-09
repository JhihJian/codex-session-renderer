/* eslint-disable */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'

export const CONFIG_PATH = '.agents/documentation.config.json'

export function toPosix(path) {
  return path.split(sep).join('/')
}

export function resolveInside(root, path) {
  const base = resolve(root)
  const target = resolve(base, path)
  if (target !== base && !target.startsWith(`${base}${sep}`)) {
    throw new Error(`path escapes project root: ${path}`)
  }
  return target
}

export function parseArguments(args, allowedFlags = []) {
  const flags = new Set(allowedFlags)
  const result = { root: process.cwd(), flags: new Set() }
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (arg === '--root') {
      const value = args[index + 1]
      if (value === undefined || value.startsWith('--')) throw new Error('--root requires a path')
      result.root = resolve(value)
      index += 1
      continue
    }
    if (flags.has(arg)) {
      result.flags.add(arg)
      continue
    }
    throw new Error(`unsupported argument: ${arg}`)
  }
  return result
}

function assertStringArray(value, field) {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || item === '')) {
    throw new Error(`${field} must be an array of non-empty strings`)
  }
}

function assertCommandEntries(value, field) {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`)
  const names = new Set()
  for (const [index, entry] of value.entries()) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new Error(`${field}[${index}] must be an object`)
    }
    for (const key of Object.keys(entry)) {
      if (!['name', 'command', 'cwd'].includes(key)) {
        throw new Error(`${field}[${index}] contains unknown field ${JSON.stringify(key)}`)
      }
    }
    if (typeof entry.name !== 'string' || entry.name === '') {
      throw new Error(`${field}[${index}].name must be a non-empty string`)
    }
    if (names.has(entry.name)) throw new Error(`${field} contains duplicate name ${JSON.stringify(entry.name)}`)
    names.add(entry.name)
    assertStringArray(entry.command, `${field}[${index}].command`)
    if (entry.command.length === 0) {
      throw new Error(`${field}[${index}].command must contain an executable`)
    }
    if (entry.cwd !== undefined && (typeof entry.cwd !== 'string' || entry.cwd === '')) {
      throw new Error(`${field}[${index}].cwd must be a non-empty string`)
    }
  }
}

export function loadConfig(root) {
  const path = resolveInside(root, CONFIG_PATH)
  if (!existsSync(path)) throw new Error(`${CONFIG_PATH} is missing`)
  let config
  try {
    config = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Error(`${CONFIG_PATH} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    throw new Error(`${CONFIG_PATH} must contain a JSON object`)
  }
  const allowed = new Set([
    'version',
    'markdown',
    'sourceReferences',
    'budgets',
    'forbiddenDecisionRoots',
    'generatedDocs',
    'optionalChecks',
  ])
  for (const field of Object.keys(config)) {
    if (!allowed.has(field)) throw new Error(`${CONFIG_PATH} contains unknown field ${JSON.stringify(field)}`)
  }
  if (config.version !== 1) throw new Error(`${CONFIG_PATH}.version must be 1`)

  if (typeof config.markdown !== 'object' || config.markdown === null || Array.isArray(config.markdown)) {
    throw new Error('markdown must be an object')
  }
  for (const field of Object.keys(config.markdown)) {
    if (!['anchorStyle', 'include', 'exclude', 'skipOutbound'].includes(field)) {
      throw new Error(`markdown contains unknown field ${JSON.stringify(field)}`)
    }
  }
  if (!['github', 'none'].includes(config.markdown.anchorStyle)) {
    throw new Error('markdown.anchorStyle must be `github` or `none`')
  }
  assertStringArray(config.markdown.include, 'markdown.include')
  assertStringArray(config.markdown.exclude, 'markdown.exclude')
  assertStringArray(config.markdown.skipOutbound, 'markdown.skipOutbound')

  if (typeof config.sourceReferences !== 'object'
    || config.sourceReferences === null
    || Array.isArray(config.sourceReferences)) {
    throw new Error('sourceReferences must be an object')
  }
  for (const field of Object.keys(config.sourceReferences)) {
    if (!['include', 'exclude', 'rootPrefixes'].includes(field)) {
      throw new Error(`sourceReferences contains unknown field ${JSON.stringify(field)}`)
    }
  }
  assertStringArray(config.sourceReferences.include, 'sourceReferences.include')
  assertStringArray(config.sourceReferences.exclude, 'sourceReferences.exclude')
  assertStringArray(config.sourceReferences.rootPrefixes, 'sourceReferences.rootPrefixes')

  if (!Array.isArray(config.budgets) || config.budgets.length === 0) {
    throw new Error('budgets must be a non-empty array')
  }
  const budgetPaths = new Set()
  for (const [index, entry] of config.budgets.entries()) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new Error(`budgets[${index}] must be an object`)
    }
    if (typeof entry.path !== 'string' || entry.path === '') {
      throw new Error(`budgets[${index}].path must be a non-empty string`)
    }
    if (budgetPaths.has(entry.path)) throw new Error(`budgets contains duplicate path ${JSON.stringify(entry.path)}`)
    budgetPaths.add(entry.path)
    for (const field of Object.keys(entry)) {
      if (!['path', 'maxCodePoints', 'maxWords', 'maxLines'].includes(field)) {
        throw new Error(`budgets[${index}] contains unknown field ${JSON.stringify(field)}`)
      }
    }
    const limits = ['maxCodePoints', 'maxWords', 'maxLines'].filter(field => entry[field] !== undefined)
    if (limits.length === 0) {
      throw new Error(`budgets[${index}] must define maxCodePoints, maxWords, or maxLines`)
    }
    for (const field of limits) {
      if (!Number.isInteger(entry[field]) || entry[field] <= 0) {
        throw new Error(`budgets[${index}].${field} must be a positive integer`)
      }
    }
    resolveInside(root, entry.path)
  }

  assertStringArray(config.forbiddenDecisionRoots, 'forbiddenDecisionRoots')
  for (const path of config.forbiddenDecisionRoots) resolveInside(root, path)

  if (!Array.isArray(config.generatedDocs)) throw new Error('generatedDocs must be an array')
  const generatedNames = new Set()
  const generatedPaths = new Set()
  for (const [index, entry] of config.generatedDocs.entries()) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new Error(`generatedDocs[${index}] must be an object`)
    }
    for (const field of Object.keys(entry)) {
      if (!['name', 'path', 'sources', 'checkCommand', 'cwd', 'marker'].includes(field)) {
        throw new Error(`generatedDocs[${index}] contains unknown field ${JSON.stringify(field)}`)
      }
    }
    if (typeof entry.name !== 'string' || entry.name === '') {
      throw new Error(`generatedDocs[${index}].name must be a non-empty string`)
    }
    if (generatedNames.has(entry.name)) {
      throw new Error(`generatedDocs contains duplicate name ${JSON.stringify(entry.name)}`)
    }
    generatedNames.add(entry.name)
    if (typeof entry.path !== 'string' || entry.path === '') {
      throw new Error(`generatedDocs[${index}].path must be a non-empty string`)
    }
    if (generatedPaths.has(entry.path)) {
      throw new Error(`generatedDocs contains duplicate path ${JSON.stringify(entry.path)}`)
    }
    generatedPaths.add(entry.path)
    resolveInside(root, entry.path)
    assertStringArray(entry.sources, `generatedDocs[${index}].sources`)
    if (entry.sources.length === 0) {
      throw new Error(`generatedDocs[${index}].sources must contain at least one path`)
    }
    for (const source of entry.sources) resolveInside(root, source)
    assertStringArray(entry.checkCommand, `generatedDocs[${index}].checkCommand`)
    if (entry.checkCommand.length === 0) {
      throw new Error(`generatedDocs[${index}].checkCommand must contain an executable`)
    }
    if (entry.cwd !== undefined && (typeof entry.cwd !== 'string' || entry.cwd === '')) {
      throw new Error(`generatedDocs[${index}].cwd must be a non-empty string`)
    }
    if (entry.cwd !== undefined) resolveInside(root, entry.cwd)
    if (entry.marker !== undefined && (typeof entry.marker !== 'string' || entry.marker === '')) {
      throw new Error(`generatedDocs[${index}].marker must be a non-empty string`)
    }
  }

  assertCommandEntries(config.optionalChecks, 'optionalChecks')
  for (const entry of config.optionalChecks) {
    if (entry.cwd !== undefined) resolveInside(root, entry.cwd)
  }
  return config
}

export function globToRegExp(pattern) {
  const normalized = toPosix(pattern)
  let source = '^'
  for (let index = 0; index < normalized.length; index++) {
    const char = normalized[index]
    if (char === '*') {
      if (normalized[index + 1] === '*') {
        index += 1
        if (normalized[index + 1] === '/') {
          index += 1
          source += '(?:.*/)?'
        } else {
          source += '.*'
        }
      } else {
        source += '[^/]*'
      }
      continue
    }
    if (char === '?') {
      source += '[^/]'
      continue
    }
    source += /[\\^$.*+?()[\]{}|]/.test(char) ? `\\${char}` : char
  }
  return new RegExp(`${source}$`, 'u')
}

export function matchesAny(path, patterns) {
  const normalized = toPosix(path)
  return patterns.some(pattern => globToRegExp(pattern).test(normalized))
}

export function listFiles(root, include, exclude) {
  const out = []
  const seenFiles = new Set()

  function visit(directory, relDirectory = '') {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const rel = relDirectory === '' ? entry.name : `${relDirectory}/${entry.name}`
      const abs = resolve(directory, entry.name)
      if (entry.isDirectory()) {
        if (!matchesAny(rel, exclude) && !matchesAny(`${rel}/__probe__`, exclude)) visit(abs, rel)
        continue
      }
      if (entry.isSymbolicLink()) {
        let stat
        try {
          stat = statSync(abs)
        } catch {
          continue
        }
        if (!stat.isFile()) continue
      } else if (!entry.isFile()) {
        continue
      }
      if (!matchesAny(rel, include) || matchesAny(rel, exclude)) continue
      const real = realpathSync(abs)
      if (seenFiles.has(real)) continue
      seenFiles.add(real)
      out.push({ abs, rel: toPosix(rel) })
    }
  }

  visit(resolve(root))
  return out.sort((left, right) => left.rel.localeCompare(right.rel))
}

function executable(command) {
  if (command === 'node') return process.execPath
  if (process.platform !== 'win32') return command
  if (['npm', 'npx', 'pnpm', 'yarn'].includes(command)) return `${command}.cmd`
  return command
}

export function runCommand(root, entry, options = {}) {
  const [command, ...args] = entry.command
  const cwd = entry.cwd === undefined ? root : resolveInside(root, entry.cwd)
  const result = spawnSync(executable(command), args, {
    cwd,
    encoding: 'utf8',
    shell: false,
    stdio: options.inherit ? 'inherit' : 'pipe',
    timeout: options.timeout ?? 300_000,
  })
  if (result.error !== undefined) {
    return { ok: false, message: result.error.message }
  }
  if (result.status !== 0) {
    const output = options.inherit
      ? `exited with status ${String(result.status)}`
      : `${result.stdout ?? ''}${result.stderr ?? ''}`.trim() || `exited with status ${String(result.status)}`
    return { ok: false, message: output }
  }
  return { ok: true, message: options.inherit ? '' : String(result.stdout ?? '').trim() }
}

export function lineNumberAt(source, offset) {
  let line = 1
  for (let index = 0; index < offset; index++) if (source[index] === '\n') line += 1
  return line
}

export function relativeFrom(root, path) {
  return toPosix(relative(root, path))
}

export function ensureParentInside(root, path) {
  resolveInside(root, dirname(path))
}

export function pathHasExactCase(root, target) {
  const rel = relative(resolve(root), resolve(target))
  if (rel === '') return true
  if (rel === '..' || rel.startsWith(`..${sep}`)) return false
  let current = resolve(root)
  for (const segment of rel.split(sep)) {
    const entries = readdirSync(current)
    if (!entries.includes(segment)) return false
    current = resolve(current, segment)
  }
  return true
}

export function realPathIsInside(root, target) {
  const base = realpathSync(resolve(root))
  const real = realpathSync(resolve(target))
  return real === base || real.startsWith(`${base}${sep}`)
}
