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

1. Open a Java workspace in VS Code.
2. Open a Java file for the class you want to inspect.
3. Run **Java Structure Analyser: Open Graph** from the Command Palette or the Java editor title menu.
4. The selected class appears as the central node.
5. Nearby incoming and outgoing classes are rendered as temporary nodes.
6. Double-click relevant nodes to pin them permanently.
7. Move through the codebase and repeat until the diagram represents the structure you care about.

## Current Analysis Scope

The current implementation uses lightweight static parsing to identify common Java relationships:

- `new ClassName(...)` instantiations
- field declarations
- constructor and method parameters
- local variable declarations
- imports
- static method calls
- method calls on variables with known local or parameter types

This makes the extension fast and dependency-light, while leaving room for future integration with richer Java language-server metadata.

## Requirements

- Visual Studio Code `1.95.0` or newer.
- A workspace containing Java source files.
- Node.js and npm for development or packaging from source.

## Install from a VSIX Package

After a `.vsix` file has been built, install it in one of these ways:

### VS Code UI

1. Open the Extensions view.
2. Select **...** → **Install from VSIX...**.
3. Choose the generated file, for example `java-structure-analyser-0.1.0.vsix`.

### Command Line

```bash
code --install-extension java-structure-analyser-0.1.0.vsix
```

## Development

Install dependencies:

```bash
npm install
```

Run tests with Node.js' built-in test runner. The test command compiles the TypeScript sources first and then runs the JavaScript tests against `dist/`:

```bash
npm test
```

The project intentionally avoids a separate test framework such as Vite/Vitest to keep the dependency tree small.

Compile the extension:

```bash
npm run compile
```

Run TypeScript type checking without emitting files:

```bash
npm run lint
```

Open the project in VS Code and press `F5` to launch an Extension Development Host.

This repository keeps development dependencies intentionally small. The direct development dependencies are limited to TypeScript, VS Code API type definitions, and `@vscode/vsce` for packaging.

## Build a VSIX Package

This repository includes `@vscode/vsce` as a development dependency and exposes an npm script for packaging.

Build the extension package:

```bash
npm run package
```

The package command runs the VS Code prepublish step first, so the TypeScript sources are compiled into `dist/` before the `.vsix` file is created.

Expected output artifact:

```text
java-structure-analyser-0.1.0.vsix
```

Before publishing or sharing a package, it is recommended to run the full local verification set:

```bash
npm test
npm run lint
npm run compile
npm run package
```

## Repository Goals

The project is intended to explore an iterative, user-curated diagramming workflow for large Java systems. Rather than attempting to render the entire application at once, it helps developers build an understandable structural map one class at a time.

## License

MIT
