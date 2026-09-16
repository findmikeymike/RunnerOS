import { defaultUrlTransform } from 'react-markdown'

/** Only passive, workspace-scoped result destinations may enter the app from chat. */
export function isReadOnlyAppNavigationUrl(url: string): boolean {
  return /^(?:artistos|craftagents):\/\/workspace\/[a-zA-Z0-9_-]+\/(?:agents(?:\/agent\/[a-zA-Z0-9_-]+)?|workflows(?:\/[a-zA-Z0-9_-]+)?|automations(?:\/automation\/[a-zA-Z0-9_-]+)?)$/.test(url)
}

export function normalMarkdownUrl(url: string, key: string): string {
  if (key === 'href' && isReadOnlyAppNavigationUrl(url)) return url
  return defaultUrlTransform(url)
}
