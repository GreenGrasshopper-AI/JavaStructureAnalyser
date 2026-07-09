# Java Structure Analyser

VSCode-Extension mit einem **komplett selbst gezeichneten Canvas** (HTML5 Canvas 2D, keine Fremdbibliothek), der ein Java-Programm als **mentales Modell in Objektsicht** visualisiert.

> Konzept-Skizze: siehe `Mentales Modell Idee.png` im Repository.

## Visuelle Sprache

- **Großes abgerundetes Rechteck = Objekt** — Objektname oben links, Klassenname klein oben rechts (`«interface»`/`«abstract»`/… als Präfix), darunter ggf. `extends …` / `implements …`
- **Orange Kreise = Instanzvariablen** (selbst Objekte); drei überlappende Kreise = Array/Collection; graue Kreise = nicht im Workspace auflösbar (JDK-/Bibliothekstypen)
- **Graue Quadrate = primitive Werte** (`int`, `boolean`, …) — bewusst keine Kreise, weil Werte keine Objekte sind
- **Blaue Kästchen unten = Methoden** (überlappen die Unterkante des Objekts); **Konstruktoren in dunklerem Blau**
- **Vererbungskette oberhalb jedes Objekts**: die selbst geschriebenen Oberklassen (nicht `Object` & Co.) werden automatisch darüber gestapelt, verbunden mit `«extends»`-Pfeilen
- **Blaue Pfeile = Aufrufpfade**: Methode → benutzte Instanzvariable → deren Objekt, rechts daneben aufgeklappt, mit Pfeil auf die dort aufgerufene Methode
- **Halbtransparente Kästchen links eines Startpunkts**: die Antwort auf „woher kommt dieses Objekt?" — **Halter** (durchgezogener oranger Rahmen) halten es als Instanzvariable (`⊚ feldname`), auch **polymorph** über ein Feld eines Supertyps (`⊚ feldname als SeitenPanel`); **Ersteller** (gestrichelter blauer Rahmen) erzeugen es nur in einer Methode (`new in methode()`). Wird ein reiner Ersteller per Doppelklick materialisiert, verbindet eine **blaue gestrichelte Linie** die erzeugende Methode mit dem erzeugten Objekt.
- **Blaue gestrichelte Andock-Linie** (`⇔ andocken`): verbindet einen Geist mit einem bereits sichtbaren Objekt, mit dem sich der Startpunkt verbinden ließe — **Doppelklick** darauf hängt ihn dort an. Erscheint an drei Stellen: am **Halter-Geist** (Andocken als Feld-Kind), am **Subtyp-Geist** (vorhandenes Objekt als Realisierung andocken statt eine Kopie zu erzeugen) und an der **Oberklassen-Box** eines Startpunkts (die Oberklasse ist schon als Objekt sichtbar → dort als Realisierung andocken)
- **Halbtransparente Kästchen unterhalb eines Objekts = Subtyp-Geister**: die direkten Unterklassen/Implementierungen des Typs — also die Antwort auf „welche konkreten Klassen kann dieses Objekt sein?" (v. a. bei `«abstract»`/`«interface»`)
- **Realisierte Subtypen**: per Doppelklick auf einen Subtyp-Geist wird die konkrete Klasse als eigenes Objekt unter der übergeordneten Klasse eingeblendet (`«extends»`/`«implements»`-Pfeil nach oben); die übergeordnete Klasse bleibt mit ihrem Parent verbunden, mehrere Realisierungen teilen sich dasselbe Element

## Bedienung

Der Canvas ist zu Beginn leer. **Java-Dateien per Drag&Drop** aus dem Explorer auf den Canvas ziehen — sie werden zu **Startpunkten**, links daneben erscheinen automatisch ihre Halter.

| Aktion | Effekt |
|---|---|
| **Java-Datei auf den Canvas ziehen** | Legt den Typ als Startpunkt an der Drop-Position an (bleibt dauerhaft, inkl. Position) |
| **Doppelklick auf Halter-/Ersteller-Geist** | Macht den Halter/Ersteller zum **neuen** Startpunkt und hängt **alle** elternlosen Startpunkte, die er als **Feld** hält, samt ihren Bäumen an (als hätte man von ihm aus expandiert); polymorph gehaltene docken als **Realisierung** unter der Feld-Expansion an; Startpunkte, die er nur **per `new`** erzeugt, werden mit der erzeugenden Methode über eine blaue gestrichelte Linie verbunden |
| **Doppelklick auf Andock-Linie** (`⇔ andocken`) | Hängt den Startpunkt unter das **bereits sichtbare** Zielobjekt, das ihn hält (der Geist verschwindet); so entscheidest du bei mehreren möglichen Eltern selbst, welche Verknüpfung entsteht |
| **Doppelklick** auf Startpunkt | Entfernt nur ihn — der aufgeklappte Baum bleibt stehen, die direkten Kinder werden eigene Startpunkte mit eigenen Haltern (über deren Geist lässt sich der Parent wieder andocken) |
| **Doppelklick auf Subtyp-Geist** | Realisiert die konkrete Klasse als Objekt unter der übergeordneten Klasse; mehrere Realisierungen nebeneinander möglich, alle bleiben über die übergeordnete Klasse mit dem Parent verbunden |
| **Doppelklick** auf realisiertes Objekt | Entfernt die Realisierung — sein aufgeklappter Teilbaum bleibt als eigene Startpunkte stehen |
| **Klick** auf Objektfläche / Halter-Geist / Subtyp-Geist / Oberklasse | Öffnet die Datei im Editor |
| Klick auf **Methoden-Kästchen** | Blendet dessen Aufrufpfade ein/aus |
| Klick auf **Instanzvariablen-Kreis** | Klappt das Zielobjekt rechts auf/zu (rekursiv möglich) |
| **Ctrl+Klick** auf Methode/Kreis | Springt zur Deklaration im Editor |
| Drag auf Objekt / Freifläche | Verschieben / Pan · **Mausrad** = Zoom auf Cursor |

