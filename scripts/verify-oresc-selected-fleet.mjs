#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import process from 'node:process';

const CONTRACT_SCHEMA = 'oresc.selected-fleet.contract.v1';
const REPORT_SCHEMA = 'ores-chat-test.oresc-selected-fleet-report.v1';
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;
const REPOSITORY = /^[A-Za-z0-9._-]+$/;
const FORBIDDEN_NAME = /(github[_-]?pat|ghp[_-])/i;

class ContractError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ContractError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new ContractError(code, message);
}

function exactKeys(value, allowed, target) {
  const actual = Object.keys(value).sort();
  const expected = [...allowed].sort();
  if (actual.join('\0') !== expected.join('\0')) {
    fail('unknown-or-missing-property', `${target} keys differ from the contract`);
  }
}

function safeOwner(value, target) {
  if (typeof value !== 'string' || value.length > 39 || !OWNER.test(value) || value.includes('--')) {
    fail('owner-invalid', `${target} is not a safe GitHub owner`);
  }
  if (FORBIDDEN_NAME.test(value)) {
    fail('owner-secret-shaped', `${target} is secret-shaped`);
  }
}

function safeRepository(value, target) {
  if (typeof value !== 'string' || value.length > 100 || !REPOSITORY.test(value)) {
    fail('repository-invalid', `${target} is not a safe GitHub repository name`);
  }
  if (FORBIDDEN_NAME.test(value)) {
    fail('repository-secret-shaped', `${target} is secret-shaped`);
  }
}

