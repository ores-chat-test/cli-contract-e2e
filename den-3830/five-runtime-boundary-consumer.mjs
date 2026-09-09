import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import {
  LANGUAGE_BOUNDARY_VERIFICATION_SCHEMA,
  verifyLanguageBoundaries,
} from '@oresoftware/typespec-json-schema-validator/language-boundary-verification';

const runId = 'b'.repeat(64);
const contractIrId = 'c'.repeat(64);
const revision = 'a'.repeat(40);

const targets = Object.freeze([
  ['rust', 'native', 'evidence/rust-native.json', 'rustc', '1.95.0'],
  ['typescript', 'node', 'evidence/typescript-node.json', 'node', '22.16.0'],
  ['dart', 'flutter', 'evidence/dart-flutter.json', 'dart', '3.9.2'],
  ['go', 'native', 'evidence/go-native.json', 'go', '1.25.1'],
  ['gleam', 'beam', 'evidence/gleam-beam.json', 'gleam', '1.12.0'],
].map(([language, runtime, evidence, toolchain, version]) => Object.freeze({
  language,
  runtime,
  evidence,
  toolchain,
  version,
})));

function report(overrides = {}) {
  return {
    schema: 'ores.typespec-json-schema-validator.report/v1',
    runId,
    status: 'passed',
    zeroUnexplainedFindings: true,
    findings: [],
    authorities: {
      typespec: {
        authority: 'independently-authored',
        generatedJsonSchemaRole: 'comparison-evidence-only',
      },
      jsonSchema: { authority: 'independently-authored' },
      precedence: 'none',
    },
    coverage: { differentialInstanceValidation: true },
    differential: {
      summary: { probesEvaluated: 625, divergences: 0, refusals: 0 },
    },
    ...overrides,
  };
}

function contractIr(overrides = {}) {
  return {
    schema: 'ores.typespec-json-schema-validator.contract-ir/v1',
    irId: contractIrId,
    status: 'passed',
    admissible: true,
    role: 'downstream-derived-parity-artifact',
    editableAuthority: false,
    authorities: {
      typespec: 'independently-authored',
      jsonSchema: 'independently-authored',
      generatedJsonSchema: 'comparison-evidence-only',
      precedence: 'none',
    },
    declarations: [{ id: 'Ores.Chat.Contract.V1.Message' }],
    excludedDeclarations: [],
    outOfScopeDeclarations: [],
    admission: {
      receipt: { runId },
      requirements: { differentialInstanceValidation: true },
    },
    ...overrides,
  };
}

function manifest(overrides = {}) {
  return {
    schema: 'ores.typespec-json-schema-validator.language-boundaries/v1',
    minimumDistinctLanguages: 5,
    authorities: {
      typeSpec: 'peer',
      jsonSchema: 'peer',
      generatedWitness: 'evidence_only',
    },
    targets: targets.map(({ language, runtime, evidence }) => ({
      language,
      runtime,
      evidence,
      required: true,
      ingress: true,
      egress: true,
    })),
    ...overrides,
  };
}

function evidence(target, overrides = {}) {
  return {
    schema: 'ores.typespec-json-schema-validator.language-boundary-evidence/v1',
    language: target.language,
    runtime: target.runtime,
    status: 'passed',
    sourceRevision: revision,
    artifactDigest: `sha256:${'d'.repeat(64)}`,
    contractIrId,
    receiptRunId: runId,
    toolchain: { name: target.toolchain, version: target.version },
    generator: { name: 'oresoftware-api-docs', version: '1.0.0' },
    validation: { ingress: 'passed', egress: 'passed' },
    ...overrides,
  };
}

function evidenceMap(overrides = new Map()) {
  return new Map(targets.map((target) => [
    target.evidence,
    evidence(target, overrides.get(target.evidence) ?? {}),
  ]));
}

function verify({
  manifestValue = manifest(),
  reportValue = report(),
  contractIrValue = contractIr(),
  evidenceValue = evidenceMap(),
} = {}) {
  return verifyLanguageBoundaries({
    manifest: manifestValue,
    report: reportValue,
    contractIr: contractIrValue,
    evidenceByPath: evidenceValue,
  });
}

