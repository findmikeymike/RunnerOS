#!/usr/bin/env npx tsx
/** Spotify Delta Brief — compare the latest two compatible snapshots. */

import { promises as fs } from "node:fs";
import path from "node:path";

type OptionalNumber = number | null | undefined;
type Track = { id?: string; name: string; streams?: OptionalNumber };
type Playlist = { name: string; type?: string; listeners?: OptionalNumber };
type Snapshot = {
  snapshotDate: string;
  dataSource?: string;
  windowDays?: OptionalNumber;
  artist: { name?: string };
  metrics: {
    streams?: OptionalNumber;
    listeners?: OptionalNumber;
    followers?: OptionalNumber;
    saves?: OptionalNumber;
    saveRate?: OptionalNumber;
    skipRate?: OptionalNumber;
  };
  tracks: Track[];
  playlistsDriving: Playlist[];
  sources: Record<string, number>;
  partial: boolean;
  errors: string[];
};

type CliOptions = { snapshotsDir: string; outDir: string; noiseFloorPct: number };

const DEFAULT_SNAPSHOTS_DIR = "data/spotify/snapshots";
const DEFAULT_OUT_DIR = "data/spotify/briefs";

function usage() {
  return `Usage:
  "\${CRAFT_BUN:-bun}" "$HOME/.agents/skills/spotify-analytics-snapshot/scripts/delta-brief.ts" [options]

Options:
  --snapshots-dir <path>   Default: ${DEFAULT_SNAPSHOTS_DIR}
  --out-dir <path>         Default: ${DEFAULT_OUT_DIR}
  --noise-floor <pct>      Movements below this percent flagged as noise. Default: 10
  --help
`;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { snapshotsDir: DEFAULT_SNAPSHOTS_DIR, outDir: DEFAULT_OUT_DIR, noiseFloorPct: 10 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`Missing value for ${arg}`);
      return value;
    };
    if (arg === "--help" || arg === "-h") { console.log(usage()); process.exit(0); }
    else if (arg === "--snapshots-dir") options.snapshotsDir = next();
    else if (arg === "--out-dir") options.outDir = next();
    else if (arg === "--noise-floor") options.noiseFloorPct = Number(next());
    else if (arg !== "--") throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isFinite(options.noiseFloorPct) || options.noiseFloorPct < 0) {
    throw new Error("--noise-floor must be a nonnegative number.");
  }
  return options;
}

async function listSnapshotFiles(dir: string): Promise<string[]> {
  const stat = await fs.stat(dir).catch(() => null);
  if (!stat?.isDirectory()) return [];
  return (await fs.readdir(dir))
    .filter((name) => /^\d{4}-\d{2}-\d{2}(?:-(?:s4a|web-api))?\.json$/.test(name))
    .sort();
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function readSnapshot(filePath: string): Promise<Snapshot> {
  const parsed = JSON.parse(await fs.readFile(filePath, "utf8")) as unknown;
  const root = record(parsed);
  const snapshotDate = typeof root.snapshotDate === "string" ? root.snapshotDate : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate)) throw new Error(`Invalid snapshotDate in ${filePath}.`);
  const metricInput = record(root.metrics);
  const artistInput = record(root.artist);
  const sourceInput = record(root.sources);
  const sources = Object.fromEntries(Object.entries(sourceInput)
    .map(([key, value]) => [key, finiteNumber(value)] as const)
    .filter((entry): entry is readonly [string, number] => entry[1] !== undefined));
  const tracks = Array.isArray(root.tracks) ? root.tracks.flatMap((value) => {
    const item = record(value);
    const name = typeof item.name === "string" ? item.name.trim() : "";
    return name ? [{ id: typeof item.id === "string" ? item.id : undefined, name, streams: finiteNumber(item.streams) }] : [];
  }) : [];
  const playlistsDriving = Array.isArray(root.playlistsDriving) ? root.playlistsDriving.flatMap((value) => {
    const item = record(value);
    const name = typeof item.name === "string" ? item.name.trim() : "";
    return name ? [{ name, type: typeof item.type === "string" ? item.type : undefined, listeners: finiteNumber(item.listeners) }] : [];
  }) : [];

  return {
    snapshotDate,
    dataSource: typeof root.dataSource === "string" ? root.dataSource : undefined,
    windowDays: finiteNumber(root.windowDays),
    artist: { name: typeof artistInput.name === "string" ? artistInput.name : undefined },
    metrics: {
      streams: finiteNumber(metricInput.streams), listeners: finiteNumber(metricInput.listeners),
      followers: finiteNumber(metricInput.followers), saves: finiteNumber(metricInput.saves),
      saveRate: finiteNumber(metricInput.saveRate), skipRate: finiteNumber(metricInput.skipRate),
    },
    tracks,
    playlistsDriving,
    sources,
    partial: root.partial === true,
    errors: Array.isArray(root.errors) ? root.errors.filter((value): value is string => typeof value === "string") : [],
  };
}

