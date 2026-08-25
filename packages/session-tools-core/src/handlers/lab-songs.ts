import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { errorResponse } from '../response.ts';

export type LabSongStatus = 'working' | 'done';
export type LabSongDestination = 'rough_pad' | 'remember' | 'section';
export type LabSongWriteMode = 'append' | 'replace';

export interface LabSongCaptureInput {
  text: string;
  selectionLabel?: string;
  destination?: LabSongDestination;
  sectionId?: string;
  sectionLabel?: string;
  mode?: LabSongWriteMode;
  sourceSessionId?: string;
  sourceAgentSlug?: string;
  sourceMessageId?: string;
  note?: string;
}

export interface CreateLabSongToolInput {
  title: string;
  project?: string;
  status?: LabSongStatus;
  focused?: boolean;
  captures?: LabSongCaptureInput[];
}

export interface SaveLabLyricsToolInput {
  songId?: string;
  songTitle?: string;
  createIfMissing?: {
    title: string;
    project?: string;
    status?: LabSongStatus;
    focused?: boolean;
  };
  captures: LabSongCaptureInput[];
}

export interface ListLabSongsToolInput {
  search?: string;
  project?: string;
  status?: LabSongStatus;
  focused?: boolean;
  limit?: number;
}

export interface LabSongToolResult {
  ok: boolean;
  song?: unknown;
  songs?: unknown[];
  total?: number;
  error?: string;
}

function successResponse(message: string, result: LabSongToolResult): ToolResult {
  return {
    content: [{ type: 'text', text: message }],
    structuredContent: result as unknown as Record<string, unknown>,
    isError: false,
  };
}

function assertCaptures(captures: LabSongCaptureInput[] | undefined): string | null {
  if (!captures) return null;
  if (!Array.isArray(captures)) return 'captures must be an array.';
  for (const [idx, capture] of captures.entries()) {
    if (!capture || typeof capture.text !== 'string' || !capture.text.trim()) {
      return `captures[${idx}].text must be the exact lyric excerpt to save.`;
    }
    if (capture.destination === 'section' && !capture.sectionId?.trim() && !capture.sectionLabel?.trim()) {
      return `captures[${idx}] destination "section" requires sectionId or sectionLabel.`;
    }
  }
  return null;
}

export async function handleCreateLabSong(
  ctx: SessionToolContext,
  args: CreateLabSongToolInput,
): Promise<ToolResult> {
  if (!args.title?.trim()) return errorResponse('title is required.');
  const captureError = assertCaptures(args.captures);
  if (captureError) return errorResponse(captureError);
  if (!ctx.createLabSong) return errorResponse('create_lab_song is not available in this context.');

  try {
    const song = await ctx.createLabSong(args);
    return successResponse(`Created Lab song "${args.title.trim()}".`, { ok: true, song });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error));
  }
}

export async function handleSaveLabLyrics(
  ctx: SessionToolContext,
  args: SaveLabLyricsToolInput,
): Promise<ToolResult> {
  const captureError = assertCaptures(args.captures);
  if (captureError) return errorResponse(captureError);
  if (!args.captures?.length) return errorResponse('captures must include at least one exact excerpt.');
  if (!args.songId?.trim() && !args.songTitle?.trim() && !args.createIfMissing?.title?.trim()) {
    return errorResponse('Provide songId, songTitle, or createIfMissing.title.');
  }
  if (!ctx.saveLabLyrics) return errorResponse('save_lab_lyrics is not available in this context.');

  try {
    const song = await ctx.saveLabLyrics(args);
    return successResponse(`Saved ${args.captures.length} excerpt${args.captures.length === 1 ? '' : 's'} to Lab song.`, { ok: true, song });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error));
  }
}

export async function handleListLabSongs(
  ctx: SessionToolContext,
  args: ListLabSongsToolInput = {},
): Promise<ToolResult> {
  if (!ctx.listLabSongs) return errorResponse('list_lab_songs is not available in this context.');

  try {
    const songs = await ctx.listLabSongs(args);
    return successResponse(`Found ${songs.length} Lab song${songs.length === 1 ? '' : 's'}.`, {
      ok: true,
      songs,
      total: songs.length,
    });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error));
  }
}
