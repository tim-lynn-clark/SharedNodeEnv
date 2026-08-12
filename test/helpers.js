'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Creates a temp directory, passes it to fn, and always removes it — even when
// fn throws — so a failing assertion cannot leak fixtures into os.tmpdir().
//
// realpathSync matters on macOS, where os.tmpdir() is /var/folders/... but
// process.cwd() after chdir reports the resolved /private/var/folders/....
// Without it, any test that chdirs into the temp dir and compares a returned
// path against path.join(dir, ...) fails on macOS and passes on Linux.
function withTempDir(fn) {
  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'shared-node-env-'))
  );
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Snapshots process.env, runs fn, then restores by key. Reassigning process.env
// wholesale does not propagate to child processes and breaks the real binding,
// so keys are deleted and reinstated individually.
function withCleanEnv(fn) {
  const snapshot = { ...process.env };
  try {
    return fn();
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!(key in snapshot)) {
        delete process.env[key];
      }
    }
    for (const [key, value] of Object.entries(snapshot)) {
      if (process.env[key] !== value) {
        process.env[key] = value;
      }
    }
  }
}

function writeEnvFile(dir, name, pairs) {
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, JSON.stringify(pairs));
  return filePath;
}

module.exports = { withTempDir, withCleanEnv, writeEnvFile };
