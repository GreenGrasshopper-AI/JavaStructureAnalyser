import { HolderVia, JavaType, TypeHolder } from '../../src/shared/javaModel';
import { CanvasElement, isWithinSubtree, ViewModel } from '../viewModel';
import { Camera } from './camera';
import { defaultObjectName, ElementLayout, LAYOUT, layoutElement } from './layout';
import { drawArrow, drawArrowVerticalEnd, drawInstanceCircle, drawValueSquare, roundedRectPath } from './shapes';

const EXPANSION_GAP_X = 110;
const EXPANSION_GAP_Y = 36;
const SUPER_GAP_Y = 46;
const SUPER_ALPHA = 0.7;
const REALIZED_GAP_X = 48;
const REALIZED_GAP_Y = 64;
const SUBTYPE_GHOST_GAP_Y = 28;
const SUBTYPE_GHOST_GAP_X = 14;
const GRID_SPACING = 28;
const GHOST_GAP_X = 90;
const GHOST_GAP_Y = 16;
const GHOST_PADDING = 12;
const GHOST_MIN_WIDTH = 120;
const GHOST_HEIGHT = 64;
const EMPTY_HINT = 'Java-Datei aus dem Explorer hierher ziehen, um einen Startpunkt zu setzen';

export interface Palette {
    isDark: boolean;
    background: string;
    surface: string;
    border: string;
    text: string;
    textDim: string;
    accent: string;
    object: string;
    gray: string;
}

export interface Placement {
    element: CanvasElement;
    x: number;
    y: number;
    layout: ElementLayout;
}

/** Halbtransparentes Halter-Element links eines Startpunkts (fürs Hit-Testing). */
export interface GhostPlacement {
    baseElementId: string;
    holderTypeId: string;
    x: number;
    y: number;
    width: number;
    height: number;
}

/** Automatisch gezeichnete Oberklasse in der Vererbungskette über einem Element. */
export interface SuperPlacement {
    typeId: string;
    x: number;
    y: number;
    width: number;
    height: number;
}

/** Subtyp-Geist unterhalb eines Elements: mögliche konkrete Klasse (fürs Hit-Testing). */
export interface SubtypeGhostPlacement {
    parentElementId: string;
    subtypeId: string;
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * Andock-Vorschlag: ein elternloser Startpunkt (child) könnte unter ein bereits
 * sichtbares Objekt (target) gehängt werden — als Feld-Expansion (kind 'field',
 * Linie am Halter-Geist) oder als realisierter Subtyp (kind 'realize', Linie am
 * Subtyp-Geist bzw. an der Oberklassen-Box). Doppelklick führt das Andocken aus.
 */
export interface LinkPlacement {
    kind: 'field' | 'realize';
    childElementId: string;
    targetElementId: string;
    /** Nur bei kind === 'field'. */
    fieldName?: string;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
}

/** Achsen der Andock-Linie zwischen zwei Rechtecken (Kante → Kante, vertikal geklemmt). */
interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

function linkAnchors(source: Rect, target: Rect): { x1: number; y1: number; x2: number; y2: number } {
    const sourceCenterX = source.x + source.width / 2;
    const sourceCenterY = source.y + source.height / 2;
    const targetCenterX = target.x + target.width / 2;
    const rightward = targetCenterX >= sourceCenterX;
    return {
        x1: rightward ? source.x + source.width : source.x,
        y1: sourceCenterY,
        x2: rightward ? target.x : target.x + target.width,
        y2: Math.min(Math.max(sourceCenterY, target.y + 14), target.y + target.height - 14),
    };
}

function cssVar(name: string, fallback: string): string {
    const value = getComputedStyle(document.body).getPropertyValue(name).trim();
    return value.length > 0 ? value : fallback;
}

/** Dunkelt eine #hex- oder rgb()/rgba()-Farbe um einen Faktor ab (Fallback: unverändert). */
export function darkenColor(color: string, factor: number): string {
    const hexMatch = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
    if (hexMatch) {
        let hex = hexMatch[1];
        if (hex.length === 3) {
            hex = hex.split('').map((char) => char + char).join('');
        }
        const r = Math.round(parseInt(hex.slice(0, 2), 16) * factor);
        const g = Math.round(parseInt(hex.slice(2, 4), 16) * factor);
        const b = Math.round(parseInt(hex.slice(4, 6), 16) * factor);
        return `rgb(${r}, ${g}, ${b})`;
    }
    const rgbMatch = /^(rgba?)\(([^)]+)\)$/i.exec(color.trim());
    if (rgbMatch) {
        const parts = rgbMatch[2].split(',').map((part) => part.trim());
        const scaled = parts.map((part, index) =>
            index < 3 ? String(Math.round(parseFloat(part) * factor)) : part,
        );
        return `${rgbMatch[1]}(${scaled.join(', ')})`;
    }
    return color;
}

