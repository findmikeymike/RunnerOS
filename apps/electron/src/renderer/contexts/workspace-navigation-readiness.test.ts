import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import type { NavigateOptions } from '../lib/navigate'

test('internal navigation events preserve HQ selection and panel options', () => {
  const source = readFileSync(new URL('./NavigationContext.tsx', import.meta.url), 'utf8')
  const start = source.indexOf('    const handleNavigateEvent = (event: Event) => {')
  const end = source.indexOf('\n  }, [navigate])', start)
  expect(start).toBeGreaterThan(0)
  expect(end).toBeGreaterThan(start)
  // Exercise the actual listener on an EventTarget, including listener cleanup.
  const body = new Bun.Transpiler({ loader: 'ts' }).transformSync(source.slice(start, end))
  const install = new Function('window', 'navigate', 'NAVIGATE_EVENT', body)
  const target = new EventTarget()
  const calls: Array<[string, NavigateOptions?]> = []
  const cleanup = install(target, (route: string, options?: NavigateOptions) => calls.push([route, options]), 'craft-agent-navigate')
  const send = (detail: unknown) => target.dispatchEvent(new CustomEvent('craft-agent-navigate', { detail }))
  send({ route: 'allSessions', skipAutoSelect: true })
  send({ route: 'agents', newPanel: true, targetLaneId: 'main', skipAutoSelect: true })
  send({ route: 'allSessions' })
  expect(calls[0]).toEqual(['allSessions', { skipAutoSelect: true }])
  expect(calls[1]).toEqual(['agents', { newPanel: true, targetLaneId: 'main', skipAutoSelect: true }])
  expect(calls[2]?.[0]).toBe('allSessions')
  expect(calls[2]?.[1]?.skipAutoSelect).toBeUndefined()
  cleanup()
  send({ route: 'settings' })
  expect(calls).toHaveLength(3)
})

test('queued explicit links retain full route and options until destination restoration finishes', () => {
  const source = readFileSync(new URL('./NavigationContext.tsx', import.meta.url), 'utf8')
  const start = source.indexOf('    if (!isWorkspaceNavigationReady || !pendingNavigationRef.current) return')
  const end = source.indexOf('\n  }, [isWorkspaceNavigationReady, navigate])', start)
  expect(start).toBeGreaterThan(0)
  expect(end).toBeGreaterThan(start)
  const replay = new Function('isWorkspaceNavigationReady', 'pendingNavigationRef', 'navigate', source.slice(start, end))
  const pending = { current: { route: 'action/new-chat?agent=writer&prompt=hello', options: { newPanel: true } } }
  const calls: unknown[] = []
  replay(false, pending, (...args: unknown[]) => calls.push(args))
  expect(calls).toEqual([])
  expect(pending.current).not.toBeNull()
  replay(true, pending, (...args: unknown[]) => calls.push(args))
  expect(calls).toEqual([['action/new-chat?agent=writer&prompt=hello', { newPanel: true }]])
  expect(pending.current).toBeNull()
})

test('explicit HQ page waits for restored destination, then replaces its saved page', () => {
  const source = readFileSync(new URL('../components/app-shell/AppShell.tsx', import.meta.url), 'utf8')
  const start = source.indexOf('    const pending = pendingWorkspaceNavigationRef.current\n')
  const end = source.indexOf('\n  }, [activeWorkspaceId, sessionMetaMap, isWorkspaceNavigationReady])', start)
  expect(start).toBeGreaterThan(0)
  expect(end).toBeGreaterThan(start)
  const apply = new Function('pendingWorkspaceNavigationRef', 'activeWorkspaceId', 'isWorkspaceNavigationReady', 'sessionMetaMap', 'pendingWorkspaceNavigationTimeoutRef', 'setTimeout', 'clearTimeout', 'window', 'navigate', source.slice(start, end))
  const pending = { current: { workspaceId: 'hq', route: 'allSessions', hash: '#artist-hq/signals' } }
  const browser = { location: { hash: '#artist-hq/branding' } }
  const calls: unknown[] = []
  const run = (ready: boolean) => apply(pending, 'hq', ready, new Map(), { current: null }, (fn: () => void) => fn(), () => {}, browser, (...args: unknown[]) => calls.push(args))
  run(false)
  expect(browser.location.hash).toBe('#artist-hq/branding')
  expect(calls).toEqual([])
  run(true)
  expect(browser.location.hash).toBe('#artist-hq/signals')
  expect(calls).toEqual([['allSessions', { skipAutoSelect: true }]])
})
