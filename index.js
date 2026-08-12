'use strict';

const { resolveConfig } = require('./src/resolve-config');
const { loadEnv } = require('./src/load');
const { applyEnv } = require('./src/apply');
const { SharedNodeEnvError } = require('./src/errors');

function run(config) {
  const resolved = resolveConfig(config);
  const { vars, sources, missing } = loadEnv(resolved);
  const { applied, skipped } = applyEnv(vars, { override: resolved.override });
  return { applied, skipped, sources, missing };
}

run.SharedNodeEnvError = SharedNodeEnvError;

module.exports = run;