function pctChange(prev: number, curr: number): { abs: number; pct: number | null } {
  const abs = curr - prev;
  return { abs, pct: prev === 0 ? (curr === 0 ? 0 : null) : (abs / prev) * 100 };
}

function fmtPct(pct: number | null): string {
  if (pct === null) return "from 0";
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

function noiseTag(pct: number | null, floor: number): string {
  return pct !== null && Math.abs(pct) < floor ? " _(below noise floor — likely insignificant)_" : "";
}

function metricDelta(prev: OptionalNumber, curr: OptionalNumber, label: string, floor: number): string {
  if (prev === undefined || prev === null || curr === undefined || curr === null) return `- ${label}: delta unavailable (not captured in both snapshots)`;
  const delta = pctChange(prev, curr);
  return `- ${label}: ${prev} → ${curr} (${delta.abs >= 0 ? "+" : ""}${delta.abs}, ${fmtPct(delta.pct)})${noiseTag(delta.pct, floor)}`;
}

function rateDelta(prev: OptionalNumber, curr: OptionalNumber, label: string): string | null {
  if (prev === undefined || prev === null || curr === undefined || curr === null) return null;
  const abs = curr - prev;
  return `- ${label}: ${(prev * 100).toFixed(2)}% → ${(curr * 100).toFixed(2)}% (${abs >= 0 ? "+" : ""}${(abs * 100).toFixed(2)} pts)`;
}

function trackKey(track: Track): string { return track.id || track.name.toLowerCase(); }

function topMovers(prev: Snapshot, curr: Snapshot, limit = 3) {
  const prevMap = new Map(prev.tracks.filter((track) => track.streams !== undefined).map((track) => [trackKey(track), track.streams as number]));
  return curr.tracks.flatMap((track) => {
    if (track.streams === undefined || track.streams === null) return [];
    const previous = prevMap.get(trackKey(track));
    if (previous === undefined) return [];
    const delta = pctChange(previous, track.streams);
    return [{ name: track.name, delta: delta.abs, pct: delta.pct }];
  }).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, limit);
}

function playlistDiff(prev: Snapshot, curr: Snapshot) {
  const prevNames = new Set(prev.playlistsDriving.map((playlist) => playlist.name));
  const currNames = new Set(curr.playlistsDriving.map((playlist) => playlist.name));
  return {
    added: curr.playlistsDriving.filter((playlist) => !prevNames.has(playlist.name)),
    removed: prev.playlistsDriving.filter((playlist) => !currNames.has(playlist.name)),
  };
}

