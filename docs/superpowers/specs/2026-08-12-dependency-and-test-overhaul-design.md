# SharedNodeEnv: Dependency Remediation and Test Suite Design

**Date:** 2026-08-12
**Status:** Approved for planning
**Target release:** 2.0.0 (preceded by a 1.0.4 stopgap)

## Problem

Three open Dependabot alerts on this repository all trace to a single package,
`grunt`, declared as `^0.4.5`. A caret range on a `0.x` version only permits
movement within `0.4.x`, so the dependency could never reach the patched
`1.5.3` release regardless of how often it was reinstalled.

Fixing that range alone is insufficient. Investigation surfaced three further
classes of problem:

1. **The remaining vulnerability surface is the build toolchain itself.** After
   upgrading grunt to 1.6.3, `npm audit` still reports six findings, every one
   of them transitive through `grunt-contrib-jshint` (which vendors old
   `lodash` and `minimatch`) and `mocha` (which vendors `serialize-javascript`).
   None has a clean upstream fix; `npm audit fix --force` "resolves" them by
   downgrading `grunt-contrib-jshint` to 1.1.0 and `mocha` to 8.1.3, which is
   strictly worse.

2. **The package has no tests.** There is no `test/` directory, `npm test` is a
   stub that exits 1, and the `simplemocha` grunt task has been globbing an
   empty `tests/*.js` path since 2015. No behavior is protected.

3. **`run()` is not re-entrant, and this is an observable bug.** Six
   module-level mutable variables persist across calls because Node caches
   modules.

### Evidence for the re-entrancy bug

```js
run({ sharedEnv: '/abs/.env-shared', local: false });
run();   // no config: per the README this should load ./.env-local
```

Observed:

```
call1  FROM_SHARED=shared-1 FROM_LOCAL=undefined
call2  FROM_SHARED=shared-1 FROM_LOCAL=undefined
```

The second call loads nothing. `doLocal` is still `false` from the first call,
and `sharedEnvFile` is still set, so the shared file is silently re-read. This
is both a defect a consumer can hit and the reason a test suite cannot simply
call `run()` repeatedly — each test would contaminate the next.

### Additional defects found

- **`underscore` is the only runtime dependency** and is used for four calls to
  `_.isUndefined` / `_.isEmpty`. Removing it makes the package
  zero-runtime-dependency.
- **Filename validation is a substring check.** `config.sharedEnv.indexOf('.env-shared') > -1`
  accepts `/tmp/.env-shared.bak` and `/x/.env-shared/other.json`.
- **`injectVariables` fails silently.** A JSON object rather than an array has
  no `.length`, so the loop never executes and nothing is injected — with no
  error. An entry missing `key` creates an environment variable literally named
  `"undefined"`.
- **The README example is broken.** It shows `require('SharedNodeEnv')` but the
  package is `shared-node-env`; the example fails on any case-sensitive
  filesystem.
- **Package metadata is wrong.** No `engines`, no `files`, `license` is
  `"GNU GENERAL PUBLIC LICENSE"` (not valid SPDX; the LICENSE file is GPL v2),
  and `repository`/`bugs`/`homepage` point at `schleichermann` rather than
  `tim-lynn-clark`.

## Goals

- Close all Dependabot alerts, and remove the tooling that generates them
  rather than deferring to upstream patches.
- Establish a real test suite, including tests of the published artifact.
- Fix the re-entrancy bug structurally, not by remembering to reset state.
- Reach zero runtime dependencies.

## Non-goals

- Changing the `.env` file format. The array-of-`{key,value}` JSON shape is
  unusual, but changing it would break every existing deployed `.env-shared`
  file for no security benefit.
- Rewriting in TypeScript.
- Any refactoring not in service of the above.

## Decisions

| Decision | Choice |
|---|---|
| Release posture | 2.0, breaking changes permitted |
| Toolchain | Drop grunt entirely; `node:test` + ESLint |
| Module format | Dual CJS + ESM with a side-effect entry point |
| `process.env` clobbering | Default `override: false` |
| Malformed env data | Throw |
| Filename restriction | Removed entirely |
| Missing defaulted local file | Continue, report in result |
| Node floor | `>=20` |
| PR #1 (1.0.4) | Merge and publish first as a stopgap |

## Architecture

