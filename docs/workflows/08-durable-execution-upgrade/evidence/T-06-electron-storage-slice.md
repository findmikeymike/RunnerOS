# Small Electron secure-storage connection

2026-09-09 · included in this commit.

Added a main-process host factory that uses Electron `app`/`safeStorage` and the canonical runtime data root. It refuses use before app readiness, unavailable encryption and the Linux plaintext backend. Encryption/decryption recheck availability and propagate locked-keychain errors; the existing key loader preserves the envelope instead of replacing it.

The adapter has three focused tests (nine assertions), using synthetic storage plus the real key loader: early/unavailable/plaintext refusal, availability changes, same-key reopen and unchanged envelope after decryption failure. These are not live OS keychain certification. Electron typecheck and diff check passed.

The factory is ready for later startup registration. No live journal opened, app restart, new public admission or startup/quit wiring in this slice. Earlier included in this commit authority and factory-probe work preserved.
