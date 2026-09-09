#!/usr/bin/env node
/* eslint-disable */

import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const CONFIG = '.agents/architecture-workflow.config.json'
const LEGACY_CONFIG = '.agents/architecture-map.config.json'
const STATUSES = new Set(['candidate', 'active', 'blocked'])
const KINDS = new Set(['purpose', 'boundary', 'capability', 'guarantee', 'module', 'flow', 'data-ownership', 'external-boundary'])
const REQUIRED_KINDS = new Set(['purpose', 'boundary', 'module'])
const CERTAINTIES = new Set(['confirmed', 'inferred', 'declared-target', 'conflict', 'unknown'])
const ASSESSMENT_RESULTS = new Set(['updated', 'unaffected', 'pending'])
const PATH_ASSESSMENT_RESULTS = new Set(['mapped', 'unaffected', 'pending'])

function fail(message) { throw new Error(message) }
function text(value, label, allowEmpty = false) { if (typeof value !== 'string' || (!allowEmpty && value.trim() === '') || /[\r\n\0]/u.test(value)) fail(`${label} must be a non-empty single-line string`) }
function object(value, label) { if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`) }
function exact(value, fields, label) { object(value, label); for (const key of Object.keys(value)) if (!fields.includes(key)) fail(`${label} contains unknown field ${key}`); for (const key of fields) if (value[key] === undefined) fail(`${label}.${key} is required`) }
function digest(value) { return `sha256:${createHash('sha256').update(String(value).replaceAll('\r\n', '\n')).digest('hex')}` }
function safe(root, path) { text(path, 'path'); const base = resolve(root); const target = resolve(base, path); if (target !== base && !target.startsWith(`${base}${sep}`)) fail(`path escapes project root: ${path}`); for (let current = target; current !== base; current = dirname(current)) if (existsSync(current) && lstatSync(current).isSymbolicLink()) fail(`path crosses a symbolic link: ${path}`); return target }
function source(root, path, label = path) { const target = safe(root, path); if (!existsSync(target) || !lstatSync(target).isFile()) fail(`${label} must be an existing regular file: ${path}`); return readFileSync(target, 'utf8') }
function json(root, path, label) { try { return JSON.parse(source(root, path, label)) } catch (error) { fail(`${label} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`) } }
function heading(content, anchor) { return content.split(/\r?\n/u).some(line => /^#{1,6}\s+/u.test(line) && line.replace(/^#{1,6}\s+/u, '').trim() === anchor) }
function list(value, label, required = false) { if (!Array.isArray(value) || (required && value.length === 0)) fail(`${label} must be an array${required ? ' with items' : ''}`); const seen = new Set(); value.forEach((item, index) => { text(item, `${label}[${index}]`); if (seen.has(item)) fail(`${label} contains duplicate ${item}`); seen.add(item) }) }
function locator(root, value, label, verify) { exact(value, ['path', 'locator'], label); text(value.path, `${label}.path`); text(value.locator, `${label}.locator`); safe(root, value.path); if (verify && !source(root, value.path, `${label}.path`).includes(value.locator)) fail(`${label}.locator is missing from ${value.path}`) }
function doc(root, value, label, verify) { exact(value, ['role', 'path', 'anchor'], label); text(value.role, `${label}.role`); text(value.path, `${label}.path`); text(value.anchor, `${label}.anchor`); safe(root, value.path); if (verify && !heading(source(root, value.path, `${label}.path`), value.anchor)) fail(`${label}.anchor is missing from ${value.path}`) }
function config(root) { const value = json(root, CONFIG, CONFIG); exact(value, ['version', 'enabled', 'statePath'], CONFIG); if (value.version !== 1 || typeof value.enabled !== 'boolean' || typeof value.statePath !== 'string') fail(`${CONFIG} version or enabled is invalid`); if (value.enabled) safe(root, value.statePath); else if (value.statePath !== '') fail(`${CONFIG}.statePath must be empty while disabled`); return value }

function normalizeState(value) {
  if (value?.version === 4 && value.pendingImpact !== null && value.pendingImpact !== undefined && (value.pendingImpact.unmappedPaths === undefined || value.pendingImpact.pathAssessments === undefined)) {
    const changedPaths = value.pendingImpact.changedPaths ?? []
    const covered = new Set((value.items ?? []).flatMap(item => [item.document?.path, ...(item.impactPaths ?? []), ...(item.evidence ?? []).map(entry => entry.path), ...(item.tests ?? []).map(entry => entry.path)].filter(Boolean)))
    return { ...value, pendingImpact: { ...value.pendingImpact, unmappedPaths: value.pendingImpact.unmappedPaths ?? changedPaths.filter(path => !covered.has(path)), pathAssessments: value.pendingImpact.pathAssessments ?? [] } }
  }
  if (![1, 2, 3].includes(value?.version)) return value
  const legacy = value.version === 1
  const { reviewedAt, acceptedAt, ...snapshot } = value.snapshot ?? {}
  const items = value.items?.map(item => {
    const impactPaths = item.impactPaths ?? item.reviewPaths ?? [...new Set([item.document?.path, ...(item.evidence ?? []).map(entry => entry.path), ...(item.tests ?? []).map(entry => entry.path)].filter(Boolean))]
    const { reviewPaths, ...result } = item
    return { ...result, impactPaths }
  })
  const openQuestions = value.openQuestions?.map(item => {
    const impactPaths = item.impactPaths ?? item.reviewPaths ?? []
    const { reviewPaths, ...result } = item
    return { ...result, impactPaths }
  })
  return {
    version: 4,
    documentStatus: value.documentStatus === 'blocked' ? 'blocked' : 'candidate',
    snapshot: { ...snapshot, acceptedAt: acceptedAt ?? reviewedAt ?? new Date(0).toISOString(), files: value.snapshot?.files ?? [] },
    documents: value.documents,
    items,
    openQuestions,
    pendingImpact: null,
  }
}

export function validateState(root, state, { verify = true } = {}) {
  state = normalizeState(state)
  exact(state, ['version', 'documentStatus', 'snapshot', 'documents', 'items', 'openQuestions', 'pendingImpact'], 'architecture state')
  if (state.version !== 4 || !STATUSES.has(state.documentStatus)) fail('architecture state version or documentStatus is invalid')
  exact(state.snapshot, ['commit', 'acceptedAt', 'files'], 'architecture state.snapshot')
  if (!/^[0-9a-f]{40}$/u.test(state.snapshot.commit) || Number.isNaN(Date.parse(state.snapshot.acceptedAt)) || !Array.isArray(state.snapshot.files)) fail('architecture state.snapshot is invalid')
  const fingerprints = new Set()
  state.snapshot.files.forEach((file, index) => { exact(file, ['path', 'sha256'], `architecture state.snapshot.files[${index}]`); text(file.path, `architecture state.snapshot.files[${index}].path`); if (!/^sha256:[0-9a-f]{64}$/u.test(file.sha256)) fail(`architecture state.snapshot.files[${index}].sha256 is invalid`); safe(root, file.path); if (fingerprints.has(file.path)) fail(`architecture state.snapshot.files contains duplicate ${file.path}`); fingerprints.add(file.path) })
  if (state.documentStatus === 'active' && state.snapshot.files.length === 0) fail('active architecture state must have a non-empty snapshot')
  if (!Array.isArray(state.documents) || state.documents.length === 0 || !Array.isArray(state.items) || state.items.length === 0 || !Array.isArray(state.openQuestions)) fail('architecture state collections are invalid')
  const roles = new Set(); state.documents.forEach((value, index) => { doc(root, value, `architecture state.documents[${index}]`, verify); if (roles.has(value.role)) fail(`architecture state.documents contains duplicate ${value.role}`); roles.add(value.role) })
  if (!roles.has('overview')) fail('architecture state.documents must contain exactly one overview role')
  const itemIds = new Set()
  state.items.forEach((item, index) => {
    const label = `architecture state.items[${index}]`; exact(item, ['id', 'kind', 'summary', 'moduleId', 'certainty', 'evidence', 'tests', 'document', 'impactPaths'], label)
    for (const key of ['id', 'kind', 'summary', 'moduleId', 'certainty']) text(item[key], `${label}.${key}`)
    if (!KINDS.has(item.kind) || !CERTAINTIES.has(item.certainty) || itemIds.has(item.id)) fail(`${label} is invalid or duplicated`); itemIds.add(item.id)
    if (!Array.isArray(item.evidence) || item.evidence.length === 0 || !Array.isArray(item.tests)) fail(`${label}.evidence or tests is invalid`)
    item.evidence.forEach((value, itemIndex) => locator(root, value, `${label}.evidence[${itemIndex}]`, verify)); item.tests.forEach((value, itemIndex) => locator(root, value, `${label}.tests[${itemIndex}]`, verify))
    doc(root, item.document, `${label}.document`, verify); if (!roles.has(item.document.role)) fail(`${label}.document.role is unknown`)
    list(item.impactPaths, `${label}.impactPaths`, true); item.impactPaths.forEach(path => safe(root, path))
  })
  const questions = new Set(); state.openQuestions.forEach((item, index) => { const label = `architecture state.openQuestions[${index}]`; exact(item, ['id', 'subject', 'impact', 'neededEvidence', 'impactPaths', 'critical'], label); for (const key of ['id', 'subject', 'impact', 'neededEvidence']) text(item[key], `${label}.${key}`); if (typeof item.critical !== 'boolean' || questions.has(item.id)) fail(`${label} is invalid or duplicated`); questions.add(item.id); list(item.impactPaths, `${label}.impactPaths`, true); item.impactPaths.forEach(path => safe(root, path)) })
  if (state.pendingImpact !== null) {
    exact(state.pendingImpact, ['baseCommit', 'changedPaths', 'itemIds', 'assessments', 'unmappedPaths', 'pathAssessments'], 'architecture state.pendingImpact')
    if (!/^[0-9a-f]{40}$/u.test(state.pendingImpact.baseCommit)) fail('architecture state.pendingImpact.baseCommit is invalid')
    list(state.pendingImpact.changedPaths, 'architecture state.pendingImpact.changedPaths'); list(state.pendingImpact.itemIds, 'architecture state.pendingImpact.itemIds'); list(state.pendingImpact.unmappedPaths, 'architecture state.pendingImpact.unmappedPaths')
    state.pendingImpact.unmappedPaths.forEach(path => { if (!state.pendingImpact.changedPaths.includes(path)) fail(`architecture state.pendingImpact.unmappedPaths references unchanged ${path}`) })
    state.pendingImpact.itemIds.forEach(id => { if (!itemIds.has(id)) fail(`architecture state.pendingImpact.itemIds references unknown ${id}`) })
    if (!Array.isArray(state.pendingImpact.assessments)) fail('architecture state.pendingImpact.assessments must be an array')
    const assessed = new Set(); state.pendingImpact.assessments.forEach((assessment, index) => { const label = `architecture state.pendingImpact.assessments[${index}]`; exact(assessment, ['itemId', 'result', 'reason', 'evidence'], label); text(assessment.itemId, `${label}.itemId`); if (!state.pendingImpact.itemIds.includes(assessment.itemId) || assessed.has(assessment.itemId)) fail(`${label}.itemId is invalid or duplicated`); assessed.add(assessment.itemId); text(assessment.result, `${label}.result`); if (!ASSESSMENT_RESULTS.has(assessment.result)) fail(`${label}.result is invalid`); text(assessment.reason, `${label}.reason`); locator(root, assessment.evidence, `${label}.evidence`, verify) })
    if (!Array.isArray(state.pendingImpact.pathAssessments)) fail('architecture state.pendingImpact.pathAssessments must be an array')
    const assessedPaths = new Set(); state.pendingImpact.pathAssessments.forEach((assessment, index) => { const label = `architecture state.pendingImpact.pathAssessments[${index}]`; exact(assessment, ['path', 'result', 'reason', 'evidence'], label); text(assessment.path, `${label}.path`); if (!state.pendingImpact.unmappedPaths.includes(assessment.path) || assessedPaths.has(assessment.path)) fail(`${label}.path is invalid or duplicated`); assessedPaths.add(assessment.path); text(assessment.result, `${label}.result`); if (!PATH_ASSESSMENT_RESULTS.has(assessment.result)) fail(`${label}.result is invalid`); text(assessment.reason, `${label}.reason`); locator(root, assessment.evidence, `${label}.evidence`, verify) })
  }
  if (state.documentStatus === 'active' && state.openQuestions.some(item => item.critical)) fail('active architecture state cannot contain critical open questions')
  return state
}

function readState(root, value = config(root), options) { if (!value.enabled) return undefined; return validateState(root, json(root, value.statePath, 'architecture state'), options) }
function currentCommit(root) { const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }); if (result.status !== 0) fail('current project commit is unavailable'); return result.stdout.trim() }
function workingChanges(root) { const paths = new Set(); for (const args of [['--cached'], []]) { const result = spawnSync('git', ['diff', '--name-only', ...args], { cwd: root, encoding: 'utf8' }); if (result.status !== 0) fail('cannot inspect Git worktree changes'); result.stdout.split(/\r?\n/u).filter(Boolean).forEach(path => paths.add(path)) } const untracked = spawnSync('git', ['ls-files', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' }); if (untracked.status !== 0) fail('cannot inspect untracked Git paths'); untracked.stdout.split(/\r?\n/u).filter(Boolean).forEach(path => paths.add(path)); return [...paths].sort() }
function changed(root, base) { const paths = new Set(workingChanges(root)); const result = spawnSync('git', ['diff', '--name-only', `${base}...HEAD`], { cwd: root, encoding: 'utf8' }); if (result.status !== 0) fail(`cannot inspect Git diff from ${base}`); result.stdout.split(/\r?\n/u).filter(Boolean).forEach(path => paths.add(path)); return [...paths].sort() }
function affected(model, changedPaths) { const changedSet = new Set(changedPaths); return model.items.filter(item => [item.document.path, ...item.impactPaths, ...item.evidence.map(entry => entry.path), ...item.tests.map(entry => entry.path)].some(path => changedSet.has(path))).map(item => ({ id: item.id, document: item.document })) }
function coveredPaths(model) { return new Set(model.items.flatMap(item => [item.document.path, ...item.impactPaths, ...item.evidence.map(entry => entry.path), ...item.tests.map(entry => entry.path)])) }
function currentFiles(root, value) { const paths = new Set([...value.documents.map(item => item.path), ...value.items.flatMap(item => [item.document.path, ...item.evidence.map(entry => entry.path), ...item.tests.map(entry => entry.path), ...item.impactPaths])]); return [...paths].sort().map(path => ({ path, sha256: digest(source(root, path)) })) }
function issues(root, value) { const result = []; for (const file of value.snapshot.files) { try { if (digest(source(root, file.path)) !== file.sha256) result.push(`architecture snapshot is stale: ${file.path}`) } catch { result.push(`architecture snapshot is stale: ${file.path}`) } } return result.sort() }
function coverageIssues(value) { const kinds = new Set(value.items.map(item => item.kind)); return [...REQUIRED_KINDS].filter(kind => !kinds.has(kind)).map(kind => `architecture is missing required ${kind} content`) }
function pendingIssues(value) { if (value.pendingImpact === null) return []; const assessments = new Map(value.pendingImpact.assessments.map(item => [item.itemId, item])); const missing = value.pendingImpact.itemIds.filter(id => !assessments.has(id)).map(id => `architecture impact is not assessed: ${id}`); const pending = [...assessments.values()].filter(item => item.result === 'pending').map(item => `architecture impact remains pending: ${item.itemId}`); const pathAssessments = new Map(value.pendingImpact.pathAssessments.map(item => [item.path, item])); const missingPaths = value.pendingImpact.unmappedPaths.filter(path => !pathAssessments.has(path)).map(path => `unmapped architecture change is not assessed: ${path}`); const pendingPaths = [...pathAssessments.values()].filter(item => item.result === 'pending').map(item => `unmapped architecture change remains pending: ${item.path}`); const covered = coveredPaths(value); const staleMappings = [...pathAssessments.values()].filter(item => item.result === 'mapped' && !covered.has(item.path)).map(item => `mapped architecture change has no state owner: ${item.path}`); return [...missing, ...pending, ...missingPaths, ...pendingPaths, ...staleMappings] }
function sameValues(left, right) { return left.length === right.length && left.every((value, index) => value === right[index]) }
function impactIntegrityIssues(root, value, statePath) {
  if (value.pendingImpact === null) return []
  const actual = changed(root, value.pendingImpact.baseCommit)
  const recorded = [...value.pendingImpact.changedPaths].sort()
  const result = []
  if (!sameValues(actual, recorded)) result.push('architecture pending impact does not match current Git changes; run prepare again')
  const expectedItems = affected(value, actual).map(item => item.id).sort()
  const recordedItems = [...value.pendingImpact.itemIds].sort()
  if (!sameValues(expectedItems, recordedItems)) result.push('architecture pending itemIds do not match current state ownership')
  const covered = coveredPaths(value)
  const controls = new Set([CONFIG, statePath])
  const unmapped = new Set(value.pendingImpact.unmappedPaths)
  for (const path of actual) if (!controls.has(path) && !covered.has(path) && !unmapped.has(path)) result.push(`architecture change is neither mapped nor assessed: ${path}`)
  return result
}
function writeState(path, value) { const temporary = `${path}.tmp-${process.pid}`; mkdirSync(dirname(path), { recursive: true }); writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8'); renameSync(temporary, path) }

function migrateLegacy(root) {
  const legacy = json(root, LEGACY_CONFIG, LEGACY_CONFIG); exact(legacy, ['version', 'enabled', 'paths', 'documents'], LEGACY_CONFIG)
  if (legacy.version !== 1 || legacy.enabled !== true || !Array.isArray(legacy.documents)) fail('legacy architecture map is disabled or invalid')
  const model = json(root, legacy.paths.model, 'legacy architecture map'); if (!Array.isArray(model.modules) || model.modules.length === 0) fail('legacy architecture map has no modules to migrate')
  const documents = legacy.documents.map(item => ({ role: item.role, path: item.path, anchor: item.anchor })); const moduleDocument = documents.find(item => item.role === 'modules') ?? documents[0]
  const items = model.modules.map(item => { const sourceArea = item.sourceAreas?.[0]; if (sourceArea === undefined) fail(`legacy module ${item.id} has no source area`); return { id: `module-${item.id}`, kind: 'module', summary: item.responsibility, moduleId: item.id, certainty: 'inferred', evidence: [{ path: sourceArea.path, locator: sourceArea.locator }], tests: [], document: moduleDocument, impactPaths: item.sourceAreas.map(area => area.path) } })
  const openQuestions = [...(model.capabilities ?? []), ...(model.guarantees ?? []), ...(model.pendingDecisions ?? [])].map(item => ({ id: `legacy-${item.id}`, subject: item.outcome ?? item.statement ?? item.subject, impact: '旧架构条目需要按当前代码和测试重新确认。', neededEvidence: '对应代码、配置、测试和决定资料。', impactPaths: [...new Set(items.flatMap(value => value.impactPaths))], critical: false }))
  const workflow = { version: 1, enabled: true, statePath: '.agents/architecture/state.json' }
  const candidate = { version: 4, documentStatus: 'candidate', snapshot: { commit: currentCommit(root), acceptedAt: new Date().toISOString(), files: [] }, documents, items, openQuestions, pendingImpact: null }
  validateState(root, candidate); writeState(safe(root, CONFIG), workflow); writeState(safe(root, workflow.statePath), candidate); rmSync(safe(root, LEGACY_CONFIG))
  for (const path of [legacy.paths.model, legacy.paths.baseline]) { const target = safe(root, path); if (existsSync(target) && lstatSync(target).isFile()) rmSync(target) }
  return candidate
}

export function runArchitectureWorkflow(argv = process.argv.slice(2), io = {}) {
  const [command, ...rest] = argv; if (!['check', 'impact', 'prepare', 'audit', 'accept', 'migrate'].includes(command)) fail('command must be check, impact, prepare, audit, accept, or migrate')
  let root = process.cwd(); let allowWrite = false; let requireActive = false
  for (let index = 0; index < rest.length; index += 1) { const flag = rest[index]; if (flag === '--root') { const value = rest[++index]; if (value === undefined || value.startsWith('--')) fail('--root requires a path'); root = resolve(value) } else if (flag === '--write') { if (allowWrite) fail('duplicate --write'); allowWrite = true } else if (flag === '--require-active') { if (requireActive) fail('duplicate --require-active'); requireActive = true } else fail(`unsupported argument: ${flag}`) }
  if (['prepare', 'accept', 'migrate'].includes(command) !== allowWrite) fail('prepare, accept, and migrate require --write; other commands are read-only')
  if (requireActive && command !== 'check') fail('--require-active is supported only by check')
  const stdout = io.stdout ?? (content => process.stdout.write(content)); if (command === 'migrate') { const candidate = migrateLegacy(root); stdout(`${JSON.stringify({ status: candidate.documentStatus, items: candidate.items.map(item => item.id) }, null, 2)}\n`); return 0 }
  const value = config(root); if (!value.enabled) { if (requireActive) fail('architecture workflow is disabled; active baseline is required'); stdout('architecture-workflow: architecture workflow is disabled.\n'); return 0 }
  const model = readState(root, value, { verify: command !== 'impact' && command !== 'prepare' })
  if (command === 'impact') { const changedPaths = changed(root, model.snapshot.commit); stdout(`${JSON.stringify({ baseCommit: model.snapshot.commit, changedPaths, items: affected(model, changedPaths) }, null, 2)}\n`); return 0 }
  if (command === 'prepare') { if (!['active', 'candidate'].includes(model.documentStatus)) fail('only active or candidate architecture state can prepare a change'); const baseCommit = model.pendingImpact?.baseCommit ?? model.snapshot.commit; const changedPaths = changed(root, baseCommit); const items = affected(model, changedPaths); const covered = coveredPaths(model); const controlPaths = new Set([CONFIG, value.statePath]); const unmappedPaths = changedPaths.filter(path => !covered.has(path) && !controlPaths.has(path)); const candidate = { ...model, documentStatus: 'candidate', snapshot: { ...model.snapshot, files: [] }, pendingImpact: { baseCommit, changedPaths, itemIds: items.map(item => item.id), assessments: [], unmappedPaths, pathAssessments: [] } }; validateState(root, candidate, { verify: false }); writeState(safe(root, value.statePath), candidate); stdout(`${JSON.stringify({ status: candidate.documentStatus, items, unmappedPaths }, null, 2)}\n`); return 0 }
  const found = [...issues(root, model), ...coverageIssues(model), ...pendingIssues(model), ...impactIntegrityIssues(root, model, value.statePath)]
  if (model.documentStatus === 'blocked' || model.openQuestions.some(item => item.critical)) found.push('architecture has critical open questions')
  if (command === 'audit') { stdout(`${JSON.stringify({ status: found.length === 0 ? model.documentStatus : 'blocked', issues: found.sort() }, null, 2)}\n`); return 0 }
  if (command === 'check') { if (requireActive && model.documentStatus !== 'active') found.push(`architecture state must be active, found ${model.documentStatus}`); if (requireActive && model.documentStatus === 'active') { const controls = new Set([CONFIG, value.statePath]); for (const path of changed(root, model.snapshot.commit)) if (!controls.has(path)) found.push(`active architecture baseline has unassessed change: ${path}`) } if (found.length > 0) fail(found.sort().join('\n')); stdout(`architecture-workflow: architecture state is ${model.documentStatus}.\n`); return 0 }
  if (model.documentStatus !== 'candidate') fail('only candidate architecture state can become active')
  const uncommitted = workingChanges(root).filter(path => path !== value.statePath)
  if (uncommitted.length > 0) fail(`architecture candidate changes must be committed before accept: ${uncommitted.join(', ')}`)
  if (found.length > 0) fail(found.sort().join('\n'))
  const accepted = { ...model, documentStatus: 'active', pendingImpact: null, snapshot: { commit: currentCommit(root), acceptedAt: new Date().toISOString(), files: currentFiles(root, model) } }
  validateState(root, accepted); writeState(safe(root, value.statePath), accepted); stdout('architecture-workflow: architecture state is active.\n'); return 0
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { try { process.exitCode = runArchitectureWorkflow() } catch (error) { process.stderr.write(`architecture-workflow: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1 } }