`run(config)` composes four units. No module-level mutable state exists
anywhere; every variable is local to a call.

```
run(config)
  |- resolveConfig(input)        -> { sharedFile, localFile, override }  pure
  |- loadEnv(resolved)           -> { vars, sources, missing }           reads fs
  |   |- parseEnvData(text, path) -> [{ key, value }]                    pure
  |- applyEnv(vars, { override }) -> { applied, skipped }                writes process.env
```

`run` returns `{ applied, skipped }` from `applyEnv` merged with `sources` and
`missing` from `loadEnv`. Only `loadEnv` touches the filesystem and only
`applyEnv` touches `process.env`; the other two are pure.

### Module contracts

| Module | Signature | Responsibility |
|---|---|---|
| `src/config.js` | `resolveConfig(input?) -> {sharedFile, localFile, override}` | Normalize and validate. Resolves relative paths against `cwd`. `local: false` sets `localFile: null`. Throws on wrong types. |
| `src/parse.js` | `parseEnvData(text, path) -> [{key, value}]` | JSON to validated pairs. Throws with path and offending index. No fs, no env. |
| `src/load.js` | `loadEnv(resolved) -> {vars, sources, missing}` | Reads shared then local; delegates to `parseEnvData`. Returns a **merged** map. |
| `src/apply.js` | `applyEnv(vars, {override}) -> {applied, skipped}` | The only function in the package that mutates `process.env`. |
| `src/errors.js` | `SharedNodeEnvError extends Error` | Carries `code`, `path`, and an optional `cause`. |

### Merge-then-apply ordering

Two override rules exist and must not be applied in the same pass:

1. Local beats shared.
2. Pre-existing `process.env` beats file values (the new `override: false`
   default).

`loadEnv` merges shared and local into a single map first, where local wins.
Only then does `applyEnv` compare that merged result against `process.env`.

Applying shared and then local sequentially against `process.env` with
`override: false` would be incorrect: the shared value would land first, become
"pre-existing," and then block its own local override — silently inverting the
library's headline feature.

## Behavior

### Config contract

```js
{
  sharedEnv: string,   // any path; no filename restriction. Missing -> throws.
  localEnv:  string,   // any path. Explicit + missing -> throws.
                       //   Defaulted to ./.env-local + missing -> reported in `missing`.
  local:     boolean,  // default true. false disables local entirely.
  override:  boolean   // default false. true restores 1.x clobber behavior.
}
```

`run()` returns `{ applied, skipped, sources, missing }`. In 1.x it returned
`undefined`.

Precedence and edge cases, stated explicitly so the implementation does not
have to guess:

- **`local: false` combined with an explicit `localEnv`**: `local: false` wins.
  `localFile` is `null` and the named file is never read. Disabling is the
  stronger statement of intent.
- **A path given as an empty or whitespace-only string** (`sharedEnv: ''`):
  throws `ERR_CONFIG_INVALID`. In 1.x this was silently ignored, which made a
  misresolved path variable look like success.
- **A path given as a non-string** (number, object, array): throws
  `ERR_CONFIG_INVALID`.
- **`sharedEnv` omitted entirely**: no shared file is loaded. This is not an
  error; the library supports local-only use.

### Validation

| Input | 1.x behavior | 2.0 behavior |
|---|---|---|
| Empty file | throws | throws (unchanged) |
| Whitespace-only file | passes empty check, then reports "badly formatted" | throws `ERR_FILE_EMPTY` |
| Valid JSON, object not array | silently injects nothing, reports success | throws `ERR_FILE_MALFORMED` |
| Entry missing `key` | sets a variable named `"undefined"` | throws `ERR_ENTRY_INVALID` with index |
| `value` is null/object/array | sets `"null"` / `"[object Object]"` | throws `ERR_ENTRY_INVALID` with index |
| `value: 123` or `true` | coerced to `"123"` / `"true"` | same, explicitly allowed |
| Duplicate keys in one file | last wins silently | last wins, documented |

### Errors

A single `SharedNodeEnvError extends Error` carrying a stable `code` and a
`path` property. Codes: `ERR_CONFIG_INVALID`, `ERR_FILE_MISSING`,
`ERR_FILE_EMPTY`, `ERR_FILE_MALFORMED`, `ERR_ENTRY_INVALID`,
`ERR_FILE_UNREADABLE`.

