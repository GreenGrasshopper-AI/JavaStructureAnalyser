import { JavaType, TypeHolder, TypeSubtype } from '../src/shared/javaModel';
import { emptyView, PersistedView } from '../src/shared/messages';

/**
 * Ein Element auf dem Canvas.
 * - base:      Startpunkt (per Drag&Drop abgelegt bzw. materialisiert);
 *              id = FQN des Typs.
 * - expansion: rechts aufgeklapptes Zielobjekt einer Instanzvariable;
 *              id = `${parentElementId}/${fieldName}`.
 * - realized:  konkreter Subtyp, unterhalb eines abstrakten/Interface-Elements
 *              realisiert; id = `${parentElementId}~${subtypeId}`.
 */
export interface CanvasElement {
    id: string;
    typeId: string;
    kind: 'base' | 'expansion' | 'realized';
    x: number;
    y: number;
    parentId?: string;
    fieldName?: string;
}

/**
 * Gehört id zum Teilbaum unter rootId? Kind-IDs entstehen durch Anhängen von
 * `/feldname` (Expansion) bzw. `~subtypFqn` (Realisierung) — beide Zeichen
 * können in Java-Bezeichnern/FQNs nicht vorkommen.
 */
export function isWithinSubtree(id: string, rootId: string): boolean {
    return id === rootId || id.startsWith(`${rootId}/`) || id.startsWith(`${rootId}~`);
}

/** Verschachtelungstiefe einer Element-ID (Anzahl Trennzeichen). */
function depthOf(id: string): number {
    let depth = 0;
    for (const char of id) {
        if (char === '/' || char === '~') {
            depth++;
        }
    }
    return depth;
}

export interface RebuildResult {
    missingTypeIds: string[];
}

const PLACE_GRID_X = 380;
const PLACE_GRID_Y = 320;
const PLACE_ORIGIN = 60;

export class ViewModel {
    public readonly types = new Map<string, JavaType>();
    public readonly elements = new Map<string, CanvasElement>();
    /** Zeichenreihenfolge: Basis-Elemente, jeweils gefolgt von ihren Expansionen (DFS). */
    public elementOrder: string[] = [];

    public pinnedPositions = new Map<string, { x: number; y: number }>();
    /** `${elementId}#${methodName}` */
    public visibleMethodPaths = new Set<string>();
    /** Element-IDs expandierter Zielobjekte. */
    public expansions = new Set<string>();
    /** Element-IDs realisierter Subtypen: `${parentElementId}~${subtypeId}`. */
    public realizedSubtypes = new Set<string>();
    public expansionOffsets = new Map<string, { dx: number; dy: number }>();
    /** Halter je Typ (wer hält diesen Typ als Feld / erzeugt ihn in einer Methode). */
    public readonly holdersByTypeId = new Map<string, TypeHolder[]>();
    /** Direkte Subtypen je Typ (wer beerbt/implementiert diesen Typ). */
    public readonly subtypesByTypeId = new Map<string, TypeSubtype[]>();

    public initialViewport = { x: 0, y: 0, scale: 1 };

    public initFromView(types: JavaType[], view: PersistedView): RebuildResult {
        this.types.clear();
        for (const type of types) {
            this.types.set(type.id, type);
        }
        this.pinnedPositions = new Map(view.pinned.map((pin) => [pin.typeId, { x: pin.x, y: pin.y }]));
        this.visibleMethodPaths = new Set(view.visibleMethodPaths);
        this.expansions = new Set(view.expansions);
        this.realizedSubtypes = new Set(view.realizedSubtypes ?? []);
        this.expansionOffsets = new Map(Object.entries(view.expansionOffsets ?? {}));
        this.initialViewport = view.viewport;
        return this.rebuild();
    }

    public upsertTypes(types: JavaType[]): RebuildResult {
        for (const type of types) {
            this.types.set(type.id, type);
        }
        return this.rebuild();
    }

