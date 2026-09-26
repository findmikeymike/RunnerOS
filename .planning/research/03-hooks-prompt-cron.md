# Hermes Upgrades 3, 7, 8: Shell Hooks, Prompt-Injection Scan, Per-Job Toolsets

## Upgrade 3: Polyglot Shell Hooks (packages/shared/src/automations/hooks/)

**Wire Protocol (stdin/stdout JSON shapes)**

Shell hooks receive input via stdin and respond via stdout with JSON payloads.

**stdin** — Standardized across all hook events:
```json
{
  "hook_event_name": "pre_tool_call",
  "tool_name": "terminal",
  "tool_input": {"command": "rm -rf /"},
  "session_id": "sess_abc123",
  "cwd": "/home/user/project",
  "extra": {...}
}
```
(Serialized at `agent/shell_hooks.py:466–482`)

**stdout** — Two canonical wire formats accepted (both normalized internally):

1. **Claude-Code canonical** (`agent/shell_hooks.py:44`):
   ```json
   {"decision": "block", "reason": "Forbidden command"}
   ```

2. **Hermes canonical** (`agent/shell_hooks.py:45`):
   ```json
   {"action": "block", "message": "Forbidden command"}
   ```

Both shapes are parsed at lines 528–533; the response is normalized to Hermes canonical `{"action": "block", "message": "..."}` before being passed to the plugin manager.

For `pre_llm_call` events, hooks can inject context:
```json
{"context": "Today is Friday"}
```
(Passed through unchanged; see lines 535–537.)

**Consent Flow & Allowlist Storage**

- **First-use prompt**: Lines 641–676 (`_prompt_and_record`). User sees approval prompt at TTY; output captured to `~/.hermes/shell-hooks-allowlist.json`.
- **Non-TTY fallback**: Line 655, `sys.stdin.isatty()` check. Non-TTY callers must pass `accept_hooks=True` (resolved from `--accept-hooks` flag, `HERMES_ACCEPT_HOOKS` env var, or `hooks_auto_accept: true` in config) at lines 162–173.
- **Allowlist storage**: `~/.hermes/shell-hooks-allowlist.json`, managed at lines 546–548. Each approval records event, command, timestamp, and script mtime hash for drift detection (lines 679–694).
- **Cross-process locking**: fcntl.flock on `.lock` file (POSIX, lines 628–638) or intra-process lock (non-POSIX, lines 621–625) prevents allowlist corruption under concurrent access.

**Subprocess Invocation (shlex.split + shell=False)**

- Line 383: `argv = shlex.split(os.path.expanduser(spec.command))`
- Line 399: `shell=False` — *no shell interpreter invoked*, eliminating injection footguns. Users needing pipes/redirection wrap logic in a script (documented at lines 16–18).

**Timeout & Output Handling**

- Default timeout: `DEFAULT_TIMEOUT_SECONDS = 60` (line 83); max clamped to `300s` (line 84).
- Per-hook override via YAML `timeout:` field (lines 325–347).
- Output capture: stdout/stderr both captured via `capture_output=True` (line 396), capped at 400 chars when logged (lines 450, 457).
- Timeout detection: `subprocess.TimeoutExpired` caught, logged as warning (lines 401–403); exit code and stderr recorded for diagnostics (lines 415–418).

---

## Upgrade 7: Prompt-Injection Scan (packages/shared/src/agent/prompt-builder.ts)

**Scan Invocation in Cron**

The injection scan is invoked **after fully assembling the cron prompt** (including skill content loaded at runtime):

- **Location**: `cron/scheduler.py:1109–1131`, function `_scan_assembled_cron_prompt(assembled, job)`.
- **Call sites**:
  - Line 1058: When prompt has no skills.
  - Line 1106: When skills are loaded, after composing user prompt + skill content.
  - Line 1122: Delegates to `tools/cronjob_tools.py:_scan_cron_prompt(assembled)`.

**Threat Patterns (Regex + LLM-free)**

Hermes uses only regex patterns (no LLM inference). Patterns defined at `tools/cronjob_tools.py:43–65`:

**Critical threat patterns** (lines 43–50):
```
- ignore\s+(?:\w+\s+)*(?:previous|all|above|prior)\s+(?:\w+\s+)*instructions  → "prompt_injection"
- do\s+not\s+tell\s+the\s+user  → "deception_hide"
- system\s+prompt\s+override  → "sys_prompt_override"
- disregard\s+(your|all|any)\s+(instructions|rules|guidelines)  → "disregard_rules"
- cat\s+[^\n]*(\.env|credentials|\.netrc|\.pgpass)  → "read_secrets"
- authorized_keys  → "ssh_backdoor"
- /etc/sudoers|visudo  → "sudoers_mod"
- rm\s+-rf\s+/  → "destructive_root_rm"
```