`ERR_FILE_UNREADABLE` covers any filesystem failure that is not `ENOENT` —
permissions, a directory where a file was expected, an I/O error. The
underlying system error is attached as `cause` rather than discarded, so the
`errno` remains available for diagnosis. In 1.x these were rethrown raw, which
meant a permissions problem surfaced as an unprefixed Node error with no
indication that this library was involved.

Tests assert on `code`, never on message text. In 1.x every failure is a bare
`new Error('SharedNodeEnv - ...')`, so the only possible assertion is a
substring match on prose — which makes rewording an error message a
test-breaking change and trains maintainers to distrust the suite. Stable codes
also give consumers something to branch on, which they currently cannot do.

### Preserved deliberately

Local overriding shared; throwing on an explicitly-named missing file; the
array-of-`{key,value}` file format.

## Testing

Runner: `node:test` + `node:assert/strict`, zero dependencies. Files in
`test/`, named `*.test.js`, run via `node --test`.

### Layer 1 — Pure unit tests (bulk of the suite)

`resolveConfig` and `parseEnvData` are input-to-output. No fs, no
`process.env`, no cleanup, no ordering constraints. Every row of the validation
table above, plus config normalization (undefined config, relative path
resolution, `local: false`, bad types). Roughly 30-40 tests running in
milliseconds.

These are reachable only because of the module split; in the current
single-file design none of them can be exercised without touching disk.

### Layer 2 — Filesystem tests (`loadEnv`)

A `withTempDir()` helper wraps `fs.mkdtemp` under `os.tmpdir()` and removes the
directory in a `finally`, so a failing assertion cannot leak fixtures.

Cases: shared only; local only; both merged with local winning; missing
explicit file throws; missing defaulted file appears in `missing`; unreadable
file (mode 000) raises `ERR_FILE_UNREADABLE` with `cause` preserved rather than
being misreported as a missing file.

The mode-000 case must be skipped when the process is running as root, since
root bypasses permission bits and the read would succeed. The test checks
`process.getuid?.() === 0` and skips accordingly. Without this guard the test
passes locally and fails only inside a root Docker container — the least
useful place to discover it.

### Layer 3 — `process.env` tests (`applyEnv`, `run`)

A `withCleanEnv()` helper snapshots `process.env`, runs the test, and restores
**by key** rather than reassigning the object — reassigning `process.env` does
not propagate to child processes and breaks the real binding.

Cases: pre-existing value wins by default; `override: true` clobbers;
local-beats-shared still holds through the merge; returned `applied` and
`skipped` match what actually landed.

### Layer 4 — Packaging tests

Unit tests import `../src/...` directly and therefore pass even when the
*published package* is broken. With a dual CJS/ESM `exports` map being
introduced, that is a live risk: a wrong `exports` entry, a missing `files`
glob, or a bad `main` yields a package that installs and then throws
`ERR_PACKAGE_PATH_NOT_EXPORTED` on first require, with a green suite.

The test runs `npm pack`, installs the tarball into a temp directory, and
exercises all three entry points as a real consumer would:

- `require('shared-node-env')`
- `import ... from 'shared-node-env'`
- `import 'shared-node-env/config'` (side-effect form)

It also asserts the tarball contains `src/` and `index.js` and does not contain
`test/`. This layer is slower than everything else combined; it is tagged so it
can be skipped locally, and always runs in CI.

### Regression test

An explicit test for the bug documented above: call
`run({sharedEnv, local: false})`, then call `run()` with no config, and assert
the second call loads `./.env-local`. This fails against 1.x and passes against
2.0.

### Coverage

`--experimental-test-coverage` with a gate at **90% lines / 85% branches as a
floor**. If the finished suite measures higher, the gate is raised to the
observed figure, rounded down to a whole percent; it is never set below the
floor. Resolving it this way removes the contradiction between "gate at 90/85"
and "gate at whatever we achieve" — the floor is a minimum acceptance
criterion, and the observed value is the ratchet.

## Packaging

Dual format with no build step. Source remains CJS; ESM is a hand-written
wrapper:

```
index.js     module.exports = run
index.mjs    import run from './index.js'; export default run
config.js    CJS side-effect entry (reads SHARED_NODE_ENV_* vars, calls run)
config.mjs   ESM side-effect entry
```

