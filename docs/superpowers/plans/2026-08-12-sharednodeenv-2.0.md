# SharedNodeEnv 2.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate every dependency-derived security alert by removing the grunt toolchain, restructure the single-file library into four testable units that make the `run()` re-entrancy bug structurally impossible, and ship a real test suite including tests of the published tarball.

**Architecture:** `run(config)` composes four units — `resolveConfig` (pure), `loadEnv` (only filesystem access), `parseEnvData` (pure), `applyEnv` (only `process.env` mutation). No module-level mutable state exists anywhere. Shared and local files merge into a single map before any comparison against `process.env`, so "local beats shared" and "existing env beats files" never collide. Ships dual CJS/ESM with a side-effect entry point, because ESM import hoisting otherwise defeats the library's purpose.

**Tech Stack:** Node.js >=20, `node:test`, `node:assert/strict`, ESLint 9 (flat config). Zero runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-08-12-dependency-and-test-overhaul-design.md`

## Global Constraints

- **Zero runtime dependencies.** `underscore` is removed in Task 7. Nothing may be added to `dependencies` — ever, in any task.
- **DevDependencies are limited to `eslint` and `@eslint/js`.** No test framework, no mocking library, no bundler.
- **Node floor is `>=20`.** CI matrix is `20`, `22`, `24`.
- **Error codes are exactly:** `ERR_CONFIG_INVALID`, `ERR_FILE_MISSING`, `ERR_FILE_EMPTY`, `ERR_FILE_MALFORMED`, `ERR_ENTRY_INVALID`, `ERR_FILE_UNREADABLE`.
- **Tests assert on `err.code`, never on error message text.** A test containing `assert.match(err.message, ...)` is a defect.
- **`override` defaults to `false`.** Pre-existing `process.env` values win unless explicitly overridden.
- **Coverage floor:** 90% lines / 85% branches. Raise to the observed figure if higher; never set below the floor.
- **License string is exactly `GPL-2.0`.** Repository URLs use `tim-lynn-clark`, not `schleichermann`.
- **Naming deviation from spec:** the spec's `src/config.js` is implemented as **`src/resolve-config.js`** to avoid colliding with the root-level `config.js` side-effect entry point. Behavior is unchanged.
- **Every task ends with a commit.** No task leaves the tree in a non-passing state.

---

### Task 1: Replace the grunt toolchain

Deletes the source of every remaining vulnerability. Nothing else can be tested until there is a test runner.

**Files:**
- Delete: `gruntfile.js`
- Create: `eslint.config.js`
- Create: `test/smoke.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: nothing.
- Produces: working `npm test` (runs `node --test test/`) and `npm run lint` commands that all later tasks depend on.

- [ ] **Step 1: Remove grunt and its plugins, install ESLint**

```bash
npm uninstall grunt grunt-contrib-jshint grunt-simple-mocha mocha chai debug
npm install --save-dev eslint@^9 @eslint/js@^9
rm gruntfile.js
```

- [ ] **Step 2: Create the ESLint flat config**

Create `eslint.config.js`:

```js
'use strict';

const js = require('@eslint/js');

const nodeGlobals = {
  process: 'readonly',
  console: 'readonly',
  __dirname: 'readonly',
  module: 'writable',
  require: 'readonly',
  exports: 'writable',
  Buffer: 'readonly',
  URL: 'readonly'
};

module.exports = [
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: nodeGlobals
    },
    rules: {
      strict: ['error', 'global'],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'always'],
      'prefer-const': 'error'
    }
  },
  {
    files: ['**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: nodeGlobals
    },
    rules: {
      strict: 'off',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
    }
  },
  {
    ignores: ['node_modules/', 'coverage/', 'docs/']
  }
];
```

- [ ] **Step 3: Add scripts to `package.json`**

Replace the `scripts` block with the following. **`prepare` and `scan` already
exist on this branch and must be preserved** — `prepare` wires up the gitleaks
pre-commit hook, and dropping it silently disables local secret scanning for
every future clone:

```json
"scripts": {
  "prepare": "git config core.hooksPath .githooks || true",
  "scan": "gitleaks git --no-banner --redact -c .gitleaks.toml .",
  "lint": "eslint .",
  "test": "node --test test/",
  "test:coverage": "node --test --experimental-test-coverage --test-coverage-lines=90 --test-coverage-branches=85 test/",
  "test:package": "RUN_PACKAGE_TESTS=1 node --test test/package.test.js"
}
```

Verify afterwards: `npm pkg get scripts.prepare` must return the `core.hooksPath`
command, not `{}`.

Note: the `--test-coverage-lines` and `--test-coverage-branches` flags require Node 22.8+. Task 10 pins the coverage CI job to Node 24 for this reason. Plain `npm test` works on Node 20.

- [ ] **Step 4: Create a smoke test so the runner has something to run**

Create `test/smoke.test.js`:

```js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

test('test runner is wired up', () => {
  assert.equal(1 + 1, 2);
});
```

- [ ] **Step 5: Verify both commands pass**

Run: `npm run lint && npm test`
Expected: lint reports no errors; test reports `pass 1  fail 0`.

Note: `src/bin/sharedNodeEnv.js` still exists and still uses `var`. `prefer-const` will flag it. If lint fails on that file only, add it to the `ignores` array temporarily with the comment `// removed in Task 7` — Task 7 deletes the file and the ignore entry together.

- [ ] **Step 6: Confirm the vulnerability count dropped**

Run: `npm audit`
Expected: `found 0 vulnerabilities`. If any remain, they are not from grunt — report them before continuing.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Replaced the grunt toolchain with node:test and ESLint."
```

---

### Task 2: Error type

**Files:**
- Create: `src/errors.js`
- Test: `test/errors.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `SharedNodeEnvError` class with properties `name` (`'SharedNodeEnvError'`), `code` (string), `path` (string or `null`), `cause` (Error or `undefined`). Exported as `{ SharedNodeEnvError }`. Every later task throws only this type.

