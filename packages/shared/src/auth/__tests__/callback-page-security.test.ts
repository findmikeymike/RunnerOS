import { describe, expect, it } from 'bun:test';

import {
  generateCallbackPage,
  OAUTH_CALLBACK_PAGE_HEADERS,
} from '../callback-page.ts';

describe('OAuth callback page security', () => {
  it('escapes every dynamic value and includes no executable script', () => {
    const html = generateCallbackPage({
      title: '<img src=x onerror=titleAttack()>',
      isSuccess: false,
      errorDetail: '<img src=x onerror=detailAttack()>',
      deeplinkUrl: 'runner://done" onclick="linkAttack()',
    });

    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('onclick="linkAttack()"');
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;img src=x onerror=titleAttack()&gt;');
    expect(html).toContain('&lt;img src=x onerror=detailAttack()&gt;');
    expect(html).toContain('runner://done&quot; onclick=&quot;linkAttack()');
  });

  it('ships restrictive browser response headers', () => {
    expect(OAUTH_CALLBACK_PAGE_HEADERS['Content-Security-Policy']).toContain("default-src 'none'");
    expect(OAUTH_CALLBACK_PAGE_HEADERS['Content-Security-Policy']).toContain("frame-ancestors 'none'");
    expect(OAUTH_CALLBACK_PAGE_HEADERS['X-Content-Type-Options']).toBe('nosniff');
    expect(OAUTH_CALLBACK_PAGE_HEADERS['Cache-Control']).toBe('no-store');
  });

  it('does not claim the connection is complete before token storage finishes', () => {
    const html = generateCallbackPage({
      title: 'Authorization Complete',
      isSuccess: true,
    });

    expect(html).toContain('Authorization received');
    expect(html).toContain('while it finishes connecting');
    expect(html).not.toContain('Authorization successful');
  });
});
