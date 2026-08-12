'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const run = require('../index.js');
const { withTempDir, withCleanEnv, writeEnvFile } = require('./helpers');

test('returns applied, skipped, sources and missing', () => {
  withTempDir((dir) => {
    withCleanEnv(() => {
      const shared = writeEnvFile(dir, '.env-shared', [
        { key: 'SNE_RUN_A', value: '1' }
      ]);
      delete process.env.SNE_RUN_A;
      const out = run({ sharedEnv: shared, local: false });
      assert.deepEqual(out.applied, ['SNE_RUN_A']);
      assert.deepEqual(out.skipped, []);
      assert.deepEqual(out.sources, [shared]);
      assert.deepEqual(out.missing, []);
      assert.equal(process.env.SNE_RUN_A, '1');
    });
  });
});

// The bug that motivated the 2.0 restructure. In 1.x, `doLocal` and
// `sharedEnvFile` were module-level and survived between calls, so this second
// call silently loaded nothing.
test('run() is re-entrant: a later call is not poisoned by an earlier one', () => {
  withTempDir((dir) => {
    withCleanEnv(() => {
      const shared = writeEnvFile(dir, '.env-shared', [
        { key: 'SNE_REENTRANT_SHARED', value: 'shared-1' }
      ]);
      writeEnvFile(dir, '.env-local', [
        { key: 'SNE_REENTRANT_LOCAL', value: 'local-1' }
      ]);

      delete process.env.SNE_REENTRANT_SHARED;
      delete process.env.SNE_REENTRANT_LOCAL;

      run({ sharedEnv: shared, local: false });
      assert.equal(process.env.SNE_REENTRANT_SHARED, 'shared-1');
      assert.equal(process.env.SNE_REENTRANT_LOCAL, undefined);

      const originalCwd = process.cwd();
      process.chdir(dir);
      try {
        const out = run();
        assert.equal(
          process.env.SNE_REENTRANT_LOCAL,
          'local-1',
          'second call must re-enable local and load ./.env-local'
        );
        assert.deepEqual(out.sources, [path.join(dir, '.env-local')]);
      } finally {
        process.chdir(originalCwd);
      }
    });
  });
});

test('local overrides shared even when override is false', () => {
  withTempDir((dir) => {
    withCleanEnv(() => {
      const shared = writeEnvFile(dir, '.env-shared', [
        { key: 'SNE_MERGE', value: 'from-shared' }
      ]);
      const local = writeEnvFile(dir, '.env-local', [
        { key: 'SNE_MERGE', value: 'from-local' }
      ]);
      delete process.env.SNE_MERGE;
      run({ sharedEnv: shared, localEnv: local });
      assert.equal(process.env.SNE_MERGE, 'from-local');
    });
  });
});

test('a pre-existing process.env value beats both files by default', () => {
  withTempDir((dir) => {
    withCleanEnv(() => {
      const shared = writeEnvFile(dir, '.env-shared', [
        { key: 'SNE_PLATFORM', value: 'from-shared' }
      ]);
      const local = writeEnvFile(dir, '.env-local', [
        { key: 'SNE_PLATFORM', value: 'from-local' }
      ]);
      process.env.SNE_PLATFORM = 'from-platform';
      const out = run({ sharedEnv: shared, localEnv: local });
      assert.equal(process.env.SNE_PLATFORM, 'from-platform');
      assert.deepEqual(out.skipped, ['SNE_PLATFORM']);
    });
  });
});

test('override:true lets the merged file value win', () => {
  withTempDir((dir) => {
    withCleanEnv(() => {
      const shared = writeEnvFile(dir, '.env-shared', [
        { key: 'SNE_OVERRIDE', value: 'from-shared' }
      ]);
      const local = writeEnvFile(dir, '.env-local', [
        { key: 'SNE_OVERRIDE', value: 'from-local' }
      ]);
      process.env.SNE_OVERRIDE = 'from-platform';
      run({ sharedEnv: shared, localEnv: local, override: true });
      assert.equal(process.env.SNE_OVERRIDE, 'from-local');
    });
  });
});

test('a missing defaulted local file does not throw', () => {
  withTempDir((dir) => {
    withCleanEnv(() => {
      const originalCwd = process.cwd();
      process.chdir(dir);
      try {
        const out = run();
        assert.deepEqual(out.missing, [path.join(dir, '.env-local')]);
        assert.deepEqual(out.applied, []);
      } finally {
        process.chdir(originalCwd);
      }
    });
  });
});

test('exposes the error class for instanceof checks', () => {
  assert.equal(typeof run.SharedNodeEnvError, 'function');
  try {
    run({ sharedEnv: 42 });
    assert.fail('should have thrown');
  } catch (err) {
    assert.ok(err instanceof run.SharedNodeEnvError);
    assert.equal(err.code, 'ERR_CONFIG_INVALID');
  }
});
