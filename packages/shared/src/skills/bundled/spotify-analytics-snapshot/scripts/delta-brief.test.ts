import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const script = path.join(import.meta.dir, "delta-brief.ts");

function runDelta(snapshots: Record<string, unknown>[]) {
  const root = mkdtempSync(path.join(tmpdir(), "spotify-delta-"));
  const snapshotsDir = path.join(root, "snapshots");
  const outDir = path.join(root, "briefs");
  mkdirSync(snapshotsDir, { recursive: true });
  snapshots.forEach((snapshot) => {
    const date = String(snapshot.snapshotDate);
    writeFileSync(path.join(snapshotsDir, `${date}-s4a.json`), JSON.stringify(snapshot));
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