function buildBrief(prev: Snapshot, curr: Snapshot, noiseFloorPct: number): string {
  const lines = [`# Spotify Delta Brief — ${curr.snapshotDate}${curr.partial ? " (current snapshot is partial)" : ""}`, ""];
  lines.push(`Comparing **${prev.snapshotDate}** → **${curr.snapshotDate}** for ${curr.artist.name || prev.artist.name || "the connected artist"}.`, "");
  if (curr.partial && curr.errors.length) lines.push(`> **Partial snapshot.** Errors: ${curr.errors.join("; ")}`, "");

  lines.push("## Aggregate Metrics", "");
  lines.push(metricDelta(prev.metrics.streams, curr.metrics.streams, "Streams", noiseFloorPct));
  lines.push(metricDelta(prev.metrics.listeners, curr.metrics.listeners, "Listeners", noiseFloorPct));
  lines.push(metricDelta(prev.metrics.followers, curr.metrics.followers, "Followers", noiseFloorPct));
  lines.push(metricDelta(prev.metrics.saves, curr.metrics.saves, "Saves", noiseFloorPct));
  const rates = [rateDelta(prev.metrics.saveRate, curr.metrics.saveRate, "Save rate"), rateDelta(prev.metrics.skipRate, curr.metrics.skipRate, "Skip rate")].filter(Boolean);
  lines.push(...rates as string[], "");

  lines.push("## Top Track Movement", "");
  const movers = topMovers(prev, curr);
  lines.push(...(movers.length ? movers.map((mover) => `- ${mover.name}: ${mover.delta >= 0 ? "+" : ""}${mover.delta} streams (${fmtPct(mover.pct)})`) : ["- No comparable per-track stream counts captured."]), "");

  const { added, removed } = playlistDiff(prev, curr);
  lines.push("## Playlist Changes", "");
  if (!prev.playlistsDriving.length && !curr.playlistsDriving.length) lines.push("- Playlist-driving data was not captured.");
  else if (!added.length && !removed.length) lines.push("- No additions or removals.");
  if (added.length) lines.push("**Added:**", ...added.map((playlist) => `- ${playlist.name}${playlist.type ? ` (${playlist.type})` : ""}`));
  if (removed.length) lines.push("**Removed (anomaly — investigate):**", ...removed.map((playlist) => `- ${playlist.name}${playlist.type ? ` (${playlist.type})` : ""}`));
  lines.push("");

  lines.push("## Source Of Streams", "");
  const sourceKeys = [...new Set([...Object.keys(prev.sources), ...Object.keys(curr.sources)])].sort();
  lines.push(...(sourceKeys.length ? sourceKeys.map((key) => metricDelta(prev.sources[key], curr.sources[key], key, noiseFloorPct)) : ["- Source-of-streams data was not captured."]), "");

  lines.push("## Interpretation", "");
  const streamDelta = prev.metrics.streams !== undefined && curr.metrics.streams !== undefined
    ? pctChange(prev.metrics.streams as number, curr.metrics.streams as number).pct : null;
  if (streamDelta !== null && Math.abs(streamDelta) >= noiseFloorPct) {
    lines.push(`- Streams ${streamDelta > 0 ? "up" : "down"} ${Math.abs(streamDelta).toFixed(1)}%. Review track and source movement before acting.`);
  } else if (removed.length) lines.push(`- ${removed.length} playlist${removed.length === 1 ? "" : "s"} dropped; investigate the change.`);
  else lines.push("- No confirmed movement above the noise floor in the comparable captured metrics.");
  lines.push("");
  return lines.join("\n");
}

function baselineBrief(snapshot: Snapshot): string {
  const metric = (label: string, value: OptionalNumber) => `- ${label}: ${value ?? "not captured"}`;
  return [`# Spotify Delta Brief — ${snapshot.snapshotDate}`, "", "No prior comparable snapshot. Baseline captured.", "",
    metric("Streams", snapshot.metrics.streams), metric("Listeners", snapshot.metrics.listeners),
    metric("Followers", snapshot.metrics.followers), metric("Saves", snapshot.metrics.saves), ""].join("\n");
}

function compatible(previous: Snapshot, current: Snapshot): boolean {
  if ((previous.dataSource || "unknown") !== (current.dataSource || "unknown")) return false;
  return previous.windowDays !== undefined
    && current.windowDays !== undefined
    && previous.windowDays === current.windowDays;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const files = await listSnapshotFiles(options.snapshotsDir);
  if (!files.length) throw new Error(`No snapshots found in ${options.snapshotsDir}.`);
  const snapshots = await Promise.all(files.map(async (file) => ({ file, snapshot: await readSnapshot(path.join(options.snapshotsDir, file)) })));
  snapshots.sort((a, b) => a.snapshot.snapshotDate.localeCompare(b.snapshot.snapshotDate) || a.file.localeCompare(b.file));
  const current = snapshots.at(-1);
  if (!current) throw new Error(`No snapshots found in ${options.snapshotsDir}.`);
  const previous = snapshots.slice(0, -1).reverse().find((candidate) => compatible(candidate.snapshot, current.snapshot));

  await fs.mkdir(options.outDir, { recursive: true });
  const briefPath = path.join(options.outDir, `${current.snapshot.snapshotDate}.md`);
  await fs.writeFile(briefPath, previous ? buildBrief(previous.snapshot, current.snapshot, options.noiseFloorPct) : baselineBrief(current.snapshot));
  console.log(JSON.stringify(previous ? {
    status: "delta_brief_written", path: briefPath,
    compared: { previous: previous.snapshot.snapshotDate, current: current.snapshot.snapshotDate },
  } : { status: "baseline_brief", path: briefPath }, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); });