    public removeTypes(typeIds: string[]): RebuildResult {
        for (const id of typeIds) {
            this.types.delete(id);
        }
        return this.rebuild();
    }

    /** Halter-Antworten der Extension einpflegen (ersetzt je Typ die alte Liste). */
    public mergeHolders(holders: Record<string, TypeHolder[]>): void {
        for (const [typeId, list] of Object.entries(holders)) {
            this.holdersByTypeId.set(typeId, list);
        }
    }

    /** Subtyp-Antworten der Extension einpflegen (ersetzt je Typ die alte Liste). */
    public mergeSubtypes(subtypes: Record<string, TypeSubtype[]>): void {
        for (const [typeId, list] of Object.entries(subtypes)) {
            this.subtypesByTypeId.set(typeId, list);
        }
    }

    /** Per Drag&Drop abgelegte Typen als Startpunkte an der Drop-Position pinnen. */
    public addStartPoints(types: JavaType[], x: number, y: number): RebuildResult {
        let offset = 0;
        for (const type of types) {
            this.types.set(type.id, type);
            const position = { x: x + offset, y: y + offset };
            if (this.pinnedPositions.has(type.id)) {
                // erneuter Drop eines vorhandenen Startpunkts: nur verschieben
                const existing = this.elements.get(type.id);
                if (existing?.kind === 'base') {
                    existing.x = position.x;
                    existing.y = position.y;
                }
            } else {
                // frischer Startpunkt beginnt zugeklappt (kein alter Merkzustand)
                this.clearSubtreeState(type.id);
            }
            this.pinnedPositions.set(type.id, position);
            offset += 48; // mehrere Typen aus einer Datei versetzt stapeln
        }
        return this.rebuild();
    }

    /**
     * Gleicht die Element-Menge mit dem Soll-Zustand ab
     * (Basis = Startpunkte; Expansionen = gespeicherte Pfade, deren Kette intakt ist).
     */
    public rebuild(): RebuildResult {
        const missingTypeIds = new Set<string>();

        // --- Basis-Elemente (Startpunkte) ---
        const baseIds = new Set<string>(this.pinnedPositions.keys());
        for (const [id, element] of [...this.elements]) {
            if (element.kind === 'base' && !baseIds.has(id)) {
                this.elements.delete(id);
            }
        }
        for (const typeId of baseIds) {
            if (!this.types.has(typeId)) {
                missingTypeIds.add(typeId);
                continue;
            }
            if (this.elements.has(typeId)) {
                continue;
            }
            const position = this.pinnedPositions.get(typeId) ?? this.findFreePosition();
            this.elements.set(typeId, {
                id: typeId,
                typeId,
                kind: 'base',
                x: position.x,
                y: position.y,
            });
        }

        // --- Expansionen & Realisierungen (nach Pfadtiefe, damit Eltern zuerst entstehen) ---
        for (const [id, element] of [...this.elements]) {
            if (element.kind !== 'base') {
                this.elements.delete(id);
            }
        }
        const childEntries = [
            ...[...this.expansions].map((id) => ({ id, realized: false })),
            ...[...this.realizedSubtypes].map((id) => ({ id, realized: true })),
        ].sort((a, b) => depthOf(a.id) - depthOf(b.id));
        for (const entry of childEntries) {
            if (entry.realized) {
                this.materializeRealized(entry.id, missingTypeIds);
            } else {
                this.materializeExpansion(entry.id, missingTypeIds);
            }
        }

        // --- Vererbungsketten: fehlende Supertypen anfordern (werden über den Elementen gezeichnet) ---
        for (const element of this.elements.values()) {
            if (element.kind === 'realized') {
                continue; // Verbindung zur übergeordneten Klasse wird direkt gezeichnet, keine Kette
            }
            const visited = new Set<string>([element.typeId]);
            let current = this.types.get(element.typeId);
            while (current) {
                const ref = current.superTypes.find(
                    (candidate) =>
                        candidate.relation === 'extends' &&
                        candidate.resolvedId !== undefined &&
                        !visited.has(candidate.resolvedId),
                );
                if (!ref?.resolvedId) {
                    break;
                }
                visited.add(ref.resolvedId);
                const superType = this.types.get(ref.resolvedId);
                if (!superType) {
                    missingTypeIds.add(ref.resolvedId);
                    break;
                }
                current = superType;
            }
        }

        // --- sichtbare Methodenpfade aufräumen ---
        for (const key of [...this.visibleMethodPaths]) {
            const hashIndex = key.lastIndexOf('#');
            const elementId = key.slice(0, hashIndex);
            const methodName = key.slice(hashIndex + 1);
            const element = this.elements.get(elementId);
            const type = element ? this.types.get(element.typeId) : undefined;
            if (!type || !type.methods.some((method) => method.name === methodName)) {
                this.visibleMethodPaths.delete(key);
            }
        }

        this.recomputeOrder();
        return { missingTypeIds: [...missingTypeIds] };
    }

