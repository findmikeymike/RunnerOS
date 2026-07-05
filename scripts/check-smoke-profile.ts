import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const envPath = join(root, '.env.local');
const artistPath = join(root, 'smoke/local/artist-context.md');
const campaignPath = join(root, 'smoke/local/campaign-context.md');

type Check = {
  label: string;
  names: string[];
  required?: boolean;
};

const checks: Check[] = [
  { label: 'LLM: OpenAI', names: ['OPENAI_API_KEY', 'RUNNER_LLM_OPENAI_API_KEY'] },
  { label: 'LLM: Anthropic', names: ['ANTHROPIC_API_KEY', 'RUNNER_LLM_ANTHROPIC_API_KEY'] },
  { label: 'LLM: OpenRouter', names: ['OPENROUTER_API_KEY', 'RUNNER_LLM_OPENROUTER_API_KEY'] },
  { label: 'Google API / YouTube research', names: ['GOOGLE_API_KEY', 'GEMINI_API_KEY', 'YOUTUBE_API_KEY', 'RUNNER_SOURCE_YOUTUBE_RESEARCH_API_KEY'] },
  { label: 'fal creative generation', names: ['FAL_KEY', 'FAL_API_KEY', 'RUNNER_SOURCE_FAL_API_KEY'] },
  { label: 'ElevenLabs voice', names: ['ELEVENLABS_API_KEY', 'RUNNER_SOURCE_ELEVENLABS_API_KEY'] },
  { label: 'Inworld voice/characters', names: ['INWORLD_API_KEY', 'RUNNER_SOURCE_INWORLD_API_KEY'] },
  { label: 'HeyGen video', names: ['HEYGEN_API_KEY', 'RUNNER_SOURCE_HEYGEN_API_KEY'] },
  { label: 'Resend email', names: ['RESEND_API_KEY', 'RUNNER_SOURCE_RESEND_API_KEY'] },
  { label: 'Shopify commerce', names: ['SHOPIFY_ADMIN_API_TOKEN', 'RUNNER_SOURCE_SHOPIFY_API_KEY'] },
  { label: 'Printify merch', names: ['PRINTIFY_API_TOKEN', 'RUNNER_SOURCE_PRINTIFY_API_KEY'] },
  { label: 'Meta / Instagram', names: ['META_ACCESS_TOKEN', 'RUNNER_SOURCE_META_BEARER_TOKEN'] },
  { label: 'WhatsApp Business', names: ['WHATSAPP_ACCESS_TOKEN', 'RUNNER_MESSAGING_WHATSAPP_TOKEN'] },
];

function parseEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const text = readFileSync(path, 'utf8');
  const env: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const value = match[2].trim().replace(/^['"]|['"]$/g, '');
    env[match[1]] = value;
  }
  return env;
}

function hasRealValue(value: string | undefined): boolean {
  if (!value) return false;
  const lowered = value.toLowerCase();
  return !lowered.includes('your-') && !lowered.includes('replace-me') && !lowered.includes('todo');
}

const fileEnv = parseEnvFile(envPath);
const mergedEnv = { ...process.env, ...fileEnv };
const present = checks.filter((check) => check.names.some((name) => hasRealValue(mergedEnv[name])));

console.log('Smoke profile check');
console.log(`.env.local: ${existsSync(envPath) ? 'present' : 'missing'}`);
console.log(`artist context: ${existsSync(artistPath) ? 'present' : 'missing'}`);
console.log(`campaign context: ${existsSync(campaignPath) ? 'present' : 'missing'}`);
console.log('');
console.log('Detected services:');
for (const check of checks) {
  const ok = check.names.some((name) => hasRealValue(mergedEnv[name]));
  console.log(`${ok ? 'yes' : ' no'}  ${check.label}`);
}

if (present.length === 0) {
  console.log('');
  console.log(
    existsSync(envPath)
      ? 'No real service keys detected. Fill .env.local only with the services you want to test.'
      : 'No real service keys detected. Copy smoke/templates/env.local.example to .env.local and fill only what you want to test.',
  );
}
