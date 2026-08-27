#!/usr/bin/env bun
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const authorityPath = join(import.meta.dir, '..', 'packages', 'entitlement-service', '.dev.vars');
const authority = readFileSync(authorityPath, 'utf8');
const secret = Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString('base64url');
const updated = authority.replace(/^LEMON_WEBHOOK_SECRET=.*$/m, `LEMON_WEBHOOK_SECRET='${secret}'`);

if (updated === authority) throw new Error('Local Lemon webhook authority was not found.');
writeFileSync(authorityPath, updated, { mode: 0o600 });
chmodSync(authorityPath, 0o600);
console.log('Artist OS Lemon webhook secret rotated.');
