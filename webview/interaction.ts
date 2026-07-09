import { Camera } from './canvas/camera';
import { GhostPlacement, LinkPlacement, Renderer, SubtypeGhostPlacement } from './canvas/renderer';
import { ViewModel } from './viewModel';

const CLICK_VS_DBLCLICK_MS = 220;
const DRAG_CLICK_THRESHOLD_PX = 5;

export interface HitResult {
    elementId: string;
    part: 'element' | 'method' | 'field' | 'holder' | 'super' | 'link' | 'subtype';
    memberName?: string;
    /** Gesetzt bei part === 'holder'. */
    ghost?: GhostPlacement;
    /** Gesetzt bei part === 'super'. */
    superTypeId?: string;
    /** Gesetzt bei part === 'link'. */
    link?: LinkPlacement;
    /** Gesetzt bei part === 'subtype'. */
    subtypeGhost?: SubtypeGhostPlacement;
}

const LINK_HIT_TOLERANCE_PX = 7;

/** Abstand eines Punkts zu einer Strecke (für das Treffen dünner Andock-Linien). */
function distanceToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared === 0) {
        return Math.hypot(px - x1, py - y1);
    }
    let t = ((px - x1) * dx + (py - y1) * dy) / lengthSquared;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

export interface InteractionCallbacks {
    openFile(typeId: string, member?: { kind: 'method' | 'field'; name: string }): void;
    requestMissingTypes(typeIds: string[]): void;
    persistSoon(): void;
    /** Nach Änderungen an den Startpunkten: Halter für neue Startpunkte anfragen. */
    syncHolders(): void;
    /** Nach Sichtbarkeits-Änderungen: Subtypen für neu sichtbare Typen anfragen. */
    syncSubtypes(): void;
}

/**
 * Maus-Gesten auf dem Canvas:
 * Drag = Element verschieben / Pan · Wheel = Zoom auf Cursor ·
 * Klick = Datei öffnen (Element/Halter) / Pfade togglen (Methode) / expandieren (Kreis) ·
 * Ctrl+Klick = Sprung zu Member · Doppelklick = Startpunkt entfernen (Basis)
 * bzw. Halter zum neuen Startpunkt machen (Geist).
 */
export class Interaction {
    private dragMode: 'none' | 'element' | 'pan' = 'none';
    private dragElementId: string | undefined;
    private dragStartScreen = { x: 0, y: 0 };
    private dragStartWorld = { x: 0, y: 0 };
    private dragStartElement = { x: 0, y: 0 };
    private dragStartOffset = { dx: 0, dy: 0 };
    private dragDistance = 0;
    private dragMoved = false;
    private clickTimeout: number | undefined;

    public constructor(
        private readonly canvas: HTMLCanvasElement,
        private readonly camera: Camera,
        private readonly renderer: Renderer,
        private readonly viewModel: ViewModel,
        private readonly callbacks: InteractionCallbacks,
    ) {
        canvas.addEventListener('mousedown', (event) => this.onMouseDown(event));
        canvas.addEventListener('mousemove', (event) => this.onMouseMove(event));
        canvas.addEventListener('mouseup', () => this.endDrag());
        canvas.addEventListener('mouseleave', () => this.endDrag());
        canvas.addEventListener('click', (event) => this.onClick(event));
        canvas.addEventListener('dblclick', (event) => this.onDoubleClick(event));
        canvas.addEventListener('wheel', (event) => this.onWheel(event), { passive: false });
    }

    private screenPosition(event: MouseEvent): { x: number; y: number } {
        const rect = this.canvas.getBoundingClientRect();
        return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    }

