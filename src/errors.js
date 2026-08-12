'use strict';

class SharedNodeEnvError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'SharedNodeEnvError';
    this.code = code;
    this.path = options.path === undefined ? null : options.path;
  }
}

module.exports = { SharedNodeEnvError };