- [ ] **Step 1: Write the failing test**

Create `test/errors.test.js`:

```js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { SharedNodeEnvError } = require('../src/errors');

test('is an Error with a stable name', () => {
  const err = new SharedNodeEnvError('ERR_FILE_EMPTY', 'boom');
  assert.ok(err instanceof Error);
  assert.equal(err.name, 'SharedNodeEnvError');
  assert.equal(err.message, 'boom');
});

test('carries the code', () => {
  const err = new SharedNodeEnvError('ERR_CONFIG_INVALID', 'boom');
  assert.equal(err.code, 'ERR_CONFIG_INVALID');
});

test('path defaults to null and is set from options', () => {
  assert.equal(new SharedNodeEnvError('ERR_FILE_EMPTY', 'x').path, null);
  assert.equal(
    new SharedNodeEnvError('ERR_FILE_EMPTY', 'x', { path: '/tmp/a' }).path,
    '/tmp/a'
  );
});

test('preserves the underlying cause', () => {
  const cause = new Error('EACCES');
  const err = new SharedNodeEnvError('ERR_FILE_UNREADABLE', 'x', { cause });
  assert.equal(err.cause, cause);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/errors.test.js`
Expected: FAIL — `Cannot find module '../src/errors'`.

- [ ] **Step 3: Implement**

Create `src/errors.js`:

```js
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test test/errors.test.js`
Expected: `pass 4  fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/errors.js test/errors.test.js
git commit -m "Added SharedNodeEnvError with stable codes and cause preservation."
```

---

### Task 3: Env data parser

Largest test surface in the plan. Every silent failure in 1.x becomes an error here.

**Files:**
- Create: `src/parse.js`
- Test: `test/parse.test.js`

**Interfaces:**
- Consumes: `SharedNodeEnvError` from `src/errors.js`.
- Produces: `parseEnvData(text: string, filePath: string) -> Array<{key: string, value: string}>`. Exported as `{ parseEnvData }`. Values are always strings; numbers and booleans are coerced via `String()`.

- [ ] **Step 1: Write the failing test**

Create `test/parse.test.js`:

```js
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
```

Note on the last test: it inspects the message only to confirm the *index* is present, which is diagnostic content the spec requires. It does not assert on wording. This is the single permitted exception to the no-message-assertions rule.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/parse.test.js`
Expected: FAIL — `Cannot find module '../src/parse'`.

- [ ] **Step 3: Implement**

Create `src/parse.js`:

```js
'use strict';

const { SharedNodeEnvError } = require('./errors');

function parseEnvData(text, filePath) {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new SharedNodeEnvError(
      'ERR_FILE_EMPTY',
      `Environment file is empty: ${filePath}`,
      { path: filePath }
    );
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch (cause) {
    throw new SharedNodeEnvError(
      'ERR_FILE_MALFORMED',
      `Environment file is not valid JSON: ${filePath}`,
      { path: filePath, cause }
    );
  }

  if (!Array.isArray(data)) {
    throw new SharedNodeEnvError(
      'ERR_FILE_MALFORMED',
      `Environment file must contain a JSON array of {key, value} objects: ${filePath}`,
      { path: filePath }
    );
  }

  return data.map((entry, index) => toPair(entry, index, filePath));
}

function toPair(entry, index, filePath) {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new SharedNodeEnvError(
      'ERR_ENTRY_INVALID',
      `Entry at index ${index} must be an object: ${filePath}`,
      { path: filePath }
    );
  }

  const { key, value } = entry;

  if (typeof key !== 'string' || key.trim() === '') {
    throw new SharedNodeEnvError(
      'ERR_ENTRY_INVALID',
      `Entry at index ${index} has a missing or empty "key": ${filePath}`,
      { path: filePath }
    );
  }

  const type = typeof value;
  if (type !== 'string' && type !== 'number' && type !== 'boolean') {
    throw new SharedNodeEnvError(
      'ERR_ENTRY_INVALID',
      `Entry "${key}" at index ${index} must have a string, number, or boolean "value": ${filePath}`,
      { path: filePath }
    );
  }

  return { key, value: String(value) };
}

module.exports = { parseEnvData };
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test test/parse.test.js`
Expected: `pass 18  fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/parse.js test/parse.test.js
git commit -m "Added parseEnvData with validation for every previously silent failure."
```

---

### Task 4: Config resolver

**Files:**
- Create: `src/resolve-config.js`
- Test: `test/resolve-config.test.js`

**Interfaces:**
- Consumes: `SharedNodeEnvError` from `src/errors.js`.
- Produces: `resolveConfig(input?) -> {sharedFile, localFile, localFileExplicit, override}` and the constant `DEFAULT_LOCAL_FILENAME` (`'.env-local'`). Exported as `{ resolveConfig, DEFAULT_LOCAL_FILENAME }`.
  - `sharedFile`: absolute path string, or `null` when not configured.
  - `localFile`: absolute path string, or `null` when `local: false`.
  - `localFileExplicit`: `true` only when the caller passed `localEnv` **and** local is enabled. Task 5 uses this to decide throw-vs-report.
  - `override`: boolean, `false` unless explicitly `true`.

- [ ] **Step 1: Write the failing test**

Create `test/resolve-config.test.js`:

```js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { resolveConfig } = require('../src/resolve-config');

function codeOf(fn) {
  try {
    fn();
  } catch (err) {
    return err.code;
  }
  return null;
}

const defaultLocal = () => path.resolve(process.cwd(), '.env-local');

test('undefined config defaults to local-only', () => {
  assert.deepEqual(resolveConfig(), {
    sharedFile: null,
    localFile: defaultLocal(),
    localFileExplicit: false,
    override: false
  });
});

