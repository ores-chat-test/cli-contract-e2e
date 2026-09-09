import "@typespec/json-schema";
using TypeSpec.JsonSchema;

namespace Oresc.SelectedFleet;

@id("SelectedFleetSource")
model SelectedFleetSource {
  repository: string;
  script: string;
}

@id("SelectedFleetPolicy")
model SelectedFleetPolicy {
  previewByDefault: true;
  explicitApplyRequired: true;
  primaryGitHubLogin: "ORESoftware";
  unavailableOwnerContinues: true;
  productionAndTestLanesIndependent: true;
  privateReceipts: true;
  credentialsForbiddenOnArgv: true;
}

@id("SelectedFleetPair")
model SelectedFleetPair {
  logicalOrganization: string;
  productionOwner: string;
  currentImplementation?: string;
  familyPrefix: string;
  testOwner: string;
  testRepositories: string[];
}

@id("SelectedFleetContract")
model SelectedFleetContract {
  schemaVersion: "oresc.selected-fleet.contract.v1";
  source: SelectedFleetSource;
  policy: SelectedFleetPolicy;
  pairs: SelectedFleetPair[];
}
