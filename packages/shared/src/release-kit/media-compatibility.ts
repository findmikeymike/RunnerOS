import { extname } from 'node:path';
import type { ReleaseKitCategory } from './types.ts';

type MediaKind = 'audio' | 'image' | 'video';
const EXTENSIONS: Record<MediaKind, Set<string>> = {
  audio: new Set(['.wav', '.wave', '.aif', '.aiff', '.aifc', '.flac', '.mp3', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.wma']),
  image: new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.tif', '.tiff', '.bmp', '.svg', '.avif', '.heic', '.heif', '.psd', '.ai', '.eps']),
  video: new Set(['.mp4', '.mov', '.m4v', '.webm', '.avi', '.mkv', '.mpeg', '.mpg', '.ogv', '.wmv', '.3gp']),
};

/** Metadata compatibility, not codec validation. MIME must come from the resolved source. */
export function assertReleaseKitMediaCompatibility(category: ReleaseKitCategory, sourcePath: string, sourceMimeType?: string): void {
  const expected: MediaKind | undefined = category === 'audio' ? 'audio' : category === 'video' ? 'video'
    : category === 'artwork' || category === 'images' ? 'image' : undefined;
  if (!expected) return; // Documents, references, plans, merch and copy may contain any file.
  const extension = extname(sourcePath).toLowerCase();
  const extensionKind = (Object.keys(EXTENSIONS) as MediaKind[]).find(kind => EXTENSIONS[kind].has(extension));
  const mime = sourceMimeType?.split(';')[0]?.trim().toLowerCase();
  const mimeKind = mime?.startsWith('audio/') ? 'audio' : mime?.startsWith('image/') ? 'image' : mime?.startsWith('video/') ? 'video' : undefined;
  // A known extension cannot be overridden by caller-supplied or stale MIME.
  // Missing/unknown extensions require source-owned media MIME; text/PDF never qualify.
  const knownNonMedia = /\.(txt|md|markdown|pdf|json|csv|html?|docx?|xlsx?|pptx?|zip)$/i.test(sourcePath);
  if (extensionKind ? extensionKind !== expected || Boolean(mimeKind && mimeKind !== expected)
    : knownNonMedia || mimeKind !== expected) {
    throw new Error(`Release Kit ${category} requires a compatible ${expected} file. Choose another file or category.`);
  }
}
