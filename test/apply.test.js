'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { applyEnv } = require('../src/apply');
const { withCleanEnv } = require('./helpers');

test('sets variables that are not already present', () => {
  withCleanEnv(() => {
    delete process.env.SNE_TEST_NEW;
    const out = applyEnv(new Map([['SNE_TEST_NEW', 'value']]));
    assert.equal(process.env.SNE_TEST_NEW, 'value');
    assert.deepEqual(out.applied, ['SNE_TEST_NEW']);
    assert.deepEqual(out.skipped, []);
  });
});

test('does not clobber an existing value by default', () => {
  withCleanEnv(() => {
    process.env.SNE_TEST_EXISTING = 'from-platform';
    const out = applyEnv(new Map([['SNE_TEST_EXISTING', 'from-file']]));
    assert.equal(process.env.SNE_TEST_EXISTING, 'from-platform');
    assert.deepEqual(out.applied, []);
    assert.deepEqual(out.skipped, ['SNE_TEST_EXISTING']);
  });
});

test('override:true clobbers an existing value', () => {
  withCleanEnv(() => {
    process.env.SNE_TEST_EXISTING = 'from-platform';
    const out = applyEnv(
      new Map([['SNE_TEST_EXISTING', 'from-file']]),
      { override: true }
    );
    assert.equal(process.env.SNE_TEST_EXISTING, 'from-file');
    assert.deepEqual(out.applied, ['SNE_TEST_EXISTING']);
    assert.deepEqual(out.skipped, []);
  });
});

test('an existing empty string still counts as present', () => {
  withCleanEnv(() => {
    process.env.SNE_TEST_EMPTY = '';
    const out = applyEnv(new Map([['SNE_TEST_EMPTY', 'from-file']]));
    assert.equal(process.env.SNE_TEST_EMPTY, '');
    assert.deepEqual(out.skipped, ['SNE_TEST_EMPTY']);
  });
});

test('handles a mix of applied and skipped', () => {
  withCleanEnv(() => {
    process.env.SNE_TEST_A = 'existing';
    delete process.env.SNE_TEST_B;
    const out = applyEnv(
      new Map([
        ['SNE_TEST_A', 'file-a'],
        ['SNE_TEST_B', 'file-b']
      ])
    );
    assert.deepEqual(out.applied, ['SNE_TEST_B']);
    assert.deepEqual(out.skipped, ['SNE_TEST_A']);
  });
});

test('an empty map is a no-op', () => {
  withCleanEnv(() => {
    const out = applyEnv(new Map());
    assert.deepEqual(out, { applied: [], skipped: [] });
  });
});

test('the helper restores env after the test body', () => {
  process.env.SNE_TEST_RESTORE = 'original';
  withCleanEnv(() => {
    applyEnv(new Map([['SNE_TEST_RESTORE', 'changed']]), { override: true });
    assert.equal(process.env.SNE_TEST_RESTORE, 'changed');
  });
  assert.equal(process.env.SNE_TEST_RESTORE, 'original');
  delete process.env.SNE_TEST_RESTORE;
});
