import type { ContextDocMetadata } from '../workspace-context/types.ts';
import {
  RELEASE_KIT_CONTEXT_SLUG,
  type ReleaseKitCategory,
  type ReleaseKitManifest,
} from './types.ts';

const CATEGORY_ORDER: ReleaseKitCategory[] = [
  'audio',
  'artwork',
  'video',
  'images',
  'copy',
  'plans',
  'merch',
  'documents',
  'references',
];

export function releaseKitContextMetadata(): ContextDocMetadata {
  return {
    name: 'Release Kit',
    description: 'Approved campaign assets and documents agents may trust and reuse.',
    routing: { mode: 'broadcast' },
    delivery: 'always',
    enabled: true,
    status: 'active',
    priority: 'high',
  };
}

export function serializeReleaseKitContext(manifest: ReleaseKitManifest): string {
  const items = manifest.items.map((item) => ({
    id: item.id,
    category: item.category,
    subtype: item.subtype,
    title: item.title,
    relativePath: item.relativePath,
    mimeType: item.mimeType,
    sha256: item.sha256,
    status: item.status,
    isPrimary: item.isPrimary,
    source: item.source,
    usage: {
      bestFor: item.usage.bestFor,
      contentRating: item.usage.contentRating,
      notes: item.usage.notes && item.usage.notes.length > 280
        ? `${item.usage.notes.slice(0, 277)}...`
        : item.usage.notes,
      restrictions: item.usage.restrictions,
      updatedAt: item.usage.updatedAt,
      updatedBy: item.usage.updatedBy,
    },
  }));
  const lines = CATEGORY_ORDER.map((category) => {
    const categoryItems = manifest.items.filter((item) => item.category === category);
    const ready = categoryItems.filter((item) => item.status === 'ready').length;
    const primary = categoryItems.find((item) => item.isPrimary && item.status === 'ready');
    return `- ${displayCategory(category)}: ${ready} ready${primary ? `; Primary: ${primary.title} (${primary.id})` : ''}`;
  });
  return [
    'This is the approved campaign Release Kit. Use these snapshots before Campaign Assets or draft Outputs when final campaign material is required.',
    '',
    'Do not treat Release Kit status as permission to publish, send, spend, or change an external account.',
    '',
    '```json',
    JSON.stringify({
      schemaVersion: manifest.schemaVersion,
      workspaceId: manifest.workspaceId,
      campaignId: manifest.campaignId,
      updatedAt: manifest.updatedAt,
      items,
    }, null, 2),
    '```',
    '',
    '## Readiness',
    '',
    ...lines,
  ].join('\n');
}

export function releaseKitContextSlug(): string {
  return RELEASE_KIT_CONTEXT_SLUG;
}

function displayCategory(category: string): string {
  return category.charAt(0).toUpperCase() + category.slice(1);
}