/**
 * Beschriftung, wie ein Halter den Typ hält, z. B. "⊚ player · new in spawnEnemy()";
 * polymorphe Feld-Halter zeigen den Supertyp: "⊚ panels als SeitenPanel".
 */
function buildViaLabel(vias: HolderVia[]): string {
    const labels = vias.slice(0, 2).map((via) => {
        if (via.kind !== 'field') {
            return `new in ${via.memberName}()`;
        }
        return via.superTypeName ? `⊚ ${via.memberName} als ${via.superTypeName}` : `⊚ ${via.memberName}`;
    });
    if (vias.length > 2) {
        labels.push(`+${vias.length - 2}`);
    }
    return labels.join(' · ');
}

export function readPalette(): Palette {
    const themeKind = document.body.getAttribute('data-vscode-theme-kind') ?? 'vscode-dark';
    const isDark = themeKind !== 'vscode-light' && themeKind !== 'vscode-high-contrast-light';
    return {
        isDark,
        background: cssVar('--vscode-editor-background', isDark ? '#1e1e1e' : '#ffffff'),
        surface: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
        border: cssVar('--vscode-widget-border', isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.3)'),
        text: cssVar('--vscode-editor-foreground', isDark ? '#cccccc' : '#333333'),
        textDim: cssVar('--vscode-descriptionForeground', isDark ? '#9d9d9d' : '#717171'),
        accent: cssVar('--vscode-charts-blue', '#3794ff'),
        object: cssVar('--vscode-charts-orange', '#e8823a'),
        gray: isDark ? '#8a8a8a' : '#999999',
    };
}

export class Renderer {
    private readonly context: CanvasRenderingContext2D;
    private pixelRatio = 1;
    private viewportWidth = 0;
    private viewportHeight = 0;
    private scheduledFrame: number | null = null;
    private readonly layoutCache = new Map<string, ElementLayout>();
    public palette: Palette = readPalette();
    /** Platzierungen des letzten Frames (Weltkoordinaten) — Basis fürs Hit-Testing. */
    public placements = new Map<string, Placement>();
    /** Halter-Geister des letzten Frames (Weltkoordinaten). */
    public ghostPlacements: GhostPlacement[] = [];
    /** Oberklassen-Elemente des letzten Frames (Weltkoordinaten). */
    public superPlacements: SuperPlacement[] = [];
    /** Andock-Linien des letzten Frames (Weltkoordinaten). */
    public linkPlacements: LinkPlacement[] = [];
    /** Subtyp-Geister des letzten Frames (Weltkoordinaten). */
    public subtypeGhostPlacements: SubtypeGhostPlacement[] = [];

    public constructor(
        private readonly canvas: HTMLCanvasElement,
        private readonly camera: Camera,
        private readonly viewModel: ViewModel,
    ) {
        const context = canvas.getContext('2d');
        if (!context) {
            throw new Error('2D context unavailable');
        }
        this.context = context;
    }

    public refreshPalette(): void {
        this.palette = readPalette();
        this.scheduleDraw();
    }

    public invalidateLayouts(): void {
        this.layoutCache.clear();
    }

    public resize(): void {
        this.pixelRatio = Math.max(window.devicePixelRatio || 1, 1);
        this.viewportWidth = this.canvas.clientWidth;
        this.viewportHeight = this.canvas.clientHeight;
        this.canvas.width = Math.max(1, Math.floor(this.viewportWidth * this.pixelRatio));
        this.canvas.height = Math.max(1, Math.floor(this.viewportHeight * this.pixelRatio));
        this.draw();
    }

    public scheduleDraw(): void {
        if (this.scheduledFrame !== null) {
            return;
        }
        this.scheduledFrame = window.requestAnimationFrame(() => {
            this.scheduledFrame = null;
            this.draw();
        });
    }

    public objectNameFor(element: CanvasElement, type: JavaType): string {
        return element.kind === 'expansion' && element.fieldName
            ? element.fieldName
            : defaultObjectName(type.simpleName);
    }

    private measure = (text: string, font: string): number => {
        this.context.font = font;
        return this.context.measureText(text).width;
    };

    private layoutForType(type: JavaType, objectName: string): ElementLayout {
        const key = `${type.id}|${objectName}`;
        let layout = this.layoutCache.get(key);
        if (!layout) {
            layout = layoutElement(type, objectName, this.measure);
            this.layoutCache.set(key, layout);
        }
        return layout;
    }

    /** Aufsteigende Kette der aufgelösten extends-Supertypen (nur geladene Typen). */
    private superChainOf(typeId: string): JavaType[] {
        const chain: JavaType[] = [];
        const visited = new Set<string>([typeId]);
        let current = this.viewModel.types.get(typeId);
        while (current) {
            const ref = current.superTypes.find(
                (candidate) =>
                    candidate.relation === 'extends' &&
                    candidate.resolvedId !== undefined &&
                    !visited.has(candidate.resolvedId),
            );
            const superType = ref?.resolvedId ? this.viewModel.types.get(ref.resolvedId) : undefined;
            if (!superType) {
                break;
            }
            visited.add(superType.id);
            chain.push(superType);
            current = superType;
        }
        return chain;
    }

