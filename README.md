# SharedNodeEnv

A Node.js library for sharing environment variables across multiple Node
applications running on the same server — variables that must stay identical
everywhere and be updated in one place when they change.

Each application can also keep its own local environment file. Where the local
file and the shared file define the same key, the local value wins.

**Zero runtime dependencies.** Requires Node.js 20 or later.

## Installation

    npm install shared-node-env

## Use

Load and run the library before anything else in your application, so the
variables are on `process.env` before any other module reads them.

```js
const path = require('path');

const result = require('shared-node-env')({
  sharedEnv: path.resolve('/etc/myapp/.env-shared'),
  localEnv: path.resolve(process.cwd(), '.env-local'),
  local: true,
  override: false
});

console.log(result.applied);  // keys that were set
console.log(result.skipped);  // keys already present in process.env
console.log(result.sources);  // files that were read
console.log(result.missing);  // defaulted files that were not found

const express = require('express');
const app = express();
app.listen(process.env.PORT);
```

### ESM

In ESM, **every `import` statement is hoisted and evaluated before any function
call in the module body**. This breaks the library's entire purpose if you call
it directly:

```js
// WRONG — express is hoisted above the run() call and loads without your vars.
import run from 'shared-node-env';
run({ sharedEnv: '/etc/myapp/.env-shared' });
import express from 'express';
```

Use the side-effect entry point instead. It runs at import time, in order:

```js
// Correct.
import 'shared-node-env/config';
import express from 'express';
```

Configure it with environment variables:

| Variable | Maps to |
|---|---|
| `SHARED_NODE_ENV_SHARED` | `sharedEnv` |
| `SHARED_NODE_ENV_LOCAL` | `localEnv` |
| `SHARED_NODE_ENV_OVERRIDE` | `override` |

`SHARED_NODE_ENV_OVERRIDE` is enabled only by the exact case-insensitive string
`true`. Every other value — including `1` and `yes` — is false. One unambiguous
spelling avoids the class of bug where `"0"` or `"false"` reads as truthy.

The same entry point works in CommonJS:

```js
require('shared-node-env/config');
```

## Configuration

All keys are optional.

| Key | Type | Default | Meaning |
|---|---|---|---|
| `sharedEnv` | string | none | Path to the shared file. Any path; no filename restriction. If named and missing, throws. |
| `localEnv` | string | `./.env-local` | Path to the local file. If named explicitly and missing, throws. If defaulted and missing, reported in `missing`. |
| `local` | boolean | `true` | Set `false` to skip the local file entirely. Beats an explicit `localEnv`. |
| `override` | boolean | `false` | Whether file values replace variables already in `process.env`. |

Relative paths resolve against the current working directory.

### Return value

`run()` returns an object:

```js
{
  applied: ['SERVER_ID'],       // keys written to process.env
  skipped: ['PORT'],            // keys left alone because they already existed
  sources: ['/etc/.env-shared'] // files actually read
  missing: []                   // defaulted files that were absent
}
```

### Precedence

1. A value already in `process.env` wins, unless `override: true`.
2. Otherwise the local file wins over the shared file.

The two files are merged into a single set *before* anything is compared
against `process.env`, so a shared value can never block its own local
override.

## Environment File Format

A JSON array of key/value objects:

```json
[
  {
    "key": "SERVER_ID",
    "value": "123456"
  },
  {
    "key": "SYSTEM_TOKEN",
    "value": "qwe789asd"
  }
]
```

`value` may be a string, number, or boolean; it is converted to a string, since
that is all `process.env` can hold. Duplicate keys within one file resolve to
the last occurrence.

The account running the application needs read permission on both files.

## Errors

Every failure throws a `SharedNodeEnvError` carrying a stable `code`, the
offending `path`, and — for filesystem failures — the original error as
`cause`. Branch on `code`, never on message text:

```js
const run = require('shared-node-env');

try {
  run({ sharedEnv: '/etc/myapp/.env-shared' });
} catch (err) {
  if (err instanceof run.SharedNodeEnvError && err.code === 'ERR_FILE_MISSING') {
    console.error('No shared env file at', err.path);
    process.exit(1);
  }
  throw err;
}
```

| Code | Raised when |
|---|---|
| `ERR_CONFIG_INVALID` | A config key has the wrong type, or a path is empty |
| `ERR_FILE_MISSING` | An explicitly named file does not exist |
| `ERR_FILE_EMPTY` | A file is empty or contains only whitespace |
| `ERR_FILE_MALFORMED` | A file is not valid JSON, or is not a JSON array |
| `ERR_ENTRY_INVALID` | An entry is missing `key`, or `value` is not a string, number, or boolean |
| `ERR_FILE_UNREADABLE` | A file exists but could not be read (permissions, I/O) |

## Migrating from 1.x

- **`override: true` restores 1.x behavior.** By default, a value already in
  `process.env` now wins over the file. This is the one change most likely to
  affect a running deployment: a variable injected by your host or orchestrator
  is no longer silently replaced by a stale file value.
- **Previously silent failures now throw.** In 1.x a JSON object instead of an
  array injected nothing and reported success, and an entry missing `key`
  created a variable literally named `"undefined"`.
- **`local: false` is largely unnecessary.** A missing `.env-local` at the
  default path is now reported in `missing` rather than being fatal.
- **Filename restrictions are gone.** `sharedEnv` and `localEnv` accept any
  path. 1.x required the paths to contain `.env-shared` / `.env-local`.
- **`run()` returns a result object** instead of `undefined`.
- **Node.js 20 or later is required.**

## Secret Scanning

This repository is scanned for committed credentials by [gitleaks](https://github.com/gitleaks/gitleaks)
at two points.

**Locally, before each commit.** A `pre-commit` hook scans staged changes and
refuses the commit if it finds a secret. The hook lives in `.githooks/` and is
wired up automatically by the `prepare` script when you run `npm install`. To
enable it by hand:

    git config core.hooksPath .githooks

The hook needs gitleaks on your PATH (`brew install gitleaks`). If it is not
installed the hook prints a notice and lets the commit through, so a missing
tool never blocks work — CI still scans the push.

**In CI, on every push and pull request.** `.github/workflows/secret-scan.yml`
scans the full history, not just the diff, and fails the build on any finding.
This is the enforcement point; the hook is only an early warning.

#### Handling a finding

If it is a real credential, remove it and **rotate it**. Rotate even if it was
never pushed — it already exists in your shell history and on disk.

If it is a false positive, add it to the `regexes` list in `.gitleaks.toml`
with a comment explaining why it is not a credential. Prefer a narrow value
match over excluding a whole path; broad path exclusions are how scanners
quietly stop finding things.

To bypass the local hook deliberately:

    git commit --no-verify

CI cannot be bypassed.

## Development

    npm install          # also wires up the pre-commit hook
    npm run lint
    npm test             # unit tests; packaging tests are skipped
    npm run test:package # slow: packs and installs the real tarball
    npm run test:coverage
    npm run scan         # manual gitleaks run

## License

GPL-2.0