function validateContract(contract) {
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) {
    fail('contract-not-object', 'contract root must be an object');
  }
  exactKeys(contract, ['schemaVersion', 'source', 'policy', 'pairs'], 'contract');
  if (contract.schemaVersion !== CONTRACT_SCHEMA) {
    fail('schema-version', `schemaVersion must be ${CONTRACT_SCHEMA}`);
  }

  exactKeys(contract.source, ['repository', 'script'], 'source');
  if (contract.source.repository !== 'ORESoftware/ores-cli'
      || contract.source.script !== 'reconcile-selected-orgs.sh') {
    fail('source-authority', 'source authority must remain ORESoftware/ores-cli/reconcile-selected-orgs.sh');
  }

  exactKeys(contract.policy, [
    'previewByDefault',
    'explicitApplyRequired',
    'primaryGitHubLogin',
    'unavailableOwnerContinues',
    'productionAndTestLanesIndependent',
    'privateReceipts',
    'credentialsForbiddenOnArgv',
  ], 'policy');
  for (const key of [
    'previewByDefault',
    'explicitApplyRequired',
    'unavailableOwnerContinues',
    'productionAndTestLanesIndependent',
    'privateReceipts',
    'credentialsForbiddenOnArgv',
  ]) {
    if (contract.policy[key] !== true) {
      fail('policy-weakened', `${key} must be true`);
    }
  }
  if (contract.policy.primaryGitHubLogin !== 'ORESoftware') {
    fail('primary-login', 'primaryGitHubLogin must be ORESoftware');
  }

  if (!Array.isArray(contract.pairs) || contract.pairs.length !== 7) {
    fail('pair-count', 'exactly seven production/test pairs are required');
  }

  const logical = new Set();
  const production = new Set();
  const tests = new Set();
  for (const [index, pair] of contract.pairs.entries()) {
    if (!pair || typeof pair !== 'object' || Array.isArray(pair)) {
      fail('pair-not-object', `pairs[${index}] must be an object`);
    }
    const allowed = ['logicalOrganization', 'productionOwner', 'familyPrefix', 'testOwner', 'testRepositories'];
    if (pair.logicalOrganization === 'ores-middleware') allowed.push('currentImplementation');
    exactKeys(pair, allowed, `pairs[${index}]`);

    safeOwner(pair.logicalOrganization, `pairs[${index}].logicalOrganization`);
    safeOwner(pair.productionOwner, `pairs[${index}].productionOwner`);
    safeOwner(pair.testOwner, `pairs[${index}].testOwner`);
    safeRepository(pair.familyPrefix, `pairs[${index}].familyPrefix`);

    if (logical.has(pair.logicalOrganization.toLowerCase())) fail('logical-duplicate', pair.logicalOrganization);
    if (production.has(pair.productionOwner.toLowerCase())) fail('production-duplicate', pair.productionOwner);
    if (tests.has(pair.testOwner.toLowerCase())) fail('test-owner-duplicate', pair.testOwner);
    logical.add(pair.logicalOrganization.toLowerCase());
    production.add(pair.productionOwner.toLowerCase());
    tests.add(pair.testOwner.toLowerCase());

    if (pair.logicalOrganization === 'ores-middleware') {
      if (pair.currentImplementation !== 'ORESoftware/ores-middleware') {
        fail('middleware-current-implementation', 'middleware current implementation must remain explicit');
      }
    }

    if (!Array.isArray(pair.testRepositories) || pair.testRepositories.length === 0) {
      fail('test-repositories-empty', pair.testOwner);
    }
    const repos = new Set();
    for (const [repoIndex, repository] of pair.testRepositories.entries()) {
      safeRepository(repository, `pairs[${index}].testRepositories[${repoIndex}]`);
      const key = repository.toLowerCase();
      if (repos.has(key)) fail('test-repository-duplicate', `${pair.testOwner}/${repository}`);
      repos.add(key);
    }
    if (!repos.has('.github')) fail('test-governance-missing', `${pair.testOwner}/.github`);
  }

  const prefixes = new Map(contract.pairs.map((pair) => [pair.logicalOrganization, pair.familyPrefix]));
  for (const [owner, expected] of Object.entries({
    'ores-rate-limit': 'ores-rl',
    'ores-redis-lru-cache': 'ores-lru-redis',
  })) {
    if (prefixes.get(owner) !== expected) fail('prefix-drift', `${owner} must use ${expected}`);
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractCaseRepositories(source, testOwner) {
  const pattern = new RegExp(
    `${escapeRegExp(testOwner)}\\)\\s*\\n\\s*printf\\s+'%s'\\s+'([^']*)'`,
    'm',
  );
  const match = source.match(pattern);
  if (!match) fail('test-case-missing', `no test_expected_repositories case for ${testOwner}`);
  return match[1].split(',').filter(Boolean);
}

function validateScript(contract, source) {
  if (typeof source !== 'string' || source.length === 0 || source.length > 256_000) {
    fail('script-size', 'script must be nonempty and at most 256 KiB');
  }
  for (const required of [
    'APPLY=0',
    '--apply',
    '--production-only',
    '--tests-only',
    '--strict',
    'PRIMARY_LOGIN="${ORES_PRIMARY_GITHUB_LOGIN:-ORESoftware}"',
    'umask 077',
    'mktemp -d',
  ]) {
    if (!source.includes(required)) fail('script-invariant-missing', required);
  }
  for (const forbidden of ['--token', 'Authorization: Bearer', 'github_pat_', 'ghp_']) {
    if (source.includes(forbidden)) fail('credential-argv-surface', forbidden);
  }

  for (const pair of contract.pairs) {
    const productionCall = `process_production ${pair.productionOwner} ${pair.familyPrefix}`;
    if (!source.includes(productionCall)) fail('production-call-drift', productionCall);
    const testCall = `process_test_org ${pair.testOwner}`;
    if (!source.includes(testCall)) fail('test-call-drift', testCall);

    const actual = extractCaseRepositories(source, pair.testOwner);
    if (actual.join('\0') !== pair.testRepositories.join('\0')) {
      fail('test-repository-matrix-drift', pair.testOwner);
    }
  }
}

function syntheticScript(contract) {
  const lines = [
    '#!/usr/bin/env bash',
    'set -uo pipefail',
    'umask 077',
    'APPLY=0',
    'PRIMARY_LOGIN="${ORES_PRIMARY_GITHUB_LOGIN:-ORESoftware}"',
    '# --apply --production-only --tests-only --strict',
    '# mktemp -d',
    'test_expected_repositories() {',
    '  case "$1" in',
  ];
  for (const pair of contract.pairs) {
    lines.push(`    ${pair.testOwner})`);
    lines.push(`      printf '%s' '${pair.testRepositories.join(',')}'`);
    lines.push('      ;;');
  }
  lines.push('  esac', '}');
  for (const pair of contract.pairs) lines.push(`process_production ${pair.productionOwner} ${pair.familyPrefix}`);
  for (const pair of contract.pairs) lines.push(`process_test_org ${pair.testOwner}`);
  return `${lines.join('\n')}\n`;
}

async function selfTest(contract) {
  validateContract(contract);
  validateScript(contract, syntheticScript(contract));

  const staleMatrix = syntheticScript(contract).replace(
    "'.github,ores-redis-lru-e2e-test,ores-redis-lru-cache-test.github.io'",
    "'.github,ores-redis-lru-e2e-test,stale-scenario-repository'",
  );
  try {
    validateScript(contract, staleMatrix);
    fail('self-test-missed-matrix-drift', 'stale matrix was accepted');
  } catch (error) {
    if (!(error instanceof ContractError) || error.code !== 'test-repository-matrix-drift') throw error;
  }

  const badPrefix = syntheticScript(contract).replace(
    'process_production ores-rate-limit ores-rl',
    'process_production ores-rate-limit ores-rate-limit',
  );
  try {
    validateScript(contract, badPrefix);
    fail('self-test-missed-prefix-drift', 'bad prefix was accepted');
  } catch (error) {
    if (!(error instanceof ContractError) || error.code !== 'production-call-drift') throw error;
  }

  const duplicate = structuredClone(contract);
  duplicate.pairs[0].testRepositories.push(duplicate.pairs[0].testRepositories[0]);
  try {
    validateContract(duplicate);
    fail('self-test-missed-duplicate', 'duplicate repository was accepted');
  } catch (error) {
    if (!(error instanceof ContractError) || error.code !== 'test-repository-duplicate') throw error;
  }

  const secretShaped = structuredClone(contract);
  secretShaped.pairs[0].testRepositories[1] = 'github_pat_example';
  try {
    validateContract(secretShaped);
    fail('self-test-missed-secret-shape', 'secret-shaped repository was accepted');
  } catch (error) {
    if (!(error instanceof ContractError) || error.code !== 'repository-secret-shaped') throw error;
  }
}

function parseArgs(argv) {
  const result = { contract: 'contracts/oresc-selected-fleet.v1.json', script: null, selfTest: false };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === '--contract') result.contract = argv[++i] ?? null;
    else if (value === '--script') result.script = argv[++i] ?? null;
    else if (value === '--self-test') result.selfTest = true;
    else if (value === '--help' || value === '-h') {
      console.log('Usage: node scripts/verify-oresc-selected-fleet.mjs [--contract PATH] [--script PATH] [--self-test]');
      process.exit(0);
    } else fail('unknown-argument', value);
  }
  if (!result.contract) fail('contract-path-missing', '--contract requires a path');
  if (result.script === null && argv.includes('--script')) fail('script-path-missing', '--script requires a path');
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const contract = JSON.parse(await readFile(args.contract, 'utf8'));
  validateContract(contract);
  if (args.selfTest) await selfTest(contract);
  if (args.script) validateScript(contract, await readFile(args.script, 'utf8'));

  process.stdout.write(`${JSON.stringify({
    schemaVersion: REPORT_SCHEMA,
    status: 'passed',
    pairs: contract.pairs.length,
    testRepositories: contract.pairs.reduce((sum, pair) => sum + pair.testRepositories.length, 0),
    sourceChecked: Boolean(args.script),
    selfTested: args.selfTest,
  })}\n`);
}

main().catch((error) => {
  const code = error instanceof ContractError ? error.code : 'runtime-error';
  process.stderr.write(`oresc selected-fleet contract failure: ${code}\n`);
  process.exitCode = error instanceof ContractError ? 2 : 70;
});
