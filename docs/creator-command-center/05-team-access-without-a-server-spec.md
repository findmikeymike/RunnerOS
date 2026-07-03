---
status: draft
owner: agent
last_verified: 2026-07-01
source_of_truth: false
---

# Team Access Without a Server

> How multiple people (band + manager + collaborators) can use and see the **same HQ hub**
> without running it as a web service — plus what breaks, how to work around it, and when a
> server actually becomes worth it.
>
> Companion to `04-hq-homebase-architecture-spec.md`. That doc explains *what* the hub is
> (spaces = lenses, context docs = spine, composer = brain, pulses/workers = muscle). This doc
> explains *how a team shares that spine* given the app is desktop/local-first.

---

## 0. TL;DR

**You do not need to run this on the web to share it with a team.** Because the entire hub is
**files in a folder**, several people can each run the desktop app pointed at the *same shared
folder* and see the same brain. Two viable no-server models:

- **Model A — Shared synced folder** (Dropbox / Google Drive / iCloud / Syncthing). Easiest,
  best for non-technical teammates.
- **Model B — Git repo as the hub**. Best history and conflict handling; needs pull/push
  discipline.

Three facts from the codebase make this work, and two facts set the limits:

**Works because:**
1. A workspace is just a local folder you pick (`addWorkspace({ rootPath, name })`, `apps/electron/src/main/index.ts`).
2. Secrets (API keys, OAuth tokens) live **outside** the workspace, in encrypted storage at
   `~/.craft-agent` (`CONFIG_DIR`, `packages/shared/src/config/paths.ts`). So the shared folder
   carries **no credentials** — each person keeps their own keys on their own machine.
3. The hub's state (context docs, automations, pulses, projects) is plain markdown/JSON files
   under the workspace root — syncable and diffable by design.

**Limited because:**
4. It's **sync, not live** — you see changes when files sync/pull, not in real time.
5. **Background automation (Pulses) only runs while an app is open** — which creates a
   "who runs the morning brief?" problem solved by the *runner-machine rule* (§4).

**Bonus:** the no-server route **sidesteps the critical control-plane security hole**
(`AUDIT_CONTROL_PLANE.md`) entirely, because nothing is exposed to a browser or network. Local
files only. This is the *safer* path, not just the simpler one.

---

## 1. Why sharing the data is basically free

The `04` spec's core idea is that the UI and the agents read the **same files** — one canonical
context doc per domain (profile, Spotify snapshot, network, calendar, community, goals,
state-of-play). That single-source-of-truth design is exactly what makes team sharing cheap:
put the folder in one shared place and everyone's app — and everyone's workers — read the same
brain automatically. No sync engine to build, no API, no database. The architecture that makes
the hub *intelligent* is the same architecture that makes it *shareable*.

### What's inside a workspace folder (all syncable)

```text
<workspace-root>/
  context/                 # context docs — profile, spotify, network, calendar, community,
                           #   state-of-play, mission briefs  (the shared brain)
  projects/config.json     # project registry  (⚠ contains absolute folderPaths — see §5)
  labels/config.json       # labels / project membership
  automations/…            # automation + pulse definitions
  pulses/<id>/ticks.jsonl  # pulse decision history
  outputs/…                # generated outputs
```

### What is NOT inside it (stays private, per-machine)

```text
~/.craft-agent/            # CONFIG_DIR — encrypted credentials, LLM connections,
                           #   OAuth tokens, user secrets.  NEVER synced.  Per person.
.env / .env.local          # already gitignored; machine-local
node_modules, dist, out    # build artifacts; already gitignored
```

This separation is the whole reason a shared folder is safe: the sensitive stuff was already
architected to live elsewhere.

---

## 2. Model A — Shared synced folder (recommended for most teams)

**Setup:** put the workspace folder inside a synced drive (Dropbox / Google Drive / iCloud /
Syncthing). Each teammate installs the desktop app and adds that folder as their workspace.

