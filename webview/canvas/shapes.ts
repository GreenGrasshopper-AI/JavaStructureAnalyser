/**
 * Zeichenprimitive für den selbst gezeichneten Canvas.
 */

export function roundedRectPath(
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
): void {
    const r = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + r, y);
    context.arcTo(x + width, y, x + width, y + height, r);
    context.arcTo(x + width, y + height, x, y + height, r);
    context.arcTo(x, y + height, x, y, r);
    context.arcTo(x, y, x + width, y, r);
    context.closePath();
}

export interface ArrowOptions {
    color: string;
    lineWidth: number;
    alpha: number;
    dashed?: boolean;
    headSize?: number;
}

/**
 * Kubische Bezier-Kurve mit Pfeilspitze am Ende; Kontrollpunkte werden aus
 * der Richtung abgeleitet (horizontal ausschwingend).
 */
export function drawArrow(
    context: CanvasRenderingContext2D,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    options: ArrowOptions,
): void {
    const bend = Math.max(24, Math.abs(toX - fromX) * 0.4);
    const direction = toX >= fromX ? 1 : -1;
    const control1X = fromX + direction * bend;
    const control2X = toX - direction * bend;

    context.save();
    context.globalAlpha = options.alpha;
    context.strokeStyle = options.color;
    context.lineWidth = options.lineWidth;
    context.setLineDash(options.dashed ? [6, 4] : []);
    context.beginPath();
    context.moveTo(fromX, fromY);
    context.bezierCurveTo(control1X, fromY, control2X, toY, toX, toY);
    context.stroke();
    context.setLineDash([]);

    // Kontrollpunkt 2 liegt auf Höhe des Ziels → Pfeil kommt horizontal an
    drawArrowHead(context, toX, toY, direction > 0 ? 0 : Math.PI, options.color, options.headSize ?? 7);
    context.restore();
}

/** Pfeil, der vertikal am Ziel ankommt (z. B. von oben auf ein Methoden-Kästchen). */
export function drawArrowVerticalEnd(
    context: CanvasRenderingContext2D,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    options: ArrowOptions,
): void {
    const bend = Math.max(18, Math.abs(toY - fromY) * 0.5);
    const directionY = toY >= fromY ? 1 : -1;

    context.save();
    context.globalAlpha = options.alpha;
    context.strokeStyle = options.color;
    context.lineWidth = options.lineWidth;
    context.setLineDash(options.dashed ? [6, 4] : []);
    context.beginPath();
    context.moveTo(fromX, fromY);
    context.bezierCurveTo(fromX, fromY + directionY * bend, toX, toY - directionY * bend, toX, toY);
    context.stroke();
    context.setLineDash([]);
    drawArrowHead(context, toX, toY, directionY > 0 ? Math.PI / 2 : -Math.PI / 2, options.color, options.headSize ?? 7);
    context.restore();
}

export function drawArrowHead(
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    angle: number,
    color: string,
    size: number,
): void {
    context.save();
    context.translate(x, y);
    context.rotate(angle);
    context.fillStyle = color;
    context.beginPath();
    context.moveTo(0, 0);
    context.lineTo(-size, -size * 0.55);
    context.lineTo(-size, size * 0.55);
    context.closePath();
    context.fill();
    context.restore();
}

/**
 * Quadrat für einen primitiven Wert (int, boolean, …) — bewusst kein Kreis,
 * weil Werte keine Objekte sind; Arrays als drei überlappende Quadrate.
 */
export function drawValueSquare(
    context: CanvasRenderingContext2D,
    centerX: number,
    centerY: number,
    radius: number,
    isCollection: boolean,
    strokeColor: string,
    fillColor: string,
    lineWidth: number,
): void {
    const half = radius * 0.85;
    const offsets = isCollection
        ? [
              { dx: -radius * 0.55, dy: radius * 0.25 },
              { dx: radius * 0.55, dy: radius * 0.25 },
              { dx: 0, dy: -radius * 0.2 },
          ]
        : [{ dx: 0, dy: 0 }];
    for (const offset of offsets) {
        roundedRectPath(context, centerX + offset.dx - half, centerY + offset.dy - half, half * 2, half * 2, 3);
        context.fillStyle = fillColor;
        context.fill();
        context.strokeStyle = strokeColor;
        context.lineWidth = lineWidth;
        context.stroke();
    }
}

/**
 * Kreis für eine Instanzvariable; Collections werden als drei überlappende
 * Kreise gezeichnet (wie in der Skizze des mentalen Modells).
 */
export function drawInstanceCircle(
    context: CanvasRenderingContext2D,
    centerX: number,
    centerY: number,
    radius: number,
    isCollection: boolean,
    strokeColor: string,
    fillColor: string,
    lineWidth: number,
): void {
    const offsets = isCollection
        ? [
              { dx: -radius * 0.55, dy: radius * 0.25 },
              { dx: radius * 0.55, dy: radius * 0.25 },
              { dx: 0, dy: -radius * 0.2 },
          ]
        : [{ dx: 0, dy: 0 }];
    for (const offset of offsets) {
        context.beginPath();
        context.arc(centerX + offset.dx, centerY + offset.dy, radius, 0, Math.PI * 2);
        context.fillStyle = fillColor;
        context.fill();
        context.strokeStyle = strokeColor;
        context.lineWidth = lineWidth;
        context.stroke();
    }
}
