/**
 * Pan/Zoom-Kamera: screen = world * scale + (x, y).
 */
export class Camera {
    public x = 0;
    public y = 0;
    public scale = 1;

    public static readonly MIN_SCALE = 0.15;
    public static readonly MAX_SCALE = 4;

    public toWorld(screenX: number, screenY: number): { x: number; y: number } {
        return { x: (screenX - this.x) / this.scale, y: (screenY - this.y) / this.scale };
    }

    /** Zoomt um einen Faktor, zentriert auf eine Bildschirmposition (Mauszeiger). */
    public zoomAt(screenX: number, screenY: number, factor: number): void {
        const nextScale = Math.max(Camera.MIN_SCALE, Math.min(Camera.MAX_SCALE, this.scale * factor));
        this.x = screenX - (screenX - this.x) * (nextScale / this.scale);
        this.y = screenY - (screenY - this.y) * (nextScale / this.scale);
        this.scale = nextScale;
    }

    public apply(context: CanvasRenderingContext2D): void {
        context.translate(this.x, this.y);
        context.scale(this.scale, this.scale);
    }
}
