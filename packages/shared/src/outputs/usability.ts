import { assertUsableOutputAsset } from './asset-usability.ts';
import type { OutputAsset, OutputManifest } from './types.ts';

/** A required deliverable must contain usable work, not just a matching title.
 * Drafts remain valid for review; this does not add an approval requirement. */
export function isOutputUsable(workspaceRootPath: string, output: OutputManifest): boolean {
  if (output.status === 'failed' || output.status === 'cancelled') return false;
  const usableAsset = (asset: OutputAsset): boolean => {
    try { assertUsableOutputAsset(workspaceRootPath, output.id, asset.path); return true; }
    catch { return false; }
  };
  const primary = output.primary ?? output.assets.find(asset => asset.role === 'primary');
  // A preview snippet or incidental receipt cannot replace a missing primary.
  if (primary) return usableAsset(primary);
  if (output.preview?.assetId) {
    const previewAsset = output.assets.find(asset => asset.id === output.preview!.assetId);
    return Boolean(previewAsset && usableAsset(previewAsset));
  }
  if (output.socialVariantSet) {
    return output.socialVariantSet.variants.some(variant => variant.state === 'ready'
      && output.assets.some(asset => asset.id === variant.assetId && usableAsset(asset)));
  }
  const deliverableAssets = output.assets.filter(asset => asset.role !== 'source' && asset.role !== 'thumbnail');
  if (deliverableAssets.length > 0) return deliverableAssets.some(usableAsset);
  // These are legitimate fileless Outputs. A receipt records an outcome; it
  // need not claim that an external action succeeded to be a useful receipt.
  if (output.links.some(link => Boolean(link.url.trim())) || output.receipts.length > 0) return true;
  return Boolean(output.assets.length === 0 && output.preview?.inlineText?.trim()
    && ['markdown', 'text', 'json', 'receipt', 'table', 'chart', 'workflow'].includes(output.preview.mode));
}
