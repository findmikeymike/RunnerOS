export const INWORLD_API_KEY_NAME = 'INWORLD_API_KEY' as const;
export const INWORLD_VOICE_ID_NAME = 'INWORLD_VOICE_ID' as const;

export const INWORLD_LEGACY_API_KEY_NAMES = [
  'INWORLD_RUNTIME_KEY',
  'INWORLD_TTS_API_KEY',
  'SQUAD_INWORLD_TTS_API_KEY',
] as const;

export const INWORLD_LEGACY_VOICE_ID_NAMES = [
  'INWORLD_TTS_VOICE_ID',
  'SQUAD_INWORLD_TTS_VOICE_ID',
] as const;

export const INWORLD_API_KEY_NAMES = [
  INWORLD_API_KEY_NAME,
  ...INWORLD_LEGACY_API_KEY_NAMES,
] as const;

export const INWORLD_VOICE_ID_NAMES = [
  INWORLD_VOICE_ID_NAME,
  ...INWORLD_LEGACY_VOICE_ID_NAMES,
] as const;

type SecretLoader = (name: string) => Promise<string | null | undefined>;
type Environment = Readonly<Record<string, string | undefined>>;

async function resolveNamedValue(
  names: readonly string[],
  loadSecret: SecretLoader,
  environment: Environment,
): Promise<string | null> {
  for (const name of names) {
    const stored = (await loadSecret(name))?.trim();
    if (stored) return stored;
    const envValue = environment[name]?.trim();
    if (envValue) return envValue;
  }
  return null;
}

export function resolveInworldApiKey(
  loadSecret: SecretLoader,
  environment: Environment,
): Promise<string | null> {
  return resolveNamedValue(INWORLD_API_KEY_NAMES, loadSecret, environment);
}

export function resolveInworldVoiceId(
  loadSecret: SecretLoader,
  environment: Environment,
): Promise<string | null> {
  return resolveNamedValue(INWORLD_VOICE_ID_NAMES, loadSecret, environment);
}

export function buildInworldBasicAuthorization(apiKey: string): string {
  const trimmed = apiKey.trim();
  const withoutScheme = trimmed.replace(/^Basic\s+/i, '');
  const credentials = withoutScheme.includes(':')
    ? Buffer.from(withoutScheme, 'utf8').toString('base64')
    : withoutScheme;
  return `Basic ${credentials}`;
}
