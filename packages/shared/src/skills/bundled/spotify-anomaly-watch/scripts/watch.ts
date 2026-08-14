#!/usr/bin/env npx tsx
/** Spotify Anomaly Watch — inspect existing compatible snapshots without scraping. */

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type OptionalNumber = number | null | undefined;
type Playlist = { name: string; type?: string; listeners?: OptionalNumber };
type Track = { id?: string; name: string; streams?: OptionalNumber };
type Snapshot = {
  snapshotDate: string;
  dataSource?: string;
  windowDays?: OptionalNumber;
  metrics: Record<"streams" | "listeners" | "followers" | "saves" | "saveRate" | "skipRate", OptionalNumber>;
  tracks: Track[];
  tracksCaptured: boolean;
  playlistsDriving: Playlist[];
  playlistsCaptured: boolean;
  sources: Record<string, number>;
  partial: boolean;
  errors: string[];
};
type Severity = "severe" | "moderate" | "informational";
type Anomaly = { severity: Severity; kind: string; message: string };
type CliOptions = {
  snapshotsDir: string; alertsDir: string; ceoInbox: string | null;
  streamDropPct: number; listenerDropPct: number; saveRateDropPct: number;
  skipRateSpikePct: number; playlistMinListeners: number;
};

const DEFAULT_SNAPSHOTS_DIR = "data/spotify/snapshots";
const DEFAULT_ALERTS_DIR = "data/spotify/alerts";
const DEFAULT_CEO_INBOX = "data/booth/agent-inbox/artist-ceo.md";

function usage() {
  const scriptPath = fileURLToPath(import.meta.url);
  return `Usage: "\${CRAFT_BUN:-bun}" "${scriptPath}" [options]

  --snapshots-dir <path>       Default: ${DEFAULT_SNAPSHOTS_DIR}
  --alerts-dir <path>          Default: ${DEFAULT_ALERTS_DIR}
  --ceo-inbox <path>           Default: ${DEFAULT_CEO_INBOX} (use "" to disable)
  --stream-drop-pct <n>        Default: 30
  --listener-drop-pct <n>      Default: 30
  --save-rate-drop-pct <n>     Default: 20
  --skip-rate-spike-pct <n>    Default: 20
  --playlist-min-listeners <n> Default: 100
`;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    snapshotsDir: DEFAULT_SNAPSHOTS_DIR, alertsDir: DEFAULT_ALERTS_DIR, ceoInbox: DEFAULT_CEO_INBOX,
    streamDropPct: 30, listenerDropPct: 30, saveRateDropPct: 20, skipRateSpikePct: 20, playlistMinListeners: 100,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => { const value = argv[++i]; if (value === undefined) throw new Error(`Missing value for ${arg}`); return value; };
    if (arg === "--help" || arg === "-h") { console.log(usage()); process.exit(0); }
    else if (arg === "--snapshots-dir") options.snapshotsDir = next();
    else if (arg === "--alerts-dir") options.alertsDir = next();
    else if (arg === "--ceo-inbox") { const value = next(); options.ceoInbox = value || null; }
    else if (arg === "--stream-drop-pct") options.streamDropPct = Number(next());
    else if (arg === "--listener-drop-pct") options.listenerDropPct = Number(next());
    else if (arg === "--save-rate-drop-pct") options.saveRateDropPct = Number(next());
    else if (arg === "--skip-rate-spike-pct") options.skipRateSpikePct = Number(next());
    else if (arg === "--playlist-min-listeners") options.playlistMinListeners = Number(next());
    else if (arg !== "--") throw new Error(`Unknown argument: ${arg}`);
  }
  for (const key of ["streamDropPct", "listenerDropPct", "saveRateDropPct", "skipRateSpikePct", "playlistMinListeners"] as const) {
    if (!Number.isFinite(options[key]) || options[key] < 0) throw new Error(`${key} must be a nonnegative number.`);
  }
  return options;
}

