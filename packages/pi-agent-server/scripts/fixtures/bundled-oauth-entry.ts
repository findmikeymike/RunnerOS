import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex';
import { registerPiBundledOAuthFlows } from '../../src/bundled-oauth.ts';

registerPiBundledOAuthFlows();

const oauth = openaiCodexProvider().auth.oauth;
if (!oauth) throw new Error('OpenAI Codex OAuth provider is unavailable');

const auth = await oauth.toAuth({
  type: 'oauth',
  access: 'smoke-access-token',
  refresh: 'smoke-refresh-token',
  expires: Date.now() + 60 * 60 * 1000,
});

if (auth.apiKey !== 'smoke-access-token') {
  throw new Error('OpenAI Codex OAuth did not preserve the access token');
}

console.log('Bundled OAuth auth derived');