    /** Erzeugt das Element einer gespeicherten Expansion, sofern ihre Kette intakt ist. */
    private materializeExpansion(expansionId: string, missingTypeIds: Set<string>): void {
        const slashIndex = expansionId.lastIndexOf('/');
        if (slashIndex < 0) {
            this.expansions.delete(expansionId);
            return;
        }
        const parentId = expansionId.slice(0, slashIndex);
        const fieldName = expansionId.slice(slashIndex + 1);
        const parent = this.elements.get(parentId);
        if (!parent) {
            return; // Kette (noch) nicht intakt — Eintrag behalten, evtl. kommt der Typ noch
        }
        const parentType = this.types.get(parent.typeId);
        const field = parentType?.fields.find((candidate) => candidate.name === fieldName);
        const targetTypeId = field?.typeRef.resolvedId;
        if (!targetTypeId) {
            this.expansions.delete(expansionId);
            this.expansionOffsets.delete(expansionId);
            return;
        }
        if (!this.types.has(targetTypeId)) {
            missingTypeIds.add(targetTypeId);
            return;
        }
        this.elements.set(expansionId, {
            id: expansionId,
            typeId: targetTypeId,
            kind: 'expansion',
            x: 0, // wird vom Renderer relativ zum Parent berechnet
            y: 0,
            parentId,
            fieldName,
        });
    }

    /** Erzeugt das Element eines realisierten Subtyps, sofern seine Kette intakt ist. */
    private materializeRealized(realizedId: string, missingTypeIds: Set<string>): void {
        const tildeIndex = realizedId.lastIndexOf('~');
        if (tildeIndex < 0) {
            this.realizedSubtypes.delete(realizedId);
            return;
        }
        const parentId = realizedId.slice(0, tildeIndex);
        const subtypeId = realizedId.slice(tildeIndex + 1);
        const parent = this.elements.get(parentId);
        if (!parent) {
            return; // Kette (noch) nicht intakt — Eintrag behalten, evtl. kommt der Typ noch
        }
        const subtype = this.types.get(subtypeId);
        if (!subtype) {
            missingTypeIds.add(subtypeId);
            return;
        }
        // Nur solange der Typ den Parent-Typ wirklich direkt beerbt/implementiert
        if (!subtype.superTypes.some((ref) => ref.resolvedId === parent.typeId)) {
            this.realizedSubtypes.delete(realizedId);
            this.expansionOffsets.delete(realizedId);
            return;
        }
        this.elements.set(realizedId, {
            id: realizedId,
            typeId: subtypeId,
            kind: 'realized',
            x: 0, // wird vom Renderer relativ zum Parent berechnet
            y: 0,
            parentId,
        });
    }

