import { afterEach, expect, test } from 'bun:test'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

import type { Logger } from '../runtime/platform'
import {
  PrivilegedExecutionBroker,
  resolvePrivilegedAuditLogPath,
} from './privileged-execution-broker'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

test('writes privileged audit records only beneath the supplied product root', async () => {
  const home = join(tmpdir(), `trade-god-audit-${randomUUID()}`)
  const tradeGodRoot = join(home, '.trade-god')
  const runnerRoot = join(home, '.craft-agent')
  roots.push(home)
  const auditPath = resolvePrivilegedAuditLogPath(tradeGodRoot)
  const logger = { warn: () => {} } as unknown as Logger
  const broker = new PrivilegedExecutionBroker(logger, auditPath)

  broker.auditEvent('containment_canary', { safe: true })
  await Bun.sleep(20)

  expect(readFileSync(auditPath, 'utf8')).toContain('containment_canary')
  expect(existsSync(join(runnerRoot, 'logs', 'privileged-actions.jsonl'))).toBe(false)
})
