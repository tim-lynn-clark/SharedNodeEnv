'use strict';

const run = require('./index.js');

// Environment-variable configuration exists because ESM hoists all `import`
// statements above any function call. A consumer cannot call run() before
// importing their framework, so the side-effect import is the only ESM-safe
// ordering. Mirrors dotenv/config.
function configFromEnvironment() {
  const config = {};

  if (process.env.SHARED_NODE_ENV_SHARED) {
    config.sharedEnv = process.env.SHARED_NODE_ENV_SHARED;
  }
  if (process.env.SHARED_NODE_ENV_LOCAL) {
    config.localEnv = process.env.SHARED_NODE_ENV_LOCAL;
  }

  // Exactly the case-insensitive string "true" enables override. "1" and "yes"
  // are deliberately false: one unambiguous spelling avoids the class of bug
  // where "0" or "false" reads as truthy.
  config.override =
    String(process.env.SHARED_NODE_ENV_OVERRIDE || '').toLowerCase() === 'true';

  return config;
}

run(configFromEnvironment());

module.exports = run;