**How it behaves:**
- Person edits the Network doc → file syncs → others see it on next refresh.
- Everyone's workers read the same docs, so the chief-of-staff brief is identical for all.
- Credentials stay in each person's `~/.craft-agent`; nothing secret ever touches the drive.

**Pros**
- Near-zero setup; non-technical teammates can do it.
- Automatic, background sync — no commands to remember.
- No network exposure → security hole is moot.

**Cons / watch-outs**
- **Simultaneous edits** to the *same file* produce a "conflicted copy" (Dropbox/Drive) or a
  duplicate (iCloud). Small teams with light overlap rarely hit this; heavy concurrent editing
  of one doc is the danger zone.
- Sync latency: seconds to minutes, not instant.
- Some sync clients choke on rapidly-changing files (e.g. `ticks.jsonl`); keep the always-on
  runner (§4) as the single writer of pulse logs to avoid churn.

**Best for:** a band + manager + a couple collaborators who mostly work in different areas
(one on network/outreach, one on release/vault) and want it to "just work."

---

## 3. Model B — Git repo as the hub

**Setup:** the workspace folder is a Git repo (this repo already is one). Teammates clone it;
they `pull` to get the latest and `commit` + `push` to share changes. `.env` and credentials
are already gitignored, so secrets never land in history.

**How it behaves:**
- Context docs are markdown/JSON → they diff cleanly (an explicit design goal in the context-doc
  types). You get real history: who changed the fan list, what the brief said last week.
- Conflicts are *explicit* merge conflicts you resolve, not silent duplicate files.

**Pros**
- Full version history + blame + rollback.
- Best-in-class conflict resolution for text.
- Free hosting (GitHub/GitLab) doubles as backup.

**Cons / watch-outs**
- Requires pull/push discipline; not natural for non-technical teammates.
- Not automatic — someone forgets to pull and works on stale state.
- Binary assets in Vault (audio/video/images) bloat Git; use Git LFS or keep large media in a
  synced drive and reference paths.

**Best for:** a technical owner (or one technical teammate) who wants history and control, and
is willing to run the pull/push loop.

> **Hybrid option:** Git for the *text brain* (context docs, config) + a synced drive for *large
> Vault media*. Gets clean history on what matters and avoids Git-LFS pain on big files.

---

## 4. The runner-machine rule (the one thing you must decide)

Pulses and automations only execute **while an app instance is running**. On a shared workspace
that creates a duplication problem:

- If **nobody's** app is open → the Morning Pulse never fires; no brief, no proactive work.
- If **everybody's** app is open → the Morning Pulse fires on every machine → 3 people get 3
  draft emails, workers do the same job 3×, `ticks.jsonl` gets triple-written.

**Rule: designate exactly one machine as the "runner."**

- The runner has **Pulses/automations enabled** and stays on (a bandmate's always-on desktop, a
  spare Mac mini, or later a small server).
- Everyone else runs in **view-and-act mode**: Pulses/automations **disabled**, they read the
  shared brief and click one-off worker actions manually.

This keeps proactive/background work single-sourced while everyone still sees and acts on the
same hub. It is also the honest dividing line for "do we need a server?": **you need an
always-on runner, not necessarily a server.** A server is just the most reliable runner. Sharing
and viewing never require one.

> Implementation note: this is a *policy* today (toggle pulses off on non-runner machines). A
> small future feature could formalize it — a per-machine "this instance is the runner" flag that
> gates automation execution — so it's not enforced by memory. Track as a follow-up; not required
> for V1 team use.

---

## 5. Known portability gotcha — absolute paths

`projects/config.json` stores project folder links as **absolute paths**, e.g.:

```json
{ "id": "ltr-os", "name": "LTR OS", "folderPath": "/Users/michaelb.williams/CAS4/LTR OS" }
```

On a synced/cloned workspace, another teammate's machine has no `/Users/michaelb.williams/...`
path, so folder-linked projects will fail to resolve for them.

