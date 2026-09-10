import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

/** OS birth identity distinguishes an owner from a later process reusing its PID. */
export function readOsProcessIdentity(pid: number): string | null {
  if (!Number.isSafeInteger(pid) || pid < 1) return null;
  try {
    if (process.platform === 'linux') {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      // comm may contain spaces and parentheses; starttime is field 22.
      const start = stat.slice(stat.lastIndexOf(')') + 2).split(/\s+/)[19];
      const boot = readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
      return start && /^\d+$/.test(start) && boot ? `os:linux:${boot}:${start}` : null;
    }
    if (process.platform === 'darwin') {
      const start = execFileSync('/bin/ps', ['-p', String(pid), '-o', 'lstart='], { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, LC_ALL: 'C', TZ: 'UTC' } }).trim();
      const boot = execFileSync('/usr/sbin/sysctl', ['-n', 'kern.boottime'], { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      const birth = /\bsec\s*=\s*(\d+).*?\busec\s*=\s*(\d+)/.exec(boot);
      return start && Number.isFinite(Date.parse(start)) && birth ? `os:darwin:${birth[1]}:${birth[2]}:${start}` : null;
    }
  } catch { /* Unavailable inspection must never authorize taking a live owner's claim. */ }
  return null;
}
let selfIdentity: string | undefined;
export function readProcessIdentity(pid: number): string | null {
  if (pid !== process.pid) return readOsProcessIdentity(pid);
  // Sandboxed tests can deny ps. This process-local identity proves equality only;
  // another process must conservatively retain its claim until this PID is dead.
  return selfIdentity ??= readOsProcessIdentity(pid) ?? `local:${process.pid}:${randomUUID()}`;
}
export function processIdentityProvesReplacement(saved: string | null, current: string | null): boolean {
  return Boolean(saved?.startsWith('os:') && current?.startsWith('os:') && saved !== current);
}
