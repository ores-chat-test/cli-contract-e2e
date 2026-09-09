#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const LOCK_SCHEMA = 'ores.tjsv-source-lock/v1';
const UPSTREAM_SCHEMA = 'ores-chat-test.oresc-tjsv-pin/v1';
const REPOSITORY = 'ORESoftware/typespec-json-schema-validator';
const SHA40 = /^[0-9a-f]{40}$/u;
const EXACT_LOCK_KEYS = ['repository', 'revision', 'schema'];

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function exactKeys(value, keys) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
}

function validateLock(lock) {
  if (!exactKeys(lock, EXACT_LOCK_KEYS)) throw new Error('source-lock envelope is not closed');
  if (lock.schema !== LOCK_SCHEMA) throw new Error('source-lock schema mismatch');
  if (lock.repository !== REPOSITORY) throw new Error('validator repository mismatch');
  if (!SHA40.test(lock.revision)) throw new Error('revision is not an immutable lowercase Git SHA');
  return lock;
}

function expectRejected(label, mutation) {
  const candidate = mutation(readJson('den-390/source-lock.json'));
  try {
    validateLock(candidate);
  } catch {
    return;
  }
  throw new Error(`${label} was accepted`);
}

const lock = validateLock(readJson('den-390/source-lock.json'));
const upstream = readJson('den-390/upstream-lock.json');
if (upstream.schema !== UPSTREAM_SCHEMA) throw new Error('upstream lock schema mismatch');
if (!SHA40.test(upstream.upstream?.head ?? '')) throw new Error('upstream head is not immutable');
if (upstream.expectedValidator?.repository !== lock.repository) throw new Error('expected repository drift');
if (upstream.expectedValidator?.revision !== lock.revision) throw new Error('expected revision drift');

for (const [path, blob] of Object.entries(upstream.upstream?.files ?? {})) {
  if (!SHA40.test(blob)) throw new Error(`invalid upstream blob for ${path}`);
}
const actualSourceLockBlob = execFileSync('git', ['hash-object', 'den-390/source-lock.json'], {
  encoding: 'utf8',
}).trim();
if (actualSourceLockBlob !== upstream.upstream.files['tjsv/source-lock.json']) {
  throw new Error(`source-lock blob mismatch: ${actualSourceLockBlob}`);
}

expectRejected('mutable branch', (candidate) => ({ ...candidate, revision: 'main' }));
expectRejected('abbreviated SHA', (candidate) => ({ ...candidate, revision: candidate.revision.slice(0, 12) }));
expectRejected('uppercase SHA', (candidate) => ({ ...candidate, revision: candidate.revision.toUpperCase() }));
expectRejected('alternate repository', (candidate) => ({ ...candidate, repository: 'the1mills/typespec-json-schema-validator' }));
expectRejected('extra authority field', (candidate) => ({ ...candidate, preferredAuthority: 'typespec' }));

const commandLine = `git clone https://github.com/${lock.repository}.git && git checkout ${lock.revision}`;
if (/ghp_|Authorization|token@/u.test(commandLine)) throw new Error('credential material entered clone plan');

process.stdout.write(JSON.stringify({
  status: 'passed',
  repository: lock.repository,
  revision: lock.revision,
  upstreamHead: upstream.upstream.head,
  negativeCases: 5,
  sourceLockBlob: actualSourceLockBlob,
}) + '\n');
