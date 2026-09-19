import { expect, test } from 'bun:test'
import { runInNewContext } from 'node:vm'
import { mediaScript, targetScript, successScript, tikTokReceiptBaselineScript } from '../scheduled-social-browser-executor'

function page(nodes: (poll: number) => unknown[]) {
  let polls = 0
  const element = { disabled: false, style: {}, setAttribute() {}, removeAttribute() {}, addEventListener() {}, getBoundingClientRect: () => ({ width: 20, height: 20 }) }
  return { element, polls: () => polls, context: {
    window: {},
    document: { querySelectorAll: () => nodes(polls) },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    setTimeout: (callback: () => void) => { polls++; callback() },
  } }
}

test('waits for a TikTok upload input mounted after navigation', async () => {
  const fixture = page(poll => poll >= 4 ? [fixture.element] : [])
  const result = await runInNewContext(targetScript('tiktok', 'upload', ['input[type="file"]'], [], 'runner-social-upload'), fixture.context)
  expect(result.status).toBe('ok')
  expect(fixture.polls()).toBe(4)
})

test('waits for a disabled control to become ready', async () => {
  const fixture = page(poll => { fixture.element.disabled = poll < 3; return [fixture.element] })
  expect((await runInNewContext(targetScript('tiktok', 'caption', ['[contenteditable="true"]'], [], 'runner-social-caption'), fixture.context)).status).toBe('ok')
  expect(fixture.polls()).toBe(3)
})

test('does not choose between ambiguous controls or wait forever for a missing one', async () => {
  const ambiguous = page(() => [ambiguous.element, { ...ambiguous.element }])
  expect((await runInNewContext(targetScript('tiktok', 'upload', ['input'], [], 'upload'), ambiguous.context)).status).toBe('ambiguous')
  expect(ambiguous.polls()).toBe(0)
  const missing = page(() => [])
  expect((await runInNewContext(targetScript('tiktok', 'upload', ['input'], [], 'upload'), missing.context)).status).toBe('missing')
  expect(missing.polls()).toBe(60)
})


test('retains exact selected media evidence when TikTok unmounts its file input', async () => {
  let onChange: (() => void) | undefined
  const input = {
    files: [{ name: 'approved.mp4' }], disabled: false, style: {},
    setAttribute() {}, removeAttribute() {},
    addEventListener(event: string, callback: () => void) { if (event === 'change') onChange = callback },
    getBoundingClientRect: () => ({ width: 1, height: 1 }),
  }
  const context = {
    window: {},
    document: {
      querySelectorAll: (_selector: string): unknown[] => [input],
      querySelector: (_selector: string): unknown => input,
      body: { innerText: 'approved.mp4 Uploaded（1.06MB）' },
    },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
  }
  await runInNewContext(targetScript('tiktok', 'upload', ['input[type="file"]'], [], 'runner-social-upload'), context)
  onChange!()
  context.document.querySelector = () => null
  context.document.querySelectorAll = selector => selector === 'button' ? [{ textContent: 'Replace' }] : []
  const inspect = () => runInNewContext(mediaScript('tiktok', []), context)
  expect(inspect()).toEqual({ fileNames: ['approved.mp4'], hasMediaPreview: true })
  context.document.body.innerText = 'different.mp4 Uploaded（1.06MB）'
  expect(inspect().hasMediaPreview).toBe(false)
})


test('does not click a Post button covered by an onboarding overlay', async () => {
  const fixture = page(() => [button])
  const button = { ...fixture.element, textContent: 'Post', scrollIntoView() {}, contains: (node: unknown) => node === button }
  const context = { ...fixture.context, document: { ...fixture.context.document, elementFromPoint: () => ({ overlay: true }) } }
  expect((await runInNewContext(targetScript('tiktok', 'submit', ['button'], ['Post'], 'runner-social-submit'), context)).status).toBe('missing')
  context.document.elementFromPoint = () => button as any
  expect((await runInNewContext(targetScript('tiktok', 'submit', ['button'], ['Post'], 'runner-social-submit'), context)).status).toBe('ok')
})


test('TikTok receipt requires exactly one new post matching the approved account and caption', () => {
  const posted = 'https://www.tiktok.com/@earthtomikey/video/7686704360977419533'
  const old = 'https://www.tiktok.com/@earthtomikey/video/123'
  let links = [{ href: old, textContent: 'boop' }, { href: posted, textContent: 'boop' }]
  const context = {
    URL, location: { href: 'https://www.tiktok.com/tiktokstudio/content', pathname: '/tiktokstudio/content' },
    document: { querySelectorAll: () => links, body: { innerText: 'Posts 2 Content under review' } },
  }
  const inspect = () => runInNewContext(successScript('tiktok', { existingUrls: [old], caption: 'boop', handle: '@earthtomikey' }), context)
  expect(inspect()).toEqual({ proven: true, externalUrl: posted, underReview: true })
  links = [{ href: old, textContent: 'boop' }]
  expect(inspect().proven).toBe(false)
  links = [{ href: posted.replace('@earthtomikey', '@someoneelse'), textContent: 'boop' }]
  expect(inspect().proven).toBe(false)
  links = [{ href: posted, textContent: 'wrong caption' }]
  expect(inspect().proven).toBe(false)
  links = [{ href: posted, textContent: 'boop' }, { href: posted + '1', textContent: 'boop' }]
  expect(inspect().proven).toBe(false)
})

test('TikTok receipt baseline waits for the content list instead of treating loading as empty', async () => {
  let polls = 0
  const context = { document: { querySelectorAll: () => [], body: { innerText: 'Loading' } }, setTimeout(callback: () => void) { polls++; context.document.body.innerText = 'Posts 0 Drafts 0'; callback() } }
  expect(await runInNewContext(tikTokReceiptBaselineScript(), context)).toEqual({ ready: true, urls: [] })
  expect(polls).toBe(1)
})

test('dismisses the observed TikTok editing tutorial before resolving Post', async () => {
  let overlay = true
  const fixture = page(() => [])
  const button = { ...fixture.element, textContent: 'Post', scrollIntoView() {}, contains: (node: unknown) => node === button }
  const tutorial = { textContent: 'New editing features added', querySelectorAll: () => [{ textContent: 'Got it', click() { overlay = false } }] }
  const context = { ...fixture.context, document: {
    querySelectorAll: (selector: string) => selector === '.tutorial-tooltip' ? [tutorial] : selector === 'button' ? [button] : [],
    elementFromPoint: () => overlay ? tutorial : button,
  } }
  expect((await runInNewContext(targetScript('tiktok', 'submit', ['button'], ['Post'], 'runner-social-submit'), context)).status).toBe('ok')
  expect(overlay).toBe(false)
})