Falls der Drop nicht ankommt (VSCode fängt den Drag ab), beim Ziehen **Shift gedrückt halten**.

Commands (Ctrl+Shift+P):

- **„Java Structure: Open Structure Canvas"** — öffnet den Canvas (auch als Icon im Editor-Titel bei Java-Dateien)
- **„Java Structure: Save Structure Canvas As…"** — speichert den aktuellen Canvas (Pins, Positionen, Expansionen, Viewport) als `.javacanvas.json`-Datei, z. B. zum Einchecken oder für mehrere Modelle pro Projekt
- **„Java Structure: Open Structure Canvas from File…"** — lädt eine gespeicherte Canvas-Datei (ersetzt den aktuellen Stand)

Unabhängig davon überlebt der zuletzt bearbeitete Stand einen VSCode-Neustart automatisch (workspaceState).

**Doppelte Klassennamen:** Deklarieren mehrere Dateien denselben Typ (z. B. Backup-/Archiv-Kopien), verwendet die Analyse pro Typ **eine** kanonische Datei (die flacher/kürzer im Pfad liegende) und meldet die Duplikate einmalig als Warnung. So bleibt das Modell konsistent — sonst könnten Halter Felder „kennen", die der gezeichnete Typ (aus einer anderen Kopie) gar nicht hat.

## Entwicklung

```bash
npm install
npm run compile        # Typecheck + Bundles (dist/)
npm run watch          # esbuild-Watch
npm run test:analyzer  # Parser-Smoke-Test gegen testdata/ (ohne VSCode)
```

**F5** startet den Extension Development Host mit dem Beispielprojekt `testdata/` (kleines Spiel: `GameLoop` → `Player`/`Board`/`Enemy` → `Position`/`Inventory`/`Tile`).

## Als VSIX exportieren & installieren

```bash
npm run vsix           # Production-Build + java-structure-analyser-<version>.vsix
```

Installation der erzeugten Datei wahlweise über die Kommandozeile …

```bash
code --install-extension java-structure-analyser-0.1.0.vsix
```

… oder in VSCode: Extensions-Ansicht → `…`-Menü → **„Install from VSIX…"**.

## Architektur

```
src/                     Extension-Host (Node)
  extension.ts           Aktivierung, Commands
  controller.ts          verdrahtet Editor-Events ↔ Modell ↔ Webview
  panel/canvasPanel.ts   WebviewPanel + CSP-HTML
  analyzer/              vscode-frei (Node-testbar)
    parserService.ts     web-tree-sitter (WASM, java-Grammatik)
    modelBuilder.ts      AST → JavaType/JavaField/JavaMethod (+ Feld-Aufrufe, new-Ausdrücke)
    typeResolver.ts      Import-/Package-/Simple-Name-Heuristik
    holders.ts           Rückwärtssuche: wer hält einen Typ (Feld / new in Methode)?
    modelStore.ts        Modell-Cache pro Datei
  workspace/             workspaceIndex (findFiles + Watcher)
  state/persistence.ts   workspaceState: nur User-Intent (Pins, Positionen, Expansionen, Viewport)
  shared/                Modell + Nachrichtenprotokoll (auch vom Webview importiert)

webview/                 Browser (eigenes Bundle, selbst gezeichnet)
  canvas/renderer.ts     rAF-Loop, Platzierung, Theme-Farben aus CSS-Variablen
  canvas/layout.ts       Innenlayout der Objekt-Elemente
  canvas/camera.ts       Pan/Zoom-Transformation
  canvas/shapes.ts       Rechtecke, Kreis-Cluster, Bezier-Pfeile
  interaction.ts         Maus-Gesten (Klick/Doppelklick/Drag/Wheel, Hit-Testing)
  viewModel.ts           Elemente, Expansionen (`parent/feldname`), sichtbare Pfade
```

Grundprinzip der Persistenz: **Kanten und Inhalte werden nie gespeichert**, sondern bei jedem Start neu aus dem Code abgeleitet — gespeichert wird nur, *was der Benutzer angeordnet hat*.
