import { dirname, resolve } from 'path';

import { sync as nodeResolveSync } from 'resolve';

import { EXPORTS_SUFFIX, HELPERS_ID, MODULE_SUFFIX, wrapId } from './helpers';
import { normalizePathSlashes } from './utils';

export function isRequireStatement(node, scope) {
  if (!node) return false;
  if (node.type !== 'CallExpression') return false;

  // Weird case of `require()` or `module.require()` without arguments
  if (node.arguments.length === 0) return false;

  return isRequire(node.callee, scope);
}

function isRequire(node, scope) {
  return (
    (node.type === 'Identifier' && node.name === 'require' && !scope.contains('require')) ||
    (node.type === 'MemberExpression' && isModuleRequire(node, scope))
  );
}

export function isModuleRequire({ object, property }, scope) {
  return (
    object.type === 'Identifier' &&
    object.name === 'module' &&
    property.type === 'Identifier' &&
    property.name === 'require' &&
    !scope.contains('module')
  );
}

export function isStaticRequireStatement(node, scope) {
  if (!isRequireStatement(node, scope)) return false;
  return !hasDynamicArguments(node);
}

function hasDynamicArguments(node) {
  return (
    node.arguments.length > 1 ||
    (node.arguments[0].type !== 'Literal' &&
      (node.arguments[0].type !== 'TemplateLiteral' || node.arguments[0].expressions.length > 0))
  );
}

const reservedMethod = { resolve: true, cache: true, main: true };

export function isNodeRequirePropertyAccess(parent) {
  return parent && parent.property && reservedMethod[parent.property.name];
}

export function isIgnoredRequireStatement(requiredNode, ignoreRequire) {
  return ignoreRequire(requiredNode.arguments[0].value);
}

export function getRequireStringArg(node) {
  return node.arguments[0].type === 'Literal'
    ? node.arguments[0].value
    : node.arguments[0].quasis[0].value.cooked;
}

export function hasDynamicModuleForPath(source, id, dynamicRequireModuleSet) {
  if (!/^(?:\.{0,2}[/\\]|[A-Za-z]:[/\\])/.test(source)) {
    try {
      const resolvedPath = normalizePathSlashes(nodeResolveSync(source, { basedir: dirname(id) }));
      if (dynamicRequireModuleSet.has(resolvedPath)) {
        return true;
      }
    } catch (ex) {
      // Probably a node.js internal module
      return false;
    }

    return false;
  }

  for (const attemptExt of ['', '.js', '.json']) {
    const resolvedPath = normalizePathSlashes(resolve(dirname(id), source + attemptExt));
    if (dynamicRequireModuleSet.has(resolvedPath)) {
      return true;
    }
  }

  return false;
}

export function getRequireHandlers() {
  const requireExpressions = [];

  function addRequireStatement(sourceId, node, scope, usesReturnValue, toBeRemoved) {
    requireExpressions.push({ sourceId, node, scope, usesReturnValue, toBeRemoved });
  }

  function rewriteRequireExpressionsAndGetImportBlock(
    magicString,
    topLevelDeclarations,
    topLevelRequireDeclarators,
    reassignedNames,
    helpersName,
    dynamicRegisterSources,
    moduleName,
    exportsName,
    id,
    exportMode,
    resolveRequireSourcesAndGetMeta
  ) {
    const imports = [];
    imports.push(`import * as ${helpersName} from "${HELPERS_ID}";`);
    if (exportMode === 'module') {
      imports.push(
        `import { __module as ${moduleName}, exports as ${exportsName} } from ${JSON.stringify(
          wrapId(id, MODULE_SUFFIX)
        )}`
      );
    } else if (exportMode === 'exports') {
      imports.push(
        `import { __exports as ${exportsName} } from ${JSON.stringify(wrapId(id, EXPORTS_SUFFIX))}`
      );
    }
    for (const source of dynamicRegisterSources) {
      imports.push(`import ${JSON.stringify(source)};`);
    }
    const requiresBySource = collectSources(requireExpressions);
    return resolveRequireSourcesAndGetMeta(Object.keys(requiresBySource))
      .then((result) => {
        let uid = 0;
        for (const { source, id: resolveId } of result) {
          const requires = requiresBySource[source];
          let usesRequired = false;
          let name;
          const hasNameConflict = ({ scope }) => scope.contains(name);
          do {
            name = `require$$${uid}`;
            uid += 1;
          } while (requires.some(hasNameConflict));

          for (const { node, usesReturnValue, toBeRemoved } of requires) {
            if (usesReturnValue) {
              usesRequired = true;
              magicString.overwrite(node.start, node.end, name);
            } else {
              magicString.remove(toBeRemoved.start, toBeRemoved.end);
            }
          }
          imports.push(
            `import ${usesRequired ? `${name} from ` : ''}${JSON.stringify(resolveId)};`
          );
        }
      })
      .then(() => (imports.length ? `${imports.join('\n')}\n\n` : ''));
  }

  return {
    addRequireStatement,
    rewriteRequireExpressionsAndGetImportBlock
  };
}

function collectSources(requireExpressions) {
  const requiresBySource = Object.create(null);
  for (const { sourceId, node, scope, usesReturnValue, toBeRemoved } of requireExpressions) {
    if (!requiresBySource[sourceId]) {
      requiresBySource[sourceId] = [];
    }
    const requires = requiresBySource[sourceId];
    requires.push({ node, scope, usesReturnValue, toBeRemoved });
  }
  return requiresBySource;
}
