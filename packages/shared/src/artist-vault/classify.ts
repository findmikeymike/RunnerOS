import { basename, extname, join } from 'node:path';
import type {
  VaultAssetClassification,
  VaultAssetKind,
  VaultAssetStatus,
  VaultCategory,
  VaultKindHint,
  VaultRightsStatus,
} from './types.ts';

const AUDIO_EXTENSIONS = new Set(['.wav', '.aiff', '.aif', '.flac', '.mp3', '.m4a']);
const VIDEO_EXTENSIONS = new Set(['.mov', '.mp4', '.m4v', '.avi', '.mkv', '.webm']);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.psd', '.ai', '.tif', '.tiff']);
const DOC_EXTENSIONS = new Set(['.txt', '.md', '.docx', '.pdf', '.rtf']);
const PROJECT_EXTENSIONS = new Set(['.prproj', '.aep', '.fcpxml', '.drp', '.fig', '.sketch']);

export function inferVaultMimeType(fileName: string): string {
  const ext = extname(fileName).toLowerCase();
  if (ext === '.wav') return 'audio/wav';
  if (ext === '.aiff' || ext === '.aif') return 'audio/aiff';
  if (ext === '.flac') return 'audio/flac';
  if (ext === '.mp3') return 'audio/mpeg';
  if (ext === '.m4a') return 'audio/mp4';
  if (ext === '.mov') return 'video/quicktime';
  if (ext === '.mp4' || ext === '.m4v') return 'video/mp4';
  if (ext === '.webm') return 'video/webm';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (ext === '.md') return 'text/markdown';
  if (ext === '.txt') return 'text/plain';
  return 'application/octet-stream';
}

