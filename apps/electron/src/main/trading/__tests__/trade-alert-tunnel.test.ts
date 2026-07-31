import { expect, test } from 'bun:test'

import { parseCloudflaredLogLine } from '../trade-alert-tunnel.ts'

test('extracts a quick-tunnel URL from cloudflared JSON logs', () => {
  expect(parseCloudflaredLogLine(JSON.stringify({
    level: 'info',
    message: '|  https://night-compare-appreciation-guidelines.trycloudflare.com  |',
  }))).toEqual({
    publicUrl: 'https://night-compare-appreciation-guidelines.trycloudflare.com',
    connected: false,
  })
})

test('recognizes a registered tunnel connection', () => {
  expect(parseCloudflaredLogLine(JSON.stringify({
    level: 'info',
    message: 'Registered tunnel connection',
  }))).toEqual({ connected: true })
})
