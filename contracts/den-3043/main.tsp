import "@typespec/json-schema";
using TypeSpec.JsonSchema;

namespace Oresc.DatabaseIdentity;

@id("DbTableLink")
model DbTableLink {
  qualifiedName: string;
  schema: string;
  table: string;
  source: string;
  line: int32;
  explicitSchema: boolean;
  quotedSchema: boolean;
  quotedTable: boolean;
}

@id("DbTableAudit")
model DbTableAudit {
  schemaVersion: "ores.db-table-audit/v1";
  tableCount: int32;
  namespaceCount: int32;
  links: DbTableLink[];
}
