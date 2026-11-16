#!/usr/bin/env bash
# Load the repository's NPM_TOKEN and publish to npmjs as intentcomputing.
# Disable tracing before handling credentials, including when invoked with bash -x.
set +x
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

node --input-type=module - "$ROOT" "$@" <<'NODE'
import { readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.argv[2];
const sdkDir = join(root, 'sdks/typescript');
const registry = 'https://registry.npmjs.org/';
const inheritedEnv = { ...process.env };
const releaseArgs = process.argv.slice(3);
let token = '';
let tarball;

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

if (releaseArgs.length > 1) {
  fail('Usage: npm run release -- [/absolute/path/to/audited-package.tgz]');
}

if (typeof process.loadEnvFile !== 'function') {
  fail('Release requires Node.js 20.12 or newer to read the repository .env.');
}
try {
  // Never fall back to a token inherited from a different shell/account.
  delete process.env.NPM_TOKEN;
  process.loadEnvFile(join(root, '.env'));
  token = process.env.NPM_TOKEN || '';
} catch {
  fail('Could not read the repository .env. Configure NPM_TOKEN there.');
}
if (!token || token !== token.trim() || /[\r\n]/.test(token)) {
  fail('NPM_TOKEN is missing or invalid in the repository .env.');
}

try {
  const npmrc = readFileSync(join(root, '.npmrc'), 'utf8');
  const authLines = npmrc.split(/\r?\n/).filter((line) =>
    /^\s*\/\/registry\.npmjs\.org\/:_authToken\s*=/.test(line));
  if (authLines.length !== 1 ||
      authLines[0].trim() !== '//registry.npmjs.org/:_authToken=${NPM_TOKEN}') {
    fail('The repository .npmrc must reference ${NPM_TOKEN} for npmjs authentication.');
  }
  const pkg = JSON.parse(readFileSync(join(sdkDir, 'package.json'), 'utf8'));
  if (pkg.name !== '@intentcomputing/koko-agent-sdk' ||
      pkg.publishConfig?.registry !== registry) {
    fail('Unexpected SDK package name or publish registry.');
  }
  const reportedVersion = (source) =>
    source.match(/\bexport\s+const\s+KOKO_SDK_VERSION\s*=\s*(['"])([^'"]+)\1/)?.[2];
  if (reportedVersion(readFileSync(join(sdkDir, 'src/protocol.ts'), 'utf8')) !== pkg.version) {
    fail('The SDK package and wire-reported SDK versions must match.');
  }
  if (releaseArgs.length === 1) {
    tarball = resolve(releaseArgs[0]);
    if (!statSync(tarball).isFile()) fail('The audited tarball must be a regular file.');
    const member = (name) => {
      const result = spawnSync('tar', ['-xOzf', tarball, 'package/' + name], {
        encoding: 'utf8', maxBuffer: 1024 * 1024,
      });
      if (result.error || result.status !== 0) fail('Could not inspect the audited tarball metadata.');
      return result.stdout;
    };
    const packed = JSON.parse(member('package.json'));
    if (packed.name !== pkg.name || packed.version !== pkg.version ||
        packed.publishConfig?.registry !== registry ||
        reportedVersion(member('src/protocol.ts')) !== pkg.version) {
      fail('The audited tarball must match the SDK name, package version and wire-reported version.');
    }
  }
} catch {
  fail('Could not verify the SDK package, tarball and repository npm configuration.');
}

const env = {
  ...inheritedEnv,
  NPM_TOKEN: token,
  NPM_CONFIG_USERCONFIG: join(root, '.npmrc'),
  NPM_CONFIG_REGISTRY: registry,
};
// npm run supplies lowercase npm_config_* variables. Explicit CLI config below
// fixes the userconfig and registry even when those inherited values differ.
const configArgs = ['--userconfig', join(root, '.npmrc'), '--registry', registry,
  '--@intentcomputing:registry=' + registry];
const redact = (output = '') => String(output).split(token).join('[REDACTED]');

function runNpm(args) {
  const result = spawnSync('npm', [...args, ...configArgs], {
    cwd: sdkDir, env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  });
  if (result.stderr) process.stderr.write(redact(result.stderr));
  if (result.error || result.status !== 0) {
    if (result.stdout) process.stdout.write(redact(result.stdout));
    fail(`npm ${args[0]} failed; publication was not confirmed.`);
  }
  return result.stdout.trim();
}

const account = runNpm(['whoami']);
if (account !== 'intentcomputing') {
  fail('npm account must be intentcomputing; refusing to publish.');
}
process.stdout.write('Verified npm account: intentcomputing\n');
const output = runNpm(['publish', ...(tarball ? [tarball] : []), '--access', 'public']);
if (output) process.stdout.write(redact(output) + '\n');
NODE
