/** Bounded, platform-specific preparation. None of these scripts clicks Publish/Post/Share. */
const helpers = `
  const visible = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden'; };
  const text = el => String(el?.innerText || el?.textContent || '').trim();
  const buttons = label => [...document.querySelectorAll('button,[role="button"]')].filter(el => visible(el) && !el.disabled && text(el) === label);
  const clickOne = label => { const matches = buttons(label); if (matches.length !== 1) return false; matches[0].click(); return true; };
  const pause = () => new Promise(resolve => setTimeout(resolve, 250));
`

export function instagramReelsNotice(): string {
  return `
    const notice = [...document.querySelectorAll('[role="dialog"]')].filter(el => el.textContent?.includes('Video posts are now shared as reels'));
    let noticeRoot = notice.length === 1 ? notice[0] : null;
    if (!noticeRoot) {
      const heading = [...document.querySelectorAll('h1,h2,h3,span,div')].find(el => el.textContent?.trim() === 'Video posts are now shared as reels');
      for (let parent = heading, depth = 0; parent && depth < 8; parent = parent.parentElement, depth++) {
        const ok = [...parent.querySelectorAll('button,[role="button"]')].filter(el => el.textContent?.trim() === 'OK' && !el.disabled);
        if (ok.length === 1) { noticeRoot = parent; break; }
      }
    }
    if (noticeRoot) {
      const ok = [...noticeRoot.querySelectorAll('button,[role="button"]')].filter(el => el.textContent?.trim() === 'OK' && !el.disabled);
      if (ok.length === 1 && ok[0].getBoundingClientRect().width > 0) ok[0].click();
    }
  `
}

export function instagramAdvanceScript(): string {
  return `/* runner-social:compose:instagram */(async () => {
    ${helpers}
    let lastStage = '';
    for (let attempt = 0; attempt < 80; attempt++) {
      ${instagramReelsNotice()}
      const captions = [...document.querySelectorAll('textarea[aria-label*="caption" i],[contenteditable="true"][aria-label*="caption" i]')].filter(visible);
      if (captions.length === 1 && buttons('Share').length === 1) return { ready: true };
      const headings = [...document.querySelectorAll('h1,h2,h3,[role="heading"]')].filter(visible).map(text);
      const stage = headings.includes('Crop') ? 'Crop' : headings.includes('Edit') ? 'Edit' : '';
      if (stage && stage !== lastStage && clickOne('Next')) lastStage = stage;
      await pause();
    }
    return { ready: false, reason: 'Instagram did not reach the caption screen after Crop/Edit.' };
  })()`
}

export function instagramDestinationScript(): string {
  return `/* runner-social:destinations:instagram */(async () => {
    ${helpers}
    let toggled = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      const confirmation = buttons('Don’t share this reel').concat(buttons("Don't share this reel"));
      if (confirmation.length === 1 && toggled) { confirmation[0].click(); await pause(); continue; }
      // Find the smallest Facebook row with exactly one switch. Never touch AI labels or global preferences.
      const candidates = [...document.querySelectorAll('[role="switch"],input[type="checkbox"]')].filter(visible).filter(control => {
        for (let node = control.parentElement, depth = 0; node && depth < 6; node = node.parentElement, depth++) {
          if (node.querySelectorAll('[role="switch"],input[type="checkbox"]').length !== 1) break;
          if (/Facebook/.test(text(node)) || node.querySelector('img[alt*="Facebook"],svg[aria-label*="Facebook"]')) return true;
        }
        return false;
      });
      if (candidates.length > 1) return { ready: false, reason: 'Ambiguous Facebook destination controls.' };
      if (candidates.length === 1) {
        const control = candidates[0];
        const checked = control.getAttribute('aria-checked') ?? (typeof control.checked === 'boolean' ? String(control.checked) : null);
        if (checked === 'false' && confirmation.length === 0 && buttons('Cancel').length === 0) return { ready: true };
        if (checked === 'true' && !toggled) { control.click(); toggled = true; }
      } else {
        const expand = [...document.querySelectorAll('button,[role="button"]')].filter(el => visible(el) && /^Share to(?:\\s|$)/.test(text(el)));
        const captions = [...document.querySelectorAll('[aria-label="runner-social-caption"],textarea[aria-label*="caption" i],[contenteditable="true"][aria-label*="caption" i]')].filter(visible);
        if (attempt >= 3 && !expand.length && !/Facebook/.test(document.body.innerText) && captions.length === 1 && buttons('Share').length === 1) return { ready: true };
        if (expand.length === 1 && (expand[0].getAttribute('aria-expanded') === 'false' || expand[0].querySelector('[aria-label*="Down chevron"],img[alt*="Down chevron"]'))) expand[0].click();
        // No row is not evidence of an off destination; wait, then report a precise problem.
      }
      await pause();
    }
    return { ready: false, reason: 'Could not verify Facebook sharing is off for this Instagram draft.' };
  })()`
}

export function tikTokDraftRecoveryScript(fileName: string, caption: string): string {
  return `/* runner-social:recovery:tiktok */(async () => {
    ${helpers}
    let restoring = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      const body = document.body.innerText;
      if (/A video you were editing wasn.t saved/.test(body)) {
        if (!restoring && clickOne('Continue')) restoring = true;
        await pause(); continue;
      }
      const editors = [...document.querySelectorAll('[contenteditable="true"][role="textbox"],.public-DraftEditor-content[contenteditable="true"]')].filter(visible);
      const replace = buttons('Replace');
      if (editors.length || /Uploaded[（(]/.test(body)) {
        if (editors.length !== 1 || !/Uploaded[（(]/.test(body)) { await pause(); continue; }
        const name = ${JSON.stringify(fileName)};
        const allowedCaptions = [${JSON.stringify(caption)}, name, name.replace(/\\.[^.]+$/, '')];
        const matchingName = body.split(/\\r?\\n/).some(line => line.trim() === name);
        if (!matchingName || editors.length !== 1 || !allowedCaptions.includes(text(editors[0]))) {
          return { ready: false, reason: 'TikTok contains a different unfinished draft. It was preserved; finish or save it in the account browser before retrying this scheduled post.' };
        }
        // A filename is not proof of bytes. Reattach the host-verified file through Replace.
        if (replace.length === 1) { replace[0].click(); return { ready: true, replacing: true }; }
      } else if (!restoring && document.querySelector('input[type="file"]')) {
        return { ready: true, replacing: false };
      }
      await pause();
    }
    return { ready: false, reason: 'TikTok did not expose a ready upload or matching draft replacement control.' };
  })()`
}
