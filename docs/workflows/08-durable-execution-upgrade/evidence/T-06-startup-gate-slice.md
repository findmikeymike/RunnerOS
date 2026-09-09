# Small startup composition slice

2026-09-09 · included in this commit.

Added a prepared Electron startup entry point joining the existing local authority and protected host factories. Omitted/false enablement returns without identity, binding or journal access. Explicit opt-in requires a local-only binding; shared/external configuration is rejected before identity loading and rechecked afterward. Identity failures propagate without opening storage. The factory passes runner options and the trusted resolver through without admitting work.

Four startup tests plus existing authority/lifetime/storage tests pass: 14 tests, 46 assertions. Electron typecheck and diff check passed. Startup dependencies are injected in tests; this is composition proof, not live Electron/keychain certification.

No bootstrap invocation, environment flag, renderer switch or public workflow admission was added. Actual startup still needs the production runner binding resolver and handler dependency registration, followed by runtime verification. Local-owner work is included in the same commit.