    private recomputeOrder(): void {
        const order: string[] = [];
        const visit = (elementId: string): void => {
            order.push(elementId);
            const children = [...this.elements.values()]
                .filter((element) => element.parentId === elementId)
                .sort((a, b) => this.fieldOrder(a) - this.fieldOrder(b));
            for (const child of children) {
                visit(child.id);
            }
        };
        for (const element of this.elements.values()) {
            if (element.kind === 'base') {
                visit(element.id);
            }
        }
        this.elementOrder = order;
    }

    private fieldOrder(element: CanvasElement): number {
        const parent = element.parentId ? this.elements.get(element.parentId) : undefined;
        const parentType = parent ? this.types.get(parent.typeId) : undefined;
        const index = parentType?.fields.findIndex((field) => field.name === element.fieldName) ?? -1;
        return index < 0 ? Number.MAX_SAFE_INTEGER : index;
    }

    /** Freie Rasterposition finden, die kein vorhandenes Element überdeckt. */
    private findFreePosition(): { x: number; y: number } {
        for (let row = 0; row < 50; row++) {
            for (let column = 0; column < 6; column++) {
                const x = PLACE_ORIGIN + column * PLACE_GRID_X;
                const y = PLACE_ORIGIN + row * PLACE_GRID_Y;
                const occupied = [...this.elements.values()].some(
                    (element) =>
                        element.kind === 'base' &&
                        Math.abs(element.x - x) < PLACE_GRID_X * 0.8 &&
                        Math.abs(element.y - y) < PLACE_GRID_Y * 0.8,
                );
                if (!occupied) {
                    return { x, y };
                }
            }
        }
        return { x: PLACE_ORIGIN, y: PLACE_ORIGIN };
    }

    // --- Interaktionen ---

    /**
     * Entfernt einen Startpunkt. Sein aufgeklappter Baum bleibt stehen:
     * die direkten Kinder werden an ihrer aktuellen Position zu eigenen
     * Startpunkten (samt ihrer Teilbäume) und zeigen wieder Halter an.
     */
    public removeStartPoint(elementId: string): RebuildResult {
        if (!this.pinnedPositions.delete(elementId)) {
            return { missingTypeIds: [] };
        }
        this.promoteChildrenToStartPoints(elementId);
        this.clearSubtreeState(elementId);
        return this.rebuild();
    }

    /**
     * Macht die direkten Kinder (Expansionen und Realisierungen) eines entfernten
     * Elements an ihrer aktuellen Position zu eigenen Startpunkten — samt Teilbäumen.
     */
    private promoteChildrenToStartPoints(elementId: string): void {
        const children = [...this.elements.values()].filter(
            (element) => element.kind !== 'base' && element.parentId === elementId,
        );
        for (const child of children) {
            if (child.kind === 'expansion') {
                this.expansions.delete(child.id);
            } else {
                this.realizedSubtypes.delete(child.id);
            }
            this.expansionOffsets.delete(child.id);
            this.rekeySubtree(child.id, child.typeId);
            if (!this.pinnedPositions.has(child.typeId)) {
                this.pinnedPositions.set(child.typeId, { x: child.x, y: child.y });
            }
        }
    }

    /**
     * Realisiert einen konkreten Subtyp unter einem abstrakten/Interface-Element
     * (Doppelklick auf einen Subtyp-Geist). Die übergeordnete Klasse bleibt mit
     * ihrem Parent verbunden; mehrere Realisierungen teilen sich dasselbe Element.
     */
    public realizeSubtype(parentElementId: string, subtypeId: string): RebuildResult {
        const parent = this.elements.get(parentElementId);
        const realizedId = `${parentElementId}~${subtypeId}`;
        if (!parent || parent.typeId === subtypeId || this.realizedSubtypes.has(realizedId)) {
            return { missingTypeIds: [] };
        }
        this.realizedSubtypes.add(realizedId);
        return this.rebuild();
    }