async function listSnapshotFiles(dir: string): Promise<string[]> {
  const stat = await fs.stat(dir).catch(() => null);
  if (!stat?.isDirectory()) return [];
  return (await fs.readdir(dir)).filter((name) => /^\d{4}-\d{2}-\d{2}(?:-(?:s4a|web-api))?\.json$/.test(name)).sort();
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

async function readSnapshot(filePath: string): Promise<Snapshot | { error: string; file: string }> {
  try {
    const root = record(JSON.parse(await fs.readFile(filePath, "utf8")) as unknown);
    const snapshotDate = typeof root.snapshotDate === "string" ? root.snapshotDate : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate)) throw new Error("missing or invalid snapshotDate");
    const metrics = record(root.metrics);
    const rawTracks = Array.isArray(root.tracks) ? root.tracks : [];
    const rawPlaylists = Array.isArray(root.playlistsDriving) ? root.playlistsDriving : [];
    const sources = Object.fromEntries(Object.entries(record(root.sources))
      .map(([key, value]) => [key, finiteNumber(value)] as const)
      .filter((entry): entry is readonly [string, number] => entry[1] !== undefined));
    return {
      snapshotDate,
      dataSource: typeof root.dataSource === "string" ? root.dataSource : undefined,
      windowDays: finiteNumber(root.windowDays),
      metrics: {
        streams: finiteNumber(metrics.streams), listeners: finiteNumber(metrics.listeners),
        followers: finiteNumber(metrics.followers), saves: finiteNumber(metrics.saves),
        saveRate: finiteNumber(metrics.saveRate), skipRate: finiteNumber(metrics.skipRate),
      },
      tracks: rawTracks.flatMap((value) => { const item = record(value); const name = typeof item.name === "string" ? item.name.trim() : ""; return name ? [{ id: typeof item.id === "string" ? item.id : undefined, name, streams: finiteNumber(item.streams) }] : []; }),
      tracksCaptured: Array.isArray(root.tracks),
      playlistsDriving: rawPlaylists.flatMap((value) => { const item = record(value); const name = typeof item.name === "string" ? item.name.trim() : ""; return name ? [{ name, type: typeof item.type === "string" ? item.type : undefined, listeners: finiteNumber(item.listeners) }] : []; }),
      playlistsCaptured: Array.isArray(root.playlistsDriving),
      sources,
      partial: root.partial === true,
      errors: Array.isArray(root.errors) ? root.errors.filter((value): value is string => typeof value === "string") : [],
    };
  } catch (error) {
    return { file: path.basename(filePath), error: error instanceof Error ? error.message : String(error) };
  }
}

function pctChange(prev: number, curr: number): number | null {
  return prev === 0 ? (curr === 0 ? 0 : null) : ((curr - prev) / prev) * 100;
}
function available(value: OptionalNumber): value is number { return typeof value === "number" && Number.isFinite(value); }

function sustained(snaps: Snapshot[], pick: (snapshot: Snapshot) => OptionalNumber, threshold: number, direction: "drop" | "spike"): boolean {
  if (snaps.length < 2) return false;
  const latest = pick(snaps.at(-1)!);
  const previous = pick(snaps.at(-2)!);
  if (!available(latest) || !available(previous)) return false;
  const change = pctChange(previous, latest);
  if (change === null || (direction === "drop" ? change > -threshold : change < threshold)) return false;
  if (snaps.length < 3) return true;
  const prior = pick(snaps.at(-3)!);
  if (!available(prior)) return false;
  const priorChange = pctChange(prior, previous);
  return priorChange !== null && (direction === "drop" ? priorChange < 0 : priorChange > 0);
}

function compatible(previous: Snapshot, current: Snapshot): boolean {
  if ((previous.dataSource || "unknown") !== (current.dataSource || "unknown")) return false;
  return previous.windowDays !== undefined
    && current.windowDays !== undefined
    && previous.windowDays === current.windowDays;
}

function detectAnomalies(snaps: Snapshot[], options: CliOptions): Anomaly[] {
  const anomalies: Anomaly[] = [];
  const latest = snaps.at(-1);
  if (!latest) return anomalies;
  if (latest.partial) anomalies.push({ severity: "informational", kind: "partial-snapshot", message: `Latest snapshot is partial. Errors: ${latest.errors.join("; ") || "(unspecified)"}` });
  if (snaps.length < 2) {
    anomalies.push({ severity: "informational", kind: "baseline", message: `Only one compatible snapshot available (${latest.snapshotDate}). No comparisons yet.` });
    return anomalies;
  }
  const previous = snaps.at(-2)!;
  const metricAlert = (key: keyof Snapshot["metrics"], threshold: number, severity: Severity, kind: string, label: string, direction: "drop" | "spike", rate = false) => {
    if (!sustained(snaps, (snapshot) => snapshot.metrics[key], threshold, direction)) return;
    const prev = previous.metrics[key]; const curr = latest.metrics[key];
    if (!available(prev) || !available(curr)) return;
    const change = pctChange(prev, curr); if (change === null) return;
    const values = rate ? `${(prev * 100).toFixed(2)}% → ${(curr * 100).toFixed(2)}%` : `${prev} → ${curr}`;
    anomalies.push({ severity, kind, message: `${label} ${direction === "drop" ? "dropped" : "spiked"} ${Math.abs(change).toFixed(1)}% (${values}). Sustained.` });
  };
  metricAlert("streams", options.streamDropPct, "severe", "stream-drop", "Streams", "drop");
  metricAlert("listeners", options.listenerDropPct, "severe", "listener-drop", "Listeners", "drop");
  metricAlert("saveRate", options.saveRateDropPct, "moderate", "save-rate-drop", "Save rate", "drop", true);
  metricAlert("skipRate", options.skipRateSpikePct, "moderate", "skip-rate-spike", "Skip rate", "spike", true);

  if (previous.playlistsCaptured && latest.playlistsCaptured) {
    for (const removed of previous.playlistsDriving) {
      if (!available(removed.listeners) || removed.listeners < options.playlistMinListeners) continue;
      if (!latest.playlistsDriving.some((playlist) => playlist.name === removed.name)) {
        anomalies.push({ severity: "severe", kind: "playlist-removed", message: `Removed from "${removed.name}"${removed.type ? ` (${removed.type})` : ""}, previously ${removed.listeners} listeners. Investigate.` });
      }
    }
  }
  if (previous.tracksCaptured && latest.tracksCaptured) {
    const topTracks = previous.tracks.filter((track) => available(track.streams)).sort((a, b) => (b.streams as number) - (a.streams as number)).slice(0, 3);
    for (const track of topTracks) if (!latest.tracks.some((candidate) => (track.id && candidate.id === track.id) || candidate.name === track.name)) {
      anomalies.push({ severity: "moderate", kind: "track-disappeared", message: `Top track "${track.name}" not present in latest snapshot. Could be metadata change or report shift.` });
    }
  }
  const prevEditorial = previous.sources.editorial; const currEditorial = latest.sources.editorial;
  if (available(prevEditorial) && available(currEditorial) && (currEditorial - prevEditorial) * 100 > 10) {
    anomalies.push({ severity: "informational", kind: "editorial-dependency-up", message: `Editorial source share grew ${((currEditorial - prevEditorial) * 100).toFixed(1)}pts.` });
  }
  return anomalies;
}

