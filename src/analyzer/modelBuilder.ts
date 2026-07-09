import { Node, Tree } from 'web-tree-sitter';
import {
    Creation,
    FieldCall,
    JavaField,
    JavaMethod,
    JavaType,
    SourceRange,
    SuperTypeRef,
    TypeKind,
    TypeRef,
} from '../shared/javaModel';

/** Rohergebnis eines Parse-Laufs; TypeRefs sind hier noch unaufgelöst. */
export interface ParsedFile {
    packageName: string;
    /** explizite Imports als FQN, z. B. "com.example.Player" */
    imports: string[];
    /** Wildcard-Imports ohne ".*", z. B. "com.example" */
    wildcardImports: string[];
    types: JavaType[];
}

const COLLECTION_TYPES = new Set([
    'List', 'ArrayList', 'LinkedList', 'Set', 'HashSet', 'LinkedHashSet', 'TreeSet',
    'Map', 'HashMap', 'LinkedHashMap', 'TreeMap', 'Collection', 'Queue', 'Deque',
    'ArrayDeque', 'PriorityQueue', 'Vector', 'Stack', 'Iterable', 'Optional', 'Stream',
]);

const TYPE_DECLARATION_KINDS = new Set([
    'class_declaration', 'interface_declaration', 'enum_declaration', 'record_declaration',
]);

function rangeOf(node: Node): SourceRange {
    return {
        startLine: node.startPosition.row,
        startCol: node.startPosition.column,
        endLine: node.endPosition.row,
        endCol: node.endPosition.column,
    };
}

/**
 * Liefert den "Kernnamen" eines Typ-Knotens: Generics und Array-Klammern werden
 * entfernt, qualifizierte Namen bleiben qualifiziert.
 */
function typeNameOf(typeNode: Node | null): string | undefined {
    if (!typeNode) {
        return undefined;
    }
    switch (typeNode.type) {
        case 'type_identifier':
        case 'scoped_type_identifier':
            return typeNode.text;
        case 'generic_type': {
            const base = typeNode.namedChildren.find(
                (child) => child !== null && (child.type === 'type_identifier' || child.type === 'scoped_type_identifier'),
            );
            return base?.text;
        }
        case 'array_type':
            return typeNameOf(typeNode.childForFieldName('element'));
        default:
            return undefined;
    }
}

/** tree-sitter-Knotentypen primitiver Java-Typen (void kann kein Feldtyp sein). */
const PRIMITIVE_TYPE_NODES = new Set(['integral_type', 'floating_point_type', 'boolean_type']);

function primitiveNameOf(typeNode: Node | null): string | undefined {
    if (!typeNode) {
        return undefined;
    }
    if (typeNode.type === 'array_type') {
        return primitiveNameOf(typeNode.childForFieldName('element'));
    }
    return PRIMITIVE_TYPE_NODES.has(typeNode.type) ? typeNode.text : undefined;
}

/** Name/Collection/Primitiv-Info eines Feldtyps; undefined bei nicht darstellbaren Typen. */
function fieldTypeInfo(typeNode: Node): { name: string; isCollection: boolean; isPrimitive: boolean } | undefined {
    const { isCollection, elementTypeName } = collectionInfo(typeNode);
    const referencedName = elementTypeName ?? typeNameOf(typeNode);
    if (referencedName) {
        return { name: referencedName, isCollection, isPrimitive: false };
    }
    const primitiveName = primitiveNameOf(typeNode);
    return primitiveName ? { name: primitiveName, isCollection, isPrimitive: true } : undefined;
}

/** Bei Collections interessiert das Element (bei Map der Value-Typ). */
function collectionInfo(typeNode: Node): { isCollection: boolean; elementTypeName?: string } {
    if (typeNode.type === 'array_type') {
        return { isCollection: true, elementTypeName: typeNameOf(typeNode.childForFieldName('element')) };
    }
    if (typeNode.type === 'generic_type') {
        const baseName = typeNameOf(typeNode);
        if (baseName && COLLECTION_TYPES.has(baseName.split('.').pop() ?? baseName)) {
            const args = typeNode.namedChildren.find((child) => child?.type === 'type_arguments');
            const argTypes = (args?.namedChildren ?? []).filter(
                (child): child is Node => child !== null && child.type !== 'wildcard',
            );
            const last = argTypes[argTypes.length - 1];
            return { isCollection: true, elementTypeName: last ? typeNameOf(last) : undefined };
        }
    }
    return { isCollection: false };
}

function hasModifier(declaration: Node, modifier: string): boolean {
    const modifiers = declaration.namedChildren.find((child) => child?.type === 'modifiers');
    return modifiers?.children.some((child) => child?.type === modifier) ?? false;
}