    /**
     * Entfernt eine Realisierung (Doppelklick auf das realisierte Element).
     * Wie beim Startpunkt-Entfernen bleibt der aufgeklappte Teilbaum erhalten:
     * die direkten Kinder werden eigene Startpunkte.
     */
    public removeRealizedSubtype(elementId: string): RebuildResult {
        const element = this.elements.get(elementId);
        if (element?.kind !== 'realized' || !this.realizedSubtypes.delete(elementId)) {
            return { missingTypeIds: [] };
        }
        this.expansionOffsets.delete(elementId);
        this.promoteChildrenToStartPoints(elementId);
        this.clearSubtreeState(elementId);
        return this.rebuild();
    }

    /** Schlüsselt alle Zustands-Einträge eines Teilbaums auf eine neue Wurzel-ID um. */
    private rekeySubtree(oldRootId: string, newRootId: string): void {
        const map = (id: string): string =>
            isWithinSubtree(id, oldRootId) ? `${newRootId}${id.slice(oldRootId.length)}` : id;
        this.expansions = new Set([...this.expansions].map(map));
        this.realizedSubtypes = new Set([...this.realizedSubtypes].map(map));
        this.expansionOffsets = new Map([...this.expansionOffsets].map(([id, offset]) => [map(id), offset]));
        this.visibleMethodPaths = new Set(
            [...this.visibleMethodPaths].map((key) => {
                const hashIndex = key.lastIndexOf('#');
                return `${map(key.slice(0, hashIndex))}${key.slice(hashIndex)}`;
            }),
        );
    }

    /** Verwirft Expansionen, Realisierungen, Offsets und sichtbare Pfade unterhalb einer Element-ID. */
    private clearSubtreeState(rootId: string): void {
        for (const id of [...this.expansions]) {
            if (id !== rootId && isWithinSubtree(id, rootId)) {
                this.expansions.delete(id);
                this.expansionOffsets.delete(id);
            }
        }
        for (const id of [...this.realizedSubtypes]) {
            if (id !== rootId && isWithinSubtree(id, rootId)) {
                this.realizedSubtypes.delete(id);
                this.expansionOffsets.delete(id);
            }
        }
        for (const key of [...this.visibleMethodPaths]) {
            if (key.startsWith(`${rootId}#`) || key.startsWith(`${rootId}/`) || key.startsWith(`${rootId}~`)) {
                this.visibleMethodPaths.delete(key);
            }
        }
    }

    /**
     * Wie ein elternloser Startpunkt an ein Feld andocken würde:
     * - Feldtyp = Kindtyp → als Feld-Expansion (bisheriges Verhalten)
     * - Feldtyp = direkter Supertyp des Kinds → polymorph: Feld-Expansion
     *   (falls noch nicht offen) plus Realisierung des Kinds darunter
     * undefined, wenn das Andocken nicht darstellbar ist (kein passendes Feld,
     * Zyklus, Platz schon belegt) — Prüfung gegen das AKTUELLE Modell, damit
     * beim Andocken nie etwas verloren geht (z. B. bei doppelten Klassennamen).
     */
    private resolveAttachPlan(
        child: CanvasElement,
        parentElementId: string,
        parentTypeId: string,
        fieldName: string,
    ): { expansionId: string; realizedId?: string } | undefined {
        if (child.kind !== 'base') {
            return undefined;
        }
        // Nicht in den eigenen Teilbaum andocken (Zyklus)
        if (isWithinSubtree(parentElementId, child.id)) {
            return undefined;
        }
        const field = this.types.get(parentTypeId)?.fields.find((candidate) => candidate.name === fieldName);
        const fieldTypeId = field?.typeRef.resolvedId;
        if (!fieldTypeId) {
            return undefined;
        }
        const expansionId = `${parentElementId}/${fieldName}`;
        if (fieldTypeId === child.typeId) {
            // Feld ist dort schon aufgeklappt — Startpunkt bleibt eigenständig
            return this.expansions.has(expansionId) ? undefined : { expansionId };
        }
        const childType = this.types.get(child.typeId);
        if (!childType?.superTypes.some((ref) => ref.resolvedId === fieldTypeId)) {
            return undefined;
        }
        const realizedId = `${expansionId}~${child.typeId}`;
        return this.realizedSubtypes.has(realizedId) ? undefined : { expansionId, realizedId };
    }

