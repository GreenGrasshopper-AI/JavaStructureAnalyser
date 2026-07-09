/**
 * Heuristische Auflösung von Typnamen zu FQNs im Workspace.
 * Reihenfolge: expliziter Import > gleiches Package > Wildcard-Import >
 * eindeutiger Simple-Name-Treffer. JDK-/Bibliothekstypen bleiben unaufgelöst.
 */

export interface TypeIndexEntry {
    fqn: string;
    simpleName: string;
    fsPath: string;
}

export interface TypeIndex {
    byFqn(fqn: string): TypeIndexEntry | undefined;
    bySimpleName(simpleName: string): TypeIndexEntry[];
}

export interface ResolveContext {
    packageName: string;
    imports: string[];
    wildcardImports: string[];
}

export function resolveTypeName(name: string, context: ResolveContext, index: TypeIndex): string | undefined {
    if (name.includes('.')) {
        return index.byFqn(name)?.fqn;
    }

    const explicitImport = context.imports.find((imported) => imported.endsWith(`.${name}`));
    if (explicitImport) {
        return index.byFqn(explicitImport)?.fqn;
    }

    const samePackage = context.packageName ? `${context.packageName}.${name}` : name;
    const samePackageEntry = index.byFqn(samePackage);
    if (samePackageEntry) {
        return samePackageEntry.fqn;
    }

    for (const wildcard of context.wildcardImports) {
        const candidate = index.byFqn(`${wildcard}.${name}`);
        if (candidate) {
            return candidate.fqn;
        }
    }

    const candidates = index.bySimpleName(name);
    if (candidates.length === 1) {
        return candidates[0].fqn;
    }
    return undefined;
}