**Options (pick before multi-machine rollout):**
1. **Relative paths** — store `folderPath` relative to the workspace root; resolve at load time.
   Cleanest if project folders live *inside* the workspace.
2. **Per-machine overrides** — keep the shared logical project in `config.json`, but resolve the
   real path from a machine-local map in `~/.craft-agent` (which is per-person and unsynced).
3. **Convention** — require project folders to sit under the workspace root so paths are portable
   by construction.

Recommend option 1 (relative) as the default, with option 2 as the escape hatch for folders that
must live outside the workspace. This is a small, contained change but must be done before a team
relies on folder-linked projects across machines.

> Broader audit worth doing once: grep the codebase for any other absolute host paths written
> *into the workspace folder* (not into `~/.craft-agent`). Anything machine-specific that lands
> in the synced folder is a portability risk. Known offender is `projects/config.json`; verify
> there are no others (automations with hardcoded paths, output references, etc.).

---

## 6. What this model does NOT give you

Be clear-eyed so nobody expects Google-Docs behavior:

- **No real-time co-editing.** It's eventual sync/pull, not live cursors.
- **No per-user accounts or roles.** Everyone touching the folder is effectively the same,
  anonymous user. No "view-only" collaborator, no "who did what" attribution, no permissions.
- **No conflict *prevention*.** You get conflict *detection/resolution* (conflicted copies or
  merge conflicts), not locking.
- **No presence.** You can't see who else is "in" the hub.

If/when the team needs true accounts, roles, attribution, and safe concurrent editing, that is
the **server + multi-user build** (Tier 3 in the discussion). The good news carried from the `04`
spec: because the data spine is file-based and already shared cleanly, that future build is about
*accounts, permissions, and security* — not re-architecting the hub.

---

## 7. Decision guide

| Your situation | Use this |
|---|---|
| Solo, one machine | Plain desktop app (nothing to do) |
| 2–4 trusting people, mostly non-technical, work in different areas | **Model A** (shared synced folder) + runner-machine rule |
| Technical owner, wants history/rollback, big media | **Model B** (Git) or the Git-text + synced-media hybrid |
| Want proactive briefs/pulses to run 24/7 for the team | Any model **+ one always-on runner machine** |
| Need per-user logins, roles, attribution, safe concurrent editing | Server + multi-user build (out of scope here; see `04` §9 and security prereq) |

---

## 8. Security prerequisites

- **No-server models (A/B): no new exposure.** Local files only; the control-plane WS hole is
  not reachable because nothing listens for a browser. Safe today.
- **Any server/web-UI path: blocked until fixed.** `AUDIT_CONTROL_PLANE.md` (2026-06-30) found a
  Critical browser→agent RCE bridge (no `Origin`/`Host` check on the loopback WS control plane)
  and no per-channel authorization. Do **not** expose the hub over a network — even to teammates
  — until that fix ships. This is the hard gate on Tier 2/Tier 3.
- **Shared folder hygiene:** confirm the synced folder never contains `.env` or anything from
  `~/.craft-agent`. It shouldn't by default (secrets are separated), but verify per teammate on
  setup.

---

## 9. Recommendation

For your near-term reality (a small trusted team around one artist), ship **Model A: a shared
synced folder + the runner-machine rule**, and fix the **absolute-path portability** issue first
so folder-linked projects work across machines. This gives everyone the same live-ish hub, keeps
every person's credentials private, and requires zero server and zero new security surface.
Treat true multi-user (accounts/roles/attribution) as a later, well-scoped project gated behind
the control-plane security fix — not a prerequisite for sharing.

---

## 10. Open decisions

1. **Model A vs B vs hybrid** for the first team — driven by how technical the teammates are.
2. **Which machine is the runner**, and do we formalize the runner flag now or rely on policy.
3. **Absolute-path fix approach** — relative paths (recommended) vs per-machine override map.
4. **Vault media strategy** under Git — LFS vs synced-drive-for-media hybrid.
5. **When (if ever) true multi-user is needed** — which forces the server + security build.
