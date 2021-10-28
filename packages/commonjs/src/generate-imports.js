import { dirname, resolve } from 'path';

import { sync as nodeResolveSync } from 'resolve';

import { EXPORTS_SUFFIX, HELPERS_ID, MODULE_SUFFIX, PROXY_SUFFIX, wrapId } from './helpers';
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
  const requiredBySource = Object.create(null);
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
    exportMode
  ) {
    setImportNamesAndRewriteRequires(magicString);
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
    for (const source of Object.keys(requiredBySource)) {
      const { name, nodesUsingRequired } = requiredBySource[source];
      imports.push(
        `import ${nodesUsingRequired.length ? `${name} from ` : ''}${JSON.stringify(
          source.startsWith('\0') ? source : wrapId(source, PROXY_SUFFIX)
        )};`
      );
    }
    return imports.length ? `${imports.join('\n')}\n\n` : '';
  }

  function setImportNamesAndRewriteRequires(magicString) {
    let uid = 0;
    const nodeToScope = new Map();
    for (const { sourceId, node, scope, usesReturnValue, toBeRemoved } of requireExpressions) {
      // TODO Lukas this should only happen for non-function requires
      const required = getRequired(sourceId);
      nodeToScope.set(node, scope);
      if (usesReturnValue) {
        required.nodesUsingRequired.push(node);
        if (!required.name) {
          let potentialName;
          const isUsedName = (requireExpression) =>
            nodeToScope.get(requireExpression).contains(potentialName);
          do {
            potentialName = `require$$${uid}`;
            uid += 1;
          } while (required.nodesUsingRequired.some(isUsedName));
          required.name = potentialName;
        }
        magicString.overwrite(node.start, node.end, required.name);
      } else {
        magicString.remove(toBeRemoved.start, toBeRemoved.end);
      }
    }
  }

  function getRequired(sourceId) {
    if (!requiredBySource[sourceId]) {
      requiredBySource[sourceId] = {
        source: sourceId,
        name: null,
        nodesUsingRequired: []
      };
    }

    return requiredBySource[sourceId];
  }

  return {
    addRequireStatement,
    rewriteRequireExpressionsAndGetImportBlock
  };
}