function hasFinding(result, ruleId) {
  return result.findings.some((finding) => finding.ruleId === ruleId);
}

const admitted = verify();
assert.equal(admitted.schema, LANGUAGE_BOUNDARY_VERIFICATION_SCHEMA);
assert.equal(admitted.status, 'passed');
assert.equal(admitted.zeroUnexplainedFindings, true);
assert.deepEqual(admitted.counts, {
  targets: 5,
  requiredTargets: 5,
  distinctRequiredLanguages: 5,
  admittedEvidence: 5,
  findings: 0,
});
assert.equal(admitted.binding.parityReceiptRunId, runId);
assert.equal(admitted.binding.contractIrId, contractIrId);
assert.match(admitted.verificationId, /^sha256:[0-9a-f]{64}$/u);
assert.ok(Object.isFrozen(admitted));
assert.ok(Object.isFrozen(admitted.binding));
assert.ok(Object.isFrozen(admitted.counts));
assert.ok(Object.isFrozen(admitted.findings));

const reordered = verify({
  manifestValue: manifest({ targets: [...manifest().targets].reverse() }),
  evidenceValue: new Map([...evidenceMap()].reverse()),
});
assert.equal(reordered.verificationId, admitted.verificationId);

const staleReceipt = verify({
  evidenceValue: evidenceMap(new Map([[
    targets[0].evidence,
    { receiptRunId: 'e'.repeat(64) },
  ]])),
});
assert.ok(hasFinding(staleReceipt, 'boundary-evidence-receipt-mismatch'));
assert.equal(staleReceipt.counts.admittedEvidence, 4);

const staleIr = verify({
  evidenceValue: evidenceMap(new Map([[
    targets[1].evidence,
    { contractIrId: 'f'.repeat(64) },
  ]])),
});
assert.ok(hasFinding(staleIr, 'boundary-evidence-contract-ir-mismatch'));
assert.equal(staleIr.counts.admittedEvidence, 4);

const missingEvidence = evidenceMap();
missingEvidence.delete(targets[2].evidence);
const missing = verify({ evidenceValue: missingEvidence });
assert.ok(hasFinding(missing, 'boundary-required-evidence-missing'));
assert.equal(missing.counts.admittedEvidence, 4);

const divergent = verify({
  reportValue: report({
    differential: {
      summary: { probesEvaluated: 625, divergences: 1, refusals: 0 },
    },
  }),
});
assert.ok(hasFinding(divergent, 'boundary-differential-evidence-not-converged'));
assert.equal(divergent.counts.admittedEvidence, 0);

const partialScope = verify({
  contractIrValue: contractIr({
    outOfScopeDeclarations: [{ id: 'Ores.Chat.Contract.V1.InternalMessage' }],
  }),
});
assert.ok(hasFinding(partialScope, 'boundary-contract-ir-scope-incomplete'));
assert.equal(partialScope.counts.admittedEvidence, 0);

const promotedWitness = verify({
  manifestValue: manifest({
    authorities: {
      typeSpec: 'peer',
      jsonSchema: 'peer',
      generatedWitness: 'authority',
    },
  }),
});
assert.ok(hasFinding(promotedWitness, 'boundary-authority-model-invalid'));
assert.equal(promotedWitness.counts.admittedEvidence, 0);

const duplicatePathTargets = manifest().targets;
duplicatePathTargets[4] = {
  ...duplicatePathTargets[4],
  evidence: duplicatePathTargets[0].evidence,
};
const duplicatePath = verify({
  manifestValue: manifest({ targets: duplicatePathTargets }),
});
assert.ok(hasFinding(duplicatePath, 'boundary-evidence-reused'));

const output = process.env.TJSV_BOUNDARY_RECEIPT;
if (output) {
  mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
  writeFileSync(output, `${JSON.stringify(admitted, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
}

process.stdout.write(
  `five-runtime boundary admission passed: targets=${admitted.counts.targets} negativeCases=7 verification=${admitted.verificationId}\n`,
);
