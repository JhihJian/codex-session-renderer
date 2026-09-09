#!/usr/bin/env node
/* eslint-disable */

import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runArchitectureWorkflow } from './architecture-workflow.mjs'

export function runVerifyArchitectureWorkflow(argv = process.argv.slice(2), io = {}) {
  try { return runArchitectureWorkflow(['check', ...argv], io) } catch (error) { (io.stderr ?? (value => process.stderr.write(value)))(`verify-architecture-workflow: ${error instanceof Error ? error.message : String(error)}\n`); return 1 }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = runVerifyArchitectureWorkflow()