export function classifyVaultAsset(filePath: string, kindHint: VaultKindHint = 'any'): VaultAssetClassification {
  const name = basename(filePath);
  const lower = name.toLowerCase();
  const ext = extname(name).toLowerCase();

  if (kindHint !== 'any') {
    const directory = destinationForVaultKind(kindHint);
    return route(categoryForKind(kindHint), kindHint, directory, 'high', `Chosen as ${displayVaultKind(kindHint)}`);
  }

  if (AUDIO_EXTENSIONS.has(ext)) {
    if (/\b(stem|vocal|instrumental|drums?|bass|guitar|keys?|acapella|acappella)\b/.test(lower)) {
      return route('music', 'stem', 'music/stems', 'high', 'Audio filename suggests stem');
    }
    if (/\b(beat|instrumental|prod|production)\b/.test(lower)) {
      return route('music', 'beat-instrumental', 'music/beats-instrumentals', 'high', 'Audio filename suggests beat or instrumental');
    }
    if (/\b(demo|idea|rough|scratch|draft)\b/.test(lower)) {
      return route('music', 'demo', 'music/demos', 'high', 'Audio filename suggests demo');
    }
    if (/\b(ref|reference|inspo|inspiration)\b/.test(lower)) {
      return route('music', 'mix-reference', 'music/mix-references', 'high', 'Audio filename suggests mix reference');
    }
    return route('music', 'master-final', 'music/masters-finals', ext === '.wav' || ext === '.aiff' || ext === '.aif' || ext === '.flac' ? 'medium' : 'low', 'Audio file');
  }

  if (VIDEO_EXTENSIONS.has(ext)) {
    if (/\b(clip|reel|short|tiktok|content)\b/.test(lower)) {
      return route('video', 'content-clip', 'video/content-clips', 'high', 'Video filename suggests content clip');
    }
    if (/\b(final|export|render|deliverable|finished)\b/.test(lower)) {
      return route('video', 'final-video', 'video/final-videos', 'high', 'Video filename suggests final');
    }
    if (/\b(b-roll|broll|roll)\b/.test(lower)) {
      return route('video', 'b-roll', 'video/b-roll', 'high', 'Video filename suggests b-roll');
    }
    if (/\b(live|performance|show)\b/.test(lower)) {
      return route('video', 'live-performance', 'video/live-performance', 'medium', 'Video filename suggests live performance');
    }
    return route('video', 'raw-footage', 'video/raw-footage', 'medium', 'Video file');
  }

  if (IMAGE_EXTENSIONS.has(ext)) {
    if (/\b(cover|artwork|single-cover|album-cover)\b/.test(lower)) {
      return route('visuals', 'cover-art', 'visuals/cover-art', 'high', 'Image filename suggests cover art');
    }
    if (/(^|[-_\s])(face|face-ref|face-reference|identity-ref|identity-reference|likeness|selfie|selfies|portrait-ref|portrait-reference)([-_\s.]|$)/.test(lower)) {
      return route('visuals', 'face-reference', 'visuals/face-references', 'high', 'Image filename suggests face reference');
    }
    if (/\b(press|photo|headshot|portrait|promo)\b/.test(lower)) {
      return route('visuals', 'artist-photo', 'visuals/artist-photos', 'high', 'Image filename suggests artist photo');
    }
    if (/\b(logo|mark|wordmark)\b/.test(lower)) {
      return route('visuals', 'logo-mark', 'visuals/logos-marks', 'high', 'Image filename suggests logo or mark');
    }
    if (/\b(poster|flyer)\b/.test(lower)) {
      return route('visuals', 'poster-flyer', 'visuals/posters-flyers', 'high', 'Image filename suggests poster or flyer');
    }
    if (/\b(merch|shirt|hoodie)\b/.test(lower)) {
      return route('visuals', 'merch-design', 'visuals/merch-designs', 'high', 'Image filename suggests merch design');
    }
    if (/\b(mood|board|ref|reference|inspo|visual)\b/.test(lower)) {
      return route('references', 'moodboard', 'references/moodboards', 'high', 'Image filename suggests moodboard');
    }
    return route('visuals', 'cover-art', 'visuals/cover-art', 'low', 'Image file');
  }

  if (PROJECT_EXTENSIONS.has(ext)) {
    return route('video', 'video-project', 'video/project-files', 'medium', 'Project file');
  }

  if (DOC_EXTENSIONS.has(ext)) {
    if (/\b(contract|agreement|deal|licen[cs]e|assignment|administration|publishing|distribution|producer|sync)\b|\bterm[-_\s]?sheet\b|\bartist[-_\s]?360\b/.test(lower)) {
      return route('business', 'contract', 'business/contracts', 'high', 'Document filename suggests contract');
    }
    if (/\b(split|splitsheet|split-sheet)\b/.test(lower)) {
      return route('business', 'split-sheet', 'business/splits', 'high', 'Document filename suggests split sheet');
    }
    if (/\b(invoice|receipt)\b/.test(lower)) {
      return route('business', 'invoice', 'business/invoices', 'high', 'Document filename suggests invoice');
    }
    if (/\b(epk|press-kit|presskit)\b/.test(lower)) {
      return route('business', 'epk', 'business/epk', 'high', 'Document filename suggests EPK');
    }
    if (/\b(one-sheet|onesheet)\b/.test(lower)) {
      return route('business', 'one-sheet', 'business/one-sheets', 'high', 'Document filename suggests one-sheet');
    }
    if (/\b(lyric|lyrics|note|notes)\b/.test(lower)) {
      return route('music', 'lyrics-note', 'music/lyrics-notes', 'high', 'Document filename suggests lyrics or notes');
    }
    if (/\b(press|bio|release)\b/.test(lower)) {
      return route('campaigns', 'press-asset', 'campaigns/press', 'high', 'Document filename suggests press material');
    }
    return route('references', 'swipe-file', 'references/swipe-files', 'medium', 'Document file');
  }

  return route('references', 'swipe-file', 'references/swipe-files', 'low', 'Unknown file type');
}

