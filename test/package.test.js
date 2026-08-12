'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const { withTempDir } = require('./helpers');

// Slow: npm pack plus a real install. Always runs in CI; opt in locally with
// RUN_PACKAGE_TESTS=1 (or `npm run test:package`).
const enabled = process.env.CI === 'true' || process.env.RUN_PACKAGE_TESTS === '1';
const skip = enabled ? false : 'set RUN_PACKAGE_TESTS=1 to run';

const repoRoot = path.resolve(__dirname, '..');

function packInto(dir) {
  const stdout = execFileSync('npm', ['pack', '--pack-destination', dir], {
    cwd: repoRoot,
    encoding: 'utf8'
  });
  const name = stdout.trim().split('\n').pop().trim();
  return path.join(dir, name);
}

function installInto(dir, tarball) {
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'consumer', version: '1.0.0', private: true })
  );
  execFileSync('npm', ['install', '--no-audit', '--no-fund', tarball], {
    cwd: dir,
    encoding: 'utf8'
  });
}

function writeFixture(dir) {
  const shared = path.join(dir, '.env-shared');
  fs.writeFileSync(shared, JSON.stringify([{ key: 'SNE_PKG', value: 'ok' }]));
  return shared;
}

test('tarball ships the right files and nothing else', { skip }, () => {
  withTempDir((dir) => {
    const tarball = packInto(dir);
    const listing = execFileSync('tar', ['-tf', tarball], { encoding: 'utf8' });

    for (const expected of [
      'package/index.js',
      'package/index.mjs',
      'package/config.js',
      'package/config.mjs',
      'package/src/resolve-config.js',
      'package/src/load.js',
      'package/src/apply.js',
      'package/src/parse.js',
      'package/src/errors.js'
    ]) {
      assert.ok(listing.includes(expected), `tarball should contain ${expected}`);
    }

    assert.ok(!listing.includes('package/test/'), 'tarball must not ship tests');
    assert.ok(!listing.includes('package/docs/'), 'tarball must not ship docs');
  });
});

test('installed package works via require()', { skip }, () => {
  withTempDir((dir) => {
    const tarball = packInto(dir);
    installInto(dir, tarball);
    const shared = writeFixture(dir);

    const script = `
      const run = require('shared-node-env');
      const out = run({ sharedEnv: ${JSON.stringify(shared)}, local: false });
      if (process.env.SNE_PKG !== 'ok') throw new Error('not injected');
      if (out.applied[0] !== 'SNE_PKG') throw new Error('bad result');
      console.log('cjs-ok');
    `;
    const stdout = execFileSync('node', ['-e', script], { cwd: dir, encoding: 'utf8' });
    assert.match(stdout, /cjs-ok/);
  });
});

test('installed package works via ESM import', { skip }, () => {
  withTempDir((dir) => {
    const tarball = packInto(dir);
    installInto(dir, tarball);
    const shared = writeFixture(dir);

    const entry = path.join(dir, 'consumer.mjs');
    fs.writeFileSync(
      entry,
      `import run from 'shared-node-env';
       const out = run({ sharedEnv: ${JSON.stringify(shared)}, local: false });
       if (process.env.SNE_PKG !== 'ok') throw new Error('not injected');
       if (out.applied[0] !== 'SNE_PKG') throw new Error('bad result');
       console.log('esm-ok');`
    );
    const stdout = execFileSync('node', [entry], { cwd: dir, encoding: 'utf8' });
    assert.match(stdout, /esm-ok/);
  });
});

test('side-effect entry works in both formats', { skip }, () => {
  withTempDir((dir) => {
    const tarball = packInto(dir);
    installInto(dir, tarball);
    const shared = writeFixture(dir);
    const env = { ...process.env, SHARED_NODE_ENV_SHARED: shared };

    const cjs = execFileSync(
      'node',
      ['-e', "require('shared-node-env/config'); console.log(process.env.SNE_PKG)"],
      { cwd: dir, encoding: 'utf8', env }
    );
    assert.match(cjs, /ok/);

    const entry = path.join(dir, 'side-effect.mjs');
    fs.writeFileSync(
      entry,
      `import 'shared-node-env/config';
       console.log(process.env.SNE_PKG);`
    );
    const esm = execFileSync('node', [entry], { cwd: dir, encoding: 'utf8', env });
    assert.match(esm, /ok/);
  });
});
