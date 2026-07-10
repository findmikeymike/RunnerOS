import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { readOutputManifest, resolveOutputAssetPath } from '@craft-agent/shared/outputs'
import type {
  ScheduledSocialActionPreview,
  ScheduledSocialApproval,
  ScheduledWorkOrder,
} from '@craft-agent/shared/scheduled-work'

export type NativeSocialPlatform = 'x' | 'instagram' | 'tiktok' | 'youtube'

export interface ScheduledSocialBrowserInstance {
  currentUrl: string
  partition: string
}

export interface ScheduledSocialAccessibilitySnapshot {
  nodes: Array<{ ref: string; role: string; name: string; disabled?: boolean }>
}

export interface ScheduledSocialBrowserPaneManager {
  getInstance(id: string): ScheduledSocialBrowserInstance | undefined
  createInstance(id?: string, options?: { show?: boolean; partition?: string }): string
  focus(id: string): void
  navigate(id: string, url: string): Promise<{ url: string; title: string }>
  evaluate(id: string, expression: string): Promise<unknown>
  getAccessibilitySnapshot(id: string): Promise<ScheduledSocialAccessibilitySnapshot>
  fillElement(id: string, ref: string, value: string): Promise<void>
  uploadFile(id: string, ref: string, filePaths: string[]): Promise<unknown>
  clickElement(id: string, ref: string, options?: { waitFor?: 'none' | 'navigation' | 'network-idle'; timeoutMs?: number }): Promise<void>
}

export interface ScheduledSocialBrowserExecutorDeps {
  browserPaneManager: ScheduledSocialBrowserPaneManager
  resolveMediaPath?(workspaceRootPath: string, order: ScheduledWorkOrder): string | undefined
  fingerprintMediaPath?(path: string): string
  now?(): Date
  sleep?(ms: number): Promise<void>
  successTimeoutMs?: number
  successPollMs?: number
}

export interface ScheduledSocialBrowserExecutionInput {
  workspaceRootPath: string
  order: ScheduledWorkOrder
  preview: ScheduledSocialActionPreview
  approval: ScheduledSocialApproval
}

export interface ScheduledSocialBrowserExecutionResult {
  receiptId: string
  externalUrl?: string
  summary: string
}

type PlatformContract = {
  composeUrl: string
  captionSelectors: string[]
  uploadSelectors: string[]
  submitSelectors: string[]
  submitText: string[]
  successUrl: RegExp
  mediaPreviewSelectors: string[]
}

