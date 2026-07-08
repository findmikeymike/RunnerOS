# Printing Press CLIs

CLI harnesses for agent-operated social platforms.

Current packages:

- `instagram-cli/` - direct Instagram browser CLI for profile login, posting, comments, and DMs.
- `tiktok-cli/` - direct TikTok browser CLI for profile login, video posting, comments, and DMs.
- `x-cli/` - direct X browser CLI for profile login, posts, replies, and DMs.
- `youtube-cli/` - direct YouTube browser CLI for profile login, full video uploads, Shorts uploads, and comments.

Use each platform folder as its own installable CLI package.

Recommended next check after install:

```bash
social doctor --json
```

Approved Runner handoff workflow:

```bash
social post x --profile artist01 --text "post text" --dry-run --json > dry-run-result.json
social execute --action-file dry-run-result.json --expected-action-id act_... --confirm yes --json
```

Safety defaults:

- New profiles default to `require-confirm`.
- Dry-run commands are safe planning commands.
- Live post/comment/DM/upload commands require exact approval passed as `--confirm yes`.
- Profiles must define `--handle` or `--account-url` before live actions so the visible browser account can be verified.
- The built-in `smoke` profile is dry-run only unless `SOCIAL_ENABLE_SMOKE_PROFILE=1` is explicitly set.
- Successful live actions with `--idempotency-key` are recorded in a local ledger to avoid accidental duplicate execution.
- A per-profile lock prevents two social actions from driving the same browser session at once.
- Dry-run browser plans include `accountVerification`; Runner/browser operators must verify the visible logged-in account or channel matches the requested handle/URL before submit. Prior chat approval plus the matching action id authorizes submit when the draft matches; stop only on mismatch, ambiguity, or unexpected UI/platform risk.
- `social execute` only accepts full dry-run result JSON with a browser plan and still requires `--confirm yes`; with default `runner-cdp`, it returns a delegated handoff for RunnerOS browser tools.

Asset and content roots:

- Use `social assets --asset-root <dir> --platform <platform> --json` to list usable media before choosing files.
- Use `social content --content-root <dir> --json` to list caption/title text files.
- Post commands accept `--asset-root` and `--content-root`; relative `--media`, `--text-file`, `--title-file`, and `--description-file` paths resolve inside those roots.
- Relative rooted paths cannot escape their root with `..`.

Default browser engine:

- Use one Runner agent, `@social-publisher`, as the front door for all channel posting.
- Keep Instagram/TikTok/X/YouTube differences as platform playbooks inside this CLI harness, not as separate posting agents by default.
- `runner-cdp` inside RunnerOS. The CLI emits structured plans; Runner executes with native browser/CDP tools. Direct live CLI execution requires a non-delegated fallback engine.
- `playwright` is optional fallback for standalone local execution.
