import { expect, test } from 'bun:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import OptionsControlCenterPage, { canRunGuidedOptionsTest, discordChannelUrl, PaperTestButton } from './OptionsControlCenterPage'

test('shows the exact saved Discord channel and allows the Webull sandbox paper test', () => {
  expect(discordChannelUrl({ guild_id: 'server-one', channel_id: 'channel-one' }))
    .toBe('https://discord.com/channels/server-one/channel-one')
  expect(canRunGuidedOptionsTest('webull')).toBe(true)
  expect(canRunGuidedOptionsTest('ibkr')).toBe(true)
})

test('paper safety test button directly invokes its action', () => {
  let runs = 0
  const button = PaperTestButton({
    busy: false,
    disabled: false,
    onRun: () => { runs += 1 },
  }) as React.ReactElement<{
    type: string
    disabled: boolean
    onClick(): void
  }>

  expect(button.props.type).toBe('button')
  expect(button.props.disabled).toBe(false)
  button.props.onClick()
  expect(runs).toBe(1)
})

test('uses the desk for operations and the Connections page for setup', () => {
  const desk = renderToStaticMarkup(<OptionsControlCenterPage />)
  const setup = renderToStaticMarkup(<OptionsControlCenterPage mode="connections" />)

  expect(desk).toContain('Options Desk')
  expect(desk).toContain('Manage connections')
  expect(desk).not.toContain('Connect broker')
  expect(setup).toContain('Options brokers')
  expect(setup).toContain('Start with paper while you test the system')
  expect(setup).toContain('Connect broker')
  expect(setup).not.toContain('Options Desk')
})
