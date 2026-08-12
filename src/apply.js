'use strict';

function applyEnv(vars, options = {}) {
  const override = options.override === true;
  const applied = [];
  const skipped = [];

  for (const [key, value] of vars) {
    if (!override && Object.prototype.hasOwnProperty.call(process.env, key)) {
      skipped.push(key);
      continue;
    }
    process.env[key] = value;
    applied.push(key);
  }

  return { applied, skipped };
}

module.exports = { applyEnv };
