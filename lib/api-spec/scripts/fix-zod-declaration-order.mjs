import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const target = path.resolve(here, "../../api-zod/src/generated/api.ts");
let source = fs.readFileSync(target, "utf8");

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