export class ModelBuilder {
    public build(tree: Tree, filePath: string, displayPath: string): ParsedFile {
        const root = tree.rootNode;
        const packageName = this.readPackage(root);
        const { imports, wildcardImports } = this.readImports(root);
        const types: JavaType[] = [];

        for (const child of root.namedChildren) {
            if (child && TYPE_DECLARATION_KINDS.has(child.type)) {
                const type = this.buildType(child, packageName, filePath, displayPath);
                if (type) {
                    types.push(type);
                }
            }
        }

        return { packageName, imports, wildcardImports, types };
    }

    private readPackage(root: Node): string {
        const packageNode = root.namedChildren.find((child) => child?.type === 'package_declaration');
        const nameNode = packageNode?.namedChildren.find(
            (child) => child !== null && (child.type === 'scoped_identifier' || child.type === 'identifier'),
        );
        return nameNode?.text ?? '';
    }

    private readImports(root: Node): { imports: string[]; wildcardImports: string[] } {
        const imports: string[] = [];
        const wildcardImports: string[] = [];
        for (const child of root.namedChildren) {
            if (child?.type !== 'import_declaration') {
                continue;
            }
            const isWildcard = child.children.some((part) => part?.type === 'asterisk');
            const nameNode = child.namedChildren.find(
                (part) => part !== null && (part.type === 'scoped_identifier' || part.type === 'identifier'),
            );
            if (!nameNode) {
                continue;
            }
            if (isWildcard) {
                wildcardImports.push(nameNode.text);
            } else {
                imports.push(nameNode.text);
            }
        }
        return { imports, wildcardImports };
    }

    private buildType(declaration: Node, packageName: string, filePath: string, displayPath: string): JavaType | undefined {
        const nameNode = declaration.childForFieldName('name');
        if (!nameNode) {
            return undefined;
        }
        const simpleName = nameNode.text;
        const kind = this.kindOf(declaration);
        const superTypes = this.readSuperTypes(declaration);
        const fields: JavaField[] = [];
        const methods: JavaMethod[] = [];

        // record-Komponenten sind semantisch Felder
        if (declaration.type === 'record_declaration') {
            const parameters = declaration.childForFieldName('parameters');
            for (const param of parameters?.namedChildren ?? []) {
                if (param?.type !== 'formal_parameter') {
                    continue;
                }
                const typeNode = param.childForFieldName('type');
                const paramName = param.childForFieldName('name');
                if (!typeNode || !paramName) {
                    continue;
                }
                const info = fieldTypeInfo(typeNode);
                if (info) {
                    fields.push({
                        name: paramName.text,
                        typeRef: { name: info.name },
                        isCollection: info.isCollection,
                        isPrimitive: info.isPrimitive,
                        declRange: rangeOf(param),
                    });
                }
            }
        }

        const body = declaration.childForFieldName('body');
        const memberContainers: Node[] = [];
        if (body) {
            if (declaration.type === 'enum_declaration') {
                const bodyDeclarations = body.namedChildren.find((child) => child?.type === 'enum_body_declarations');
                if (bodyDeclarations) {
                    memberContainers.push(bodyDeclarations);
                }
            } else {
                memberContainers.push(body);
            }
        }

        const fieldNames = new Set<string>();
        for (const container of memberContainers) {
            for (const member of container.namedChildren) {
                if (member?.type !== 'field_declaration') {
                    continue;
                }
                this.readFieldDeclaration(member, fields);
            }
        }
        for (const field of fields) {
            fieldNames.add(field.name);
        }

        for (const container of memberContainers) {
            for (const member of container.namedChildren) {
                if (!member) {
                    continue;
                }
                if (member.type === 'method_declaration' || member.type === 'constructor_declaration') {
                    const method = this.buildMethod(member, simpleName, fieldNames);
                    if (method) {
                        methods.push(method);
                    }
                }
                // verschachtelte Typdeklarationen werden im MVP bewusst übersprungen
            }
        }

        return {
            id: packageName ? `${packageName}.${simpleName}` : simpleName,
            simpleName,
            kind,
            filePath,
            displayPath,
            nameRange: rangeOf(nameNode),
            superTypes,
            fields,
            methods,
        };
    }

    private kindOf(declaration: Node): TypeKind {
        switch (declaration.type) {
            case 'interface_declaration':
                return 'interface';
            case 'enum_declaration':
                return 'enum';
            case 'record_declaration':
                return 'record';
            default:
                return hasModifier(declaration, 'abstract') ? 'abstract' : 'class';
        }
    }

