import { JavaType, TypeSubtype } from '../shared/javaModel';

/**
 * Vorwärtssuche: Welche geladenen Typen beerben/implementieren den Zieltyp
 * direkt? (Antwort auf „welche konkreten Klassen sind für dieses abstrakte
 * Objekt / Interface möglich?".) Vergleich exakt über resolvedId — spiegelt
 * computeHolders, nur in Richtung der Subtypen.
 */
export function computeSubtypes(types: Iterable<JavaType>, targetTypeId: string): TypeSubtype[] {
    const subtypes: TypeSubtype[] = [];
    for (const type of types) {
        if (type.id === targetTypeId) {
            continue;
        }
        const ref = type.superTypes.find((candidate) => candidate.resolvedId === targetTypeId);
        if (ref) {
            subtypes.push({ subtypeId: type.id, relation: ref.relation });
        }
    }
    subtypes.sort((a, b) => a.subtypeId.localeCompare(b.subtypeId));
    return subtypes;
}
