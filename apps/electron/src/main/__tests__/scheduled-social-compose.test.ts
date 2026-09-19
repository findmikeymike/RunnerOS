import { expect, test } from 'bun:test'
import { runInNewContext } from 'node:vm'
import { instagramAdvanceScript, instagramDestinationScript, tikTokDraftRecoveryScript } from '../scheduled-social-compose'

function node(textContent = '', click = () => {}) {
  return { textContent, click, disabled: false, parentElement: null as any,
    getBoundingClientRect: () => ({ width: 100, height: 30 }),
    getAttribute: (_name: string): string | null => null,
    querySelector: (_selector: string): any => null,
    querySelectorAll: (_selector: string): any[] => [],
  }
}
function context(query: (selector: string) => any[], body = '') {
  return { document: { querySelectorAll: query, querySelector: (selector: string) => query(selector)[0] ?? null, body: { innerText: body } },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    setTimeout: (callback: () => void) => callback(),
  }
}

test('Instagram dismisses observed Reels notice, advances named stages once, never clicks Share', async () => {
  let stage = 'notice'; const clicks: string[] = []
  const ok = node('OK', () => { clicks.push('OK'); stage = 'Crop' })
  const notice = { ...node('Video posts are now shared as reels'), querySelectorAll: () => [ok] }
  const next = node('Next', () => { clicks.push(stage); stage = stage === 'Crop' ? 'Edit' : 'New reel' })
  const share = node('Share', () => { throw new Error('Must never publish') })
  const ctx = context(selector => {
    if (selector === '[role="dialog"]') return stage === 'notice' ? [notice] : []
    if (selector.includes('heading')) return [node(stage)]
    if (selector.includes('caption')) return stage === 'New reel' ? [node()] : []
    if (selector.startsWith('button')) return stage === 'New reel' ? [share] : stage === 'notice' ? [ok] : [next]
    return []
  })
  expect(await runInNewContext(instagramAdvanceScript(), ctx)).toEqual({ ready: true })
  expect(clicks).toEqual(['OK', 'Crop', 'Edit'])
})

test('Instagram unknown stage times out without clicking an unrelated Next', async () => {
  let clicks = 0
  const ctx = context(selector => selector.startsWith('button') ? [node('Next', () => clicks++)] : [])
  expect((await runInNewContext(instagramAdvanceScript(), ctx)).ready).toBe(false)
  expect(clicks).toBe(0)
})

test('Facebook cross-posting is disabled only for this reel, and checked afterwards', async () => {
  let checked = true; let confirming = false; const actions: string[] = []
  const toggle = { ...node('', () => { confirming = true; actions.push('toggle') }), getAttribute: () => String(checked) }
  const row = { ...node('Mike Williams Facebook · Public'), querySelectorAll: () => [toggle] }
  toggle.parentElement = row
  const confirm = node('Don’t share this reel', () => { checked = false; confirming = false; actions.push('this reel') })
  const global = node('Stop sharing all reels', () => { throw new Error('Must not change global settings') })
  const ctx = context(selector => {
    if (selector.startsWith('[role="switch"]')) return [toggle]
    if (selector.startsWith('button')) return confirming ? [confirm, global, node('Cancel')] : [node('Share')]
    return []
  })
  expect(await runInNewContext(instagramDestinationScript(), ctx)).toEqual({ ready: true })
  expect(actions).toEqual(['toggle', 'this reel'])
})

test('already-off Facebook stays untouched; ambiguous destinations do not pass', async () => {
  const toggle = { ...node('', () => { throw new Error('Should stay off') }), getAttribute: () => 'false' }
  toggle.parentElement = { ...node('Facebook'), querySelectorAll: () => [toggle] }
  let controls = [toggle]
  const ctx = context(selector => selector.startsWith('[role="switch"]') ? controls : [])
  expect((await runInNewContext(instagramDestinationScript(), ctx)).ready).toBe(true)
  controls = [toggle, toggle]
  expect((await runInNewContext(instagramDestinationScript(), ctx)).ready).toBe(false)
})

test('Instagram without Facebook connection can proceed when final composer is ready', async () => {
  const ctx = context(selector => selector.startsWith('button') ? [node('Share')] : selector.includes('caption') ? [node()] : [], 'New reel')
  expect((await runInNewContext(instagramDestinationScript(), ctx)).ready).toBe(true)
})

test('TikTok fresh uploader requires no draft actions', async () => {
  const ctx = context(selector => selector === 'input[type="file"]' ? [node()] : [])
  expect(await runInNewContext(tikTokDraftRecoveryScript('goose.mp4', 'boop'), ctx)).toEqual({ ready: true, replacing: false })
})

test('TikTok restores matching draft then replaces bytes; never discards or posts', async () => {
  let restored = false; const clicks: string[] = []
  const ctx = context(selector => {
    if (selector.startsWith('button')) return restored ? [node('Replace', () => clicks.push('Replace'))] : [node('Continue', () => { restored = true; ctx.document.body.innerText = 'goose.mp4\nUploaded（1.06MB）'; clicks.push('Continue') })]
    if (selector.startsWith('[contenteditable')) return restored ? [node('goose')] : []
    return []
  }, 'A video you were editing wasn’t saved. Continue editing?')
  expect(await runInNewContext(tikTokDraftRecoveryScript('goose.mp4', 'boop'), ctx)).toEqual({ ready: true, replacing: true })
  expect(clicks).toEqual(['Continue', 'Replace'])
})

test('TikTok preserves unrelated filenames or captions even if file input is present', async () => {
  for (const [name, caption] of [['other.mp4', 'boop'], ['goose.mp4', 'My unfinished caption']]) {
    let clicks = 0
    const ctx = context(selector => selector.startsWith('button') ? [node('Replace', () => clicks++)] : selector.startsWith('[contenteditable') ? [node(caption)] : selector === 'input[type="file"]' ? [node()] : [], `${name}\nUploaded（1.06MB）`)
    expect((await runInNewContext(tikTokDraftRecoveryScript('goose.mp4', 'boop'), ctx)).ready).toBe(false)
    expect(clicks).toBe(0)
  }
})

test('TikTok waits for disabled Replace and never forces a permanently disabled control', async () => {
  for (const becomesReady of [true, false]) {
    let polls = 0; let clicks = 0
    const replace = node('Replace', () => clicks++)
    replace.disabled = true
    const ctx = context(selector => selector.startsWith('button') ? [replace] : selector.startsWith('[contenteditable') ? [node('boop')] : [], 'goose.mp4\nUploaded（1.06MB）')
    ctx.setTimeout = callback => { polls++; if (becomesReady && polls === 3) replace.disabled = false; callback() }
    expect((await runInNewContext(tikTokDraftRecoveryScript('goose.mp4', 'boop'), ctx)).ready).toBe(becomesReady)
    expect(clicks).toBe(becomesReady ? 1 : 0)
    expect(polls).toBe(becomesReady ? 3 : 60)
  }
})