export function destinationForVaultKind(kind: VaultAssetKind): string {
  switch (kind) {
    case 'master-final': return 'music/masters-finals';
    case 'demo': return 'music/demos';
    case 'stem': return 'music/stems';
    case 'beat-instrumental': return 'music/beats-instrumentals';
    case 'mix-reference': return 'music/mix-references';
    case 'lyrics-note': return 'music/lyrics-notes';
    case 'final-video': return 'video/final-videos';
    case 'raw-footage': return 'video/raw-footage';
    case 'content-clip': return 'video/content-clips';
    case 'b-roll': return 'video/b-roll';
    case 'live-performance': return 'video/live-performance';
    case 'video-project': return 'video/project-files';
    case 'cover-art': return 'visuals/cover-art';
    case 'artist-photo': return 'visuals/artist-photos';
    case 'face-reference': return 'visuals/face-references';
    case 'logo-mark': return 'visuals/logos-marks';
    case 'brand-asset': return 'visuals/brand-assets';
    case 'poster-flyer': return 'visuals/posters-flyers';
    case 'merch-design': return 'visuals/merch-designs';
    case 'release-asset': return 'campaigns/release-assets';
    case 'ad-asset': return 'campaigns/ads';
    case 'press-asset': return 'campaigns/press';
    case 'social-pack': return 'campaigns/social-packs';
    case 'contract': return 'business/contracts';
    case 'split-sheet': return 'business/splits';
    case 'rights-record': return 'business/rights-and-royalties/catalog';
    case 'invoice': return 'business/invoices';
    case 'one-sheet': return 'business/one-sheets';
    case 'epk': return 'business/epk';
    case 'moodboard': return 'references/moodboards';
    case 'inspiration': return 'references/inspiration';
    case 'similar-artist-reference': return 'references/similar-artists';
    case 'swipe-file': return 'references/swipe-files';
    default: return 'references/swipe-files';
  }
}

export function categoryForKind(kind: VaultAssetKind): VaultCategory {
  if (kind === 'master-final' || kind === 'demo' || kind === 'stem' || kind === 'beat-instrumental' || kind === 'mix-reference' || kind === 'lyrics-note') return 'music';
  if (kind === 'final-video' || kind === 'raw-footage' || kind === 'content-clip' || kind === 'b-roll' || kind === 'live-performance' || kind === 'video-project') return 'video';
  if (kind === 'cover-art' || kind === 'artist-photo' || kind === 'face-reference' || kind === 'logo-mark' || kind === 'brand-asset' || kind === 'poster-flyer' || kind === 'merch-design') return 'visuals';
  if (kind === 'release-asset' || kind === 'ad-asset' || kind === 'press-asset' || kind === 'social-pack') return 'campaigns';
  if (kind === 'contract' || kind === 'split-sheet' || kind === 'rights-record' || kind === 'invoice' || kind === 'one-sheet' || kind === 'epk') return 'business';
  return 'references';
}

export function defaultVaultPolicy(kind: VaultAssetKind): {
  status: VaultAssetStatus;
  rightsStatus: VaultRightsStatus;
  usableByAgents: boolean;
} {
  if (kind === 'contract' || kind === 'split-sheet' || kind === 'rights-record' || kind === 'invoice') {
    return { status: 'review', rightsStatus: 'private', usableByAgents: false };
  }
  if (kind === 'master-final' || kind === 'final-video' || kind === 'cover-art' || kind === 'artist-photo' || kind === 'face-reference' || kind === 'logo-mark' || kind === 'ad-asset' || kind === 'one-sheet' || kind === 'epk') {
    return { status: 'final', rightsStatus: 'safe-to-use', usableByAgents: true };
  }
  return { status: 'review', rightsStatus: 'safe-to-use', usableByAgents: true };
}

export function displayVaultKind(kind: VaultAssetKind): string {
  return kind.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

export function vaultRelativePath(directory: string, fileName: string): string {
  return join('vault', directory, fileName).replace(/\\/g, '/');
}

function route(
  category: VaultCategory,
  kind: VaultAssetKind,
  directory: string,
  confidence: VaultAssetClassification['confidence'],
  reason: string,
): VaultAssetClassification {
  return { category, kind, directory, confidence, reason };
}
