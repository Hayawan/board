import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig, ensureDataDir } from './config.js';

// This test lives in src/; the repo root (the "app tree" data must never land in) is one up.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('DATA_DIR-rooted paths (Story 2.2)', () => {
  // AC 1 / AC 3 — all data paths derive from DATA_DIR and none lands in the app tree
  it('derives dbPath and screenshotsDir under DATA_DIR, never under the app tree', () => {
    const dataDir = join(tmpdir(), 'board-oss-paths-xyz');
    const c = loadConfig({ DATA_DIR: dataDir });

    assert.ok(c.dbPath.startsWith(resolve(dataDir)), `dbPath ${c.dbPath} not under DATA_DIR`);
    assert.ok(
      c.screenshotsDir.startsWith(resolve(dataDir)),
      `screenshotsDir ${c.screenshotsDir} not under DATA_DIR`,
    );

    // The regression this story prevents: NO data path resolves into the repo tree.
    assert.ok(!resolve(c.dbPath).startsWith(repoRoot), 'dbPath must not be inside the app tree');
    assert.ok(
      !resolve(c.screenshotsDir).startsWith(repoRoot),
      'screenshotsDir must not be inside the app tree',
    );
  });

  // AC 2 — the data dir (and screenshots subdir) is created if missing
  it('creates DATA_DIR and the screenshots subdir on ensureDataDir', () => {
    const dir = mkdtempSync(join(tmpdir(), 'board-oss-ensure-'));
    const dataDir = join(dir, 'nested', 'data'); // does not exist yet
    const c = loadConfig({ DATA_DIR: dataDir });
    assert.equal(existsSync(c.screenshotsDir), false);

    ensureDataDir(c);
    assert.ok(existsSync(c.dataDir), 'DATA_DIR should be created');
    assert.ok(existsSync(c.screenshotsDir), 'screenshots subdir should be created');

    rmSync(dir, { recursive: true, force: true });
  });
});
