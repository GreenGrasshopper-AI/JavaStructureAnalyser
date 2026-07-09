import { JavaField, JavaMethod, JavaType } from '../../src/shared/javaModel';

/**
 * Innenlayout eines Objekt-Elements (alle Koordinaten relativ zur linken
 * oberen Ecke des Körper-Rechtecks):
 *
 *   ┌───────────────────────────────┐
 *   │ objektname        Klassenname │  ← Header
 *   │ (extends Foo)                 │  ← optionale Supertyp-Zeile
 *   │    ⊚ feld1     ⊚⊚⊚ feld2      │  ← Instanzvariablen-Kreise
 *   └────┬─────────┬────────────────┘
 *     │ m1() │  │ m2() │               ← Methoden-Kästchen (überlappen die Unterkante)
 */

export const LAYOUT = {
    padding: 16,
    headerHeight: 34,
    superTypeLine: 16,
    circleRadius: 13,
    fieldCellWidth: 86,
    fieldCellHeight: 62,
    methodHeight: 22,
    methodGap: 8,
    methodPaddingX: 10,
    methodRowGap: 6,
    minBodyWidth: 200,
    fieldFont: '10px sans-serif',
    methodFont: '11px sans-serif',
    titleFont: 'bold 13px sans-serif',
    classFont: '11px sans-serif',
    chipFont: '10px sans-serif',
} as const;

export interface FieldSlot {
    field: JavaField;
    centerX: number;
    centerY: number;
    radius: number;
}

export interface MethodSlot {
    method: JavaMethod;
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface ElementLayout {
    /** Breite/Höhe des Körper-Rechtecks */
    bodyWidth: number;
    bodyHeight: number;
    /** Gesamthöhe inkl. überhängender Methoden-Kästchen */
    totalHeight: number;
    headerHeight: number;
    superTypeLabel: string | undefined;
    fieldSlots: FieldSlot[];
    methodSlots: MethodSlot[];
}

export type TextMeasurer = (text: string, font: string) => number;

export function layoutElement(type: JavaType, objectName: string, measure: TextMeasurer): ElementLayout {
    const superTypeLabel = buildSuperTypeLabel(type);
    const headerHeight = LAYOUT.headerHeight + (superTypeLabel ? LAYOUT.superTypeLine : 0);

    const fields = type.fields;
    const methods = type.methods;

    const headerWidth =
        measure(objectName, LAYOUT.titleFont) + measure(type.simpleName, LAYOUT.classFont) + LAYOUT.padding * 3;
    const superTypeWidth = superTypeLabel ? measure(superTypeLabel, LAYOUT.chipFont) + LAYOUT.padding * 2 : 0;

    const fieldsPerRowMax = Math.min(4, Math.max(1, fields.length));
    const fieldsWidth = fieldsPerRowMax * LAYOUT.fieldCellWidth;

    const methodWidths = methods.map(
        (method) => measure(method.signatureLabel, LAYOUT.methodFont) + LAYOUT.methodPaddingX * 2,
    );
    const widestMethod = methodWidths.length > 0 ? Math.max(...methodWidths) : 0;

    const bodyWidth = Math.ceil(
        Math.max(
            LAYOUT.minBodyWidth,
            headerWidth,
            superTypeWidth,
            fieldsWidth + LAYOUT.padding * 2,
            widestMethod + LAYOUT.padding * 2,
        ),
    );

    // Kreise zentriert in Zeilen anordnen
    const fieldSlots: FieldSlot[] = [];
    const perRow = Math.min(fieldsPerRowMax, Math.max(1, Math.floor((bodyWidth - LAYOUT.padding * 2) / LAYOUT.fieldCellWidth)));
    const rows = fields.length > 0 ? Math.ceil(fields.length / perRow) : 0;
    for (let index = 0; index < fields.length; index++) {
        const row = Math.floor(index / perRow);
        const inRow = row === rows - 1 ? fields.length - row * perRow : perRow;
        const rowWidth = inRow * LAYOUT.fieldCellWidth;
        const column = index - row * perRow;
        fieldSlots.push({
            field: fields[index],
            centerX: (bodyWidth - rowWidth) / 2 + column * LAYOUT.fieldCellWidth + LAYOUT.fieldCellWidth / 2,
            centerY: headerHeight + row * LAYOUT.fieldCellHeight + LAYOUT.fieldCellHeight / 2 - 6,
            radius: LAYOUT.circleRadius,
        });
    }

    const fieldsHeight = rows > 0 ? rows * LAYOUT.fieldCellHeight : 14;
    const bodyHeight = headerHeight + fieldsHeight + (methods.length > 0 ? LAYOUT.methodHeight / 2 + 6 : 6);

    // Methoden-Kästchen in Zeilen umbrechen; erste Zeile überlappt die Unterkante
    const methodSlots: MethodSlot[] = [];
    const available = bodyWidth - LAYOUT.padding * 2;
    const rowsOfMethods: number[][] = [];
    let currentRow: number[] = [];
    let currentWidth = 0;
    for (let index = 0; index < methods.length; index++) {
        const width = methodWidths[index];
        if (currentRow.length > 0 && currentWidth + LAYOUT.methodGap + width > available) {
            rowsOfMethods.push(currentRow);
            currentRow = [];
            currentWidth = 0;
        }
        currentRow.push(index);
        currentWidth += (currentRow.length > 1 ? LAYOUT.methodGap : 0) + width;
    }
    if (currentRow.length > 0) {
        rowsOfMethods.push(currentRow);
    }

    let rowY = bodyHeight - LAYOUT.methodHeight / 2;
    for (const rowIndexes of rowsOfMethods) {
        const rowWidth = rowIndexes.reduce(
            (sum, index, position) => sum + methodWidths[index] + (position > 0 ? LAYOUT.methodGap : 0),
            0,
        );
        let x = (bodyWidth - rowWidth) / 2;
        for (const index of rowIndexes) {
            methodSlots.push({
                method: methods[index],
                x,
                y: rowY,
                width: methodWidths[index],
                height: LAYOUT.methodHeight,
            });
            x += methodWidths[index] + LAYOUT.methodGap;
        }
        rowY += LAYOUT.methodHeight + LAYOUT.methodRowGap;
    }

    const totalHeight = methodSlots.length > 0 ? rowY - LAYOUT.methodRowGap : bodyHeight;

    return {
        bodyWidth,
        bodyHeight,
        totalHeight,
        headerHeight,
        superTypeLabel,
        fieldSlots,
        methodSlots,
    };
}

function buildSuperTypeLabel(type: JavaType): string | undefined {
    if (type.superTypes.length === 0) {
        return undefined;
    }
    const extended = type.superTypes.filter((ref) => ref.relation === 'extends').map((ref) => ref.name);
    const implemented = type.superTypes.filter((ref) => ref.relation === 'implements').map((ref) => ref.name);
    const parts: string[] = [];
    if (extended.length > 0) {
        parts.push(`extends ${extended.join(', ')}`);
    }
    if (implemented.length > 0) {
        parts.push(`implements ${implemented.join(', ')}`);
    }
    return parts.join('  ');
}

/** Anzeigename des "gedachten Objekts": Klassennamen wie eine Variable schreiben. */
export function defaultObjectName(simpleName: string): string {
    return simpleName.charAt(0).toLowerCase() + simpleName.slice(1);
}
