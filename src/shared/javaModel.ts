/**
 * Sprachunabhängiges Datenmodell des analysierten Java-Codes.
 * Bewusst frei von vscode-Imports, damit es im Webview-Bundle und in
 * Node-Smoke-Tests verwendbar ist.
 */

export type TypeKind = 'class' | 'abstract' | 'interface' | 'enum' | 'record';

/** 0-basierte Positionen, kompatibel zu tree-sitter Points. */
export interface SourceRange {
    startLine: number;
    startCol: number;
    endLine: number;
    endCol: number;
}

/** Referenz auf einen Typ, wie er im Quelltext steht; resolvedId = FQN im Workspace. */
export interface TypeRef {
    name: string;
    resolvedId?: string;
}

export interface SuperTypeRef extends TypeRef {
    relation: 'extends' | 'implements';
}

export interface JavaField {
    name: string;
    typeRef: TypeRef;
    /** Array oder bekannter Collection-Typ (List, Set, Map, …) */
    isCollection: boolean;
    /** Primitiver Wert (int, boolean, …) — wird als Quadrat statt Kreis gezeichnet. */
    isPrimitive: boolean;
    declRange: SourceRange;
}

/** Aufruf einer Methode auf einer Instanzvariable innerhalb eines Methodenrumpfs. */
export interface FieldCall {
    fieldName: string;
    calledMethodName: string;
    callRange: SourceRange;
}

/** new-Ausdruck innerhalb eines Methodenrumpfs. */
export interface Creation {
    typeRef: TypeRef;
    callRange: SourceRange;
}

export interface JavaMethod {
    name: string;
    /** z. B. "move(int, int)" */
    signatureLabel: string;
    isStatic: boolean;
    isConstructor: boolean;
    declRange: SourceRange;
    fieldCalls: FieldCall[];
    creations: Creation[];
}

/** Wie ein Typ einen anderen hält: als Instanzvariable oder per new in einer Methode. */
export interface HolderVia {
    kind: 'field' | 'creation';
    /** Feldname bzw. Name der Methode, in der das new steht. */
    memberName: string;
    /**
     * Gesetzt, wenn das Feld den Zieltyp polymorph über einen seiner Supertypen
     * hält (z. B. Feld `SeitenPanel[] panels` hält ein BackupReportPanel).
     */
    superTypeName?: string;
}

/** Ein Typ, der den Zieltyp hält (Ergebnis der Rückwärtssuche über den Workspace). */
export interface TypeHolder {
    holderTypeId: string;
    /** Mindestens ein Eintrag; Feld-Vias stehen vor Creation-Vias. */
    vias: HolderVia[];
}

/** Ein Typ, der den Zieltyp direkt beerbt/implementiert (konkrete Ausprägung). */
export interface TypeSubtype {
    subtypeId: string;
    relation: 'extends' | 'implements';
}

export interface JavaType {
    /** FQN, z. B. "com.example.Player"; zugleich stabile Element-Identität. */
    id: string;
    simpleName: string;
    kind: TypeKind;
    /** Absoluter Dateipfad (nur extensionseitig relevant). */
    filePath: string;
    /** Workspace-relativer Pfad für Anzeige/Tooltip. */
    displayPath: string;
    nameRange: SourceRange;
    superTypes: SuperTypeRef[];
    fields: JavaField[];
    methods: JavaMethod[];
}
