'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { resolveConfig } = require('../src/resolve-config');

function codeOf(fn) {
  try {
    fn();
  } catch (err) {
    return err.code;
  }
  return null;
}

const defaultLocal = () => path.resolve(process.cwd(), '.env-local');

test('undefined config defaults to local-only', () => {
  assert.deepEqual(resolveConfig(), {
    sharedFile: null,
    localFile: defaultLocal(),
    localFileExplicit: false,
    override: false
  });
});

test('null config behaves like undefined', () => {
  assert.deepEqual(resolveConfig(null), resolveConfig());
});

test('empty object behaves like undefined', () => {
  assert.deepEqual(resolveConfig({}), resolveConfig());
});

test('resolves sharedEnv to an absolute path', () => {
  const out = resolveConfig({ sharedEnv: '/etc/app/.env-shared' });
  assert.equal(out.sharedFile, path.resolve('/etc/app/.env-shared'));
});

test('resolves a relative path against cwd', () => {
  const out = resolveConfig({ sharedEnv: './conf/.env-shared' });
  assert.equal(out.sharedFile, path.resolve(process.cwd(), './conf/.env-shared'));
});

test('accepts any filename, with no naming restriction', () => {
  const out = resolveConfig({ sharedEnv: '/etc/whatever.json' });
  assert.equal(out.sharedFile, path.resolve('/etc/whatever.json'));
});

test('explicit localEnv sets the explicit flag', () => {
  const out = resolveConfig({ localEnv: '/srv/.env-local' });
  assert.equal(out.localFile, path.resolve('/srv/.env-local'));
  assert.equal(out.localFileExplicit, true);
});

test('local:false disables local entirely', () => {
  const out = resolveConfig({ sharedEnv: '/a/.env-shared', local: false });
  assert.equal(out.localFile, null);
  assert.equal(out.localFileExplicit, false);
});

test('local:false beats an explicit localEnv', () => {
  const out = resolveConfig({ localEnv: '/srv/.env-local', local: false });
  assert.equal(out.localFile, null);
  assert.equal(out.localFileExplicit, false);
});

test('override defaults to false and is honored when true', () => {
  assert.equal(resolveConfig({}).override, false);
  assert.equal(resolveConfig({ override: false }).override, false);
  assert.equal(resolveConfig({ override: true }).override, true);
});

test('rejects a non-object config', () => {
  assert.equal(codeOf(() => resolveConfig('nope')), 'ERR_CONFIG_INVALID');
  assert.equal(codeOf(() => resolveConfig(42)), 'ERR_CONFIG_INVALID');
  assert.equal(codeOf(() => resolveConfig([])), 'ERR_CONFIG_INVALID');
});

test('rejects an empty or whitespace path', () => {
  assert.equal(codeOf(() => resolveConfig({ sharedEnv: '' })), 'ERR_CONFIG_INVALID');
  assert.equal(codeOf(() => resolveConfig({ sharedEnv: '   ' })), 'ERR_CONFIG_INVALID');
  assert.equal(codeOf(() => resolveConfig({ localEnv: '' })), 'ERR_CONFIG_INVALID');
});

test('rejects a non-string path', () => {
  assert.equal(codeOf(() => resolveConfig({ sharedEnv: 42 })), 'ERR_CONFIG_INVALID');
  assert.equal(codeOf(() => resolveConfig({ localEnv: {} })), 'ERR_CONFIG_INVALID');
});

test('validates localEnv even when local is disabled', () => {
  assert.equal(
    codeOf(() => resolveConfig({ localEnv: 42, local: false })),
    'ERR_CONFIG_INVALID'
  );
});

test('rejects non-boolean local and override', () => {
  assert.equal(codeOf(() => resolveConfig({ local: 'yes' })), 'ERR_CONFIG_INVALID');
  assert.equal(codeOf(() => resolveConfig({ override: 1 })), 'ERR_CONFIG_INVALID');
});
