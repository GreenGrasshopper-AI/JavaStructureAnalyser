import { HolderVia, JavaType, TypeHolder } from '../shared/javaModel';

/**
 * Rückwärtssuche: Welche Typen halten den Zieltyp — als Instanzvariable
 * (exakt oder polymorph über einen aufgelösten Supertyp des Zieltyps) oder
 * per new-Ausdruck in einer Methode? Exakte Feld-Vias stehen vor polymorphen,
 * diese vor Creation-Vias.
 */
export function computeHolders(types: Iterable<JavaType>, targetTypeId: string): TypeHolder[] {
    const allTypes = [...types];
    const typesById = new Map(allTypes.map((type) => [type.id, type]));

    // Transitiv aufgelöste Supertypen des Zieltyps: ein Feld dieser Typen
    // kann den Zieltyp polymorph halten (SeitenPanel-Feld hält ZeitPanel).
    const superTypeNames = new Map<string, string>(); // supertypeId -> Anzeigename
    const queue = [targetTypeId];
    while (queue.length > 0) {
        const current = typesById.get(queue.shift()!);
        for (const ref of current?.superTypes ?? []) {
            if (ref.resolvedId && ref.resolvedId !== targetTypeId && !superTypeNames.has(ref.resolvedId)) {
                superTypeNames.set(ref.resolvedId, typesById.get(ref.resolvedId)?.simpleName ?? ref.name);
                queue.push(ref.resolvedId);
            }
        }
    }

    const holders: TypeHolder[] = [];
    for (const type of allTypes) {
        if (type.id === targetTypeId) {
            continue; // Selbstreferenz (z. B. verkettete Liste) taugt nicht als Startpunkt-Wechsel
        }
        const exactVias: HolderVia[] = [];
        const polymorphVias: HolderVia[] = [];
        for (const field of type.fields) {
            const resolvedId = field.typeRef.resolvedId;
            if (resolvedId === targetTypeId) {
                exactVias.push({ kind: 'field', memberName: field.name });
            } else if (resolvedId && superTypeNames.has(resolvedId)) {
                polymorphVias.push({
                    kind: 'field',
                    memberName: field.name,
                    superTypeName: superTypeNames.get(resolvedId),
                });
            }
        }
        const vias: HolderVia[] = [...exactVias, ...polymorphVias];
        for (const method of type.methods) {
            if (method.creations.some((creation) => creation.typeRef.resolvedId === targetTypeId)) {
                vias.push({ kind: 'creation', memberName: method.name });
            }
        }
        if (vias.length > 0) {
            holders.push({ holderTypeId: type.id, vias });
        }
    }
    // Feld-Halter zuerst (an die lässt sich der Baum anhängen), dann alphabetisch
    holders.sort((a, b) => {
        const aRank = a.vias[0].kind === 'field' ? 0 : 1;
        const bRank = b.vias[0].kind === 'field' ? 0 : 1;
        return aRank - bRank || a.holderTypeId.localeCompare(b.holderTypeId);
    });
    return holders;
}