    /** Für die Andock-Linien: würde dieses Andocken gelingen? */
    public canAttach(childElementId: string, parentElementId: string, fieldName: string): boolean {
        const child = this.elements.get(childElementId);
        const parent = this.elements.get(parentElementId);
        return (
            child !== undefined &&
            parent !== undefined &&
            this.resolveAttachPlan(child, parentElementId, parent.typeId, fieldName) !== undefined
        );
    }

    /**
     * Hängt einen elternlosen Startpunkt unter ein Ziel-Feld an (exakt als
     * Expansion oder polymorph als Realisierung unter der Feld-Expansion).
     * Gibt false zurück, ohne etwas zu verändern, wenn das Andocken nicht
     * darstellbar ist — so geht das Kind nie verloren.
     */
    private attachChildInto(child: CanvasElement, parentElementId: string, parentTypeId: string, fieldName: string): boolean {
        const plan = this.resolveAttachPlan(child, parentElementId, parentTypeId, fieldName);
        if (!plan) {
            return false;
        }
        this.pinnedPositions.delete(child.id);
        if (plan.realizedId) {
            this.expansions.add(plan.expansionId); // ggf. bereits offen — dann dort andocken
            this.rekeySubtree(child.id, plan.realizedId);
            this.realizedSubtypes.add(plan.realizedId);
        } else {
            this.rekeySubtree(child.id, plan.expansionId);
            this.expansions.add(plan.expansionId);
        }
        return true;
    }

    /**
     * Doppelklick auf ein Geist-Element. Ist der Halter noch nicht sichtbar, wird
     * er als neuer Startpunkt materialisiert; ist er genau einmal sichtbar (z. B.
     * als Expansion in einem anderen Baum), wird dort angedockt statt ihn zu
     * duplizieren. Bei mehreren sichtbaren Instanzen bleibt es beim Nutzer, gezielt
     * über eine Andock-Linie zu verknüpfen. In allen Fällen werden elternlose
     * Startpunkte, die der Halter über ein Feld hält, mitsamt Teilbaum angehängt.
     */
    public rerootToHolder(holderTypeId: string, ghostX: number, ghostY: number): RebuildResult {
        const visible = [...this.elements.values()].filter((element) => element.typeId === holderTypeId);
        if (visible.length > 1) {
            return { missingTypeIds: [] }; // mehrdeutig → nur über eine Andock-Linie
        }
        const parentElementId = visible[0]?.id ?? holderTypeId; // neuer Startpunkt hat id = holderTypeId
        if (!visible[0]) {
            this.pinnedPositions.set(holderTypeId, { x: ghostX, y: ghostY });
            // Alten Merkzustand des Halters verwerfen: nach dem Andocken sollen
            // nur die tatsächlich angehängten Pfade aufgeklappt sein
            this.clearSubtreeState(holderTypeId);
        }
        for (const root of [...this.elements.values()]) {
            if (root.kind !== 'base' || root.typeId === holderTypeId) {
                continue;
            }
            const holder = this.holdersByTypeId
                .get(root.typeId)
                ?.find((candidate) => candidate.holderTypeId === holderTypeId);
            // exakte Feld-Vias stehen vor polymorphen → erstes machbares Andocken gewinnt
            for (const via of holder?.vias ?? []) {
                if (via.kind === 'field' && this.attachChildInto(root, parentElementId, holderTypeId, via.memberName)) {
                    break;
                }
            }
        }
        return this.rebuild();
    }

