import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const script = path.join(import.meta.dir, "watch.ts");

function runWatch(files: Record<string, unknown>) {
  const root = mkdtempSync(path.join(tmpdir(), "spotify-watch-"));
  const snapshotsDir = path.join(root, "snapshots");
  const alertsDir = path.join(root, "alerts");
  mkdirSync(snapshotsDir, { recursive: true });
  for (const [name, snapshot] of Object.entries(files)) writeFileSync(path.join(snapshotsDir, name), JSON.stringify(snapshot));
  const result = Bun.spawnSync([process.execPath, script, "--snapshots-dir", snapshotsDir, "--alerts-dir", alertsDir, "--ceo-inbox", ""]);
  const stdout = result.stdout.toString();
  const summary = result.exitCode === 0 ? JSON.parse(stdout) as { alertPath: string; snapshotsCompared: number } : null;
  return { result, summary, alert: summary ? readFileSync(summary.alertPath, "utf8") : "" };
}

describe("Spotify anomaly watch", () => {
  test("discovers browser snapshots, preserves partial alerts, and skips unavailable fields", () => {
    const base = { dataSource: "spotify-for-artists-browser", windowDays: 28, tracks: [], sources: {}, partial: false, errors: [] };
    const { result, summary, alert } = runWatch({
      "2026-07-07-s4a.json": { ...base, snapshotDate: "2026-07-07", metrics: { streams: 100, listeners: 50 } },
      "2026-07-08-s4a.json": { ...base, snapshotDate: "2026-07-08", metrics: { streams: 80, listeners: 45 } },
      "2026-07-09-s4a.json": { ...base, snapshotDate: "2026-07-09", metrics: { streams: 50, listeners: 44, saveRate: null }, partial: true, errors: ["Missing metrics: saves."] },
    });
    expect(result.exitCode).toBe(0);
    expect(summary?.snapshotsCompared).toBe(3);
    expect(alert).toContain("partial-snapshot");
    expect(alert).toContain("stream-drop");
    expect(alert).not.toContain("NaN");
  });

  test("treats an incompatible latest source as a baseline", () => {
    const { result, summary, alert } = runWatch({
      "2026-07-08-web-api.json": { snapshotDate: "2026-07-08", dataSource: "spotify-web-api", windowDays: 0, metrics: { followers: 10 } },
      "2026-07-09-s4a.json": { snapshotDate: "2026-07-09", dataSource: "spotify-for-artists-browser", windowDays: 28, metrics: { followers: 11 }, partial: true, errors: ["Missing metrics: streams."] },
    });
    expect(result.exitCode).toBe(0);
    expect(summary?.snapshotsCompared).toBe(1);
    expect(alert).toContain("Only one compatible snapshot available");
    expect(alert).toContain("partial-snapshot");
  });

  test("does not compare snapshots with unknown reporting windows", () => {
    const base = { dataSource: "spotify-for-artists-browser", tracks: [], sources: {}, partial: false, errors: [] };
    const { result, summary, alert } = runWatch({
      "2026-07-08-s4a.json": { ...base, snapshotDate: "2026-07-08", windowDays: 28, metrics: { streams: 100 } },
      "2026-07-09-s4a.json": { ...base, snapshotDate: "2026-07-09", windowDays: null, metrics: { streams: 10 }, partial: true },
    });
    expect(result.exitCode).toBe(0);
    expect(summary?.snapshotsCompared).toBe(1);
    expect(alert).toContain("Only one compatible snapshot available");
    expect(alert).not.toContain("stream-drop");
  });
});