    private readSuperTypes(declaration: Node): SuperTypeRef[] {
        const result: SuperTypeRef[] = [];

        const superclass = declaration.childForFieldName('superclass');
        if (superclass) {
            // superclass = seq('extends', _type)
            const name = typeNameOf(superclass.namedChildren.find((child) => child !== null) ?? null);
            if (name) {
                result.push({ name, relation: 'extends' });
            }
        }

        const interfaces = declaration.childForFieldName('interfaces');
        if (interfaces) {
            for (const listed of this.typeListChildren(interfaces)) {
                result.push({ name: listed, relation: 'implements' });
            }
        }

        // Interfaces: extends_interfaces (ohne Feldname in der Grammatik)
        const extendsInterfaces = declaration.namedChildren.find((child) => child?.type === 'extends_interfaces');
        if (extendsInterfaces) {
            for (const listed of this.typeListChildren(extendsInterfaces)) {
                result.push({ name: listed, relation: 'extends' });
            }
        }

        return result;
    }

    private typeListChildren(node: Node): string[] {
        const typeList = node.namedChildren.find((child) => child?.type === 'type_list') ?? node;
        const names: string[] = [];
        for (const child of typeList.namedChildren) {
            const name = typeNameOf(child);
            if (name) {
                names.push(name);
            }
        }
        return names;
    }

    private readFieldDeclaration(member: Node, fields: JavaField[]): void {
        const typeNode = member.childForFieldName('type');
        if (!typeNode) {
            return;
        }
        const info = fieldTypeInfo(typeNode);
        if (!info) {
            return;
        }
        for (const declarator of member.namedChildren) {
            if (declarator?.type !== 'variable_declarator') {
                continue;
            }
            const nameNode = declarator.childForFieldName('name');
            if (!nameNode) {
                continue;
            }
            fields.push({
                name: nameNode.text,
                typeRef: { name: info.name },
                isCollection: info.isCollection,
                isPrimitive: info.isPrimitive,
                declRange: rangeOf(member),
            });
        }
    }

    private buildMethod(member: Node, className: string, fieldNames: Set<string>): JavaMethod | undefined {
        const nameNode = member.childForFieldName('name');
        if (!nameNode) {
            return undefined;
        }
        const isConstructor = member.type === 'constructor_declaration';
        const parameters = member.childForFieldName('parameters');
        const paramLabels: string[] = [];
        for (const param of parameters?.namedChildren ?? []) {
            if (param?.type !== 'formal_parameter' && param?.type !== 'spread_parameter') {
                continue;
            }
            const typeNode = param.childForFieldName('type') ?? param.namedChildren.find((child) => child !== null) ?? null;
            paramLabels.push(typeNode?.text ?? '?');
        }

        const fieldCalls: FieldCall[] = [];
        const creations: Creation[] = [];
        const bodyNode = member.childForFieldName('body');
        if (bodyNode) {
            this.collectCalls(bodyNode, fieldNames, fieldCalls, creations);
        }

        return {
            name: nameNode.text,
            signatureLabel: `${isConstructor ? className : nameNode.text}(${paramLabels.join(', ')})`,
            isStatic: hasModifier(member, 'static'),
            isConstructor,
            declRange: rangeOf(nameNode),
            fieldCalls,
            creations,
        };
    }

    private collectCalls(body: Node, fieldNames: Set<string>, fieldCalls: FieldCall[], creations: Creation[]): void {
        for (const invocation of body.descendantsOfType('method_invocation')) {
            if (!invocation) {
                continue;
            }
            const object = invocation.childForFieldName('object');
            const methodName = invocation.childForFieldName('name');
            if (!object || !methodName) {
                continue;
            }
            let fieldName: string | undefined;
            if (object.type === 'identifier' && fieldNames.has(object.text)) {
                fieldName = object.text;
            } else if (object.type === 'field_access') {
                const owner = object.childForFieldName('object');
                const fieldNode = object.childForFieldName('field');
                if (owner?.type === 'this' && fieldNode && fieldNames.has(fieldNode.text)) {
                    fieldName = fieldNode.text;
                }
            }
            if (fieldName) {
                fieldCalls.push({
                    fieldName,
                    calledMethodName: methodName.text,
                    callRange: rangeOf(invocation),
                });
            }
        }

        for (const creation of body.descendantsOfType('object_creation_expression')) {
            if (!creation) {
                continue;
            }
            const name = typeNameOf(creation.childForFieldName('type'));
            if (name) {
                creations.push({ typeRef: { name }, callRange: rangeOf(creation) });
            }
        }
    }
}

/** Wendet die Typauflösung nachträglich auf alle TypeRefs eines ParsedFile an. */
export function resolveParsedFile(parsed: ParsedFile, resolve: (name: string) => string | undefined): void {
    const apply = (ref: TypeRef): void => {
        ref.resolvedId = resolve(ref.name);
    };
    for (const type of parsed.types) {
        for (const superType of type.superTypes) {
            apply(superType);
        }
        for (const field of type.fields) {
            apply(field.typeRef);
        }
        for (const method of type.methods) {
            for (const creation of method.creations) {
                apply(creation.typeRef);
            }
        }
    }
}