    public hitTest(event: MouseEvent): HitResult | undefined {
        const screen = this.screenPosition(event);
        const world = this.camera.toWorld(screen.x, screen.y);

        for (let index = this.viewModel.elementOrder.length - 1; index >= 0; index--) {
            const elementId = this.viewModel.elementOrder[index];
            const placement = this.renderer.placements.get(elementId);
            if (!placement) {
                continue;
            }
            const { x, y, layout } = placement;

            for (const slot of layout.methodSlots) {
                if (
                    world.x >= x + slot.x &&
                    world.x <= x + slot.x + slot.width &&
                    world.y >= y + slot.y &&
                    world.y <= y + slot.y + slot.height
                ) {
                    return { elementId, part: 'method', memberName: slot.method.name };
                }
            }

            for (const slot of layout.fieldSlots) {
                const dx = world.x - (x + slot.centerX);
                const dy = world.y - (y + slot.centerY);
                const tolerance = slot.field.isCollection ? slot.radius + 9 : slot.radius + 4;
                if (Math.sqrt(dx * dx + dy * dy) <= tolerance) {
                    return { elementId, part: 'field', memberName: slot.field.name };
                }
            }

            if (world.x >= x && world.x <= x + layout.bodyWidth && world.y >= y && world.y <= y + layout.bodyHeight) {
                return { elementId, part: 'element' };
            }
        }

        // Oberklassen-Elemente (über den echten Elementen gestapelt)
        for (let index = this.renderer.superPlacements.length - 1; index >= 0; index--) {
            const superPlacement = this.renderer.superPlacements[index];
            if (
                world.x >= superPlacement.x &&
                world.x <= superPlacement.x + superPlacement.width &&
                world.y >= superPlacement.y &&
                world.y <= superPlacement.y + superPlacement.height
            ) {
                return { elementId: '', part: 'super', superTypeId: superPlacement.typeId };
            }
        }

        // Halter-Geister liegen unter den echten Elementen → zuletzt prüfen
        for (let index = this.renderer.ghostPlacements.length - 1; index >= 0; index--) {
            const ghost = this.renderer.ghostPlacements[index];
            if (
                world.x >= ghost.x &&
                world.x <= ghost.x + ghost.width &&
                world.y >= ghost.y &&
                world.y <= ghost.y + ghost.height
            ) {
                return { elementId: ghost.baseElementId, part: 'holder', ghost };
            }
        }

        // Subtyp-Geister (unter den Elementen)
        for (let index = this.renderer.subtypeGhostPlacements.length - 1; index >= 0; index--) {
            const ghost = this.renderer.subtypeGhostPlacements[index];
            if (
                world.x >= ghost.x &&
                world.x <= ghost.x + ghost.width &&
                world.y >= ghost.y &&
                world.y <= ghost.y + ghost.height
            ) {
                return { elementId: ghost.parentElementId, part: 'subtype', subtypeGhost: ghost };
            }
        }

        // Andock-Linien (dünn) ganz zuletzt, nachdem alle Kästchen ausscheiden
        const tolerance = LINK_HIT_TOLERANCE_PX / this.camera.scale;
        for (const link of this.renderer.linkPlacements) {
            if (distanceToSegment(world.x, world.y, link.x1, link.y1, link.x2, link.y2) <= tolerance) {
                return { elementId: '', part: 'link', link };
            }
        }
        return undefined;
    }

    private onMouseDown(event: MouseEvent): void {
        if (event.button !== 0) {
            return;
        }
        const screen = this.screenPosition(event);
        this.dragStartScreen = screen;
        this.dragStartWorld = this.camera.toWorld(screen.x, screen.y);
        this.dragDistance = 0;
        this.dragMoved = false;

        const hit = this.hitTest(event);
        if (hit && (hit.part === 'element' || hit.part === 'method' || hit.part === 'field')) {
            const element = this.viewModel.elements.get(hit.elementId);
            if (element) {
                this.dragMode = 'element';
                this.dragElementId = hit.elementId;
                this.dragStartElement = { x: element.x, y: element.y };
                this.dragStartOffset = this.viewModel.expansionOffsets.get(hit.elementId) ?? { dx: 0, dy: 0 };
                return;
            }
        }
        this.dragMode = 'pan';
    }