    /** Höhe, die die Vererbungskette oberhalb eines Elements einnimmt. */
    private superChainHeight(typeId: string): number {
        let height = 0;
        for (const superType of this.superChainOf(typeId)) {
            const layout = this.layoutForType(superType, defaultObjectName(superType.simpleName));
            height += SUPER_GAP_Y + layout.totalHeight;
        }
        return height;
    }

    /** Berechnet Weltpositionen aller Elemente (Expansionen/Realisierungen relativ zum Parent). */
    private computePlacements(): void {
        this.placements.clear();
        const stackCursor = new Map<string, number>(); // parentId -> nächste freie Y-Position (Expansionen)
        const realizedCursor = new Map<string, number>(); // parentId -> nächste freie X-Position (Realisierungen)

        for (const elementId of this.viewModel.elementOrder) {
            const element = this.viewModel.elements.get(elementId);
            if (!element) {
                continue;
            }
            const type = this.viewModel.types.get(element.typeId);
            if (!type) {
                continue;
            }
            const layout = this.layoutForType(type, this.objectNameFor(element, type));

            let x = element.x;
            let y = element.y;
            if (element.kind === 'expansion' && element.parentId) {
                const parentPlacement = this.placements.get(element.parentId);
                if (!parentPlacement) {
                    continue;
                }
                const offset = this.viewModel.expansionOffsets.get(element.id) ?? { dx: 0, dy: 0 };
                const stackY = stackCursor.get(element.parentId) ?? parentPlacement.y;
                // Platz für die Vererbungskette über dem Element freihalten
                const chainHeight = this.superChainHeight(element.typeId);
                x = parentPlacement.x + parentPlacement.layout.bodyWidth + EXPANSION_GAP_X + offset.dx;
                y = stackY + chainHeight + offset.dy;
                stackCursor.set(element.parentId, stackY + chainHeight + layout.totalHeight + EXPANSION_GAP_Y);
                // Position zurückschreiben (Kinder übernehmen sie als Startpunkt, wenn ihr Parent entfernt wird)
                element.x = x;
                element.y = y;
            } else if (element.kind === 'realized' && element.parentId) {
                // Realisierte Subtypen in einer Reihe unter der übergeordneten Klasse
                const parentPlacement = this.placements.get(element.parentId);
                if (!parentPlacement) {
                    continue;
                }
                const offset = this.viewModel.expansionOffsets.get(element.id) ?? { dx: 0, dy: 0 };
                const rowX = realizedCursor.get(element.parentId) ?? parentPlacement.x;
                x = rowX + offset.dx;
                y = parentPlacement.y + parentPlacement.layout.totalHeight + REALIZED_GAP_Y + offset.dy;
                realizedCursor.set(element.parentId, rowX + layout.bodyWidth + REALIZED_GAP_X);
                element.x = x;
                element.y = y;
            }
            this.placements.set(elementId, { element, x, y, layout });
        }
    }

    public draw(): void {
        const { context, palette } = this;
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.fillStyle = palette.background;
        context.fillRect(0, 0, this.canvas.width, this.canvas.height);
        context.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);

        context.save();
        this.camera.apply(context);

        this.drawGrid();
        this.computePlacements();
        this.drawHolderGhosts();
        this.drawSubtypeGhosts();
        this.drawSuperChains();
        for (const elementId of this.viewModel.elementOrder) {
            const placement = this.placements.get(elementId);
            if (placement) {
                this.drawElement(placement);
            }
        }
        this.drawPathArrows();

        context.restore();

