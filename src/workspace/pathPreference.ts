/**
 * Deterministische Wahl einer kanonischen Datei bei doppelten Klassennamen.
 * vscode-frei, damit Node-testbar.
 */

/**
 * Ob `candidate` als kanonischer Repräsentant eines FQN gegenüber `current`
 * bevorzugt wird. Heuristik gegen Backup-/Archiv-Duplikate: flacher liegende,
 * kürzere Pfade gewinnen (Originale liegen i. d. R. direkt unter src/, Kopien
 * tiefer verschachtelt). Deterministisch, damit dieselbe Datei stabil gewinnt.
 */
export function isPreferredPath(candidate: string, current: string): boolean {
    const candidateSegments = pathSegmentCount(candidate);
    const currentSegments = pathSegmentCount(current);
    if (candidateSegments !== currentSegments) {
        return candidateSegments < currentSegments;
    }
    if (candidate.length !== current.length) {
        return candidate.length < current.length;
    }
    return candidate.localeCompare(current) < 0;
}

function pathSegmentCount(fsPath: string): number {
    return fsPath.split(/[/\\]+/).filter((segment) => segment.length > 0).length;
}
