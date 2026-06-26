# Google Ads Tool

Repo-owned wrapper for the bundled `google-ads-pp-cli` binary.

Bundled build: `2026.6.25-runneros-v24`, targeting Google Ads API `v24` with v24.2 release coverage.

Google Ads API v24.2 was released on 2026-06-24. The REST endpoint path remains `v24`; v24.2 is the current minor release inside that major API line.

Use from this directory:

```bash
node bin/google-ads.mjs doctor --agent
node bin/google-ads.mjs auth status --agent
node bin/google-ads.mjs customers list-accessible-customers --agent
node bin/google-ads.mjs google-ads-fields search --agent --query campaign
```

The wrapper resolves the binary from packaged app resources first, then dev resources, then `PATH`.
