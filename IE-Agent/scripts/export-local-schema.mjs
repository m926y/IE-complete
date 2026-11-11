import ts from 'typescript';
import { readFile, writeFile } from 'node:fs/promises';
import vm from 'node:vm';
const source = await readFile(new URL('../server.mjs', import.meta.url), 'utf8');
const ast = ts.createSourceFile('server.mjs', source, ts.ScriptTarget.Latest, true);
const statements = [];
for (const node of ast.statements) {
  if (!ts.isVariableStatement(node)) continue;
  for (const decl of node.declarationList.declarations) {
    if (['USER_PUBLIC_COLS', 'RESOURCE_DEFS'].includes(decl.name.getText(ast))) statements.push(`const ${decl.getText(ast)};`);
  }
}
const resources = vm.runInNewContext(statements.join('\n') + '\nRESOURCE_DEFS');
await writeFile(new URL('local-resource-schema.json', import.meta.url), JSON.stringify(resources, null, 2));
console.log(`Exported ${Object.keys(resources).length} resource contracts`);