test('null config behaves like undefined', () => {
  assert.deepEqual(resolveConfig(null), resolveConfig());
});

test('empty object behaves like undefined', () => {
  assert.deepEqual(resolveConfig({}), resolveConfig());
});

test('resolves sharedEnv to an absolute path', () => {
  const out = resolveConfig({ sharedEnv: '/etc/app/.env-shared' });
  assert.equal(out.sharedFile, path.resolve('/etc/app/.env-shared'));
});

test('resolves a relative path against cwd', () => {
  const out = resolveConfig({ sharedEnv: './conf/.env-shared' });
  assert.equal(out.sharedFile, path.resolve(process.cwd(), './conf/.env-shared'));
});

test('accepts any filename, with no naming restriction', () => {
  const out = resolveConfig({ sharedEnv: '/etc/whatever.json' });
  assert.equal(out.sharedFile, path.resolve('/etc/whatever.json'));
});

test('explicit localEnv sets the explicit flag', () => {
  const out = resolveConfig({ localEnv: '/srv/.env-local' });
  assert.equal(out.localFile, path.resolve('/srv/.env-local'));
  assert.equal(out.localFileExplicit, true);
});

test('local:false disables local entirely', () => {
  const out = resolveConfig({ sharedEnv: '/a/.env-shared', local: false });
  assert.equal(out.localFile, null);
  assert.equal(out.localFileExplicit, false);
});

test('local:false beats an explicit localEnv', () => {
  const out = resolveConfig({ localEnv: '/srv/.env-local', local: false });
  assert.equal(out.localFile, null);
  assert.equal(out.localFileExplicit, false);
});

test('override defaults to false and is honored when true', () => {
  assert.equal(resolveConfig({}).override, false);
  assert.equal(resolveConfig({ override: false }).override, false);
  assert.equal(resolveConfig({ override: true }).override, true);
});

test('rejects a non-object config', () => {
  assert.equal(codeOf(() => resolveConfig('nope')), 'ERR_CONFIG_INVALID');
  assert.equal(codeOf(() => resolveConfig(42)), 'ERR_CONFIG_INVALID');
  assert.equal(codeOf(() => resolveConfig([])), 'ERR_CONFIG_INVALID');
});

test('rejects an empty or whitespace path', () => {
  assert.equal(codeOf(() => resolveConfig({ sharedEnv: '' })), 'ERR_CONFIG_INVALID');
  assert.equal(codeOf(() => resolveConfig({ sharedEnv: '   ' })), 'ERR_CONFIG_INVALID');
  assert.equal(codeOf(() => resolveConfig({ localEnv: '' })), 'ERR_CONFIG_INVALID');
});

test('rejects a non-string path', () => {
  assert.equal(codeOf(() => resolveConfig({ sharedEnv: 42 })), 'ERR_CONFIG_INVALID');
  assert.equal(codeOf(() => resolveConfig({ localEnv: {} })), 'ERR_CONFIG_INVALID');
});

test('validates localEnv even when local is disabled', () => {
  assert.equal(
    codeOf(() => resolveConfig({ localEnv: 42, local: false })),
    'ERR_CONFIG_INVALID'
  );
});

