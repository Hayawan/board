import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Importing this module must NOT throw even with no Chrome present (AC 5 — lazy).
import { resolveChromePath, launchBrowser } from './browser.js';

describe('resolveChromePath (Story 2.3)', () => {
  // AC 1 — configured CHROME_PATH wins (lookup not consulted)
  it('uses the configured chromePath when set', () => {
    let consulted = false;
    const lookup = () => {
      consulted = true;
      return null;
    };
    assert.equal(resolveChromePath({ chromePath: '/opt/chrome', lookup }), '/opt/chrome');
    assert.equal(consulted, false, 'lookup must not run when chromePath is set');
  });

  // AC 2 — autodetect probes candidates and uses the first that resolves
  it('autodetects the first resolvable candidate', () => {
    const lookup = (c: string) => (c === 'google-chrome' ? '/usr/bin/google-chrome' : null);
    assert.equal(resolveChromePath({ chromePath: null, lookup }), '/usr/bin/google-chrome');
  });

  // AC 2 — probe ORDER: chromium first (the Debian LXC target)
  it('prefers chromium over later candidates when several resolve', () => {
    const lookup = (c: string) => (c.startsWith('/') ? null : `/usr/bin/${c}`);
    assert.equal(resolveChromePath({ chromePath: null, lookup }), '/usr/bin/chromium');
  });

  // AC 3 — none found → clear, named error telling the user to set CHROME_PATH
  it('throws a CHROME_PATH-naming error when nothing is found', () => {
    assert.throws(() => resolveChromePath({ chromePath: null, lookup: () => null }), /CHROME_PATH/);
  });
});

describe('launchBrowser laziness (Story 2.3)', () => {
  // AC 5 — resolution is lazy: it only fires at launch time, surfacing the named
  // error then (importing the module above already proved import() doesn't throw).
  it('throws the named error only when launchBrowser is invoked with no Chrome', async () => {
    await assert.rejects(launchBrowser({ chromePath: null, lookup: () => null }), /CHROME_PATH/);
  });
});
