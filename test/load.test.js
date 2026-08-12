'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadEnv } = require('../src/load');
const { withTempDir, writeEnvFile } = require('./helpers');

function resolved(over) {
  return {
    sharedFile: null,
    localFile: null,
    localFileExplicit: false,
    override: false,
    ...over
  };
}

function codeOf(fn) {
  try {
    fn();
  } catch (err) {
    return err.code;
  }
  return null;
}

test('loads a shared file only', () => {
  withTempDir((dir) => {
    const shared = writeEnvFile(dir, '.env-shared', [{ key: 'A', value: '1' }]);
    const out = loadEnv(resolved({ sharedFile: shared }));
    assert.equal(out.vars.get('A'), '1');
    assert.deepEqual(out.sources, [shared]);
    assert.deepEqual(out.missing, []);
  });
});

test('loads a local file only', () => {
  withTempDir((dir) => {
    const local = writeEnvFile(dir, '.env-local', [{ key: 'B', value: '2' }]);
    const out = loadEnv(resolved({ localFile: local, localFileExplicit: true }));
    assert.equal(out.vars.get('B'), '2');
    assert.deepEqual(out.sources, [local]);
  });
});

test('merges both with local winning', () => {
  withTempDir((dir) => {
    const shared = writeEnvFile(dir, '.env-shared', [
      { key: 'SAME', value: 'from-shared' },
      { key: 'ONLY_SHARED', value: 's' }
    ]);
    const local = writeEnvFile(dir, '.env-local', [
      { key: 'SAME', value: 'from-local' }
    ]);
    const out = loadEnv(
      resolved({ sharedFile: shared, localFile: local, localFileExplicit: true })
    );
    assert.equal(out.vars.get('SAME'), 'from-local');
    assert.equal(out.vars.get('ONLY_SHARED'), 's');
    assert.deepEqual(out.sources, [shared, local]);
  });
});

test('last duplicate key within one file wins', () => {
  withTempDir((dir) => {
    const shared = writeEnvFile(dir, '.env-shared', [
      { key: 'A', value: 'first' },
      { key: 'A', value: 'second' }
    ]);
    const out = loadEnv(resolved({ sharedFile: shared }));
    assert.equal(out.vars.get('A'), 'second');
  });
});

test('a missing shared file always throws', () => {
  withTempDir((dir) => {
    const missing = path.join(dir, 'nope.json');
    assert.equal(
      codeOf(() => loadEnv(resolved({ sharedFile: missing }))),
      'ERR_FILE_MISSING'
    );
  });
});

test('a missing explicit local file throws', () => {
  withTempDir((dir) => {
    const missing = path.join(dir, '.env-local');
    assert.equal(
      codeOf(() =>
        loadEnv(resolved({ localFile: missing, localFileExplicit: true }))
      ),
      'ERR_FILE_MISSING'
    );
  });
});

test('a missing defaulted local file is reported, not thrown', () => {
  withTempDir((dir) => {
    const missing = path.join(dir, '.env-local');
    const out = loadEnv(resolved({ localFile: missing, localFileExplicit: false }));
    assert.deepEqual(out.missing, [missing]);
    assert.deepEqual(out.sources, []);
    assert.equal(out.vars.size, 0);
  });
});

test('an unreadable file raises ERR_FILE_UNREADABLE with the cause', {
  // root bypasses permission bits, so chmod 000 would still be readable.
  // Without this guard the test passes locally and fails only in a root container.
  skip: process.getuid === undefined || process.getuid() === 0
    ? 'requires a non-root POSIX user'
    : false
}, () => {
  withTempDir((dir) => {
    const shared = writeEnvFile(dir, '.env-shared', [{ key: 'A', value: '1' }]);
    fs.chmodSync(shared, 0o000);
    try {
      loadEnv(resolved({ sharedFile: shared }));
      assert.fail('should have thrown');
    } catch (err) {
      assert.equal(err.code, 'ERR_FILE_UNREADABLE');
      assert.equal(err.path, shared);
      assert.equal(err.cause.code, 'EACCES');
    } finally {
      fs.chmodSync(shared, 0o600);
    }
  });
});

test('propagates parse errors with the file path attached', () => {
  withTempDir((dir) => {
    const shared = path.join(dir, '.env-shared');
    fs.writeFileSync(shared, '{not json');
    try {
      loadEnv(resolved({ sharedFile: shared }));
      assert.fail('should have thrown');
    } catch (err) {
      assert.equal(err.code, 'ERR_FILE_MALFORMED');
      assert.equal(err.path, shared);
    }
  });
});

test('loads nothing when both files are null', () => {
  const out = loadEnv(resolved());
  assert.equal(out.vars.size, 0);
  assert.deepEqual(out.sources, []);
  assert.deepEqual(out.missing, []);
});
