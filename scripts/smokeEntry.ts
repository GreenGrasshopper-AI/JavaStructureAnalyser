/**
 * Node-Smoke-Test des Analyzers (ohne VSCode): parst testdata/ und prüft,
 * dass Typen, Felder, Feld-Aufrufe, Erzeugungen und Vererbung korrekt
 * extrahiert und aufgelöst werden. Wird über scripts/analyzerSmokeTest.js
 * gebündelt und ausgeführt.
 */
import * as fs from 'fs';
import * as path from 'path';
import { computeHolders } from '../src/analyzer/holders';
import { ModelBuilder, resolveParsedFile } from '../src/analyzer/modelBuilder';
import { ParserService } from '../src/analyzer/parserService';
import { computeSubtypes } from '../src/analyzer/subtypes';
import { resolveTypeName, TypeIndex, TypeIndexEntry } from '../src/analyzer/typeResolver';
import { JavaType } from '../src/shared/javaModel';
import { ViewModel } from '../webview/viewModel';

const failures: string[] = [];

function expect(condition: boolean, message: string): void {
    if (!condition) {
        failures.push(message);
    }
}

async function main(): Promise<void> {
    const repoRoot = path.resolve(__dirname, '..');
    const parser = new ParserService();
    await parser.init(path.join(repoRoot, 'dist'));

    const javaDir = path.join(repoRoot, 'testdata', 'src', 'game');
    const files = fs.readdirSync(javaDir).filter((file) => file.endsWith('.java'));

    const entries: TypeIndexEntry[] = files.map((file) => {
        const content = fs.readFileSync(path.join(javaDir, file), 'utf8');
        const packageName = /^\s*package\s+([\w.]+)\s*;/m.exec(content)?.[1] ?? '';
        const simpleName = path.basename(file, '.java');
        return {
            fqn: packageName ? `${packageName}.${simpleName}` : simpleName,
            simpleName,
            fsPath: path.join(javaDir, file),
        };
    });
    const index: TypeIndex = {
        byFqn: (fqn) => entries.find((entry) => entry.fqn === fqn),
        bySimpleName: (name) => entries.filter((entry) => entry.simpleName === name),
    };

    const builder = new ModelBuilder();
    const types = new Map<string, JavaType>();
    for (const file of files) {
        const fsPath = path.join(javaDir, file);
        const content = fs.readFileSync(fsPath, 'utf8');
        const tree = parser.parse(content);
        const parsed = builder.build(tree, fsPath, path.relative(repoRoot, fsPath));
        tree.delete();
        const context = {
            packageName: parsed.packageName,
            imports: parsed.imports,
            wildcardImports: parsed.wildcardImports,
        };
        resolveParsedFile(parsed, (name) => resolveTypeName(name, context, index));
        for (const type of parsed.types) {
            types.set(type.id, type);
        }
    }

    // --- GameLoop ---
    const gameLoop = types.get('game.GameLoop');
    expect(gameLoop !== undefined, 'game.GameLoop wurde nicht gefunden');
    if (gameLoop) {
        expect(gameLoop.kind === 'class', `GameLoop.kind: erwartet class, ist ${gameLoop.kind}`);
        const fieldNames = gameLoop.fields.map((field) => field.name);
        expect(fieldNames.includes('player'), `GameLoop-Felder: player fehlt (${fieldNames.join(', ')})`);
        expect(fieldNames.includes('board'), 'GameLoop-Felder: board fehlt');
        expect(fieldNames.includes('enemies'), 'GameLoop-Felder: enemies fehlt');
        const tickCount = gameLoop.fields.find((field) => field.name === 'tickCount');
        expect(tickCount?.isPrimitive === true, 'GameLoop.tickCount muss als primitives Feld erscheinen');
        expect(
            gameLoop.fields.find((field) => field.name === 'player')?.isPrimitive === false,
            'GameLoop.player darf nicht als primitiv markiert sein',
        );

        const playerField = gameLoop.fields.find((field) => field.name === 'player');
        expect(playerField?.typeRef.resolvedId === 'game.Player', `player.resolvedId: ${playerField?.typeRef.resolvedId}`);
        const enemiesField = gameLoop.fields.find((field) => field.name === 'enemies');
        expect(enemiesField?.isCollection === true, 'enemies muss isCollection sein');
        expect(enemiesField?.typeRef.resolvedId === 'game.Enemy', `enemies.resolvedId: ${enemiesField?.typeRef.resolvedId}`);

        const update = gameLoop.methods.find((method) => method.name === 'update');
        expect(update !== undefined, 'GameLoop.update fehlt');
        const updateCalls = update?.fieldCalls.map((call) => `${call.fieldName}.${call.calledMethodName}`) ?? [];
        expect(updateCalls.includes('player.move'), `update-Aufrufe: player.move fehlt (${updateCalls.join(', ')})`);
        expect(updateCalls.includes('board.redraw'), 'update-Aufrufe: board.redraw fehlt');
        expect(!updateCalls.some((call) => call.startsWith('enemy.')), 'update: lokale Variable enemy darf kein Feld-Aufruf sein');

        const constructor = gameLoop.methods.find((method) => method.isConstructor);
        const constructorCreations = constructor?.creations.map((creation) => creation.typeRef.name) ?? [];
        expect(constructorCreations.includes('Player'), `Konstruktor-Erzeugungen: Player fehlt (${constructorCreations.join(', ')})`);
        expect(constructorCreations.includes('Board'), 'Konstruktor-Erzeugungen: Board fehlt');

        const spawn = gameLoop.methods.find((method) => method.name === 'spawnEnemy');
        const spawnCalls = spawn?.fieldCalls.map((call) => `${call.fieldName}.${call.calledMethodName}`) ?? [];
        expect(spawnCalls.includes('enemies.add'), 'spawnEnemy: enemies.add fehlt');
        expect(
            spawn?.creations.some((creation) => creation.typeRef.resolvedId === 'game.Enemy') === true,
            'spawnEnemy: Erzeugung von Enemy fehlt/unaufgelöst',
        );
    }

    // --- Player ---
    const player = types.get('game.Player');
    expect(player !== undefined, 'game.Player wurde nicht gefunden');
    if (player) {
        const relations = player.superTypes.map((ref) => `${ref.relation}:${ref.name}:${ref.resolvedId ?? '-'}`);
        expect(
            player.superTypes.some((ref) => ref.relation === 'extends' && ref.resolvedId === 'game.Entity'),
            `Player extends Entity fehlt (${relations.join(', ')})`,
        );
        expect(
            player.superTypes.some((ref) => ref.relation === 'implements' && ref.resolvedId === 'game.Movable'),
            `Player implements Movable fehlt (${relations.join(', ')})`,
        );
        const nameField = player.fields.find((field) => field.name === 'name');
        expect(nameField?.typeRef.resolvedId === undefined, 'Player.name (String) muss unaufgelöst bleiben');
        const move = player.methods.find((method) => method.name === 'move');
        expect(
            move?.fieldCalls.some((call) => call.fieldName === 'position' && call.calledMethodName === 'translate') === true,
            'Player.move: position.translate fehlt',
        );
    }

    // --- Kinds ---
    expect(types.get('game.Entity')?.kind === 'abstract', `Entity.kind: ${types.get('game.Entity')?.kind}`);
    expect(types.get('game.Movable')?.kind === 'interface', `Movable.kind: ${types.get('game.Movable')?.kind}`);

    // --- Board ---
    const board = types.get('game.Board');
    if (board) {
        const tiles = board.fields.find((field) => field.name === 'tiles');
        expect(tiles?.isCollection === true && tiles.typeRef.resolvedId === 'game.Tile', 'Board.tiles: Collection<Tile> nicht erkannt');
        expect(
            board.fields.find((field) => field.name === 'width')?.isPrimitive === true,
            'Board.width (int) muss als primitives Feld erscheinen',
        );
    } else {
        failures.push('game.Board wurde nicht gefunden');
    }

    // --- Position: primitive Felder ---
    const position = types.get('game.Position');
    if (position) {
        const primitives = position.fields.filter((field) => field.isPrimitive).map((field) => field.name);
        expect(
            primitives.includes('x') && primitives.includes('y'),
            `Position: primitive Felder x/y fehlen (${primitives.join(', ') || '—'})`,
        );
    } else {
        failures.push('game.Position wurde nicht gefunden');
    }

    // --- Halter-Rückwärtssuche ---
    const playerHolders = computeHolders(types.values(), 'game.Player');
    expect(
        playerHolders.some(
            (holder) =>
                holder.holderTypeId === 'game.GameLoop' &&
                holder.vias.some((via) => via.kind === 'field' && via.memberName === 'player'),
        ),
        `Halter von Player: GameLoop mit Feld player fehlt (${JSON.stringify(playerHolders)})`,
    );
    const enemyHolders = computeHolders(types.values(), 'game.Enemy');
    const enemyGameLoop = enemyHolders.find((holder) => holder.holderTypeId === 'game.GameLoop');
    expect(
        enemyGameLoop?.vias.some((via) => via.kind === 'field' && via.memberName === 'enemies') === true,
        'Halter von Enemy: GameLoop mit Feld enemies fehlt',
    );
    expect(
        enemyGameLoop?.vias.some((via) => via.kind === 'creation' && via.memberName === 'spawnEnemy') === true,
        'Halter von Enemy: GameLoop mit new in spawnEnemy fehlt',
    );
    expect(
        enemyGameLoop !== undefined && enemyGameLoop.vias[0].kind === 'field',
        'Halter-Vias: Feld-Via muss vor Creation-Via stehen',
    );
    expect(
        computeHolders(types.values(), 'game.GameLoop').length === 0,
        'GameLoop darf keine Halter haben (Wurzel des Testprojekts)',
    );
    // polymorpher Feld-Halter: GameLoop.boss (Entity) hält Enemy über den Supertyp
    const enemyGameLoopVias = enemyHolders.find((holder) => holder.holderTypeId === 'game.GameLoop')?.vias ?? [];
    expect(
        enemyGameLoopVias.some(
            (via) => via.kind === 'field' && via.memberName === 'boss' && via.superTypeName === 'Entity',
        ),
        `Halter von Enemy: polymorphes Feld boss als Entity fehlt (${JSON.stringify(enemyGameLoopVias)})`,
    );
    expect(
        enemyGameLoopVias.findIndex((via) => via.memberName === 'enemies') <
            enemyGameLoopVias.findIndex((via) => via.memberName === 'boss'),
        'Halter-Vias: exaktes Feld muss vor polymorphem Feld stehen',
    );
    expect(
        enemyGameLoopVias[enemyGameLoopVias.length - 1].kind === 'creation',
        'Halter-Vias: Creation-Via muss hinter allen Feld-Vias stehen',
    );

    // --- Subtyp-Vorwärtssuche (welche konkreten Klassen sind möglich?) ---
    const entitySubtypes = computeSubtypes(types.values(), 'game.Entity');
    expect(
        entitySubtypes.length === 2 &&
            entitySubtypes[0].subtypeId === 'game.Enemy' &&
            entitySubtypes[0].relation === 'extends' &&
            entitySubtypes[1].subtypeId === 'game.Player' &&
            entitySubtypes[1].relation === 'extends',
        `Subtypen von Entity: Enemy+Player (extends) erwartet (${JSON.stringify(entitySubtypes)})`,
    );
    const movableSubtypes = computeSubtypes(types.values(), 'game.Movable');
    expect(
        movableSubtypes.length === 1 &&
            movableSubtypes[0].subtypeId === 'game.Player' &&
            movableSubtypes[0].relation === 'implements',
        `Subtypen von Movable: Player (implements) erwartet (${JSON.stringify(movableSubtypes)})`,
    );
    expect(
        computeSubtypes(types.values(), 'game.Player').length === 0,
        'Player darf keine Subtypen haben',
    );

    // --- ViewModel: reine Ersteller-Geister per Methoden-Link verknüpfen ---
    const zeroRange = { startLine: 0, startCol: 0, endLine: 0, endCol: 0 };
    const factoryType: JavaType = {
        id: 'sample.Factory',
        simpleName: 'Factory',
        kind: 'class',
        filePath: '/tmp/Factory.java',
        displayPath: 'Factory.java',
        nameRange: zeroRange,
        superTypes: [],
        fields: [],
        methods: [
            {
                name: 'makeWidget',
                signatureLabel: 'makeWidget()',
                isStatic: false,
                isConstructor: false,
                declRange: zeroRange,
                fieldCalls: [],
                creations: [{ typeRef: { name: 'Widget', resolvedId: 'sample.Widget' }, callRange: zeroRange }],
            },
        ],
    };
    const widgetType: JavaType = {
        id: 'sample.Widget',
        simpleName: 'Widget',
        kind: 'class',
        filePath: '/tmp/Widget.java',
        displayPath: 'Widget.java',
        nameRange: zeroRange,
        superTypes: [],
        fields: [],
        methods: [],
    };
    const creationView = new ViewModel();
    creationView.upsertTypes([factoryType, widgetType]);
    creationView.addStartPoints([widgetType], 100, 100);
    creationView.mergeHolders({
        'sample.Widget': [{ holderTypeId: 'sample.Factory', vias: [{ kind: 'creation', memberName: 'makeWidget' }] }],
    });
    creationView.rerootToHolder('sample.Factory', 20, 40);
    const creationLinks = [...((creationView as unknown as { creationLinks?: Map<string, unknown> }).creationLinks?.values() ?? [])] as {
        parentElementId?: string;
        childElementId?: string;
        methodName?: string;
    }[];
    expect(
        creationLinks.some(
            (link) =>
                link.parentElementId === 'sample.Factory' &&
                link.childElementId === 'sample.Widget' &&
                link.methodName === 'makeWidget',
        ),
        `ViewModel: reiner Ersteller-Geist muss Widget per Methoden-Link an Factory.makeWidget hängen (${JSON.stringify(creationLinks)})`,
    );

    if (failures.length > 0) {
        console.error(`\nFEHLGESCHLAGEN (${failures.length}):`);
        for (const failure of failures) {
            console.error(`  ✗ ${failure}`);
        }
        process.exit(1);
    }
    console.log(`Smoke-Test OK: ${types.size} Typen analysiert, alle Prüfungen bestanden.`);
    for (const type of types.values()) {
        console.log(
            `  ${type.id} [${type.kind}] Felder: ${type.fields.map((field) => field.name).join(', ') || '—'} | Methoden: ${type.methods.map((method) => method.name).join(', ') || '—'}`,
        );
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
