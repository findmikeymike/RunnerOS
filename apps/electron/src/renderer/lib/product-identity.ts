export type RendererProductVariant = 'runner' | 'artist-os';

const variant = import.meta.env.VITE_CRAFT_PRODUCT_VARIANT === 'artist-os'
  ? 'artist-os'
  : 'runner';

export const RENDERER_PRODUCT_VARIANT: RendererProductVariant = variant;
export const INTERNAL_DEEPLINK_SCHEME = variant === 'artist-os' ? 'artistos' : 'craftagents';
export const DEFAULT_RPC_PORT = variant === 'artist-os' ? 9200 : 9100;
export const DEFAULT_TRIGGER_PORT = variant === 'artist-os' ? 9201 : 9101;
export const PRODUCT_DATA_DIR_NAME = variant === 'artist-os' ? '.artist-os' : '.craft-agent';
export const PRODUCT_DATA_HOME = `~/${PRODUCT_DATA_DIR_NAME}`;
export const PRODUCT_AGENTS_HOME = variant === 'artist-os'
  ? `${PRODUCT_DATA_HOME}/libraries/agents`
  : '~/.agents';

export function productDataPath(path = ''): string {
  return `${PRODUCT_DATA_HOME}/${path.replace(/^\/+/, '')}`.replace(/\/$/, '');
}

export function productDeepLink(path: string): string {
  return `${INTERNAL_DEEPLINK_SCHEME}://${path.replace(/^\/+/, '')}`;
}