        if (this.viewModel.elements.size === 0) {
            context.save();
            context.fillStyle = palette.textDim;
            context.font = '13px sans-serif';
            context.textAlign = 'center';
            context.fillText(EMPTY_HINT, this.viewportWidth / 2, this.viewportHeight / 2);
            context.restore();
        }
    }

    /** Halbtransparente Halter links jedes Startpunkts (unter den echten Elementen). */
    private drawHolderGhosts(): void {
        this.ghostPlacements = [];
        this.linkPlacements = [];
        const { context, palette } = this;
        for (const placement of this.placements.values()) {
            if (placement.element.kind !== 'base') {
                continue;
            }
            const holders = this.viewModel.holdersByTypeId.get(placement.element.typeId) ?? [];
            let y = placement.y;
            for (const holder of holders) {
                const holderType = this.viewModel.types.get(holder.holderTypeId);
                if (!holderType) {
                    continue;
                }

                const objectName = defaultObjectName(holderType.simpleName);
                const kindPrefix = holderType.kind === 'class' ? '' : `«${holderType.kind}» `;
                const classLabel = `${kindPrefix}${holderType.simpleName}`;
                const viaLabel = buildViaLabel(holder.vias);
                const width = Math.ceil(
                    Math.max(
                        GHOST_MIN_WIDTH,
                        this.measure(objectName, LAYOUT.titleFont),
                        this.measure(classLabel, LAYOUT.classFont),
                        this.measure(viaLabel, LAYOUT.fieldFont),
                    ) + GHOST_PADDING * 2,
                );
                const x = placement.x - GHOST_GAP_X - width;

                // Halter (hält als Feld) vs. Ersteller (nur new): Rahmenfarbe + Strichform
                const isFieldHolder = holder.vias[0].kind === 'field'; // Feld-Vias stehen vorn
                context.save();
                context.globalAlpha = 0.45;
                roundedRectPath(context, x, y, width, GHOST_HEIGHT, 10);
                context.fillStyle = palette.surface;
                context.fill();
                context.strokeStyle = isFieldHolder ? palette.object : palette.accent;
                context.lineWidth = 1.2;
                context.setLineDash(isFieldHolder ? [] : [5, 3]);
                context.stroke();
                context.setLineDash([]);
                context.fillStyle = palette.text;
                context.font = LAYOUT.titleFont;
                context.fillText(objectName, x + GHOST_PADDING, y + 20);
                context.fillStyle = palette.textDim;
                context.font = LAYOUT.classFont;
                context.fillText(classLabel, x + GHOST_PADDING, y + 36);
                context.fillStyle = isFieldHolder ? palette.object : palette.accent;
                context.font = LAYOUT.fieldFont;
                context.fillText(viaLabel, x + GHOST_PADDING, y + 52);
                context.restore();

                // Verbindung Halter → Startpunkt
                drawArrow(context, x + width, y + GHOST_HEIGHT / 2, placement.x - 4, placement.y + 20, {
                    color: palette.gray,
                    lineWidth: 1.1,
                    alpha: 0.35,
                    dashed: true,
                });

                this.ghostPlacements.push({
                    baseElementId: placement.element.id,
                    holderTypeId: holder.holderTypeId,
                    x,
                    y,
                    width,
                    height: GHOST_HEIGHT,
                });
                this.drawAdoptionLinks(placement, holder, x, y, width);
                y += GHOST_HEIGHT + GHOST_GAP_Y;
            }
        }
    }

    /**
     * Zeichnet Andock-Linien von einem Halter-Geist zu bereits sichtbaren Objekten
     * desselben Typs, die den Startpunkt über ein Feld halten. Doppelklick auf eine
     * Linie hängt den Startpunkt dort an (siehe ViewModel.attachToParent) — dadurch
     * bleibt der Nutzer Herr über Mehrdeutigkeiten (mehrere mögliche Eltern) statt
     * dass automatisch verknüpft wird.
     */
    private drawAdoptionLinks(
        child: Placement,
        holder: TypeHolder,
        ghostX: number,
        ghostY: number,
        ghostWidth: number,
    ): void {
        const fieldVias = holder.vias.filter((via) => via.kind === 'field');
        if (fieldVias.length === 0) {
            return; // nur per new erzeugt → kann kein Feld-Kind werden
        }
        const ghostRect: Rect = { x: ghostX, y: ghostY, width: ghostWidth, height: GHOST_HEIGHT };
        for (const target of this.placements.values()) {
            if (target.element.typeId !== holder.holderTypeId) {
                continue;
            }
            // erstes machbares Feld entscheidet (exakte Vias stehen vor polymorphen);
            // canAttach prüft Zyklus, belegten Platz und Feld-Kompatibilität
            const via = fieldVias.find((candidate) =>
                this.viewModel.canAttach(child.element.id, target.element.id, candidate.memberName),
            );
            if (!via) {
                continue;
            }
            this.pushAndockLink(
                {
                    kind: 'field',
                    childElementId: child.element.id,
                    targetElementId: target.element.id,
                    fieldName: via.memberName,
                },
                ghostRect,
                { x: target.x, y: target.y, width: target.layout.bodyWidth, height: target.layout.bodyHeight },
            );
        }
    }

    /** Zeichnet eine Andock-Linie samt «andocken»-Chip und registriert sie fürs Hit-Testing. */
    private pushAndockLink(
        link: Omit<LinkPlacement, 'x1' | 'y1' | 'x2' | 'y2'>,
        source: Rect,
        target: Rect,
    ): void {
        const { context, palette } = this;
        const { x1, y1, x2, y2 } = linkAnchors(source, target);

        context.save();
        context.globalAlpha = 0.8;
        context.strokeStyle = palette.accent;
        context.lineWidth = 1.6;
        context.setLineDash([2, 4]);
        context.beginPath();
        context.moveTo(x1, y1);
        context.lineTo(x2, y2);
        context.stroke();
        context.setLineDash([]);

        // Andock-Hinweis an der Linienmitte
        const midX = (x1 + x2) / 2;
        const midY = (y1 + y2) / 2;
        const label = '⇔ andocken';
        context.font = LAYOUT.chipFont;
        const labelWidth = context.measureText(label).width;
        roundedRectPath(context, midX - labelWidth / 2 - 6, midY - 9, labelWidth + 12, 18, 9);
        context.fillStyle = palette.background;
        context.fill();
        context.strokeStyle = palette.accent;
        context.lineWidth = 1;
        context.stroke();
        context.fillStyle = palette.accent;
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(label, midX, midY + 0.5);
        context.restore();

        this.linkPlacements.push({ ...link, x1, y1, x2, y2 });
    }

    /**
     * Subtyp-Geister: unterhalb jedes Elements, dessen Typ direkte Subtypen hat,
     * werden die möglichen konkreten Klassen halbtransparent angezeigt (Antwort
     * auf „welche Klassen kann dieses Objekt konkret sein?"). Doppelklick
     * realisiert den Subtyp als eigenes Element an dieser Stelle.
     */
    private drawSubtypeGhosts(): void {
        this.subtypeGhostPlacements = [];
        const { context, palette } = this;
        for (const placement of [...this.placements.values()]) {
            const subtypes = this.viewModel.subtypesByTypeId.get(placement.element.typeId) ?? [];
            if (subtypes.length === 0) {
                continue;
            }
            const elementId = placement.element.id;

            // Unter bereits realisierten Subtypen dieses Elements beginnen
            let top = placement.y + placement.layout.totalHeight + SUBTYPE_GHOST_GAP_Y;
            for (const child of this.placements.values()) {
                if (child.element.kind === 'realized' && child.element.parentId === elementId) {
                    top = Math.max(top, child.y + child.layout.totalHeight + SUBTYPE_GHOST_GAP_Y);
                }
            }

            let x = placement.x;
            for (const subtype of subtypes) {
                // bereits realisiert → als echtes Element sichtbar, kein Geist mehr
                if (this.viewModel.realizedSubtypes.has(`${elementId}~${subtype.subtypeId}`)) {
                    continue;
                }
                const subtypeType = this.viewModel.types.get(subtype.subtypeId);
                if (!subtypeType) {
                    continue;
                }

                const objectName = defaultObjectName(subtypeType.simpleName);
                const kindPrefix = subtypeType.kind === 'class' ? '' : `«${subtypeType.kind}» `;
                const classLabel = `${kindPrefix}${subtypeType.simpleName}`;
                const relationLabel = `«${subtype.relation}»`;
                const width = Math.ceil(
                    Math.max(
                        GHOST_MIN_WIDTH,
                        this.measure(objectName, LAYOUT.titleFont),
                        this.measure(classLabel, LAYOUT.classFont),
                        this.measure(relationLabel, LAYOUT.fieldFont),
                    ) + GHOST_PADDING * 2,
                );

                context.save();
                context.globalAlpha = 0.45;
                roundedRectPath(context, x, top, width, GHOST_HEIGHT, 10);
                context.fillStyle = palette.surface;
                context.fill();
                context.strokeStyle = palette.border;
                context.lineWidth = 1.2;
                context.stroke();
                context.fillStyle = palette.text;
                context.font = LAYOUT.titleFont;
                context.fillText(objectName, x + GHOST_PADDING, top + 20);
                context.fillStyle = palette.textDim;
                context.font = LAYOUT.classFont;
                context.fillText(classLabel, x + GHOST_PADDING, top + 36);
                context.fillStyle = palette.accent;
                context.font = LAYOUT.fieldFont;
                context.fillText(relationLabel, x + GHOST_PADDING, top + 52);
                context.restore();

                // Verbindung Geist → übergeordnete Klasse (Pfeil zeigt auf den Supertyp)
                drawArrowVerticalEnd(
                    context,
                    x + width / 2,
                    top,
                    placement.x + placement.layout.bodyWidth / 2,
                    placement.y + placement.layout.totalHeight + 4,
                    { color: palette.gray, lineWidth: 1.1, alpha: 0.35, dashed: true },
                );

                this.subtypeGhostPlacements.push({
                    parentElementId: elementId,
                    subtypeId: subtype.subtypeId,
                    x,
                    y: top,
                    width,
                    height: GHOST_HEIGHT,
                });
                this.drawRealizationLinks(placement, subtype.subtypeId, {
                    x,
                    y: top,
                    width,
                    height: GHOST_HEIGHT,
                });
                x += width + SUBTYPE_GHOST_GAP_X;
            }
        }
    }

    /**
     * Andock-Linien vom Subtyp-Geist zu elternlosen Startpunkten dieses Typs:
     * statt eine frische Kopie zu realisieren, kann das bereits vorhandene
     * Objekt samt Teilbaum per Doppelklick angedockt werden.
     */
    private drawRealizationLinks(parent: Placement, subtypeId: string, ghostRect: Rect): void {
        for (const orphan of this.placements.values()) {
            if (orphan.element.kind !== 'base' || orphan.element.typeId !== subtypeId) {
                continue;
            }
            // Nicht in den eigenen Teilbaum andocken (Zyklus); nicht wenn schon realisiert
            if (isWithinSubtree(parent.element.id, orphan.element.id)) {
                continue;
            }
            if (this.viewModel.realizedSubtypes.has(`${parent.element.id}~${subtypeId}`)) {
                continue;
            }
            this.pushAndockLink(
                { kind: 'realize', childElementId: orphan.element.id, targetElementId: parent.element.id },
                ghostRect,
                { x: orphan.x, y: orphan.y, width: orphan.layout.bodyWidth, height: orphan.layout.bodyHeight },
            );
        }
    }

    private drawGrid(): void {
        if (this.camera.scale < 0.4) {
            return;
        }
        const { context, palette } = this;
        const topLeft = this.camera.toWorld(0, 0);
        const bottomRight = this.camera.toWorld(this.viewportWidth, this.viewportHeight);
        const startX = Math.floor(topLeft.x / GRID_SPACING) * GRID_SPACING;
        const startY = Math.floor(topLeft.y / GRID_SPACING) * GRID_SPACING;
        context.fillStyle = palette.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
        for (let x = startX; x <= bottomRight.x; x += GRID_SPACING) {
            for (let y = startY; y <= bottomRight.y; y += GRID_SPACING) {
                context.fillRect(x - 0.75, y - 0.75, 1.5, 1.5);
            }
        }
    }

    /**
     * Vererbungskette über jedem Element: die selbst geschriebenen (im Workspace
     * auflösbaren) extends-Supertypen werden gestapelt darüber gezeichnet.
     */
    private drawSuperChains(): void {
        this.superPlacements = [];
        const { context, palette } = this;
        for (const placement of [...this.placements.values()]) {
            if (placement.element.kind === 'realized') {
                continue; // die übergeordnete Klasse steht bereits direkt darüber
            }
            let anchorCenterX = placement.x + placement.layout.bodyWidth / 2;
            let anchorTopY = placement.y;
            let isDirectSuper = true;
            for (const superType of this.superChainOf(placement.element.typeId)) {
                const objectName = defaultObjectName(superType.simpleName);
                const layout = this.layoutForType(superType, objectName);
                const x = anchorCenterX - layout.bodyWidth / 2;
                const y = anchorTopY - SUPER_GAP_Y - layout.totalHeight;

                drawArrowVerticalEnd(context, anchorCenterX, anchorTopY, anchorCenterX, y + layout.totalHeight + 4, {
                    color: palette.textDim,
                    lineWidth: 1.2,
                    alpha: 0.55,
                });
                context.save();
                context.globalAlpha = 0.6;
                context.fillStyle = palette.textDim;
                context.font = LAYOUT.chipFont;
                context.fillText('«extends»', anchorCenterX + 8, anchorTopY - SUPER_GAP_Y / 2 + 3);
                context.restore();

                context.save();
                context.globalAlpha = SUPER_ALPHA;
                this.drawObjectBox(superType, objectName, x, y, layout, { lineWidth: 1.1 });
                context.restore();

                this.superPlacements.push({
                    typeId: superType.id,
                    x,
                    y,
                    width: layout.bodyWidth,
                    height: layout.totalHeight,
                });

                // Andock-Linie: die Oberklasse eines elternlosen Startpunkts ist evtl.
                // schon als Objekt sichtbar → dort als Realisierung andocken können
                if (isDirectSuper && placement.element.kind === 'base') {
                    this.drawSuperDockLinks(placement, superType.id, {
                        x,
                        y,
                        width: layout.bodyWidth,
                        height: layout.totalHeight,
                    });
                }
                isDirectSuper = false;
                anchorCenterX = x + layout.bodyWidth / 2;
                anchorTopY = y;
            }
        }
    }

    /**
     * Andock-Linien von der Oberklassen-Box eines elternlosen Startpunkts zu
     * sichtbaren Objekten desselben (direkten) Supertyps — das Gegenstück zur
     * Linie am Subtyp-Geist, entdeckt von der konkreten Klasse aus.
     */
    private drawSuperDockLinks(child: Placement, superTypeId: string, superRect: Rect): void {
        for (const target of this.placements.values()) {
            if (target.element.typeId !== superTypeId) {
                continue;
            }
            if (isWithinSubtree(target.element.id, child.element.id)) {
                continue;
            }
            if (this.viewModel.realizedSubtypes.has(`${target.element.id}~${child.element.typeId}`)) {
                continue;
            }
            this.pushAndockLink(
                { kind: 'realize', childElementId: child.element.id, targetElementId: target.element.id },
                superRect,
                { x: target.x, y: target.y, width: target.layout.bodyWidth, height: target.layout.bodyHeight },
            );
        }
    }

    private drawElement(placement: Placement): void {
        const { element, x, y, layout } = placement;
        const type = this.viewModel.types.get(element.typeId);
        if (!type) {
            return;
        }

        this.drawObjectBox(type, this.objectNameFor(element, type), x, y, layout, {
            lineWidth: element.kind === 'base' ? 1.6 : 1.1,
            stateElementId: element.id,
        });

        // Verbindungslinie Parent-Kreis → Expansion (immer sichtbar, dezent)
        this.drawExpansionConnector(element, x, y);
        // «extends»/«implements»-Pfeil Realisierung → übergeordnete Klasse
        this.drawRealizedConnector(element, x, y, layout);
    }

    /** Pfeil vom realisierten Subtyp hoch zur übergeordneten Klasse (zeigt auf den Supertyp). */
    private drawRealizedConnector(element: CanvasElement, x: number, y: number, layout: ElementLayout): void {
        const { context, palette } = this;
        if (element.kind !== 'realized' || !element.parentId) {
            return;
        }
        const parentPlacement = this.placements.get(element.parentId);
        const type = this.viewModel.types.get(element.typeId);
        if (!parentPlacement || !type) {
            return;
        }
        const relation =
            type.superTypes.find((ref) => ref.resolvedId === parentPlacement.element.typeId)?.relation ?? 'extends';
        const fromX = x + layout.bodyWidth / 2;
        const fromY = y;
        const toX = parentPlacement.x + parentPlacement.layout.bodyWidth / 2;
        const toY = parentPlacement.y + parentPlacement.layout.totalHeight + 4;
        drawArrowVerticalEnd(context, fromX, fromY, toX, toY, {
            color: palette.textDim,
            lineWidth: 1.2,
            alpha: 0.55,
            dashed: relation === 'implements',
        });
        context.save();
        context.globalAlpha = 0.6;
        context.fillStyle = palette.textDim;
        context.font = LAYOUT.chipFont;
        context.fillText(`«${relation}»`, fromX + 8, (fromY + toY) / 2 + 3);
        context.restore();
    }

    /**
     * Zeichnet ein Objekt-Kästchen (Körper, Header, Felder, Methoden).
     * stateElementId aktiviert die Interaktions-Markierungen (Expansions-Ringe,
     * eingeblendete Methodenpfade) — Oberklassen-Elemente lassen sie weg.
     */
    private drawObjectBox(
        type: JavaType,
        objectName: string,
        x: number,
        y: number,
        layout: ElementLayout,
        options: { lineWidth: number; stateElementId?: string },
    ): void {
        const { context, palette } = this;
        context.save();

        // Körper
        roundedRectPath(context, x, y, layout.bodyWidth, layout.bodyHeight, 14);
        context.fillStyle = palette.surface;
        context.fill();
        context.strokeStyle = palette.border;
        context.lineWidth = options.lineWidth;
        context.stroke();

        // Header
        context.fillStyle = palette.text;
        context.font = LAYOUT.titleFont;
        context.fillText(objectName, x + LAYOUT.padding, y + 21);

        const kindPrefix =
            type.kind === 'class' ? '' : `«${type.kind}» `;
        const classLabel = `${kindPrefix}${type.simpleName}`;
        context.font = LAYOUT.classFont;
        context.fillStyle = palette.textDim;
        const classWidth = context.measureText(classLabel).width;
        context.fillText(classLabel, x + layout.bodyWidth - LAYOUT.padding - classWidth, y + 21);

        if (layout.superTypeLabel) {
            context.font = LAYOUT.chipFont;
            context.fillStyle = palette.textDim;
            context.fillText(layout.superTypeLabel, x + LAYOUT.padding, y + LAYOUT.headerHeight + 6);
        }

        // Instanzvariablen: Kreise für Objekte, Quadrate für primitive Werte
        for (const slot of layout.fieldSlots) {
            const expanded =
                options.stateElementId !== undefined &&
                this.viewModel.expansions.has(`${options.stateElementId}/${slot.field.name}`);
            if (slot.field.isPrimitive) {
                drawValueSquare(
                    context,
                    x + slot.centerX,
                    y + slot.centerY,
                    slot.radius,
                    slot.field.isCollection,
                    palette.gray,
                    palette.background,
                    1.6,
                );
            } else {
                const resolved = slot.field.typeRef.resolvedId !== undefined;
                drawInstanceCircle(
                    context,
                    x + slot.centerX,
                    y + slot.centerY,
                    slot.radius,
                    slot.field.isCollection,
                    resolved ? palette.object : palette.gray,
                    palette.background,
                    expanded ? 2.4 : 1.6,
                );
            }
            context.font = LAYOUT.fieldFont;
            context.fillStyle = palette.textDim;
            const labelWidth = context.measureText(slot.field.name).width;
            context.fillText(slot.field.name, x + slot.centerX - labelWidth / 2, y + slot.centerY + slot.radius + 13);
        }

        // Methoden-Kästchen (Konstruktoren in dunklerem Blau)
        const constructorColor = darkenColor(palette.accent, 0.62);
        for (const slot of layout.methodSlots) {
            const pathVisible =
                options.stateElementId !== undefined &&
                this.viewModel.visibleMethodPaths.has(`${options.stateElementId}#${slot.method.name}`);
            const boxColor = slot.method.isConstructor ? constructorColor : palette.accent;
            roundedRectPath(context, x + slot.x, y + slot.y, slot.width, slot.height, 5);
            context.fillStyle = pathVisible ? boxColor : palette.background;
            context.fill();
            context.strokeStyle = boxColor;
            context.lineWidth = pathVisible ? 1.8 : 1.1;
            context.stroke();
            context.font = LAYOUT.methodFont;
            context.fillStyle = pathVisible ? palette.background : boxColor;
            context.fillText(
                slot.method.signatureLabel,
                x + slot.x + LAYOUT.methodPaddingX,
                y + slot.y + slot.height - 7,
            );
        }

        context.restore();
    }

    private drawExpansionConnector(element: CanvasElement, x: number, y: number): void {
        const { context, palette } = this;
        if (element.kind === 'expansion' && element.parentId && element.fieldName) {
            const parentPlacement = this.placements.get(element.parentId);
            const slot = parentPlacement?.layout.fieldSlots.find((candidate) => candidate.field.name === element.fieldName);
            if (parentPlacement && slot) {
                context.save();
                context.globalAlpha = 0.35;
                context.strokeStyle = palette.object;
                context.lineWidth = 1.2;
                context.beginPath();
                const fromX = parentPlacement.x + slot.centerX + slot.radius;
                const fromY = parentPlacement.y + slot.centerY;
                const bend = Math.max(24, (x - fromX) * 0.4);
                context.moveTo(fromX, fromY);
                context.bezierCurveTo(fromX + bend, fromY, x - bend, y + 20, x, y + 20);
                context.stroke();
                context.restore();
            }
        }
    }

    /** Pfeile der eingeblendeten Aufrufpfade (über den Elementen gezeichnet). */
    private drawPathArrows(): void {
        const { context, palette } = this;
        for (const key of this.viewModel.visibleMethodPaths) {
            const hashIndex = key.lastIndexOf('#');
            const elementId = key.slice(0, hashIndex);
            const methodName = key.slice(hashIndex + 1);
            const placement = this.placements.get(elementId);
            if (!placement) {
                continue;
            }
            const type = this.viewModel.types.get(placement.element.typeId);
            const methodSlot = placement.layout.methodSlots.find((slot) => slot.method.name === methodName);
            if (!type || !methodSlot) {
                continue;
            }

            const seenFieldArrow = new Set<string>();
            for (const call of methodSlot.method.fieldCalls) {
                const fieldSlot = placement.layout.fieldSlots.find((slot) => slot.field.name === call.fieldName);
                if (!fieldSlot) {
                    continue;
                }

                // Pfeil 1: Methode → Instanzvariable (einmal pro Feld)
                if (!seenFieldArrow.has(call.fieldName)) {
                    seenFieldArrow.add(call.fieldName);
                    drawArrowVerticalEnd(
                        context,
                        placement.x + methodSlot.x + methodSlot.width / 2,
                        placement.y + methodSlot.y,
                        placement.x + fieldSlot.centerX,
                        placement.y + fieldSlot.centerY + fieldSlot.radius + 3,
                        { color: palette.accent, lineWidth: 1.6, alpha: 0.9 },
                    );
                }

                // Pfeil 2: Instanzvariable → aufgerufene Methode im expandierten Zielobjekt
                const expansionId = `${elementId}/${call.fieldName}`;
                const target = this.placements.get(expansionId);
                if (!target) {
                    continue;
                }
                const targetMethod = target.layout.methodSlots.find(
                    (slot) => slot.method.name === call.calledMethodName,
                );
                const endX = targetMethod ? target.x + targetMethod.x - 2 : target.x - 2;
                const endY = targetMethod
                    ? target.y + targetMethod.y + targetMethod.height / 2
                    : target.y + 20;
                drawArrow(
                    context,
                    placement.x + fieldSlot.centerX + fieldSlot.radius + 2,
                    placement.y + fieldSlot.centerY,
                    endX,
                    endY,
                    { color: palette.accent, lineWidth: 1.6, alpha: 0.9 },
                );
            }
        }
    }
}
