'use strict';

const path = require('node:path');
const { SharedNodeEnvError } = require('./errors');

const DEFAULT_LOCAL_FILENAME = '.env-local';

function resolveConfig(input) {
  if (input === undefined || input === null) {
    return {
      sharedFile: null,
      localFile: path.resolve(process.cwd(), DEFAULT_LOCAL_FILENAME),
      localFileExplicit: false,
      override: false
    };
  }

  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new SharedNodeEnvError('ERR_CONFIG_INVALID', 'Configuration must be an object.');
  }

  assertBoolean(input.local, 'local');
  assertBoolean(input.override, 'override');

  const sharedFile =
    input.sharedEnv === undefined ? null : resolvePath(input.sharedEnv, 'sharedEnv');

  // Validate localEnv whenever it is supplied, even if local is disabled, so a
  // typo is reported rather than silently ignored.
  const localEnvPath =
    input.localEnv === undefined ? null : resolvePath(input.localEnv, 'localEnv');

  const localEnabled = input.local !== false;

  let localFile = null;
  if (localEnabled) {
    localFile =
      localEnvPath === null
        ? path.resolve(process.cwd(), DEFAULT_LOCAL_FILENAME)
        : localEnvPath;
  }

  return {
    sharedFile,
    localFile,
    localFileExplicit: localEnabled && localEnvPath !== null,
    override: input.override === true
  };
}

function resolvePath(value, keyName) {
  if (typeof value !== 'string') {
    throw new SharedNodeEnvError(
      'ERR_CONFIG_INVALID',
      `Configuration key "${keyName}" must be a string.`
    );
  }
  if (value.trim() === '') {
    throw new SharedNodeEnvError(
      'ERR_CONFIG_INVALID',
      `Configuration key "${keyName}" must not be empty.`
    );
  }
  return path.resolve(value);
}

function assertBoolean(value, keyName) {
  if (value !== undefined && typeof value !== 'boolean') {
    throw new SharedNodeEnvError(
      'ERR_CONFIG_INVALID',
      `Configuration key "${keyName}" must be a boolean.`
    );
  }
}

module.exports = { resolveConfig, DEFAULT_LOCAL_FILENAME };
