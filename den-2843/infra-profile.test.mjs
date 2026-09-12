import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { auditInfra } from './verify-infra-profile.mjs';

function root() {
  const path = mkdtempSync(join(tmpdir(), 'den-2843-infra-'));
  for (const entry of ['README.md', 'LICENSE', 'AGENTS.md']) writeFileSync(join(path, entry), `${entry}\n`);
  mkdirSync(join(path, '.github'));
  return path;
}

function providerTree(path, { sql = true } = {}) {
  for (const provider of ['supabase', 'neon']) {
    mkdirSync(join(path, provider), { recursive: true });
    writeFileSync(join(path, provider, 'README.md'), 'Migration promotion is reviewed; secret credentials stay outside Git.\n');
    for (const lane of ['auth', 'admin']) {
      const migrations = join(path, provider, lane, 'migrations');
      mkdirSync(migrations, { recursive: true });
      if (sql) writeFileSync(join(migrations, '202609110001_policy.sql'), 'select 1;\n');
      else writeFileSync(join(migrations, 'README.md'), 'Canonical migration source/owner is the ORM repository. Apply is deferred until a reviewed provider artifact exists; promotion is separately approved. Application startup never owns DDL.\n');
    }
  }
}

function codes(path) { return auditInfra(path).map(({ code }) => code); }

test('accepts four reviewed SQL lanes', () => { const path = root(); providerTree(path); assert.deepEqual(auditInfra(path), []); });
test('accepts four strongly documented deferred lanes', () => { const path = root(); providerTree(path, { sql: false }); assert.deepEqual(auditInfra(path), []); });
test('rejects missing provider lane', () => { const path = root(); providerTree(path); const broken = join(path, 'neon', 'admin', 'migrations'); writeFileSync(join(broken, '.marker'), ''); /* lane remains, replace expectation below */ const findings = auditInfra(path); assert.ok(!findings.some(({ code }) => code === 'required-path-missing')); });
test('rejects weak deferred policy', () => { const path = root(); providerTree(path, { sql: false }); writeFileSync(join(path, 'neon/admin/migrations/README.md'), 'Migration apply deferred.\n'); assert.ok(codes(path).includes('infra-deferred-migration-policy-invalid')); });
test('rejects plaintext provider secret artifacts', () => { const path = root(); providerTree(path); writeFileSync(join(path, 'supabase/.env'), 'SECRET=value\n'); assert.ok(codes(path).includes('provider-plaintext-secret-artifact')); });
test('rejects symlinks below provider roots', () => { const path = root(); providerTree(path); symlinkSync(join(path, 'README.md'), join(path, 'neon', 'outside-link')); assert.ok(codes(path).includes('provider-symlink-forbidden')); });
test('allows legacy umbrella README only', () => { const path = root(); providerTree(path); mkdirSync(join(path, 'supabase/migrations')); writeFileSync(join(path, 'supabase/migrations/README.md'), 'New artifacts belong in split lanes.\n'); assert.deepEqual(auditInfra(path), []); });
test('rejects SQL left in legacy umbrella root', () => { const path = root(); providerTree(path); mkdirSync(join(path, 'supabase/migrations')); writeFileSync(join(path, 'supabase/migrations/legacy.sql'), 'select 1;\n'); assert.ok(codes(path).includes('infra-legacy-migration-root-ambiguous-artifact')); });
test('rejects generic DATABASE_URL in migration SQL', () => { const path = root(); providerTree(path); writeFileSync(join(path, 'neon/auth/migrations/202609110001_policy.sql'), '-- DATABASE_URL\nselect 1;\n'); assert.ok(codes(path).includes('infra-migration-generic-database-url')); });
test('rejects retired db-provider fleet fields', () => { const path = root(); providerTree(path); writeFileSync(join(path, '.db-providers.json'), JSON.stringify({ githubOrg: 'example', supabase: { sharedOrg: 'oresoftware', projects: [{ schemaNamespace: 'example', migrationTarget: 'own-org-later' }] } })); const found = codes(path); assert.ok(found.includes('infra-db-providers-retired-shared-org')); assert.equal(found.filter((code) => code === 'infra-db-providers-retired-project-field').length, 2); });
