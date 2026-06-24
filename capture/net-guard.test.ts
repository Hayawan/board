import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { assertCapturableUrl, BlockedUrlError } from './net-guard.js';

// Follow-up (SSRF) — block server-side capture of private/loopback/link-local addresses.
// Table-driven on BYPASS FORMS (the discriminator), not just "127.0.0.1 blocked".

const publicLookup = async () => [{ address: '93.184.216.34' }]; // example.com-ish public IP

async function blocked(url: string, lookup?: any) {
  await assert.rejects(assertCapturableUrl(url, lookup ? { lookup } : {}), BlockedUrlError, `expected BLOCKED: ${url}`);
}
async function allowed(url: string, lookup?: any) {
  await assert.doesNotReject(assertCapturableUrl(url, lookup ? { lookup } : {}), `expected ALLOWED: ${url}`);
}

describe('assertCapturableUrl (SSRF denylist)', () => {
  it('blocks loopback / private / link-local IPv4 literals', async () => {
    for (const u of [
      'http://127.0.0.1/', 'http://127.0.0.1:8080/admin', 'http://10.0.0.1/', 'http://172.16.5.4/',
      'http://172.31.255.255/', 'http://192.168.1.1/', 'http://169.254.169.254/latest/meta-data/',
      'http://0.0.0.0/', 'http://100.64.0.1/',
    ]) await blocked(u);
  });

  it('blocks IPv6 loopback and IPv4-mapped IPv6', async () => {
    await blocked('http://[::1]/');
    await blocked('http://[::ffff:127.0.0.1]/');
    await blocked('http://[fe80::1]/');
    await blocked('http://[fc00::1]/');
  });

  it('blocks numeric-encoded IPv4 (decimal + hex) for loopback', async () => {
    await blocked('http://2130706433/');   // 127.0.0.1 as a 32-bit int
    await blocked('http://0x7f000001/');   // 127.0.0.1 as hex
  });

  it('blocks the userinfo bypass (real host is private)', async () => {
    await blocked('http://example.com@127.0.0.1/');
  });

  it('blocks localhost-family hostnames', async () => {
    for (const u of ['http://localhost/', 'http://anything.local/', 'http://svc.internal/', 'http://metadata.google.internal/'])
      await blocked(u);
  });

  it('blocks non-http(s) schemes and invalid URLs', async () => {
    await blocked('ftp://example.com/');
    await blocked('file:///etc/passwd');
    await blocked('gopher://127.0.0.1/');
    await blocked('not a url');
  });

  it('blocks a public hostname that RESOLVES to a private address (the real SSRF vector)', async () => {
    await blocked('http://rebind.evil.test/', async () => [{ address: '10.0.0.5' }]);
    await blocked('http://rebind.evil.test/', async () => [{ address: '93.184.216.34' }, { address: '127.0.0.1' }]); // any private
  });

  it('allows public IP literals and public hostnames', async () => {
    await allowed('http://93.184.216.34/');            // public literal — no DNS
    await allowed('https://1.1.1.1/');
    await allowed('https://example.com/path?q=1', publicLookup);
    await allowed('http://sub.example.com/', publicLookup);
  });

  it('allows a host whose DNS resolution fails (lets the real fetch surface the error)', async () => {
    await allowed('http://nxdomain.example/', async () => { throw new Error('ENOTFOUND'); });
  });
});
