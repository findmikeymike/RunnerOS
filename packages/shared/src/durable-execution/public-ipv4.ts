import { isIP } from 'node:net';

/** Conservative public IPv4 only. IPv6 and IANA special-use blocks are unsupported. */
export function isPublicDurableWebIpv4(address: string): boolean {
  if (isIP(address) !== 4) return false;
  const [a, b, c] = address.split('.').map(Number);
  if (a === undefined || b === undefined || c === undefined) return false;
  return !(a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && ((b === 0 && (c === 0 || c === 2)) || b === 168
      || (b === 88 && c === 99) || (b === 31 && c === 196)
      || (b === 52 && c === 193) || (b === 175 && c === 48)))
    || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
    || (a === 203 && b === 0 && c === 113));
}