```json
"exports": {
  ".":        { "import": "./index.mjs", "require": "./index.js" },
  "./config": { "import": "./config.mjs", "require": "./config.js" }
},
"files": ["index.js", "index.mjs", "config.js", "config.mjs", "src/"],
"engines": { "node": ">=20" },
"license": "GPL-2.0"
```

Four hand-written lines are preferable to adding a bundler and its dependency
tree to a package whose defining property is having none. Node's CJS interop
resolves `module.exports = run` to the ESM default; the Layer 4 packaging test
proves this rather than assuming it.

### Why a side-effect entry point exists

In ESM, all `import` statements are hoisted and evaluated before any function
call in the module body. A consumer writing:

```js
import sharedEnv from 'shared-node-env';
sharedEnv({ sharedEnv: '/etc/.env-shared' });
import express from 'express';        // hoisted ABOVE the call above
```

would load `express` before any environment variable is set — silently
defeating the library's entire purpose, which is to run before anything else.
A side-effect import configured through environment variables
(`SHARED_NODE_ENV_SHARED`, `SHARED_NODE_ENV_LOCAL`, `SHARED_NODE_ENV_OVERRIDE`)
is the only ESM-safe ordering. This mirrors `dotenv/config`.

Semantics of the side-effect entry:

- Each variable maps to the config key of the same name.
  `SHARED_NODE_ENV_OVERRIDE` is treated as `true` only for the exact
  case-insensitive string `"true"`; every other value, including `"1"` and
  `"yes"`, is `false`. A single unambiguous spelling avoids the class of bug
  where `"0"` or `"false"` reads as truthy.
- Unset variables fall back to the same defaults as `run()` with no argument.
  Importing `shared-node-env/config` with nothing configured therefore attempts
  `./.env-local` and reports it in `missing` if absent — it does not throw.
- The entry point discards the result object. Consumers who need `applied` or
  `missing` should call `run()` directly.

### Dependency position after this work

Zero runtime dependencies. ESLint 9 as the sole devDependency tree. From
roughly 180 installed packages to one. The `lodash`, `minimatch`, and
`serialize-javascript` findings disappear along with `jshint` and `mocha`
rather than waiting on upstream.

## Infrastructure

- **CI** (`.github/workflows/ci.yml`): lint plus `node --test` on a Node
  20 / 22 / 24 matrix, the packaging test, and the coverage gate. Runs on push
  and pull request.
- **Dependabot** (`.github/dependabot.yml`): weekly, `npm` and
  `github-actions` ecosystems, minor and patch grouped into a single PR.
- **Metadata**: `repository`/`bugs`/`homepage` repointed to
  `tim-lynn-clark`; `license` corrected to `GPL-2.0`.
- **README**: fix the broken `require('SharedNodeEnv')` example, document the
  new config keys and return value, and add a migration section.

## Release plan

1. Merge PR #1 and publish **1.0.4**. Closes the three alerts immediately and
   gives consumers pinned to `^1` a patched build. Blocked on `npm login`.
2. Branch `v2` from master. Implement in order: extract modules -> tests ->
   drop grunt -> dual entry -> CI.
3. Publish **2.0.0** with README migration notes.

A major version is required regardless of anything else, because
`override: false` changes behavior for every existing consumer.

### Migration notes for consumers

- `override: true` restores 1.x clobbering of existing `process.env` values.
- Previously-silent malformed env files now throw.
- `local: false` is largely unnecessary; a defaulted-missing local file is now
  reported in the result rather than fatal.
- Filename restrictions on `sharedEnv` / `localEnv` are removed; any path is
  accepted.
- Node 20 or later is required.

## Risks

| Risk | Mitigation |
|---|---|
| `override: false` surprises an existing deployment that relied on files winning | Called out first in migration notes; `override: true` is a one-line restore |
| Node >=20 drops older runtimes | Node 18 is end-of-life; 2.0 is already breaking |
| Hand-written ESM wrapper diverges from the CJS entry | Layer 4 packaging test exercises both against the real tarball |
| A typo'd `.env-local` at the default path now fails quietly | Surfaced in the returned `missing` array for consumers who assert on it |
| Publishing is blocked on credentials | `npm login` is a manual step for the maintainer; nothing else depends on it |
