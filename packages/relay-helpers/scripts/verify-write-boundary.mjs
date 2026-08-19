import { readdir } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

const REQUEST_FIELDS = ['provider', 'resource', 'parameters', 'path', 'body'];

async function collectProductionSources(directory) {
  const sources = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      sources.push(...await collectProductionSources(entryPath));
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      sources.push(entryPath);
    }
  }
  return sources.sort();
}

function sourceLocation(sourceFile, node) {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return { file: sourceFile.fileName, line: line + 1, column: character + 1 };
}

function resolvedSymbol(checker, node) {
  let symbol = checker.getSymbolAtLocation(node);
  const seen = new Set();
  while (symbol && (symbol.flags & ts.SymbolFlags.Alias) !== 0 && !seen.has(symbol)) {
    seen.add(symbol);
    symbol = checker.getAliasedSymbol(symbol);
  }
  return symbol;
}

function isWriteJsonFileCall(checker, expression) {
  if (ts.isIdentifier(expression)) {
    const symbol = resolvedSymbol(checker, expression);
    return expression.text === 'writeJsonFile' || symbol?.getName() === 'writeJsonFile';
  }
  if (ts.isPropertyAccessExpression(expression)) {
    const symbol = resolvedSymbol(checker, expression.name);
    return expression.name.text === 'writeJsonFile' || symbol?.getName() === 'writeJsonFile';
  }
  if (ts.isElementAccessExpression(expression)
      && ts.isStringLiteralLike(expression.argumentExpression)) {
    return expression.argumentExpression.text === 'writeJsonFile';
  }
  return false;
}

function isRelayTransportWriteCall(checker, call) {
  const signature = checker.getResolvedSignature(call);
  if (!signature || signature.parameters.length !== 1) return false;
  const parameter = signature.parameters[0];
  const parameterType = checker.getTypeOfSymbolAtLocation(parameter, call);
  return REQUEST_FIELDS.every((field) => checker.getPropertyOfType(parameterType, field));
}

function importsWriteJsonFile(node) {
  if (!ts.isImportDeclaration(node)
      || !ts.isStringLiteral(node.moduleSpecifier)
      || node.moduleSpecifier.text !== '@relayfile/adapter-core/vfs-client') return false;
  const bindings = node.importClause?.namedBindings;
  if (!bindings) return false;
  if (ts.isNamespaceImport(bindings)) return true;
  return bindings.elements.some((element) =>
    (element.propertyName ?? element.name).text === 'writeJsonFile');
}

export async function findWriteBoundaryViolations({ sourceRoot, allowedFile = 'write-authorizer.ts' }) {
  const rootNames = await collectProductionSources(sourceRoot);
  const allowedPath = path.resolve(sourceRoot, allowedFile);
  const program = ts.createProgram(rootNames, {
    allowJs: false,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    noEmit: true,
    skipLibCheck: true,
    strict: false,
    target: ts.ScriptTarget.ES2022,
  });
  const checker = program.getTypeChecker();
  const violations = [];

  for (const sourceFile of program.getSourceFiles()) {
    if (!rootNames.includes(sourceFile.fileName) || sourceFile.fileName === allowedPath) continue;
    const visit = (node) => {
      if (importsWriteJsonFile(node)) {
        violations.push({
          kind: 'native-vfs-write-import',
          ...sourceLocation(sourceFile, node),
        });
      }
      if (ts.isCallExpression(node)) {
        if (isWriteJsonFileCall(checker, node.expression)) {
          violations.push({
            kind: 'native-vfs-write-call',
            ...sourceLocation(sourceFile, node),
          });
        } else if (isRelayTransportWriteCall(checker, node)) {
          violations.push({
            kind: 'raw-transport-write',
            ...sourceLocation(sourceFile, node),
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return violations;
}

export function formatWriteBoundaryViolations(violations) {
  return violations
    .map(({ kind, file, line, column }) => `${file}:${line}:${column}: ${kind}`)
    .join('\n');
}
