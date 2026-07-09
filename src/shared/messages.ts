import { JavaType, TypeHolder, TypeSubtype } from './javaModel';

/**
 * Persistierter View-State. Es wird ausschließlich User-Intent gespeichert —
 * alle Kanten/Inhalte werden bei jedem Start neu aus dem Code abgeleitet.
 */
export interface PersistedView {
    version: 1;
    /** Gepinnte Basis-Elemente mit Weltposition. */
    pinned: { typeId: string; x: number; y: number }[];
    /** Methoden mit eingeblendeten Aufrufpfaden: `${elementId}#${methodName}` */
    visibleMethodPaths: string[];
    /**
     * Expandierte Zielobjekte als Pfad-IDs: `${parentElementId}/${fieldName}`.
     * Dadurch kann dieselbe Klasse in verschiedenen Pfaden mehrfach offen sein.
     */
    expansions: string[];
    /** Manuelle Verschiebe-Offsets expandierter Elemente. */
    expansionOffsets: Record<string, { dx: number; dy: number }>;
    /**
     * Realisierte konkrete Subtypen unter einem abstrakten/Interface-Objekt als
     * Element-IDs: `${parentElementId}~${subtypeId}`. Die abstrakte Klasse bleibt
     * mit dem Parent verbunden; alle realisierten Subtypen hängen darunter.
     */
    realizedSubtypes: string[];
    viewport: { x: number; y: number; scale: number };
}

export function emptyView(): PersistedView {
    return {
        version: 1,
        pinned: [],
        visibleMethodPaths: [],
        expansions: [],
        expansionOffsets: {},
        realizedSubtypes: [],
        viewport: { x: 0, y: 0, scale: 1 },
    };
}

export type ExtToWebviewMessage =
    | {
          type: 'init';
          types: JavaType[];
          view: PersistedView;
      }
    | {
          type: 'modelUpdate';
          upsertTypes: JavaType[];
          removedTypeIds: string[];
      }
    /** Antwort auf dropFiles: die Typen der abgelegten Dateien samt Drop-Position (Welt). */
    | {
          type: 'dropResult';
          types: JavaType[];
          x: number;
          y: number;
      }
    /**
     * Antwort auf requestHolders: pro angefragtem Typ die Halter-Liste;
     * holderTypes liefert die JavaTypes der Halter gleich mit (für Beschriftung).
     */
    | {
          type: 'holdersUpdate';
          holders: Record<string, TypeHolder[]>;
          holderTypes: JavaType[];
      }
    /**
     * Antwort auf requestSubtypes: pro angefragtem Typ die direkten Subtypen;
     * subtypeTypes liefert deren JavaTypes gleich mit (für Beschriftung/Layout).
     */
    | {
          type: 'subtypesUpdate';
          subtypes: Record<string, TypeSubtype[]>;
          subtypeTypes: JavaType[];
      }
    /** Bittet das Webview, seinen View-State sofort (ohne Debounce) zu melden. */
    | { type: 'requestPersist' };

export type WebviewToExtMessage =
    | { type: 'ready' }
    | {
          type: 'openFile';
          typeId: string;
          member?: { kind: 'method' | 'field'; name: string };
      }
    | { type: 'persistView'; view: PersistedView }
    /** Webview benötigt Typdaten (z. B. Ziel einer Expansion), die es noch nicht kennt. */
    | { type: 'requestTypes'; typeIds: string[] }
    /** Per Drag&Drop abgelegte Dateien (URIs oder Pfade) an Weltposition (x, y). */
    | { type: 'dropFiles'; uris: string[]; x: number; y: number }
    /** Webview möchte wissen, welche Typen die angegebenen Typen halten. */
    | { type: 'requestHolders'; typeIds: string[] }
    /** Webview möchte wissen, welche Typen die angegebenen Typen beerben/implementieren. */
    | { type: 'requestSubtypes'; typeIds: string[] };
