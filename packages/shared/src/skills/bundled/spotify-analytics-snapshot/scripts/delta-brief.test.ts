import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const script = path.join(import.meta.dir, "delta-brief.ts");

function runDelta(snapshots: Record<string, unknown>[], files?: { name: string; modifiedAt?: string }[]) {
  const root = mkdtempSync(path.join(tmpdir(), "spotify-delta-"));
  const snapshotsDir = path.join(root, "snapshots");
  const outDir = path.join(root, "briefs");
  mkdirSync(snapshotsDir, { recursive: true });
  snapshots.forEach((snapshot, index) => {
    const date = String(snapshot.snapshotDate);
    const filePath = path.join(snapshotsDir, files?.[index]?.name ?? `${date}-s4a.json`);
    writeFileSync(filePath, JSON.stringify(snapshot));
    const modifiedAt = files?.[index]?.modifiedAt;
    if (modifiedAt) utimesSync(filePath, new Date(modifiedAt), new Date(modifiedAt));
  });
  const result = Bun.spawnSync([process.execPath, script, "--snapshots-dir", snapshotsDir, "--out-dir", outDir]);
  return { result, brief: result.exitCode === 0 ? readFileSync(path.join(outDir, `${snapshots.at(-1)?.snapshotDate}.md`), "utf8") : "" };
}

describe("Spotify delta brief", () => {
  test("discovers s4a snapshots and compares the optional browser schema", () => {
    const base = { dataSource: "spotify-for-artists-browser", windowDays: 28, artist: { name: "Luna" }, tracks: [], sources: {}, partial: false, errors: [] };
    const { result, brief } = runDelta([
      { ...base, snapshotDate: "2026-07-08", metrics: { streams: 100, listeners: 50, followers: 20, saves: 4 } },
      { ...base, snapshotDate: "2026-07-09", metrics: { streams: 120, listeners: 55, followers: 21, saves: null }, partial: true, errors: ["Missing metrics: saves."] },
    ]);
    expect(result.exitCode).toBe(0);
    expect(brief).toContain("100 → 120");
    expect(brief).toContain("Saves: delta unavailable");
    expect(brief).toContain("Playlist-driving data was not captured");
  });

  test("orders same-day UUID captures by validated updatedAt, not filename or copy time", () => {
    const base = { snapshotDate: "2026-09-15", dataSource: "spotify-for-artists-browser", windowDays: 28 };
    const { result, brief } = runDelta([
      { ...base, updatedAt: "2026-09-15T10:00:00.000Z", metrics: { streams: 100 } },
      { ...base, updatedAt: "2026-09-15T11:00:00.000Z", metrics: { streams: 200 } },
    ], [
      { name: "2026-09-15-s4a-ffffffff-ffff-4fff-8fff-ffffffffffff.json", modifiedAt: "2026-09-15T13:00:00.000Z" },
      { name: "2026-09-15-s4a-00000000-0000-4000-8000-000000000000.json", modifiedAt: "2026-09-15T12:00:00.000Z" },
    ]);
    expect(result.exitCode).toBe(0);
    expect(brief).toContain("Streams: 100 → 200");
  });

  test("falls back to mtime for missing or invalid updatedAt across legacy and UUID files", () => {
    const base = { snapshotDate: "2026-09-15", dataSource: "spotify-for-artists-browser", windowDays: 28 };
    const { result, brief } = runDelta([
      { ...base, metrics: { streams: 100 } },
      { ...base, updatedAt: "2026-02-30T11:00:00.000Z", metrics: { streams: 200 } },
      { ...base, updatedAt: "not-a-date", metrics: { streams: 300 } },
    ], [
      { name: "2026-09-15.json", modifiedAt: "2026-09-15T09:00:00.000Z" },
      { name: "2026-09-15-s4a.json", modifiedAt: "2026-09-15T10:00:00.000Z" },
      { name: "2026-09-15-s4a-00000000-0000-4000-8000-000000000000.json", modifiedAt: "2026-09-15T11:00:00.000Z" },
    ]);
    expect(result.exitCode).toBe(0);
    expect(brief).toContain("Streams: 200 → 300");
  });

  test("writes a baseline instead of comparing incompatible data sources", () => {
    const { result, brief } = runDelta([
      { snapshotDate: "2026-07-08", dataSource: "spotify-web-api", artist: {}, metrics: { followers: 20 } },
      { snapshotDate: "2026-07-09", dataSource: "spotify-for-artists-browser", artist: {}, metrics: { followers: 21 }, partial: true },
    ]);
    expect(result.exitCode).toBe(0);
    expect(brief).toContain("No prior comparable snapshot");
  });

  test("does not compare an unknown reporting window to a known window", () => {
    const base = { dataSource: "spotify-for-artists-browser", artist: { name: "Luna" }, tracks: [], sources: {}, partial: false, errors: [] };
    const { result, brief } = runDelta([
      { ...base, snapshotDate: "2026-07-08", windowDays: 28, metrics: { streams: 100 } },
      { ...base, snapshotDate: "2026-07-09", windowDays: null, metrics: { streams: 200 }, partial: true },
    ]);
    expect(result.exitCode).toBe(0);
    expect(brief).toContain("No prior comparable snapshot");
    expect(brief).not.toContain("100 → 200");
  });
});
