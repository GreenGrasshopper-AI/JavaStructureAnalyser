export type RelationshipReason = 'field' | 'parameter' | 'variable' | 'instantiates' | 'calls' | 'imports';

export interface ClassRelationship {
  className: string;
  reasons: RelationshipReason[];
}

export interface JavaDocumentAnalysis {
  filePath: string;
  packageName?: string;
  className: string;
  qualifiedName: string;
  outgoing: ClassRelationship[];
}

export interface GraphNode {
  id: string;
  label: string;
  kind: 'selected' | 'incoming' | 'outgoing' | 'open' | 'pinned';
  shape: 'rounded-rectangle';
  pinned: boolean;
  temporary: boolean;
  filePath?: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  reasons: RelationshipReason[];
  temporary: boolean;
}

export interface StructureGraph {
  selectedClass: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const BUILT_IN_TYPES = new Set([
  'String', 'Object', 'Class', 'Enum', 'Record', 'Void', 'Boolean', 'Byte', 'Short', 'Integer', 'Long', 'Float', 'Double',
  'Character', 'Number', 'Math', 'System', 'Exception', 'RuntimeException', 'Throwable', 'Error', 'List', 'ArrayList',
  'LinkedList', 'Set', 'HashSet', 'Map', 'HashMap', 'Collection', 'Optional', 'Stream', 'Collectors', 'Date', 'LocalDate',
  'LocalDateTime', 'BigDecimal', 'BigInteger'
]);

const JAVA_KEYWORDS = new Set([
  'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class', 'const', 'continue', 'default',
  'do', 'double', 'else', 'enum', 'extends', 'final', 'finally', 'float', 'for', 'goto', 'if', 'implements', 'import',
  'instanceof', 'int', 'interface', 'long', 'native', 'new', 'package', 'private', 'protected', 'public', 'return', 'short',
  'static', 'strictfp', 'super', 'switch', 'synchronized', 'this', 'throw', 'throws', 'transient', 'try', 'void', 'volatile',
  'while', 'var'
]);

export function analyseJavaDocument(filePath: string, source: string): JavaDocumentAnalysis {
  const withoutComments = stripComments(source);
  const packageName = matchFirst(withoutComments, /\bpackage\s+([a-zA-Z_$][\w$]*(?:\.[a-zA-Z_$][\w$]*)*)\s*;/);
  const className = extractPrimaryTypeName(withoutComments, filePath);
  const relationships = new Map<string, Set<RelationshipReason>>();
  const variableTypes = new Map<string, string>();

  collectImports(withoutComments).forEach((imported) => addRelationship(relationships, imported, 'imports', className));
  collectFieldTypes(withoutComments).forEach((typeName) => addRelationship(relationships, typeName, 'field', className));

  for (const { typeName, variableName } of collectParameterTypes(withoutComments)) {
    variableTypes.set(variableName, typeName);
    addRelationship(relationships, typeName, 'parameter', className);
  }

  for (const { typeName, variableName } of collectVariableTypes(withoutComments)) {
    variableTypes.set(variableName, typeName);
    addRelationship(relationships, typeName, 'variable', className);
  }

  collectInstantiations(withoutComments).forEach((typeName) => addRelationship(relationships, typeName, 'instantiates', className));
  collectStaticCalls(withoutComments).forEach((typeName) => addRelationship(relationships, typeName, 'calls', className));
  collectVariableCalls(withoutComments, variableTypes).forEach((typeName) => addRelationship(relationships, typeName, 'calls', className));

  return {
    filePath,
    packageName,
    className,
    qualifiedName: packageName ? `${packageName}.${className}` : className,
    outgoing: Array.from(relationships.entries())
      .map(([relatedClassName, reasons]) => ({ className: relatedClassName, reasons: Array.from(reasons).sort() as RelationshipReason[] }))
      .sort((a, b) => a.className.localeCompare(b.className))
  };
}

export function buildGraphForClass(
  current: JavaDocumentAnalysis,
  allDocuments: JavaDocumentAnalysis[],
  pinnedNodeIds: ReadonlySet<string> = new Set()
): StructureGraph {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();

  const addNode = (node: GraphNode): void => {
    const existing = nodes.get(node.id);
    if (!existing) {
      nodes.set(node.id, node);
      return;
    }

    nodes.set(node.id, {
      ...existing,
      ...node,
      kind: existing.kind === 'selected' ? 'selected' : node.kind,
      pinned: existing.pinned || node.pinned,
      temporary: existing.temporary && node.temporary
    });
  };

  addNode({
    id: current.className,
    label: current.className,
    kind: 'selected',
    shape: 'rounded-rectangle',
    pinned: true,
    temporary: false,
    filePath: current.filePath
  });

  for (const relationship of current.outgoing) {
    const isPinned = pinnedNodeIds.has(relationship.className);
    addNode({
      id: relationship.className,
      label: relationship.className,
      kind: 'outgoing',
      shape: 'rounded-rectangle',
      pinned: isPinned,
      temporary: !isPinned,
      filePath: allDocuments.find((doc) => doc.className === relationship.className)?.filePath
    });
    addEdge(edges, current.className, relationship.className, relationship.reasons, !isPinned);
  }

  for (const document of allDocuments) {
    if (document.className === current.className) {
      continue;
    }

    const incomingReasons = document.outgoing
      .filter((relationship) => relationship.className === current.className)
      .flatMap((relationship) => relationship.reasons);

    if (incomingReasons.length === 0) {
      continue;
    }

    const isPinned = pinnedNodeIds.has(document.className);
    addNode({
      id: document.className,
      label: document.className,
      kind: 'incoming',
      shape: 'rounded-rectangle',
      pinned: isPinned,
      temporary: !isPinned,
      filePath: document.filePath
    });
    addEdge(edges, document.className, current.className, uniqueReasons(incomingReasons), !isPinned);
  }

  for (const pinnedNodeId of pinnedNodeIds) {
    if (!nodes.has(pinnedNodeId)) {
      const document = allDocuments.find((doc) => doc.className === pinnedNodeId);
      addNode({
        id: pinnedNodeId,
        label: pinnedNodeId,
        kind: 'pinned',
        shape: 'rounded-rectangle',
        pinned: true,
        temporary: false,
        filePath: document?.filePath
      });
    }
  }

  return {
    selectedClass: current.className,
    nodes: Array.from(nodes.values()).sort(sortNodes),
    edges: Array.from(edges.values()).sort((a, b) => `${a.from}:${a.to}`.localeCompare(`${b.from}:${b.to}`))
  };
}

export function buildGraphForOpenJavaDocuments(
  current: JavaDocumentAnalysis,
  openDocuments: JavaDocumentAnalysis[],
  pinnedNodeIds: ReadonlySet<string> = new Set()
): StructureGraph {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const documentsByClassName = new Map<string, JavaDocumentAnalysis>();

  documentsByClassName.set(current.className, current);
  for (const document of openDocuments) {
    documentsByClassName.set(document.className, document.className === current.className ? current : document);
  }

  const documents = Array.from(documentsByClassName.values());

  for (const document of documents) {
    const pinned = document.className === current.className || pinnedNodeIds.has(document.className);
    nodes.set(document.className, {
      id: document.className,
      label: document.className,
      kind: determineOpenDocumentKind(current, document, pinned),
      shape: 'rounded-rectangle',
      pinned,
      temporary: false,
      filePath: document.filePath
    });
  }

  for (const pinnedNodeId of pinnedNodeIds) {
    if (!nodes.has(pinnedNodeId)) {
      nodes.set(pinnedNodeId, {
        id: pinnedNodeId,
        label: pinnedNodeId,
        kind: 'pinned',
        shape: 'rounded-rectangle',
        pinned: true,
        temporary: false
      });
    }
  }

  for (const document of documents) {
    for (const relationship of document.outgoing) {
      if (!nodes.has(relationship.className)) {
        continue;
      }
      addEdge(edges, document.className, relationship.className, relationship.reasons, false);
    }
  }

  return {
    selectedClass: current.className,
    nodes: Array.from(nodes.values()).sort(sortNodes),
    edges: Array.from(edges.values()).sort((a, b) => `${a.from}:${a.to}`.localeCompare(`${b.from}:${b.to}`))
  };
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function extractPrimaryTypeName(source: string, filePath: string): string {
  const declared = matchFirst(source, /\b(?:class|interface|enum|record)\s+([A-Z_$][\w$]*)\b/);
  if (declared) {
    return declared;
  }

  const fileName = filePath.split(/[\\/]/).pop() ?? 'UnknownClass.java';
  return fileName.replace(/\.java$/i, '') || 'UnknownClass';
}

function collectImports(source: string): string[] {
  const imports: string[] = [];
  const importRegex = /^\s*import\s+(?:static\s+)?([a-zA-Z_$][\w$]*(?:\.[a-zA-Z_$][\w$]*)+)(?:\.\*)?\s*;/gm;
  for (const match of source.matchAll(importRegex)) {
    const simpleName = match[1].split('.').pop();
    if (simpleName && /^[A-Z]/.test(simpleName)) {
      imports.push(simpleName);
    }
  }
  return imports;
}

function collectFieldTypes(source: string): string[] {
  const types: string[] = [];
  const fieldRegex = /^\s*(?:public|private|protected)?\s*(?:static\s+)?(?:final\s+)?([A-Z_$][\w$]*(?:\s*<[^;=()]+>)?(?:\[\])?)\s+[a-zA-Z_$][\w$]*\s*(?:=|;)/gm;
  for (const match of source.matchAll(fieldRegex)) {
    types.push(...extractTypeNames(match[1]));
  }
  return types;
}

function collectParameterTypes(source: string): Array<{ typeName: string; variableName: string }> {
  const parameters: Array<{ typeName: string; variableName: string }> = [];
  const declarationWithParams = /\b(?:public|private|protected)?\s*(?:static\s+)?(?:final\s+)?(?:[A-Z_$][\w$<>\[\], ?]*|void)?\s*[a-zA-Z_$][\w$]*\s*\(([^)]*)\)/g;

  for (const match of source.matchAll(declarationWithParams)) {
    for (const rawParameter of splitByComma(match[1])) {
      const parameter = rawParameter.replace(/\bfinal\b/g, '').trim();
      const parameterMatch = parameter.match(/^([A-Z_$][\w$]*(?:\s*<[^>]+>)?(?:\[\])?)\s+([a-zA-Z_$][\w$]*)$/);
      if (!parameterMatch) {
        continue;
      }
      for (const typeName of extractTypeNames(parameterMatch[1])) {
        parameters.push({ typeName, variableName: parameterMatch[2] });
      }
    }
  }

  return parameters;
}

function collectVariableTypes(source: string): Array<{ typeName: string; variableName: string }> {
  const variables: Array<{ typeName: string; variableName: string }> = [];
  const variableRegex = /\b(?:final\s+)?([A-Z_$][\w$]*(?:\s*<[^;=()]+>)?(?:\[\])?)\s+([a-zA-Z_$][\w$]*)\s*=/g;

  for (const match of source.matchAll(variableRegex)) {
    for (const typeName of extractTypeNames(match[1])) {
      variables.push({ typeName, variableName: match[2] });
    }
  }

  return variables;
}

function collectInstantiations(source: string): string[] {
  const typeNames: string[] = [];
  const newRegex = /\bnew\s+([A-Z_$][\w$]*)\s*(?:<[^>]*>)?\s*\(/g;
  for (const match of source.matchAll(newRegex)) {
    typeNames.push(match[1]);
  }
  return typeNames;
}

function collectStaticCalls(source: string): string[] {
  const typeNames: string[] = [];
  const staticCallRegex = /\b([A-Z_$][\w$]*)\s*\.\s*[a-zA-Z_$][\w$]*\s*\(/g;
  for (const match of source.matchAll(staticCallRegex)) {
    typeNames.push(match[1]);
  }
  return typeNames;
}

function collectVariableCalls(source: string, variableTypes: ReadonlyMap<string, string>): string[] {
  const typeNames: string[] = [];
  const variableCallRegex = /\b([a-zA-Z_$][\w$]*)\s*\.\s*[a-zA-Z_$][\w$]*\s*\(/g;
  for (const match of source.matchAll(variableCallRegex)) {
    const typeName = variableTypes.get(match[1]);
    if (typeName) {
      typeNames.push(typeName);
    }
  }
  return typeNames;
}

function extractTypeNames(typeExpression: string): string[] {
  return Array.from(typeExpression.matchAll(/\b([A-Z_$][\w$]*)\b/g))
    .map((match) => match[1])
    .filter((name) => !BUILT_IN_TYPES.has(name) && !JAVA_KEYWORDS.has(name));
}

function addRelationship(
  relationships: Map<string, Set<RelationshipReason>>,
  candidate: string,
  reason: RelationshipReason,
  currentClassName: string
): void {
  if (!candidate || candidate === currentClassName || BUILT_IN_TYPES.has(candidate) || JAVA_KEYWORDS.has(candidate)) {
    return;
  }

  const reasons = relationships.get(candidate) ?? new Set<RelationshipReason>();
  reasons.add(reason);
  relationships.set(candidate, reasons);
}

function addEdge(edges: Map<string, GraphEdge>, from: string, to: string, reasons: RelationshipReason[], temporary: boolean): void {
  const edgeId = `${from}->${to}`;
  const existing = edges.get(edgeId);
  if (!existing) {
    edges.set(edgeId, { from, to, reasons: uniqueReasons(reasons), temporary });
    return;
  }

  edges.set(edgeId, {
    ...existing,
    reasons: uniqueReasons([...existing.reasons, ...reasons]),
    temporary: existing.temporary && temporary
  });
}

function uniqueReasons(reasons: RelationshipReason[]): RelationshipReason[] {
  return Array.from(new Set(reasons)).sort() as RelationshipReason[];
}

function determineOpenDocumentKind(
  current: JavaDocumentAnalysis,
  document: JavaDocumentAnalysis,
  pinned: boolean
): GraphNode['kind'] {
  if (document.className === current.className) {
    return 'selected';
  }

  if (document.outgoing.some((relationship) => relationship.className === current.className)) {
    return 'incoming';
  }

  if (current.outgoing.some((relationship) => relationship.className === document.className)) {
    return 'outgoing';
  }

  return pinned ? 'pinned' : 'open';
}

function splitByComma(value: string): string[] {
  return value.split(',').map((part) => part.trim()).filter(Boolean);
}

function matchFirst(source: string, regex: RegExp): string | undefined {
  return source.match(regex)?.[1];
}

function sortNodes(a: GraphNode, b: GraphNode): number {
  const order = { selected: 0, incoming: 1, outgoing: 2, open: 3, pinned: 4 } satisfies Record<GraphNode['kind'], number>;
  return order[a.kind] - order[b.kind] || a.label.localeCompare(b.label);
}
