'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { SharedNodeEnvError } = require('../src/errors');

test('is an Error with a stable name', () => {
  const err = new SharedNodeEnvError('ERR_FILE_EMPTY', 'boom');
  assert.ok(err instanceof Error);
  assert.equal(err.name, 'SharedNodeEnvError');
  assert.equal(err.message, 'boom');
});

test('carries the code', () => {
  const err = new SharedNodeEnvError('ERR_CONFIG_INVALID', 'boom');
  assert.equal(err.code, 'ERR_CONFIG_INVALID');
});

test('path defaults to null and is set from options', () => {
  assert.equal(new SharedNodeEnvError('ERR_FILE_EMPTY', 'x').path, null);
  assert.equal(
    new SharedNodeEnvError('ERR_FILE_EMPTY', 'x', { path: '/tmp/a' }).path,
    '/tmp/a'
  );
});

test('preserves the underlying cause', () => {
  const cause = new Error('EACCES');
  const err = new SharedNodeEnvError('ERR_FILE_UNREADABLE', 'x', { cause });
  assert.equal(err.cause, cause);
});