    private onMouseMove(event: MouseEvent): void {
        const screen = this.screenPosition(event);
        if (this.dragMode === 'none') {
            const hit = this.hitTest(event);
            this.canvas.style.cursor = hit
                ? hit.part === 'element'
                    ? 'move'
                    : 'pointer'
                : 'grab';
            return;
        }

        const deltaX = screen.x - this.dragStartScreen.x;
        const deltaY = screen.y - this.dragStartScreen.y;
        this.dragDistance = Math.max(this.dragDistance, Math.sqrt(deltaX * deltaX + deltaY * deltaY));

        if (this.dragMode === 'pan') {
            this.camera.x += event.movementX;
            this.camera.y += event.movementY;
            this.renderer.scheduleDraw();
            return;
        }

        if (this.dragMode === 'element' && this.dragElementId) {
            const element = this.viewModel.elements.get(this.dragElementId);
            if (!element) {
                return;
            }
            const world = this.camera.toWorld(screen.x, screen.y);
            const worldDx = world.x - this.dragStartWorld.x;
            const worldDy = world.y - this.dragStartWorld.y;
            if (element.kind === 'base') {
                this.viewModel.moveElement(
                    element.id,
                    this.dragStartElement.x + worldDx,
                    this.dragStartElement.y + worldDy,
                );
            } else {
                this.viewModel.adjustExpansionOffset(
                    element.id,
                    this.dragStartOffset.dx + worldDx,
                    this.dragStartOffset.dy + worldDy,
                );
            }
            this.dragMoved = this.dragDistance > DRAG_CLICK_THRESHOLD_PX;
            this.renderer.scheduleDraw();
        }
    }

    private endDrag(): void {
        if (this.dragMode === 'none') {
            return;
        }
        const wasPan = this.dragMode === 'pan';
        const moved = this.dragMoved || (wasPan && this.dragDistance > DRAG_CLICK_THRESHOLD_PX);
        this.dragMode = 'none';
        this.dragElementId = undefined;
        if (moved) {
            this.callbacks.persistSoon();
        }
    }

    private onClick(event: MouseEvent): void {
        if (this.dragDistance > DRAG_CLICK_THRESHOLD_PX) {
            return;
        }
        const hit = this.hitTest(event);
        if (!hit) {
            return;
        }

        if (hit.part === 'super' && hit.superTypeId) {
            // Oberklasse hat keine Doppelklick-Aktion → Datei direkt öffnen
            this.callbacks.openFile(hit.superTypeId);
            return;
        }

        if ((hit.part === 'holder' && hit.ghost) || (hit.part === 'subtype' && hit.subtypeGhost)) {
            // Datei des Geists öffnen (verzögert, damit Doppelklick = Andocken/Realisieren gewinnt)
            const ghostTypeId = hit.part === 'holder' ? hit.ghost!.holderTypeId : hit.subtypeGhost!.subtypeId;
            if (this.clickTimeout !== undefined) {
                window.clearTimeout(this.clickTimeout);
            }
            this.clickTimeout = window.setTimeout(() => {
                this.clickTimeout = undefined;
                this.callbacks.openFile(ghostTypeId);
            }, CLICK_VS_DBLCLICK_MS);
            return;
        }

        const element = this.viewModel.elements.get(hit.elementId);
        if (!element) {
            return;
        }
        const withModifier = event.ctrlKey || event.metaKey;

        if (hit.part === 'method' && hit.memberName) {
            if (withModifier) {
                this.callbacks.openFile(element.typeId, { kind: 'method', name: hit.memberName });
            } else {
                this.viewModel.toggleMethodPaths(hit.elementId, hit.memberName);
                this.callbacks.persistSoon();
                this.renderer.scheduleDraw();
            }
            return;
        }

        if (hit.part === 'field' && hit.memberName) {
            if (withModifier) {
                this.callbacks.openFile(element.typeId, { kind: 'field', name: hit.memberName });
                return;
            }
            const type = this.viewModel.types.get(element.typeId);
            const field = type?.fields.find((candidate) => candidate.name === hit.memberName);
            const expansionId = `${hit.elementId}/${hit.memberName}`;
            const alreadyExpanded = this.viewModel.expansions.has(expansionId);
            if (!field?.typeRef.resolvedId && !alreadyExpanded) {
                return; // nicht auflösbar (JDK-/Bibliothekstyp) → nichts zu expandieren
            }
            const result = this.viewModel.toggleExpansion(hit.elementId, hit.memberName);
            this.callbacks.requestMissingTypes(result.missingTypeIds);
            this.callbacks.syncSubtypes();
            this.callbacks.persistSoon();
            this.renderer.scheduleDraw();
            return;
        }

        // Klick auf Element-Fläche: Datei öffnen (verzögert, damit Doppelklick gewinnt)
        if (this.clickTimeout !== undefined) {
            window.clearTimeout(this.clickTimeout);
        }
        this.clickTimeout = window.setTimeout(() => {
            this.clickTimeout = undefined;
            this.callbacks.openFile(element.typeId);
        }, CLICK_VS_DBLCLICK_MS);
    }