    /**
     * Hängt einen elternlosen Startpunkt (child) unter ein bereits sichtbares
     * Objekt (parent), das ihn über ein Feld hält — ausgelöst per Doppelklick auf
     * die Andock-Linie. Bewusst nicht automatisch: bei mehreren möglichen Eltern
     * entscheidet so der Nutzer, welche Verknüpfung entsteht.
     */
    public attachToParent(childElementId: string, parentElementId: string, fieldName: string): RebuildResult {
        const child = this.elements.get(childElementId);
        const parent = this.elements.get(parentElementId);
        if (child && parent && this.attachChildInto(child, parentElementId, parent.typeId, fieldName)) {
            return this.rebuild();
        }
        return { missingTypeIds: [] };
    }

    /**
     * Hängt einen elternlosen Startpunkt als Realisierung unter ein bereits
     * sichtbares Objekt seines direkten Supertyps — ausgelöst per Doppelklick
     * auf die Andock-Linie am Subtyp-Geist bzw. an der Oberklassen-Box.
     * Der Teilbaum des Startpunkts wandert mit; bei Hindernissen (Zyklus,
     * bereits realisiert, keine direkte Beziehung) passiert nichts.
     */
    public attachAsRealization(childElementId: string, parentElementId: string): RebuildResult {
        const child = this.elements.get(childElementId);
        const parent = this.elements.get(parentElementId);
        if (!child || child.kind !== 'base' || !parent) {
            return { missingTypeIds: [] };
        }
        // Nicht in den eigenen Teilbaum andocken (Zyklus)
        if (isWithinSubtree(parentElementId, child.id)) {
            return { missingTypeIds: [] };
        }
        const childType = this.types.get(child.typeId);
        if (!childType?.superTypes.some((ref) => ref.resolvedId === parent.typeId)) {
            return { missingTypeIds: [] };
        }
        const realizedId = `${parentElementId}~${child.typeId}`;
        if (this.realizedSubtypes.has(realizedId)) {
            return { missingTypeIds: [] };
        }
        this.pinnedPositions.delete(child.id);
        this.rekeySubtree(child.id, realizedId);
        this.realizedSubtypes.add(realizedId);
        return this.rebuild();
    }

    public toggleMethodPaths(elementId: string, methodName: string): void {
        const key = `${elementId}#${methodName}`;
        if (this.visibleMethodPaths.has(key)) {
            this.visibleMethodPaths.delete(key);
        } else {
            this.visibleMethodPaths.add(key);
        }
    }

    public toggleExpansion(parentElementId: string, fieldName: string): RebuildResult {
        const expansionId = `${parentElementId}/${fieldName}`;
        if (this.expansions.has(expansionId)) {
            // rekursiv auch alle Kind-Expansionen/-Realisierungen und Pfade entfernen
            this.expansions.delete(expansionId);
            this.expansionOffsets.delete(expansionId);
            this.clearSubtreeState(expansionId);
        } else {
            this.expansions.add(expansionId);
        }
        return this.rebuild();
    }

    public moveElement(elementId: string, x: number, y: number): void {
        const element = this.elements.get(elementId);
        if (!element) {
            return;
        }
        if (element.kind === 'base') {
            element.x = x;
            element.y = y;
            this.pinnedPositions.set(element.id, { x, y });
        }
    }

    public adjustExpansionOffset(elementId: string, dx: number, dy: number): void {
        this.expansionOffsets.set(elementId, { dx, dy });
    }

    public buildPersistedView(viewport: { x: number; y: number; scale: number }): PersistedView {
        const view = emptyView();
        view.pinned = [...this.pinnedPositions.entries()].map(([typeId, position]) => ({
            typeId,
            x: position.x,
            y: position.y,
        }));
        view.visibleMethodPaths = [...this.visibleMethodPaths];
        view.expansions = [...this.expansions];
        view.expansionOffsets = Object.fromEntries(this.expansionOffsets);
        view.realizedSubtypes = [...this.realizedSubtypes];
        view.viewport = viewport;
        return view;
    }
}