function buildAlertMarkdown(latest: Snapshot, anomalies: Anomaly[], parseErrors: Array<{ file: string; error: string }>): string {
  const lines = [`# Spotify Anomaly Alert — ${new Date().toISOString().slice(0, 10)}`, "", `Latest snapshot: \`${latest.snapshotDate}\``, ""];
  if (parseErrors.length) lines.push("## Parse Errors", "", ...parseErrors.map((error) => `- ${error.file}: ${error.error}`), "");
  for (const [severity, header] of [["severe", "## Severe — investigate this cycle"], ["moderate", "## Moderate — track"], ["informational", "## Informational"]] as const) {
    const group = anomalies.filter((anomaly) => anomaly.severity === severity);
    if (group.length) lines.push(header, "", ...group.map((anomaly) => `- **${anomaly.kind}** — ${anomaly.message}`), "");
  }
  if (!anomalies.length) lines.push("No anomalies detected. System is stable in this window.", "");
  return lines.join("\n");
}

async function appendCeoInbox(inboxPath: string, latest: Snapshot, severe: Anomaly[]) {
  if (!severe.length) return;
  await fs.mkdir(path.dirname(inboxPath), { recursive: true });
  const block = [`## Spotify Anomaly Watch — ${new Date().toISOString()}`, "", `Latest snapshot: \`${latest.snapshotDate}\``, "", ...severe.map((anomaly) => `- **${anomaly.kind}** — ${anomaly.message}`), ""].join("\n");
  const existing = await fs.readFile(inboxPath, "utf8").catch(() => `# ${path.basename(inboxPath, ".md").replace(/-/g, " ")}\n\n`);
  await fs.writeFile(inboxPath, `${existing}${existing.endsWith("\n\n") ? "" : "\n"}${block}\n`);
}

function filePriority(file: string): number { return file.endsWith("-s4a.json") ? 2 : file.endsWith("-web-api.json") ? 0 : 1; }

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const files = await listSnapshotFiles(options.snapshotsDir);
  if (!files.length) { console.log(JSON.stringify({ status: "no_snapshots", snapshotsDir: options.snapshotsDir }, null, 2)); return; }
  const parsed: Array<{ file: string; snapshot: Snapshot }> = [];
  const parseErrors: Array<{ file: string; error: string }> = [];
  for (const file of files) {
    const result = await readSnapshot(path.join(options.snapshotsDir, file));
    if ("error" in result) parseErrors.push(result); else parsed.push({ file, snapshot: result });
  }
  if (!parsed.length) throw new Error(`Could not parse any snapshot files. Errors: ${parseErrors.map((error) => `${error.file}: ${error.error}`).join("; ")}`);
  parsed.sort((a, b) => a.snapshot.snapshotDate.localeCompare(b.snapshot.snapshotDate) || filePriority(a.file) - filePriority(b.file));
  const latestEntry = parsed.at(-1)!;
  const snapshots = parsed.filter((entry) => entry === latestEntry || compatible(entry.snapshot, latestEntry.snapshot)).slice(-4).map((entry) => entry.snapshot);
  const anomalies = detectAnomalies(snapshots, options);
  await fs.mkdir(options.alertsDir, { recursive: true });
  const alertPath = path.join(options.alertsDir, `${new Date().toISOString().slice(0, 10)}.md`);
  await fs.writeFile(alertPath, buildAlertMarkdown(latestEntry.snapshot, anomalies, parseErrors));
  if (options.ceoInbox) await appendCeoInbox(options.ceoInbox, latestEntry.snapshot, anomalies.filter((anomaly) => anomaly.severity === "severe"));
  console.log(JSON.stringify({
    status: "watch_complete", alertPath, latestSnapshot: latestEntry.snapshot.snapshotDate,
    snapshotsCompared: snapshots.length,
    anomaliesBySeverity: Object.fromEntries(["severe", "moderate", "informational"].map((severity) => [severity, anomalies.filter((anomaly) => anomaly.severity === severity).length])),
    parseErrors,
  }, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); });
