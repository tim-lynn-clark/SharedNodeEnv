'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { parseEnvData } = require('../src/parse');

const P = '/tmp/.env-shared';

function codeOf(fn) {
  try {
    fn();
  } catch (err) {
    return err.code;
  }
  return null;
}

test('parses a valid array of pairs', () => {
  const text = JSON.stringify([
    { key: 'A', value: '1' },
    { key: 'B', value: '2' }
  ]);
  assert.deepEqual(parseEnvData(text, P), [
    { key: 'A', value: '1' },
    { key: 'B', value: '2' }
  ]);
});

test('accepts an empty array', () => {
  assert.deepEqual(parseEnvData('[]', P), []);
});

test('coerces numbers and booleans to strings', () => {
  const text = JSON.stringify([
    { key: 'N', value: 123 },
    { key: 'B', value: true }
  ]);
  assert.deepEqual(parseEnvData(text, P), [
    { key: 'N', value: '123' },
    { key: 'B', value: 'true' }
  ]);
});

test('keeps duplicate keys in order so the last one wins downstream', () => {
  const text = JSON.stringify([
    { key: 'A', value: 'first' },
    { key: 'A', value: 'second' }
  ]);
  assert.deepEqual(parseEnvData(text, P), [
    { key: 'A', value: 'first' },
    { key: 'A', value: 'second' }
  ]);
});

test('rejects an empty string', () => {
  assert.equal(codeOf(() => parseEnvData('', P)), 'ERR_FILE_EMPTY');
});

test('rejects a whitespace-only file', () => {
  assert.equal(codeOf(() => parseEnvData('   \n\t ', P)), 'ERR_FILE_EMPTY');
});

test('rejects invalid JSON', () => {
  assert.equal(codeOf(() => parseEnvData('{not json', P)), 'ERR_FILE_MALFORMED');
});

test('rejects a JSON object instead of an array', () => {
  assert.equal(codeOf(() => parseEnvData('{"A":"1"}', P)), 'ERR_FILE_MALFORMED');
});

test('rejects a bare JSON scalar', () => {
  assert.equal(codeOf(() => parseEnvData('42', P)), 'ERR_FILE_MALFORMED');
});

test('rejects an entry that is not an object', () => {
  assert.equal(codeOf(() => parseEnvData('["A"]', P)), 'ERR_ENTRY_INVALID');
});

test('rejects a null entry', () => {
  assert.equal(codeOf(() => parseEnvData('[null]', P)), 'ERR_ENTRY_INVALID');
});

test('rejects an entry missing key', () => {
  assert.equal(codeOf(() => parseEnvData('[{"value":"1"}]', P)), 'ERR_ENTRY_INVALID');
});

test('rejects an empty key', () => {
  assert.equal(codeOf(() => parseEnvData('[{"key":"  ","value":"1"}]', P)), 'ERR_ENTRY_INVALID');
});

test('rejects a null value', () => {
  assert.equal(codeOf(() => parseEnvData('[{"key":"A","value":null}]', P)), 'ERR_ENTRY_INVALID');
});

test('rejects an object value', () => {
  assert.equal(codeOf(() => parseEnvData('[{"key":"A","value":{}}]', P)), 'ERR_ENTRY_INVALID');
});

test('rejects a missing value', () => {
  assert.equal(codeOf(() => parseEnvData('[{"key":"A"}]', P)), 'ERR_ENTRY_INVALID');
});

test('attaches the file path to every error', () => {
  try {
    parseEnvData('nope', P);
    assert.fail('should have thrown');
  } catch (err) {
    assert.equal(err.path, P);
  }
});

test('names the offending index in the message', () => {
  try {
    parseEnvData('[{"key":"A","value":"1"},{"value":"2"}]', P);
    assert.fail('should have thrown');
  } catch (err) {
    assert.ok(err.message.includes('1'), 'message should mention index 1');
  }
});
