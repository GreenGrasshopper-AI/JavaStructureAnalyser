# Java Structure Analyser

Java Structure Analyser is a Visual Studio Code extension for interactively building focused structure diagrams for Java projects.

Large Java codebases can contain hundreds or thousands of classes. A complete dependency diagram for such a project is often too dense to be useful. This extension takes a different approach: it follows the currently selected Java file, shows nearby incoming and outgoing relationships temporarily, and lets the user pin only the nodes that matter.

## Features

- Opens an interactive graph tab inside VS Code.
- Creates a rounded-rectangle node for the currently active Java class.
- Shows temporary outgoing relationships, including classes that are instantiated, used as fields, parameters, local variables, imports, or method-call targets.
- Shows temporary incoming relationships from other workspace classes that reference or instantiate the current class.
- Allows users to double-click any graph node to pin it permanently in the diagram.
- Keeps the diagram focused while the user iteratively navigates through the codebase.

## How It Works

1. Open a Java file in VS Code.
2. Run **Java Structure Analyser: Open Graph** from the Command Palette.
3. The selected class appears as the central node.
4. Nearby incoming and outgoing classes are rendered as temporary nodes.
5. Double-click relevant nodes to pin them.
6. Move through the codebase and repeat until the diagram represents the structure you care about.

## Current Analysis Scope

The first implementation uses lightweight static parsing to identify common Java relationships:

- `new ClassName(...)` instantiations
- field declarations
- constructor and method parameters
- local variable declarations
- imports
- static method calls
- method calls on variables with known local or parameter types

This makes the extension fast and dependency-light, while leaving room for future integration with richer Java language-server metadata.

## Development

Install dependencies:

```bash
npm install
```

Run tests:

```bash
npm test
```

Compile the extension:

```bash
npm run compile
```

Open the project in VS Code and press `F5` to launch an Extension Development Host.

## Repository Goals

The project is intended to explore an iterative, user-curated diagramming workflow for large Java systems. Rather than attempting to render the entire application at once, it helps developers build an understandable structural map one class at a time.

## License

MIT
