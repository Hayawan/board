import net from 'node:net';
import dns from 'node:dns/promises';

// Follow-up (SSRF) — server-side capture must not fetch private/loopback/link-local
// addresses. Every place the SERVER fetches a USER-supplied URL routes through one of two
// seams (dispatchCapture + the snapshot capture()), and both call assertCapturableUrl
// first. This is a DENYLIST (block known-internal), the realistic protection for a
// self-hosted box: scheme allowlist + IP-range checks + localhost-family hostnames + a
// DNS-resolve-and-recheck (the real `evil.com → 10.0.0.5` vector).
//
// Residuals (documented, not closed): DNS-rebinding TOCTOU (puppeteer/fetch re-resolve at
// connect time — can't pin without connection-time IP control they don't expose);
// octal-per-octet / mixed numeric IPv4 encodings; IPv6 forms net.isIP() rejects.

export class BlockedUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlockedUrlError';
  }
}

export interface UrlGuardOptions {
  /** Injectable DNS (tests); defaults to dns.lookup(host, {all:true}). */
  lookup?: (host: string) => Promise<Array<{ address: string }>>;
}

// Private / loopback / link-local / ULA / CGNAT ranges. net.BlockList does the range math.
const BLOCK = new net.BlockList();
BLOCK.addSubnet('0.0.0.0', 8, 'ipv4'); // "this network"
BLOCK.addSubnet('10.0.0.0', 8, 'ipv4');
BLOCK.addSubnet('127.0.0.0', 8, 'ipv4'); // loopback
BLOCK.addSubnet('169.254.0.0', 16, 'ipv4'); // link-local (incl. cloud metadata 169.254.169.254)
BLOCK.addSubnet('172.16.0.0', 12, 'ipv4');
BLOCK.addSubnet('192.168.0.0', 16, 'ipv4');
BLOCK.addSubnet('100.64.0.0', 10, 'ipv4'); // CGNAT
BLOCK.addAddress('::1', 'ipv6'); // loopback
BLOCK.addAddress('::', 'ipv6'); // unspecified
BLOCK.addSubnet('fe80::', 10, 'ipv6'); // link-local
BLOCK.addSubnet('fc00::', 7, 'ipv6'); // ULA

const BLOCKED_NAME = /^(localhost|.*\.local|.*\.internal|.*\.localhost|metadata\.google\.internal)$/i;

/** Decode a whole-host numeric IPv4 (decimal int or 0x-hex) to dotted form, else null. */
function decodeNumericIPv4(host: string): string | null {
  let n: number | null = null;
  if (/^\d+$/.test(host)) n = Number(host);
  else if (/^0x[0-9a-f]+$/i.test(host)) n = parseInt(host, 16);
  if (n == null || !Number.isInteger(n) || n < 0 || n > 0xffffffff) return null;
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

/** True if `ip` (an IP literal) falls in a blocked range. Handles IPv4-mapped IPv6. */
function ipBlocked(ip: string): boolean {
  const fam = net.isIP(ip);
  if (fam === 4) return BLOCK.check(ip, 'ipv4');
  if (fam === 6) {
    const mapped = ip.match(/::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i); // ::ffff:127.0.0.1
    if (mapped && net.isIP(mapped[1]) === 4 && BLOCK.check(mapped[1], 'ipv4')) return true;
    return BLOCK.check(ip, 'ipv6');
  }
  return false;
}

/**
 * Throw BlockedUrlError if `raw` is not a public http(s) URL safe for the server to fetch.
 * Async because a hostname is DNS-resolved and rechecked. Fail-closed: on a bad URL/scheme
 * or a private resolution it throws; the caller's capture-error path marks the item `error`.
 */
export async function assertCapturableUrl(raw: string, opts: UrlGuardOptions = {}): Promise<void> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BlockedUrlError(`not a valid URL: ${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BlockedUrlError(`scheme not allowed: ${url.protocol}`);
  }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase(); // strip IPv6 brackets
  if (!host) throw new BlockedUrlError('empty host');
  if (BLOCKED_NAME.test(host)) throw new BlockedUrlError(`blocked host: ${host}`);

  const literal = decodeNumericIPv4(host) ?? host;
  if (net.isIP(literal)) {
    if (ipBlocked(literal)) throw new BlockedUrlError(`blocked address: ${host}`);
    return; // a public IP literal — nothing to resolve
  }

  // A hostname: resolve and recheck (catches a name that points at an internal IP).
  const lookup = opts.lookup ?? ((h: string) => dns.lookup(h, { all: true }));
  let addrs: Array<{ address: string }>;
  try {
    addrs = await lookup(host);
  } catch {
    return; // resolution failed — let the real fetch surface the error, don't false-block
  }
  for (const a of addrs) {
    if (ipBlocked(a.address)) {
      throw new BlockedUrlError(`host ${host} resolves to a private address (${a.address})`);
    }
  }
}
