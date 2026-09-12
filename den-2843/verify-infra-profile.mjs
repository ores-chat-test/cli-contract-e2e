import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const PROVIDERS = ['supabase', 'neon'];
const LANES = ['auth', 'admin'];
const BASELINE = ['README.md', 'LICENSE', 'AGENTS.md', '.github'];

function exists(path) {
  try { lstatSync(path); return true; } catch { return false; }
}

function walk(root, current = root, out = []) {
  if (!exists(current)) return out;
  const stat = lstatSync(current);
  if (stat.isSymbolicLink()) { out.push({ path: current, stat }); return out; }
  if (!stat.isDirectory()) { out.push({ path: current, stat }); return out; }
  for (const name of readdirSync(current)) walk(root, join(current, name), out);
  return out;
}

function read(path) {
  return readFileSync(path, 'utf8');
}

function hasCredentialMaterial(source) {
  const lower = source.toLowerCase();
  return lower.includes('postgres://') || lower.includes('postgresql://')
    || lower.includes('begin private key') || lower.includes('begin rsa private key')
    || lower.includes('begin ec private key') || lower.includes('begin openssh private key');
}

function deferredPolicyOkay(source) {
  const lower = source.toLowerCase();
  const authorityTerms = ['canonical', 'source', 'owner', 'ownership', 'repository']
    .filter((needle) => lower.includes(needle)).length;
  const deferred = lower.includes('defer') || lower.includes('not generated')
    || lower.includes('not approved') || lower.includes('no production');
  const separateApply = lower.includes('apply') || lower.includes('promotion');
  const noStartup = lower.includes('startup') && ['never', 'not', 'forbid', 'disabled']
    .some((needle) => lower.includes(needle));
  return lower.includes('migration') && authorityTerms >= 2 && deferred && separateApply && noStartup;
}

export function auditInfra(root) {
  const findings = [];
  const add = (code, target) => findings.push({ code, target });

  for (const entry of BASELINE) if (!exists(join(root, entry))) add('required-path-missing', entry);

  for (const provider of PROVIDERS) {
    const providerRoot = join(root, provider);
    const providerReadme = join(providerRoot, 'README.md');
    if (!exists(providerRoot)) add('required-path-missing', provider);
    if (!exists(providerReadme)) add('required-path-missing', `${provider}/README.md`);
    else {
      const source = read(providerReadme).toLowerCase();
      if (!source.includes('migration')) add('provider-readme-migration-policy-missing', `${provider}/README.md`);
      if (!source.includes('secret')) add('provider-readme-secret-policy-missing', `${provider}/README.md`);
    }

    for (const lane of LANES) {
      const relativeLane = `${provider}/${lane}/migrations`;
      const laneRoot = join(root, relativeLane);
      if (!exists(laneRoot)) { add('required-path-missing', relativeLane); continue; }
      const laneStat = lstatSync(laneRoot);
      if (laneStat.isSymbolicLink() || !laneStat.isDirectory()) {
        add('infra-migration-lane-not-directory', relativeLane);
        continue;
      }
      const sql = readdirSync(laneRoot).filter((name) => name.endsWith('.sql'));
      if (sql.length === 0) {
        const policy = join(laneRoot, 'README.md');
        if (!exists(policy) || !deferredPolicyOkay(read(policy))) {
          add('infra-deferred-migration-policy-invalid', relativeLane);
        } else if (hasCredentialMaterial(read(policy))) {
          add('infra-deferred-migration-policy-database-url', relativeLane);
        }
      } else {
        for (const name of sql) {
          const target = `${relativeLane}/${name}`;
          const source = read(join(laneRoot, name));
          if (!source.trim()) add('infra-migration-sql-empty', target);
          if (hasCredentialMaterial(source)) add('infra-migration-sql-database-url', target);
          if (source.split(/[^A-Za-z0-9_]+/).includes('DATABASE_URL')) add('infra-migration-generic-database-url', target);
        }
      }
    }

    const legacy = join(providerRoot, 'migrations');
    if (exists(legacy)) {
      const stat = lstatSync(legacy);
      if (stat.isSymbolicLink() || !stat.isDirectory()) add('infra-legacy-migration-root-not-directory', `${provider}/migrations`);
      else for (const entry of walk(root, legacy)) {
        const target = relative(root, entry.path).replaceAll('\\', '/');
        if (entry.stat.isSymbolicLink()) add('provider-symlink-forbidden', target);
        else if (entry.stat.isFile() && target.split('/').at(-1)?.toLowerCase() !== 'readme.md') {
          add('infra-legacy-migration-root-ambiguous-artifact', target);
        }
      }
    }

    if (exists(providerRoot)) for (const entry of walk(root, providerRoot)) {
      const target = relative(root, entry.path).replaceAll('\\', '/');
      if (entry.stat.isSymbolicLink()) add('provider-symlink-forbidden', target);
      if (!entry.stat.isFile()) continue;
      const name = target.split('/').at(-1)?.toLowerCase() ?? '';
      if (['.env', 'credentials.json', 'service-account.json'].includes(name)
          || name.endsWith('.pem') || name.endsWith('.key')) {
        add('provider-plaintext-secret-artifact', target);
      }
    }
  }

  const dbProviders = join(root, '.db-providers.json');
  if (exists(dbProviders)) {
    let data;
    try { data = JSON.parse(read(dbProviders)); } catch { add('infra-db-providers-invalid-json', '.db-providers.json'); }
    if (data?.supabase?.sharedOrg !== undefined) add('infra-db-providers-retired-shared-org', '.db-providers.json#supabase.sharedOrg');
    for (const [index, project] of (data?.supabase?.projects ?? []).entries()) {
      for (const field of ['schemaNamespace', 'migrationTarget']) {
        if (Object.hasOwn(project, field)) add('infra-db-providers-retired-project-field', `.db-providers.json#supabase.projects[${index}].${field}`);
      }
    }
  }

  return findings.sort((a, b) => `${a.code}:${a.target}`.localeCompare(`${b.code}:${b.target}`));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = process.argv[2] ?? '.';
  const findings = auditInfra(root);
  process.stdout.write(`${JSON.stringify({ version: 1, root, findings }, null, 2)}\n`);
  process.exitCode = findings.length === 0 ? 0 : 2;
}