test('rejects non-boolean local and override', () => {
  assert.equal(codeOf(() => resolveConfig({ local: 'yes' })), 'ERR_CONFIG_INVALID');
  assert.equal(codeOf(() => resolveConfig({ override: 1 })), 'ERR_CONFIG_INVALID');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/resolve-config.test.js`
Expected: FAIL — `Cannot find module '../src/resolve-config'`.

- [ ] **Step 3: Implement**

Create `src/resolve-config.js`:

```js
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

  return {
    sharedFile,
    localFile: localEnabled
      ? localEnvPath === null
        ? path.resolve(process.cwd(), DEFAULT_LOCAL_FILENAME)
        : localEnvPath
      : null,
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test test/resolve-config.test.js`
Expected: `pass 15  fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/resolve-config.js test/resolve-config.test.js
git commit -m "Added resolveConfig with explicit precedence and validation rules."
```

---

### Task 5: Test helpers and the file loader

**Files:**
- Create: `test/helpers.js`
- Create: `src/load.js`
- Test: `test/load.test.js`

**Interfaces:**
- Consumes: `parseEnvData` from `src/parse.js`, `SharedNodeEnvError` from `src/errors.js`, the resolved-config shape from Task 4.
- Produces:
  - `loadEnv(resolved) -> {vars: Map<string,string>, sources: string[], missing: string[]}`. Exported as `{ loadEnv }`. Reads shared then local, so local overwrites shared in `vars`.
  - `test/helpers.js` exporting `withTempDir(fn)` and `withCleanEnv(fn)`, used by Tasks 6, 7 and 9.

- [ ] **Step 1: Create the test helpers**

Create `test/helpers.js`:

```js
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
```

- [ ] **Step 2: Write the failing test**

Create `test/load.test.js`:

```js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadEnv } = require('../src/load');
const { withTempDir, writeEnvFile } = require('./helpers');

function resolved(over) {
  return {
    sharedFile: null,
    localFile: null,
    localFileExplicit: false,
    override: false,
    ...over
  };
}

function codeOf(fn) {
  try {
    fn();
  } catch (err) {
    return err.code;
  }
  return null;
}

test('loads a shared file only', () => {
  withTempDir((dir) => {
    const shared = writeEnvFile(dir, '.env-shared', [{ key: 'A', value: '1' }]);
    const out = loadEnv(resolved({ sharedFile: shared }));
    assert.equal(out.vars.get('A'), '1');
    assert.deepEqual(out.sources, [shared]);
    assert.deepEqual(out.missing, []);
  });
});

test('loads a local file only', () => {
  withTempDir((dir) => {
    const local = writeEnvFile(dir, '.env-local', [{ key: 'B', value: '2' }]);
    const out = loadEnv(resolved({ localFile: local, localFileExplicit: true }));
    assert.equal(out.vars.get('B'), '2');
    assert.deepEqual(out.sources, [local]);
  });
});

test('merges both with local winning', () => {
  withTempDir((dir) => {
    const shared = writeEnvFile(dir, '.env-shared', [
      { key: 'SAME', value: 'from-shared' },
      { key: 'ONLY_SHARED', value: 's' }
    ]);
    const local = writeEnvFile(dir, '.env-local', [
      { key: 'SAME', value: 'from-local' }
    ]);
    const out = loadEnv(
      resolved({ sharedFile: shared, localFile: local, localFileExplicit: true })
    );
    assert.equal(out.vars.get('SAME'), 'from-local');
    assert.equal(out.vars.get('ONLY_SHARED'), 's');
    assert.deepEqual(out.sources, [shared, local]);
  });
});

test('last duplicate key within one file wins', () => {
  withTempDir((dir) => {
    const shared = writeEnvFile(dir, '.env-shared', [
      { key: 'A', value: 'first' },
      { key: 'A', value: 'second' }
    ]);
    const out = loadEnv(resolved({ sharedFile: shared }));
    assert.equal(out.vars.get('A'), 'second');
  });
});

test('a missing shared file always throws', () => {
  withTempDir((dir) => {
    const missing = path.join(dir, 'nope.json');
    assert.equal(
      codeOf(() => loadEnv(resolved({ sharedFile: missing }))),
      'ERR_FILE_MISSING'
    );
  });
});

test('a missing explicit local file throws', () => {
  withTempDir((dir) => {
    const missing = path.join(dir, '.env-local');
    assert.equal(
      codeOf(() =>
        loadEnv(resolved({ localFile: missing, localFileExplicit: true }))
      ),
      'ERR_FILE_MISSING'
    );
  });
});

test('a missing defaulted local file is reported, not thrown', () => {
  withTempDir((dir) => {
    const missing = path.join(dir, '.env-local');
    const out = loadEnv(resolved({ localFile: missing, localFileExplicit: false }));
    assert.deepEqual(out.missing, [missing]);
    assert.deepEqual(out.sources, []);
    assert.equal(out.vars.size, 0);
  });
});

test('an unreadable file raises ERR_FILE_UNREADABLE with the cause', {
  // root bypasses permission bits, so chmod 000 would still be readable.
  // Without this guard the test passes locally and fails only in a root container.
  skip: process.getuid === undefined || process.getuid() === 0
    ? 'requires a non-root POSIX user'
    : false
}, () => {
  withTempDir((dir) => {
    const shared = writeEnvFile(dir, '.env-shared', [{ key: 'A', value: '1' }]);
    fs.chmodSync(shared, 0o000);
    try {
      loadEnv(resolved({ sharedFile: shared }));
      assert.fail('should have thrown');
    } catch (err) {
      assert.equal(err.code, 'ERR_FILE_UNREADABLE');
      assert.equal(err.path, shared);
      assert.equal(err.cause.code, 'EACCES');
    } finally {
      fs.chmodSync(shared, 0o600);
    }
  });
});

test('propagates parse errors with the file path attached', () => {
  withTempDir((dir) => {
    const shared = path.join(dir, '.env-shared');
    fs.writeFileSync(shared, '{not json');
    try {
      loadEnv(resolved({ sharedFile: shared }));
      assert.fail('should have thrown');
    } catch (err) {
      assert.equal(err.code, 'ERR_FILE_MALFORMED');
      assert.equal(err.path, shared);
    }
  });
});

test('loads nothing when both files are null', () => {
  const out = loadEnv(resolved());
  assert.equal(out.vars.size, 0);
  assert.deepEqual(out.sources, []);
  assert.deepEqual(out.missing, []);
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `node --test test/load.test.js`
Expected: FAIL — `Cannot find module '../src/load'`.

- [ ] **Step 4: Implement**

Create `src/load.js`:

```js
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
```

- [ ] **Step 5: Run to verify it passes**

Run: `node --test test/load.test.js`
Expected: `pass 10  fail 0` (9 passing plus 1 skipped if run as root).

- [ ] **Step 6: Commit**

```bash
git add test/helpers.js src/load.js test/load.test.js
git commit -m "Added loadEnv with merge-before-apply semantics and temp-dir test helpers."
```

---

### Task 6: Environment applier

The only function in the package that mutates `process.env`.

**Files:**
- Create: `src/apply.js`
- Test: `test/apply.test.js`

**Interfaces:**
- Consumes: `withCleanEnv` from `test/helpers.js` (tests only).
- Produces: `applyEnv(vars: Map<string,string>, options?: {override?: boolean}) -> {applied: string[], skipped: string[]}`. Exported as `{ applyEnv }`.

- [ ] **Step 1: Write the failing test**

Create `test/apply.test.js`:

```js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { applyEnv } = require('../src/apply');
const { withCleanEnv } = require('./helpers');

test('sets variables that are not already present', () => {
  withCleanEnv(() => {
    delete process.env.SNE_TEST_NEW;
    const out = applyEnv(new Map([['SNE_TEST_NEW', 'value']]));
    assert.equal(process.env.SNE_TEST_NEW, 'value');
    assert.deepEqual(out.applied, ['SNE_TEST_NEW']);
    assert.deepEqual(out.skipped, []);
  });
});

test('does not clobber an existing value by default', () => {
  withCleanEnv(() => {
    process.env.SNE_TEST_EXISTING = 'from-platform';
    const out = applyEnv(new Map([['SNE_TEST_EXISTING', 'from-file']]));
    assert.equal(process.env.SNE_TEST_EXISTING, 'from-platform');
    assert.deepEqual(out.applied, []);
    assert.deepEqual(out.skipped, ['SNE_TEST_EXISTING']);
  });
});

test('override:true clobbers an existing value', () => {
  withCleanEnv(() => {
    process.env.SNE_TEST_EXISTING = 'from-platform';
    const out = applyEnv(
      new Map([['SNE_TEST_EXISTING', 'from-file']]),
      { override: true }
    );
    assert.equal(process.env.SNE_TEST_EXISTING, 'from-file');
    assert.deepEqual(out.applied, ['SNE_TEST_EXISTING']);
    assert.deepEqual(out.skipped, []);
  });
});

test('an existing empty string still counts as present', () => {
  withCleanEnv(() => {
    process.env.SNE_TEST_EMPTY = '';
    const out = applyEnv(new Map([['SNE_TEST_EMPTY', 'from-file']]));
    assert.equal(process.env.SNE_TEST_EMPTY, '');
    assert.deepEqual(out.skipped, ['SNE_TEST_EMPTY']);
  });
});

test('handles a mix of applied and skipped', () => {
  withCleanEnv(() => {
    process.env.SNE_TEST_A = 'existing';
    delete process.env.SNE_TEST_B;
    const out = applyEnv(
      new Map([
        ['SNE_TEST_A', 'file-a'],
        ['SNE_TEST_B', 'file-b']
      ])
    );
    assert.deepEqual(out.applied, ['SNE_TEST_B']);
    assert.deepEqual(out.skipped, ['SNE_TEST_A']);
  });
});

test('an empty map is a no-op', () => {
  withCleanEnv(() => {
    const out = applyEnv(new Map());
    assert.deepEqual(out, { applied: [], skipped: [] });
  });
});

test('the helper restores env after the test body', () => {
  process.env.SNE_TEST_RESTORE = 'original';
  withCleanEnv(() => {
    applyEnv(new Map([['SNE_TEST_RESTORE', 'changed']]), { override: true });
    assert.equal(process.env.SNE_TEST_RESTORE, 'changed');
  });
  assert.equal(process.env.SNE_TEST_RESTORE, 'original');
  delete process.env.SNE_TEST_RESTORE;
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/apply.test.js`
Expected: FAIL — `Cannot find module '../src/apply'`.

- [ ] **Step 3: Implement**

Create `src/apply.js`:

```js
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test test/apply.test.js`
Expected: `pass 7  fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/apply.js test/apply.test.js
git commit -m "Added applyEnv with non-clobbering default and applied/skipped reporting."
```

---

### Task 7: Compose `run()`, delete the old implementation, drop underscore

The payoff task. Includes the regression test for the re-entrancy bug that motivated the whole restructure.

**Files:**
- Modify: `index.js` (full rewrite)
- Delete: `src/bin/sharedNodeEnv.js`
- Test: `test/run.test.js`
- Modify: `package.json` (remove `underscore`)
- Modify: `eslint.config.js` (remove the temporary ignore from Task 1, if added)

**Interfaces:**
- Consumes: `resolveConfig`, `loadEnv`, `applyEnv`, `SharedNodeEnvError`.
- Produces: `run(config?) -> {applied: string[], skipped: string[], sources: string[], missing: string[]}` as the package's default export, with `run.SharedNodeEnvError` attached for `instanceof` checks by consumers.

- [ ] **Step 1: Write the failing test**

Create `test/run.test.js`:

```js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const run = require('../index.js');
const { withTempDir, withCleanEnv, writeEnvFile } = require('./helpers');

test('returns applied, skipped, sources and missing', () => {
  withTempDir((dir) => {
    withCleanEnv(() => {
      const shared = writeEnvFile(dir, '.env-shared', [
        { key: 'SNE_RUN_A', value: '1' }
      ]);
      delete process.env.SNE_RUN_A;
      const out = run({ sharedEnv: shared, local: false });
      assert.deepEqual(out.applied, ['SNE_RUN_A']);
      assert.deepEqual(out.skipped, []);
      assert.deepEqual(out.sources, [shared]);
      assert.deepEqual(out.missing, []);
      assert.equal(process.env.SNE_RUN_A, '1');
    });
  });
});

// The bug that motivated the 2.0 restructure. In 1.x, `doLocal` and
// `sharedEnvFile` were module-level and survived between calls, so this second
// call silently loaded nothing.
test('run() is re-entrant: a later call is not poisoned by an earlier one', () => {
  withTempDir((dir) => {
    withCleanEnv(() => {
      const shared = writeEnvFile(dir, '.env-shared', [
        { key: 'SNE_REENTRANT_SHARED', value: 'shared-1' }
      ]);
      writeEnvFile(dir, '.env-local', [
        { key: 'SNE_REENTRANT_LOCAL', value: 'local-1' }
      ]);

      delete process.env.SNE_REENTRANT_SHARED;
      delete process.env.SNE_REENTRANT_LOCAL;

      run({ sharedEnv: shared, local: false });
      assert.equal(process.env.SNE_REENTRANT_SHARED, 'shared-1');
      assert.equal(process.env.SNE_REENTRANT_LOCAL, undefined);

      const originalCwd = process.cwd();
      process.chdir(dir);
      try {
        const out = run();
        assert.equal(
          process.env.SNE_REENTRANT_LOCAL,
          'local-1',
          'second call must re-enable local and load ./.env-local'
        );
        assert.deepEqual(out.sources, [path.join(dir, '.env-local')]);
      } finally {
        process.chdir(originalCwd);
      }
    });
  });
});

test('local overrides shared even when override is false', () => {
  withTempDir((dir) => {
    withCleanEnv(() => {
      const shared = writeEnvFile(dir, '.env-shared', [
        { key: 'SNE_MERGE', value: 'from-shared' }
      ]);
      const local = writeEnvFile(dir, '.env-local', [
        { key: 'SNE_MERGE', value: 'from-local' }
      ]);
      delete process.env.SNE_MERGE;
      run({ sharedEnv: shared, localEnv: local });
      assert.equal(process.env.SNE_MERGE, 'from-local');
    });
  });
});

test('a pre-existing process.env value beats both files by default', () => {
  withTempDir((dir) => {
    withCleanEnv(() => {
      const shared = writeEnvFile(dir, '.env-shared', [
        { key: 'SNE_PLATFORM', value: 'from-shared' }
      ]);
      const local = writeEnvFile(dir, '.env-local', [
        { key: 'SNE_PLATFORM', value: 'from-local' }
      ]);
      process.env.SNE_PLATFORM = 'from-platform';
      const out = run({ sharedEnv: shared, localEnv: local });
      assert.equal(process.env.SNE_PLATFORM, 'from-platform');
      assert.deepEqual(out.skipped, ['SNE_PLATFORM']);
    });
  });
});

test('override:true lets the merged file value win', () => {
  withTempDir((dir) => {
    withCleanEnv(() => {
      const shared = writeEnvFile(dir, '.env-shared', [
        { key: 'SNE_OVERRIDE', value: 'from-shared' }
      ]);
      const local = writeEnvFile(dir, '.env-local', [
        { key: 'SNE_OVERRIDE', value: 'from-local' }
      ]);
      process.env.SNE_OVERRIDE = 'from-platform';
      run({ sharedEnv: shared, localEnv: local, override: true });
      assert.equal(process.env.SNE_OVERRIDE, 'from-local');
    });
  });
});

test('a missing defaulted local file does not throw', () => {
  withTempDir((dir) => {
    withCleanEnv(() => {
      const originalCwd = process.cwd();
      process.chdir(dir);
      try {
        const out = run();
        assert.deepEqual(out.missing, [path.join(dir, '.env-local')]);
        assert.deepEqual(out.applied, []);
      } finally {
        process.chdir(originalCwd);
      }
    });
  });
});

test('exposes the error class for instanceof checks', () => {
  assert.equal(typeof run.SharedNodeEnvError, 'function');
  try {
    run({ sharedEnv: 42 });
    assert.fail('should have thrown');
  } catch (err) {
    assert.ok(err instanceof run.SharedNodeEnvError);
    assert.equal(err.code, 'ERR_CONFIG_INVALID');
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/run.test.js`
Expected: FAIL — the re-entrancy test fails against the old `src/bin/sharedNodeEnv.js`, and `run.SharedNodeEnvError` is undefined.

- [ ] **Step 3: Rewrite `index.js`**

Replace the entire contents of `index.js`:

```js
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
```

- [ ] **Step 4: Delete the old implementation and drop underscore**

```bash
git rm src/bin/sharedNodeEnv.js
npm uninstall underscore
```

If Task 1 added `src/bin/sharedNodeEnv.js` to the `ignores` array in `eslint.config.js`, remove that entry now.

- [ ] **Step 5: Verify the full suite and zero runtime dependencies**

Run: `npm run lint && npm test`
Expected: all tests pass, including the re-entrancy regression test.

Run: `node -p "Object.keys(require('./package.json').dependencies || {}).length"`
Expected: `0`

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Composed run() from the new modules and removed the underscore dependency.

The six module-level variables in src/bin/sharedNodeEnv.js are gone; all state
is now local to a call, so run() is re-entrant. Includes a regression test for
the state-leak bug where a second call silently loaded nothing."
```

---

### Task 8: Dual CJS/ESM entry points and package metadata

**Files:**
- Create: `index.mjs`
- Create: `config.js`
- Create: `config.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `run` from `index.js`.
- Produces: the `exports` map consumed by Task 9's packaging test. Entry points: `.` (both formats) and `./config` (both formats).

- [ ] **Step 1: Create the ESM wrapper**

Create `index.mjs`:

```js
import run from './index.js';

export default run;
export const SharedNodeEnvError = run.SharedNodeEnvError;
```

- [ ] **Step 2: Create the CJS side-effect entry**

Create `config.js`:

```js
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
```

- [ ] **Step 3: Create the ESM side-effect entry**

Create `config.mjs`:

```js
import './config.js';
```

- [ ] **Step 4: Update `package.json` metadata**

Apply all of these:

```json
{
  "version": "2.0.0",
  "main": "index.js",
  "exports": {
    ".": {
      "import": "./index.mjs",
      "require": "./index.js"
    },
    "./config": {
      "import": "./config.mjs",
      "require": "./config.js"
    },
    "./package.json": "./package.json"
  },
  "files": [
    "index.js",
    "index.mjs",
    "config.js",
    "config.mjs",
    "src/"
  ],
  "engines": {
    "node": ">=20"
  },
  "license": "GPL-2.0",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/tim-lynn-clark/SharedNodeEnv.git"
  },
  "bugs": {
    "url": "https://github.com/tim-lynn-clark/SharedNodeEnv/issues"
  },
  "homepage": "https://github.com/tim-lynn-clark/SharedNodeEnv#readme"
}
```

- [ ] **Step 5: Verify both entry points resolve in-tree**

```bash
node -e "const r = require('./index.js'); console.log(typeof r, typeof r.SharedNodeEnvError)"
node --input-type=module -e "import run from './index.mjs'; console.log(typeof run)"
```

Expected: `function function` then `function`.

- [ ] **Step 6: Verify the tarball contents**

Run: `npm pack --dry-run`
Expected: the file list contains `index.js`, `index.mjs`, `config.js`, `config.mjs`, `src/errors.js`, `src/parse.js`, `src/resolve-config.js`, `src/load.js`, `src/apply.js`, `README.md`, `LICENSE`. It must **not** contain `test/`, `docs/`, or `eslint.config.js`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Added dual CJS/ESM entry points and corrected package metadata."
```

---

### Task 9: Packaging test against the real tarball

Unit tests import `../src/...` directly and pass even when the published package is broken. This task closes that gap.

**Files:**
- Create: `test/package.test.js`

**Interfaces:**
- Consumes: the `exports` map and `files` list from Task 8.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the test**

Create `test/package.test.js`:

```js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const { withTempDir } = require('./helpers');

// Slow: npm pack plus a real install. Always runs in CI; opt in locally with
// RUN_PACKAGE_TESTS=1 (or `npm run test:package`).
const enabled = process.env.CI === 'true' || process.env.RUN_PACKAGE_TESTS === '1';
const skip = enabled ? false : 'set RUN_PACKAGE_TESTS=1 to run';

const repoRoot = path.resolve(__dirname, '..');

function packInto(dir) {
  const stdout = execFileSync('npm', ['pack', '--pack-destination', dir], {
    cwd: repoRoot,
    encoding: 'utf8'
  });
  const name = stdout.trim().split('\n').pop().trim();
  return path.join(dir, name);
}

function installInto(dir, tarball) {
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'consumer', version: '1.0.0', private: true })
  );
  execFileSync('npm', ['install', '--no-audit', '--no-fund', tarball], {
    cwd: dir,
    encoding: 'utf8'
  });
}

function writeFixture(dir) {
  const shared = path.join(dir, '.env-shared');
  fs.writeFileSync(shared, JSON.stringify([{ key: 'SNE_PKG', value: 'ok' }]));
  return shared;
}

test('tarball ships the right files and nothing else', { skip }, () => {
  withTempDir((dir) => {
    const tarball = packInto(dir);
    const listing = execFileSync('tar', ['-tf', tarball], { encoding: 'utf8' });

    for (const expected of [
      'package/index.js',
      'package/index.mjs',
      'package/config.js',
      'package/config.mjs',
      'package/src/resolve-config.js',
      'package/src/load.js',
      'package/src/apply.js',
      'package/src/parse.js',
      'package/src/errors.js'
    ]) {
      assert.ok(listing.includes(expected), `tarball should contain ${expected}`);
    }

    assert.ok(!listing.includes('package/test/'), 'tarball must not ship tests');
    assert.ok(!listing.includes('package/docs/'), 'tarball must not ship docs');
  });
});

test('installed package works via require()', { skip }, () => {
  withTempDir((dir) => {
    const tarball = packInto(dir);
    installInto(dir, tarball);
    const shared = writeFixture(dir);

    const script = `
      const run = require('shared-node-env');
      const out = run({ sharedEnv: ${JSON.stringify(shared)}, local: false });
      if (process.env.SNE_PKG !== 'ok') throw new Error('not injected');
      if (out.applied[0] !== 'SNE_PKG') throw new Error('bad result');
      console.log('cjs-ok');
    `;
    const stdout = execFileSync('node', ['-e', script], { cwd: dir, encoding: 'utf8' });
    assert.match(stdout, /cjs-ok/);
  });
});

test('installed package works via ESM import', { skip }, () => {
  withTempDir((dir) => {
    const tarball = packInto(dir);
    installInto(dir, tarball);
    const shared = writeFixture(dir);

    const entry = path.join(dir, 'consumer.mjs');
    fs.writeFileSync(
      entry,
      `import run from 'shared-node-env';
       const out = run({ sharedEnv: ${JSON.stringify(shared)}, local: false });
       if (process.env.SNE_PKG !== 'ok') throw new Error('not injected');
       if (out.applied[0] !== 'SNE_PKG') throw new Error('bad result');
       console.log('esm-ok');`
    );
    const stdout = execFileSync('node', [entry], { cwd: dir, encoding: 'utf8' });
    assert.match(stdout, /esm-ok/);
  });
});

test('side-effect entry works in both formats', { skip }, () => {
  withTempDir((dir) => {
    const tarball = packInto(dir);
    installInto(dir, tarball);
    const shared = writeFixture(dir);
    const env = { ...process.env, SHARED_NODE_ENV_SHARED: shared };

    const cjs = execFileSync(
      'node',
      ['-e', "require('shared-node-env/config'); console.log(process.env.SNE_PKG)"],
      { cwd: dir, encoding: 'utf8', env }
    );
    assert.match(cjs, /ok/);

    const entry = path.join(dir, 'side-effect.mjs');
    fs.writeFileSync(
      entry,
      `import 'shared-node-env/config';
       console.log(process.env.SNE_PKG);`
    );
    const esm = execFileSync('node', [entry], { cwd: dir, encoding: 'utf8', env });
    assert.match(esm, /ok/);
  });
});
```

Note: the side-effect test sets `SHARED_NODE_ENV_SHARED` but no local file exists in the consumer directory. That is intentional — it also proves a missing defaulted local file does not throw at import time.

- [ ] **Step 2: Run it**

Run: `npm run test:package`
Expected: `pass 4  fail 0`. This takes 30–60 seconds because of the real installs.

- [ ] **Step 3: Confirm it skips by default**

Run: `npm test`
Expected: the four packaging tests report as skipped; every other test passes.

- [ ] **Step 4: Commit**

```bash
git add test/package.test.js
git commit -m "Added packaging tests that install the real tarball and exercise all entry points."
```

---

### Task 10: Coverage gate, CI, and Dependabot

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/dependabot.yml`
- Modify: `package.json` (only if the coverage threshold is raised)

> **Pre-existing, do not clobber:** `.github/workflows/secret-scan.yml`,
> `.githooks/pre-commit`, and `.gitleaks.toml` were added on the `grunt-patch`
> branch and are already merged by the time this task runs. Create `ci.yml` as a
> **new** file alongside the secret-scan workflow; do not fold, rename, or
> replace it. The `prepare` script in `package.json`
> (`git config core.hooksPath .githooks`) must also survive — Task 1 rewrites the
> `scripts` block, so confirm `prepare` and `scan` are still present after that
> edit.

**Interfaces:**
- Consumes: the `lint`, `test`, and `test:coverage` scripts from Task 1.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Measure actual coverage**

Run: `npm run test:coverage`

Record the reported line and branch percentages. If both exceed the 90/85 floor, raise the thresholds in the `test:coverage` script to the observed values rounded **down** to a whole percent. Never set them below the floor. If either is *under* the floor, add tests until it is not — do not lower the gate.

- [ ] **Step 2: Create the CI workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [master, v2]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        node: ['20', '22', '24']
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
      - run: npm ci
      - run: npm run lint
      - run: npm test

  coverage:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          # The --test-coverage-lines/--test-coverage-branches threshold flags
          # require Node 22.8+, so coverage runs on one modern version rather
          # than across the support matrix.
          node-version: '24'
      - run: npm ci
      - run: npm run test:coverage
```

GitHub Actions sets `CI=true`, so the packaging tests from Task 9 run automatically in the `test` job on all three Node versions.

- [ ] **Step 3: Create the Dependabot config**

Create `.github/dependabot.yml`:

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: "/"
    schedule:
      interval: weekly
    groups:
      minor-and-patch:
        patterns: ["*"]
        update-types: ["minor", "patch"]

  - package-ecosystem: github-actions
    directory: "/"
    schedule:
      interval: weekly
```

Grouping minor and patch updates into one pull request is deliberate: ungrouped Dependabot noise is why the original three alerts sat unaddressed.

- [ ] **Step 4: Regenerate the lockfile and verify `npm ci` works**

```bash
rm -rf node_modules package-lock.json
npm install
npm ci
npm run lint && npm test
```

Expected: `npm ci` succeeds (CI depends on it) and everything passes.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Added CI across Node 20/22/24, a coverage gate, and grouped Dependabot updates."
```

---

### Task 11: Documentation and release

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: the final API from Tasks 7 and 8.
- Produces: the shipped documentation.

- [ ] **Step 1: Fix the broken example and document the 2.0 API**

Rewrite `README.md`. It must include, at minimum:

1. **A corrected usage example.** The current one says `require('SharedNodeEnv')`; the package is `shared-node-env`, so the existing example fails on any case-sensitive filesystem:

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
console.log(result.missing);  // defaulted files that were not found
```

2. **An ESM section** explaining the hoisting hazard and the side-effect entry:

```js
// Correct — the side-effect import runs before other imports are evaluated.
import 'shared-node-env/config';
import express from 'express';
```

```js
// WRONG — `express` is hoisted above the run() call and loads without your vars.
import run from 'shared-node-env';
run({ sharedEnv: '/etc/myapp/.env-shared' });
import express from 'express';
```

Document the three environment variables: `SHARED_NODE_ENV_SHARED`, `SHARED_NODE_ENV_LOCAL`, and `SHARED_NODE_ENV_OVERRIDE` (only the exact case-insensitive string `"true"` enables it).

3. **A config table** covering `sharedEnv`, `localEnv`, `local`, `override`, with defaults.

4. **An error-handling section** listing the six codes and showing `err.code` branching rather than message matching.

5. **A "Migrating from 1.x" section** with exactly these five points:
   - `override: true` restores 1.x clobbering of existing `process.env` values.
   - Previously-silent malformed env files now throw.
   - `local: false` is largely unnecessary; a defaulted-missing local file is now reported in `missing` rather than fatal.
   - Filename restrictions on `sharedEnv`/`localEnv` are removed; any path is accepted.
   - Node 20 or later is required.

6. **Remove** all references to grunt, jshint, and mocha.

- [ ] **Step 2: Verify every README code sample actually runs**

Copy each JavaScript sample into a scratch file and execute it against a real fixture. A README example that throws is the defect this task exists to fix — do not skip this step.

- [ ] **Step 3: Final full verification**

```bash
npm run lint
npm test
npm run test:package
npm run test:coverage
npm audit
npm pack --dry-run
```

Expected: lint clean, all tests pass, coverage at or above the gate, `found 0 vulnerabilities`, and the tarball file list matches Task 8 Step 6.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "Rewrote the README for 2.0 with ESM guidance and migration notes."
```

- [ ] **Step 5: Open the pull request**

```bash
git push -u origin v2
gh pr create --base master --head v2 \
  --title "2.0: zero-dependency rewrite with a real test suite" \
  --body "Implements docs/superpowers/specs/2026-08-12-dependency-and-test-overhaul-design.md"
```

- [ ] **Step 6: Publish (maintainer action)**

Publishing requires credentials this plan cannot supply. After the PR merges:

```bash
npm login          # interactive; must be run by the maintainer
npm publish        # publishes 2.0.0
```

Do not attempt to automate the login step.

---

## Verification Summary

After Task 11, all of the following must hold:

| Claim | Command | Expected |
|---|---|---|
| No vulnerabilities | `npm audit` | `found 0 vulnerabilities` |
| Zero runtime deps | `node -p "Object.keys(require('./package.json').dependencies \|\| {}).length"` | `0` |
| Lint clean | `npm run lint` | no output, exit 0 |
| Tests pass | `npm test` | `fail 0` |
| Packaging works | `npm run test:package` | `pass 4  fail 0` |
| Coverage gate met | `npm run test:coverage` | exit 0 |
| Re-entrancy fixed | `node --test test/run.test.js` | the re-entrancy test passes |
| No grunt remains | `git ls-files \| grep -i grunt` | no output |
