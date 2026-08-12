'use strict';

const fs = require('node:fs');
const { parseEnvData } = require('./parse');
const { SharedNodeEnvError } = require('./errors');

function loadEnv(resolved) {
  const vars = new Map();
  const sources = [];
  const missing = [];

  // Shared first, then local, so local overwrites shared in `vars`. The merged
  // map is what gets compared against process.env later — applying the two
  // files separately would let a shared value block its own local override.
  readInto(resolved.sharedFile, true, vars, sources, missing);
  readInto(resolved.localFile, resolved.localFileExplicit, vars, sources, missing);

  return { vars, sources, missing };
}

function readInto(filePath, required, vars, sources, missing) {
  if (filePath === null) {
    return;
  }

  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (cause) {
    if (cause.code === 'ENOENT') {
      if (required) {
        throw new SharedNodeEnvError(
          'ERR_FILE_MISSING',
          `Environment file does not exist: ${filePath}`,
          { path: filePath, cause }
        );
      }
      missing.push(filePath);
      return;
    }
    throw new SharedNodeEnvError(
      'ERR_FILE_UNREADABLE',
      `Environment file could not be read: ${filePath}`,
      { path: filePath, cause }
    );
  }

  for (const pair of parseEnvData(text, filePath)) {
    vars.set(pair.key, pair.value);
  }
  sources.push(filePath);
}

module.exports = { loadEnv };
