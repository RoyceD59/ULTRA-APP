import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const target = path.resolve(here, "../../api-zod/src/generated/api.ts");
const openApiPath = path.resolve(here, "../openapi.yaml");
let source = fs.readFileSync(target, "utf8");
const openApi = fs.readFileSync(openApiPath, "utf8");

// Orval can express the transport-level bounds and coarse portable patterns,
// but JavaScript RegExp output cannot carry the exact Unicode/repetition and
// formatting semantics used by the shared identity policy. Only wire these
// generated fields to the transforms when the named OpenAPI validator
// extensions are present and unchanged, so this cannot silently replace an
// unrelated schema after a spec edit.
const identityValidators = [
  ["InstantWaterFirstName", "instant-water-first-name@1"],
  ["InstantWaterPhone", "instant-water-phone@1"],
];
for (const [schemaName, validatorName] of identityValidators) {
  const schemaStart = openApi.indexOf(`    ${schemaName}:\n`);
  if (schemaStart < 0) {
    throw new Error(`Missing OpenAPI identity schema: ${schemaName}`);
  }
  const schemaTail = openApi.slice(schemaStart + schemaName.length + 6);
  const nextSchema = schemaTail.search(/\n    [A-Za-z][A-Za-z0-9]*:\n/);
  const schemaBlock = schemaTail.slice(0, nextSchema < 0 ? undefined : nextSchema);
  const extension = schemaBlock.match(/^\s+x-uc-validator:\s*(\S+)\s*$/m)?.[1];
  if (extension !== validatorName) {
    throw new Error(`Expected ${schemaName} to declare x-uc-validator: ${validatorName}; found ${extension ?? "none"}`);
  }
}

const identityImport = "import { instantWaterFirstNameSchema, instantWaterPhoneSchema } from '../instant-water-identity.js';";
if (!source.includes(identityImport)) {
  source = source.replace("import * as zod from 'zod';", `import * as zod from 'zod';\n${identityImport}`);
}

let firstNameFields = 0;
source = source.replace(
  /"firstName": zod\.string\(\)\.min\(create(?:Public|Authenticated)InstantWaterAssessmentBodyFirstNameMin\)[^\n]+,\n/g,
  () => {
    firstNameFields += 1;
    return '"firstName": instantWaterFirstNameSchema,\n';
  },
);
let phoneFields = 0;
source = source.replace(
  /"phone": zod\.string\(\)\.min\(create(?:Public|Authenticated)InstantWaterAssessmentBodyPhoneMin\)[^\n]+,?\n/g,
  () => {
    phoneFields += 1;
    return '"phone": instantWaterPhoneSchema,\n';
  },
);
if (firstNameFields !== 2 || phoneFields !== 2) {
  throw new Error(`Expected two instant water identity fields; found ${firstNameFields} first-name and ${phoneFields} phone fields`);
}

const names = [
  "listUcLocationsResponseLatMin",
  "listUcLocationsResponseLatMax",
  "listUcLocationsResponseLngMin",
  "listUcLocationsResponseLngMax",
];

const hasLocationResponse = source.includes("export const ListUcLocationsResponse");

if (hasLocationResponse) {
  const declarations = [];
  for (const name of names) {
    const pattern = new RegExp(`export const ${name} = [^;]+;\\n*`);
    const match = source.match(pattern);
    if (!match) throw new Error(`Missing generated declaration: ${name}`);
    declarations.push(match[0].trim());
    source = source.replace(pattern, "");
  }

  const itemPattern = /export const ListUcLocationsResponseItem = zod\.object\(\{[\s\S]*?\n\}\)\n*/;
  const item = source.match(itemPattern);
  if (!item) throw new Error("Missing generated ListUcLocationsResponseItem declaration");
  source = source.replace(itemPattern, "");

  const responseDeclaration = "export const ListUcLocationsResponse = zod.array(ListUcLocationsResponseItem)";
  if (!source.includes(responseDeclaration)) {
    throw new Error("Missing generated ListUcLocationsResponse declaration");
  }

  const ordered = `${declarations.join("\n")}\n\n${item[0].trim()}\n\n`;
  source = source.replace(responseDeclaration, `${ordered}${responseDeclaration}`);
}
fs.writeFileSync(target, `${source.trimEnd()}\n`);

function trimGeneratedTypeScript(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) trimGeneratedTypeScript(filePath);
    else if (entry.isFile() && entry.name.endsWith(".ts")) {
      const fileSource = fs.readFileSync(filePath, "utf8");
      fs.writeFileSync(filePath, `${fileSource.trimEnd()}\n`);
    }
  }
}

trimGeneratedTypeScript(path.resolve(here, "../../api-client-react/src/generated"));
trimGeneratedTypeScript(path.resolve(here, "../../api-zod/src/generated"));