const PLATFORM_CONTRACTS: Record<NativeSocialPlatform, PlatformContract> = {
  x: {
    composeUrl: 'https://x.com/compose/post',
    captionSelectors: ['[data-testid="tweetTextarea_0"]'],
    uploadSelectors: ['input[data-testid="fileInput"]', 'input[type="file"][accept*="image"]', 'input[type="file"][accept*="video"]'],
    submitSelectors: ['[data-testid="tweetButton"]', '[data-testid="tweetButtonInline"]'],
    submitText: ['Post'],
    successUrl: /^https:\/\/(?:www\.)?x\.com\/[^/]+\/status\/\d+(?:[/?#].*)?$/i,
    mediaPreviewSelectors: ['[data-testid="attachments"] [data-testid="media"]', '[data-testid="attachments"] video', '[data-testid="attachments"] img'],
  },
  instagram: {
    composeUrl: 'https://www.instagram.com/create/select/',
    captionSelectors: ['textarea[aria-label*="caption" i]', '[contenteditable="true"][aria-label*="caption" i]'],
    uploadSelectors: ['input[type="file"]'],
    submitSelectors: ['button'],
    submitText: ['Share'],
    successUrl: /^https:\/\/(?:www\.)?instagram\.com\/(?:p|reel)\/[^/?#]+\/?(?:[?#].*)?$/i,
    mediaPreviewSelectors: ['[role="dialog"] img[src^="blob:"]', '[role="dialog"] video[src^="blob:"]', '[role="dialog"] canvas'],
  },
  tiktok: {
    composeUrl: 'https://www.tiktok.com/tiktokstudio/upload?from=webapp',
    captionSelectors: ['[contenteditable="true"][data-e2e*="caption" i]', '[contenteditable="true"][aria-label*="caption" i]'],
    uploadSelectors: ['input[type="file"]'],
    submitSelectors: ['button[data-e2e*="post" i]', 'button'],
    submitText: ['Post'],
    successUrl: /^https:\/\/(?:www\.)?tiktok\.com\/@[^/]+\/video\/\d+(?:[/?#].*)?$/i,
    mediaPreviewSelectors: ['[data-e2e*="upload"] video', '[data-e2e*="preview"] video', '[class*="preview"] video'],
  },
  youtube: {
    composeUrl: 'https://www.youtube.com/upload',
    captionSelectors: ['#title-textarea #textbox', 'ytcp-social-suggestions-textbox#title-textarea #textbox'],
    uploadSelectors: ['input[type="file"]'],
    submitSelectors: ['#done-button', '#publish-button'],
    submitText: ['Publish', 'Done'],
    successUrl: /^https:\/\/(?:www\.)?youtube\.com\/(?:shorts\/[^/?#]+|watch\?v=[^&#]+).*$/i,
    mediaPreviewSelectors: ['ytcp-video-upload-progress', 'ytcp-video-upload-progress video', '#video-player'],
  },
}

export async function executeScheduledSocialBrowser(
  input: ScheduledSocialBrowserExecutionInput,
  deps: ScheduledSocialBrowserExecutorDeps,
): Promise<ScheduledSocialBrowserExecutionResult> {
  const platform = assertApprovedTuple(input, deps)
  const contract = PLATFORM_CONTRACTS[platform]
  const action = input.preview.dryRun.action as Record<string, unknown>
  const payload = asRecord(action.payload)
  const browserPlan = asRecord(input.preview.dryRun.browserPlan)
  const browserSession = asRecord(browserPlan.browserSession)
  const verification = asRecord(browserPlan.accountVerification)
  const instanceId = String(browserSession.instanceId)
  const partition = String(browserSession.partition)
  const manager = deps.browserPaneManager

  let instance = manager.getInstance(instanceId)
  if (instance && instance.partition !== partition) {
    throw new Error(`Refusing social publish: browser instance ${instanceId} uses the wrong persisted partition.`)
  }
  if (!instance) {
    manager.createInstance(instanceId, { show: true, partition })
    instance = manager.getInstance(instanceId)
  }
  if (!instance || instance.partition !== partition) {
    throw new Error(`Could not open the approved persisted browser session ${partition}.`)
  }

  manager.focus(instanceId)
  await manager.navigate(instanceId, contract.composeUrl)

  const identity = asIdentityInspection(await manager.evaluate(instanceId, identityScript(platform)))
  assertExpectedIdentity(identity, verification)

  const mediaPath = resolveApprovedMediaPath(input, deps)
  if (mediaPath) {
    const uploadTarget = await resolveTarget(manager, instanceId, platform, 'upload', contract.uploadSelectors, [])
    await manager.uploadFile(instanceId, uploadTarget, [mediaPath])
    const attached = asMediaInspection(await manager.evaluate(
      instanceId,
      mediaScript(platform, contract.mediaPreviewSelectors),
    ))
    if (attached.fileNames.length !== 1 || attached.fileNames[0] !== basename(mediaPath)) {
      throw new Error('Refusing social submit: the browser did not attach the exact approved media file.')
    }
    await waitForMediaPreview(manager, instanceId, platform, contract.mediaPreviewSelectors, deps)
    if (platform === 'instagram') {
      await resolveAndClickAdvance(manager, instanceId, platform, 'Next')
      await resolveAndClickAdvance(manager, instanceId, platform, 'Next')
    }
  }

  const captionTarget = await resolveTarget(manager, instanceId, platform, 'caption', contract.captionSelectors, [])
  await manager.fillElement(instanceId, captionTarget, String(payload.text))

  if (platform === 'youtube') {
    await configureYouTubePublish(manager, instanceId, payload)
  }

  const draft = asDraftInspection(await manager.evaluate(
    instanceId,
    draftScript(platform),
  ))
  if (draft.caption !== payload.text) {
    throw new Error('Refusing social submit: the visible draft caption does not exactly match the approved caption.')
  }
  if (!mediaPath && draft.hasMediaPreview) {
    throw new Error('Refusing social submit: the draft contains unapproved media.')
  }

  const submitTarget = await resolveTarget(
    manager,
    instanceId,
    platform,
    'submit',
    contract.submitSelectors,
    contract.submitText,
  )
  await waitForCleanSuccessBaseline(manager, instanceId, platform, deps)
  await manager.clickElement(instanceId, submitTarget, { waitFor: 'none' })

  const proof = await waitForSuccessProof(manager, instanceId, platform, contract, deps)
  return {
    receiptId: platformReceiptId(platform, proof.externalUrl),
    externalUrl: proof.externalUrl,
    summary: `Published to ${platform}/${input.preview.profileId}; positive platform evidence was verified.`,
  }
}

async function configureYouTubePublish(
  manager: ScheduledSocialBrowserPaneManager,
  instanceId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  if (payload.postType !== 'video') {
    throw new Error('YouTube Shorts publishing is blocked until the uploaded media can be proven to meet Shorts classification.')
  }
  const visibility = cleanString(payload.visibility)
  if (visibility !== 'private' && visibility !== 'unlisted' && visibility !== 'public') {
    throw new Error('Approved YouTube visibility is missing or unsupported.')
  }
  const madeForKids = cleanString(payload.madeForKids)
  if (madeForKids !== 'yes' && madeForKids !== 'no') {
    throw new Error('Approved YouTube audience setting is missing or unsupported.')
  }
  const audience = await resolveTarget(
    manager,
    instanceId,
    'youtube',
    'audience',
    [
      `tp-yt-paper-radio-button[name="${madeForKids === 'yes' ? 'VIDEO_MADE_FOR_KIDS_MFK' : 'VIDEO_MADE_FOR_KIDS_NOT_MFK'}"]`,
      `[name="${madeForKids === 'yes' ? 'VIDEO_MADE_FOR_KIDS_MFK' : 'VIDEO_MADE_FOR_KIDS_NOT_MFK'}"]`,
    ],
    [],
  )
  await manager.clickElement(instanceId, audience, { waitFor: 'none' })
  for (let step = 0; step < 3; step += 1) {
    await resolveAndClickAdvance(manager, instanceId, 'youtube', 'Next')
  }
  const visibilityTarget = await resolveTarget(
    manager,
    instanceId,
    'youtube',
    'visibility',
    [`tp-yt-paper-radio-button[name="${visibility.toUpperCase()}"]`, `[name="${visibility.toUpperCase()}"]`],
    [],
  )
  await manager.clickElement(instanceId, visibilityTarget, { waitFor: 'none' })
}

async function waitForCleanSuccessBaseline(
  manager: ScheduledSocialBrowserPaneManager,
  instanceId: string,
  platform: NativeSocialPlatform,
  deps: ScheduledSocialBrowserExecutorDeps,
): Promise<void> {
  const timeoutMs = Math.min(Math.max(0, deps.successTimeoutMs ?? 30_000), 5_000)
  const pollMs = Math.max(1, deps.successPollMs ?? 500)
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const started = Date.now()
  do {
    const proof = asSuccessInspection(await manager.evaluate(instanceId, successScript(platform)))
    if (!proof.proven) return
    if (Date.now() - started >= timeoutMs) break
    await sleep(Math.min(pollMs, timeoutMs - (Date.now() - started)))
  } while (Date.now() - started <= timeoutMs)
  throw new Error(`Refusing social submit: ${platform} already shows success evidence that cannot be tied to this action.`)
}

async function waitForMediaPreview(
  manager: ScheduledSocialBrowserPaneManager,
  instanceId: string,
  platform: NativeSocialPlatform,
  selectors: string[],
  deps: ScheduledSocialBrowserExecutorDeps,
): Promise<void> {
  const timeoutMs = Math.max(0, deps.successTimeoutMs ?? 30_000)
  const pollMs = Math.max(1, deps.successPollMs ?? 500)
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const started = Date.now()
  do {
    const inspection = asMediaInspection(await manager.evaluate(instanceId, mediaScript(platform, selectors)))
    if (inspection.hasMediaPreview) return
    if (Date.now() - started >= timeoutMs) break
    await sleep(Math.min(pollMs, timeoutMs - (Date.now() - started)))
  } while (Date.now() - started <= timeoutMs)
  throw new Error(`Refusing social submit: ${platform} did not show a visible preview of the approved media.`)
}

export function computeScheduledSocialBrowserActionDigest(dryRun: Record<string, unknown>, mediaDigest?: string): string {
  return `sha256:${createHash('sha256').update(stableStringify({ action: dryRun.action, browserPlan: dryRun.browserPlan, mediaDigest })).digest('hex')}`
}

export function fingerprintScheduledSocialBrowserMedia(path: string): string {
  return `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`
}

export function resolveScheduledSocialBrowserMediaPath(workspaceRootPath: string, order: ScheduledWorkOrder): string | undefined {
  for (const ref of order.inputRefs) {
    if (ref.kind !== 'final' && ref.kind !== 'output') continue
    const manifest = readOutputManifest(workspaceRootPath, ref.outputId)
    if (!manifest) continue
    const assets = [...manifest.assets, ...(manifest.primary ? [manifest.primary] : [])]
    const asset = ref.kind === 'final' && ref.assetId
      ? assets.find((candidate) => candidate.id === ref.assetId)
      : manifest.primary
    if (!asset) continue
    const resolved = resolveOutputAssetPath(workspaceRootPath, ref.outputId, asset.path)
    if (resolved) return resolved
  }
  return undefined
}

function assertApprovedTuple(input: ScheduledSocialBrowserExecutionInput, deps: ScheduledSocialBrowserExecutorDeps): NativeSocialPlatform {
  const { order, preview, approval } = input
  if (order.execution.type !== 'social-publish' || order.type !== 'social-publish') {
    throw new Error('Scheduled work is not a social publish action.')
  }
  if (!isNativePlatform(order.execution.platform)) {
    throw new Error(`Unsupported native social platform: ${order.execution.platform || '(missing)'}.`)
  }
  const platform = order.execution.platform
  const action = asRecord(preview.dryRun.action)
  const payload = asRecord(action.payload)
  const options = asRecord(action.options)
  const plan = asRecord(preview.dryRun.browserPlan)
  const session = asRecord(plan.browserSession)
  const verification = asRecord(plan.accountVerification)
  const expectedInstance = `social-${platform}-${socialBrowserSegment(order.execution.profileId)}`
  const expectedPartition = `persist:social-${platform}-${socialBrowserSegment(order.execution.profileId)}`
  const mediaPath = resolveApprovedMediaPath(input, deps)
  const mediaDigest = mediaPath ? (deps.fingerprintMediaPath ?? fingerprintScheduledSocialBrowserMedia)(mediaPath) : undefined
  const approvedMedia = Array.isArray(payload.media) ? payload.media : []
  const expectedMedia = mediaPath ? [mediaPath] : []
  const now = (deps.now ?? (() => new Date()))().getTime()
  const approvedAt = Date.parse(approval.approvedAt)
  const expiresAt = Date.parse(approval.expiresAt)

  if (!Number.isFinite(approvedAt) || approvedAt > now || !Number.isFinite(expiresAt) || expiresAt <= now) {
    throw new Error('Social approval is invalid, future-dated, or expired.')
  }
  if (preview.platform !== platform || approval.platform !== platform
    || preview.profileId !== order.execution.profileId || approval.profileId !== order.execution.profileId
    || preview.payloadDigest !== order.executionKey.payloadDigest || approval.payloadDigest !== order.executionKey.payloadDigest
    || approval.actionId !== preview.actionId || preview.actionId !== `act_${order.id}`
    || approval.actionDigest !== preview.actionDigest || preview.mediaDigest !== mediaDigest || approval.mediaDigest !== mediaDigest) {
    throw new Error('Social order, preview, and approval tuple does not match exactly.')
  }
  if (order.socialAction && stableStringify(order.socialAction) !== stableStringify(preview)) {
    throw new Error('The authoritative work order contains a different social preview.')
  }
  if (order.socialApproval && stableStringify(order.socialApproval) !== stableStringify(approval)) {
    throw new Error('The authoritative work order contains a different social approval.')
  }
  if (action.actionId !== preview.actionId || action.verb !== 'post' || action.platform !== platform
    || action.profile !== order.execution.profileId || action.mode !== 'browser'
    || payload.text !== order.execution.caption
    || stableStringify(approvedMedia) !== stableStringify(expectedMedia)
    || options.dryRun !== true || options.idempotencyKey !== order.executionKey.idempotencyKey) {
    throw new Error('Approved social preview no longer matches the authoritative work order.')
  }
  if (platform === 'youtube') {
    const platformOptions = order.execution.platformOptions ?? {}
    const postType = cleanString(platformOptions.postType) ?? 'video'
    const visibility = cleanString(platformOptions.visibility) ?? 'private'
    const madeForKids = cleanString(platformOptions.madeForKids) ?? 'no'
    if (payload.postType !== postType || payload.visibility !== visibility || payload.madeForKids !== madeForKids) {
      throw new Error('Approved YouTube settings no longer match the authoritative work order.')
    }
  }
  if (session.kind !== 'runneros-electron-partition' || session.platform !== platform
    || session.profile !== order.execution.profileId || session.instanceId !== expectedInstance
    || session.partition !== expectedPartition) {
    throw new Error('Approved social preview contains an ambiguous or incorrect browser session.')
  }
  if (verification.requiredBeforeLiveSubmit !== true || verification.verificationTargetKnown !== true
    || verification.platform !== platform || verification.profile !== order.execution.profileId
    || (!cleanString(verification.expectedHandle) && !cleanString(verification.expectedAccountUrl))) {
    throw new Error('Approved social preview has no exact account verification target.')
  }
  const digest = computeScheduledSocialBrowserActionDigest(preview.dryRun, mediaDigest)
  if (preview.actionDigest !== digest) throw new Error('Approved social action digest changed before browser execution.')
  return platform
}

function resolveApprovedMediaPath(input: ScheduledSocialBrowserExecutionInput, deps: ScheduledSocialBrowserExecutorDeps): string | undefined {
  const path = (deps.resolveMediaPath ?? resolveScheduledSocialBrowserMediaPath)(input.workspaceRootPath, input.order)
  if (!path && input.order.execution.type === 'social-publish' && input.order.execution.platform !== 'x') {
    throw new Error(`${input.order.execution.platform} publish requires one exact resolvable media asset.`)
  }
  return path
}

async function resolveTarget(
  manager: ScheduledSocialBrowserPaneManager,
  instanceId: string,
  platform: NativeSocialPlatform,
  kind: 'caption' | 'upload' | 'submit' | 'audience' | 'visibility',
  selectors: string[],
  text: string[],
): Promise<string> {
  const marker = `runner-social-${kind}`
  const result = asTargetInspection(await manager.evaluate(instanceId, targetScript(platform, kind, selectors, text, marker)))
  if (result.status !== 'ok') {
    throw new Error(`Refusing social publish: ${platform} ${kind} selector is ${result.status}; expected exactly one visible enabled target.`)
  }
  const snapshot = await manager.getAccessibilitySnapshot(instanceId)
  const matches = snapshot.nodes.filter((node) => node.name === marker && !node.disabled)
  if (matches.length !== 1) {
    throw new Error(`Refusing social publish: ${platform} ${kind} accessibility target is ${matches.length === 0 ? 'missing' : 'ambiguous'}.`)
  }
  return matches[0]!.ref
}

async function resolveAndClickAdvance(
  manager: ScheduledSocialBrowserPaneManager,
  instanceId: string,
  platform: NativeSocialPlatform,
  label: string,
): Promise<void> {
  const target = await resolveTarget(manager, instanceId, platform, 'submit', ['button', '[role="button"]'], [label])
  await manager.clickElement(instanceId, target, { waitFor: 'none' })
}

async function waitForSuccessProof(
  manager: ScheduledSocialBrowserPaneManager,
  instanceId: string,
  platform: NativeSocialPlatform,
  contract: PlatformContract,
  deps: ScheduledSocialBrowserExecutorDeps,
): Promise<{ externalUrl: string }> {
  const timeoutMs = Math.max(0, deps.successTimeoutMs ?? 30_000)
  const pollMs = Math.max(1, deps.successPollMs ?? 500)
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const started = Date.now()
  do {
    const proof = asSuccessInspection(await manager.evaluate(instanceId, successScript(platform)))
    if (proof.proven) {
      if (!proof.externalUrl || !contract.successUrl.test(proof.externalUrl)) {
        throw new Error(`Refusing social receipt: ${platform} returned an invalid success URL.`)
      }
      return { externalUrl: proof.externalUrl }
    }
    if (Date.now() - started >= timeoutMs) break
    await sleep(Math.min(pollMs, timeoutMs - (Date.now() - started)))
  } while (Date.now() - started <= timeoutMs)
  throw new Error(`Refusing to record ${platform} publication: final submit occurred but no positive success evidence appeared.`)
}

function identityScript(platform: NativeSocialPlatform): string {
  return `/* runner-social:identity:${platform} */(async () => {
    const clean = (value) => String(value || '').trim();
    const candidates = [];
    const add = (node) => {
      if (!node) return;
      const link = node.closest?.('a[href]') || (node.matches?.('a[href]') ? node : null);
      const text = clean(node.getAttribute?.('aria-label')) + ' ' + clean(node.textContent);
      const handles = [...text.matchAll(/(^|\\s)@([A-Za-z0-9._-]+)/g)].map((match) => '@' + match[2]);
      const accountUrl = link?.href || null;
      if (handles.length === 0 && accountUrl) {
        try { const part = new URL(accountUrl).pathname.split('/').filter(Boolean)[0]; if (part && !['home','explore','messages','notifications','compose','create','upload','feed','watch','shorts'].includes(part)) handles.push('@' + part); } catch {}
      }
      for (const handle of handles.length ? handles : [null]) candidates.push({ handle, accountUrl });
    };
    if (${JSON.stringify(platform)} === 'youtube') {
      document.querySelector('ytd-masthead #avatar-btn, ytcp-header #avatar-btn')?.click();
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    const selectors = ${JSON.stringify(identitySelectors(platform))};
    for (const selector of selectors) document.querySelectorAll(selector).forEach(add);
    const unique = [...new Map(candidates.map((item) => [String(item.handle || '') + '|' + String(item.accountUrl || ''), item])).values()];
    return { loggedIn: unique.length > 0, candidates: unique };
  })()`
}

function targetScript(platform: NativeSocialPlatform, kind: string, selectors: string[], text: string[], marker: string): string {
  return `/* runner-social:target:${platform}:${kind} */(() => {
    const visible = (el) => { const style = getComputedStyle(el); const box = el.getBoundingClientRect(); return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0 && !el.disabled; };
    const nodes = new Set();
    const isUpload = ${JSON.stringify(kind)} === 'upload';
    for (const selector of ${JSON.stringify(selectors)}) document.querySelectorAll(selector).forEach((el) => { if ((isUpload || visible(el)) && !el.disabled) nodes.add(el); });
    const wanted = ${JSON.stringify(text)}.map((value) => value.toLowerCase());
    const filtered = [...nodes].filter((el) => wanted.length === 0 || wanted.includes(String(el.textContent || el.getAttribute('aria-label') || '').trim().toLowerCase()));
    if (filtered.length !== 1) return { status: filtered.length === 0 ? 'missing' : 'ambiguous', count: filtered.length };
    const target = filtered[0]; target.setAttribute('aria-label', ${JSON.stringify(marker)}); target.removeAttribute('aria-hidden');
    if (isUpload && !visible(target)) { target.style.position = 'fixed'; target.style.left = '0'; target.style.top = '0'; target.style.width = '1px'; target.style.height = '1px'; target.style.display = 'block'; target.style.visibility = 'visible'; target.style.opacity = '0.01'; }
    return { status: 'ok', count: 1 };
  })()`
}

function mediaScript(platform: NativeSocialPlatform, previewSelectors: string[]): string {
  return `/* runner-social:media:${platform} */(() => {
    const uploadNode = document.querySelector('[aria-label="runner-social-upload"]');
    const fileNames = uploadNode?.files ? Array.from(uploadNode.files).map((file) => file.name) : [];
    const visible = (el) => { const style = getComputedStyle(el); const box = el.getBoundingClientRect(); return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0; };
    const previews = new Set();
    for (const selector of ${JSON.stringify(previewSelectors)}) document.querySelectorAll(selector).forEach((el) => { if (visible(el)) previews.add(el); });
    return { fileNames, hasMediaPreview: previews.size > 0 };
  })()`
}

function draftScript(platform: NativeSocialPlatform): string {
  return `/* runner-social:draft:${platform} */(() => {
    const captionNode = document.querySelector('[aria-label="runner-social-caption"]');
    const actualCaption = captionNode ? ('value' in captionNode ? captionNode.value : captionNode.textContent) : null;
    const hasMediaPreview = Boolean(document.querySelector('[data-testid="attachments"] [data-testid="media"], [data-testid="attachments"] video, [data-testid="attachments"] img'));
    return { caption: actualCaption, hasMediaPreview };
  })()`
}

function successScript(platform: NativeSocialPlatform): string {
  return `/* runner-social:success:${platform} */(() => {
    const url = location.href;
    const successUrl = ${platformSuccessUrlSource(platform)};
    const evidence = document.querySelector('[role="alert"], [data-testid="toast"], ytcp-video-upload-progress, ytcp-video-upload-completion');
    const linkedUrl = Array.from(evidence?.querySelectorAll?.('a[href]') || []).map((link) => link.href).find((href) => successUrl.test(href)) || null;
    const externalUrl = successUrl.test(url) ? url : linkedUrl;
    return { proven: Boolean(externalUrl), externalUrl };
  })()`
}

function identitySelectors(platform: NativeSocialPlatform): string[] {
  if (platform === 'x') return ['[data-testid="SideNav_AccountSwitcher_Button"]', '[data-testid="AppTabBar_Profile_Link"]']
  if (platform === 'instagram') return ['nav a[href] img[alt*="profile picture" i]', 'header a[href] img[alt*="profile picture" i]']
  if (platform === 'tiktok') return ['[data-e2e="profile-icon"]', '[data-e2e="profile-icon"] a[href]']
  return ['ytd-active-account-header-renderer', 'ytd-active-account-header-renderer a[href]', 'ytcp-account-item', '#channel-handle', '#account-name']
}

function assertExpectedIdentity(identity: IdentityInspection, verification: Record<string, unknown>): void {
  if (!identity.loggedIn || identity.candidates.length === 0) {
    throw new Error('Refusing social publish: no unambiguous logged-in account identity is visible.')
  }
  const expectedHandle = normalizeHandle(verification.expectedHandle)
  const expectedUrl = normalizeComparableUrl(verification.expectedAccountUrl)
  const matches = identity.candidates.filter((candidate) => {
    const handleMatch = expectedHandle && normalizeHandle(candidate.handle) === expectedHandle
    const urlMatch = expectedUrl && normalizeComparableUrl(candidate.accountUrl) === expectedUrl
    return Boolean(handleMatch || urlMatch)
  })
  if (matches.length === 0 || matches.length !== identity.candidates.length) {
    const visible = identity.candidates.map((candidate) => candidate.handle || candidate.accountUrl || '(unknown)').join(', ')
    throw new Error(`Refusing social publish: visible account ${visible} does not exactly and unambiguously match the configured account.`)
  }
}

function platformSuccessUrlSource(platform: NativeSocialPlatform): string {
  return PLATFORM_CONTRACTS[platform].successUrl.toString()
}

type IdentityInspection = { loggedIn: boolean; candidates: Array<{ handle?: string | null; accountUrl?: string | null }> }
type DraftInspection = { caption: string | null; hasMediaPreview: boolean }
type MediaInspection = { fileNames: string[]; hasMediaPreview: boolean }
type TargetInspection = { status: 'ok' | 'missing' | 'ambiguous' }
type SuccessInspection = { proven: boolean; externalUrl?: string }

function asIdentityInspection(value: unknown): IdentityInspection {
  const record = asRecord(value)
  const candidates = Array.isArray(record.candidates) ? record.candidates.map((item) => asRecord(item)) : []
  return { loggedIn: record.loggedIn === true, candidates: candidates.map((item) => ({ handle: cleanString(item.handle), accountUrl: cleanString(item.accountUrl) })) }
}

function asDraftInspection(value: unknown): DraftInspection {
  const record = asRecord(value)
  return { caption: typeof record.caption === 'string' ? record.caption : null, hasMediaPreview: record.hasMediaPreview === true }
}

function asMediaInspection(value: unknown): MediaInspection {
  const record = asRecord(value)
  return {
    fileNames: Array.isArray(record.fileNames) ? record.fileNames.filter((item): item is string => typeof item === 'string') : [],
    hasMediaPreview: record.hasMediaPreview === true,
  }
}

function asTargetInspection(value: unknown): TargetInspection {
  const status = asRecord(value).status
  return { status: status === 'ok' || status === 'ambiguous' ? status : 'missing' }
}

function asSuccessInspection(value: unknown): SuccessInspection {
  const record = asRecord(value)
  return { proven: record.proven === true, externalUrl: cleanString(record.externalUrl) ?? undefined }
}

function platformReceiptId(platform: NativeSocialPlatform, externalUrl: string): string {
  const url = new URL(externalUrl)
  const match = platform === 'x'
    ? /\/status\/(\d+)/.exec(url.pathname)
    : platform === 'instagram'
      ? /\/(?:p|reel)\/([^/]+)/.exec(url.pathname)
      : platform === 'tiktok'
        ? /\/video\/(\d+)/.exec(url.pathname)
        : /\/shorts\/([^/]+)/.exec(url.pathname) ?? cleanString(url.searchParams.get('v'))?.match(/^(.+)$/)
  const id = match?.[1]
  if (!id) throw new Error(`Refusing social receipt: ${platform} success URL has no platform publication id.`)
  return `${platform}:${id}`
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function isNativePlatform(value: string): value is NativeSocialPlatform {
  return value === 'x' || value === 'instagram' || value === 'tiktok' || value === 'youtube'
}

function socialBrowserSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '-')
}

function normalizeHandle(value: unknown): string | null {
  const normalized = cleanString(value)?.replace(/^@+/, '').toLowerCase()
  return normalized || null
}

function normalizeComparableUrl(value: unknown): string | null {
  const text = cleanString(value)
  if (!text) return null
  try {
    const url = new URL(text)
    return `${url.hostname.replace(/^www\./, '').toLowerCase()}${url.pathname.replace(/\/+$/, '')}`
  } catch {
    return null
  }
}

function cleanString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}