    private onDoubleClick(event: MouseEvent): void {
        if (this.clickTimeout !== undefined) {
            window.clearTimeout(this.clickTimeout);
            this.clickTimeout = undefined;
        }
        const hit = this.hitTest(event);
        if (!hit) {
            return;
        }
        if (hit.part === 'link' && hit.link) {
            // Andock-Linie: Startpunkt unter das bereits sichtbare Zielobjekt hängen
            // (als Feld-Expansion bzw. als realisierter Subtyp)
            const result =
                hit.link.kind === 'realize'
                    ? this.viewModel.attachAsRealization(hit.link.childElementId, hit.link.targetElementId)
                    : this.viewModel.attachToParent(
                          hit.link.childElementId,
                          hit.link.targetElementId,
                          hit.link.fieldName ?? '',
                      );
            this.callbacks.requestMissingTypes(result.missingTypeIds);
        } else if (hit.part === 'holder' && hit.ghost) {
            const result = this.viewModel.rerootToHolder(hit.ghost.holderTypeId, hit.ghost.x, hit.ghost.y);
            this.callbacks.requestMissingTypes(result.missingTypeIds);
        } else if (hit.part === 'subtype' && hit.subtypeGhost) {
            // Subtyp-Geist: konkrete Klasse unter der übergeordneten realisieren
            const result = this.viewModel.realizeSubtype(hit.subtypeGhost.parentElementId, hit.subtypeGhost.subtypeId);
            this.callbacks.requestMissingTypes(result.missingTypeIds);
        } else {
            const element = this.viewModel.elements.get(hit.elementId);
            if (!element) {
                return;
            }
            if (element.kind === 'base') {
                const result = this.viewModel.removeStartPoint(element.id);
                this.callbacks.requestMissingTypes(result.missingTypeIds);
            } else if (element.kind === 'realized') {
                const result = this.viewModel.removeRealizedSubtype(element.id);
                this.callbacks.requestMissingTypes(result.missingTypeIds);
            } else {
                return;
            }
        }
        // in allen Fällen kann sich die Sichtbarkeit geändert haben → Halter/Subtypen anfragen
        this.callbacks.syncHolders();
        this.callbacks.syncSubtypes();
        this.callbacks.persistSoon();
        this.renderer.scheduleDraw();
    }

    private onWheel(event: WheelEvent): void {
        event.preventDefault();
        const screen = this.screenPosition(event);
        const factor = event.deltaY > 0 ? 0.9 : 1.1;
        this.camera.zoomAt(screen.x, screen.y, factor);
        this.renderer.scheduleDraw();
        this.callbacks.persistSoon();
    }
}