**Exfiltration patterns** (lines 55–62, uses `_CRON_SECRET_VAR_RE = r'\$\{?\w*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)\w*\}?'`):
```
- curl\s+[^\n]*https?://[^\s"\'`]*{SECRET_VAR}  → "exfil_curl_url"
- wget\s+[^\n]*https?://[^\s"\'`]*{SECRET_VAR}  → "exfil_wget_url"
- curl\s+[^\n]*(?:--data|-d|--form|-F)\s+[^\n]*{SECRET_VAR}  → "exfil_curl_data"
- wget\s+[^\n]*--post-(?:data|file)=[^\n]*{SECRET_VAR}  → "exfil_wget_post"
- curl\s+[^\n]*(?:-H|--header)\s+Authorization:\s*(?:Bearer|token)\s+{SECRET_VAR}  → "exfil_curl_auth_header"
```

**Invisible unicode check** (lines 131–133):
```
_CRON_INVISIBLE_CHARS = {'​', '‌', '‍', '⁠', '﻿', '‪', '‫', '‬', '‭', '‮'}
```
(Special handling for zero-width joiner U+200D in emoji sequences at lines 104–114.)

**Bug #3968 Summary** (documented at `scheduler.py:46–56` and test file `tests/cron/test_cron_prompt_injection_skill.py:1–13`)

**The gap**: Create-time scanning (via `_scan_cron_prompt`) checked only the user-supplied prompt field. Skill content was loaded from disk at runtime via `_build_job_prompt` (line 1067) and never scanned. Since cron runs non-interactively with auto-approval of tool calls, a malicious skill carrying an injection payload bypassed every gate.

**The fix**: Line 1106 now invokes `_scan_assembled_cron_prompt` on the fully-composed prompt (user text + cron hint + all skill bodies) *before* the agent sees it. Regression tests confirm this catches injected skills (test file lines 150–176).

**Detection Response**

When injection is detected:
1. `_scan_cron_prompt` returns an error string (e.g., `"Blocked: prompt matches threat pattern 'prompt_injection'..."`).
2. Line 1122–1130: Logged as a warning with job context; exception `CronPromptInjectionBlocked` is raised.
3. Exception is caught in `run_job` (line 1295–?), delivering a clean "job blocked" message to the operator instead of crashing the scheduler.

---

## Upgrade 8: Per-Job Toolset Override (packages/shared/src/workflows/trigger-inputs.ts)

**Precedence Chain for Enabled Toolsets**

Resolved at `cron/scheduler.py:60–88`, function `_resolve_cron_enabled_toolsets(job, cfg)`:

1. **Per-job `enabled_toolsets`** (line 77): If set on the job dict via the cronjob tool (create/update), this wins unconditionally. Kept intact per issue #6130 (per-job override).
2. **Per-platform `cron` tools config** (line 81): Falls back to `_get_platform_tools(cfg, "cron")` from `hermes_cli.tools_config`. Mirrors gateway behavior so users can gate cron toolsets globally without recreating every job.
3. **Full default set** (line 87): Returns `None` on any lookup failure; AIAgent loads the full default toolset (legacy safety net).

Special note (lines 72–75): `_DEFAULT_OFF_TOOLSETS ({moa, homeassistant, rl})` are removed by `_get_platform_tools` for unconfigured platforms, so fresh installs avoid surprise cost overruns (e.g., Norbert's $4.63 run from uncontrolled moa calls).

**Job Creation & Storage**

- **Function**: `cron/jobs.py:create_cron_job` (lines 506–656).
- **Parameter**: `enabled_toolsets: Optional[List[str]]` (line 523).
- **Normalization**: Lines 606–607 convert to a deduplicated, stripped string list or `None`.
- **Stored in job dict**: Line 662, `"enabled_toolsets": normalized_toolsets`.

**Runtime Resolution**

- **Called at**: `cron/scheduler.py:1573`, passed to AIAgent constructor as the `enabled_toolsets=` kwarg.
- **Invoked during agent initialization**: AIAgent uses this to restrict the tool registry before prompt assembly.

**Failure Mode: Nonexistent Toolset**

When a job references a toolset that doesn't exist:
- **Graceful degradation**: Line 85–88. If `_get_platform_tools` raises any exception (e.g., toolset not found in config), it is caught and logged as a warning; the function returns `None`.
- **Fallback**: AIAgent receives `enabled_toolsets=None` and loads the full default toolset.
- **No job failure**: The job does not crash; instead, it runs with a broader toolset than intended. The operator logs the misconfiguration but execution continues.

This conservative approach prevents jobs from silently breaking if a toolset name is typo'd or removed—the job still runs, albeit without the intended restriction.

---

## Cross-File References & Test Coverage

- **Shell hooks tests**: `tests/agent/test_shell_hooks.py` (if exists; validate allowlist round-trip, timeout, stderr handling).
- **Prompt-injection tests**: `tests/cron/test_cron_prompt_injection_skill.py` (lines 74–236: core regression coverage).
- **Integration**: Shell hooks registered in `hermes_cli/main.py` and `gateway/run.py` (lines 154–221); plugin manager dispatch at `hermes_cli/plugins.py`.
- **Toolset resolution tests**: `tests/cron/test_*.py` (if present; validate precedence chain).
