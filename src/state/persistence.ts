import * as vscode from 'vscode';
import { emptyView, PersistedView } from '../shared/messages';

const STORAGE_KEY = 'javaStructureAnalyser.view.v1';

/**
 * Persistiert ausschließlich User-Intent (Pins, Positionen, Expansionen,
 * Viewport) im workspaceState — Kanten/Inhalte werden immer neu abgeleitet.
 */
export class ViewPersistence {
    public constructor(private readonly storage: vscode.Memento) {}

    public load(): PersistedView {
        const stored = this.storage.get<PersistedView>(STORAGE_KEY);
        if (!stored || stored.version !== 1) {
            return emptyView();
        }
        return {
            ...emptyView(),
            ...stored,
            viewport: { ...emptyView().viewport, ...stored.viewport },
        };
    }

    public save(view: PersistedView): Thenable<void> {
        return this.storage.update(STORAGE_KEY, view);
    }
}
