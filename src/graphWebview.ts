import type { StructureGraph } from './javaAnalyzer';

export function getGraphWebviewHtml(graph: StructureGraph | undefined, nonce: string): string {
  const graphJson = JSON.stringify(graph ?? null).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>Java Structure Analyser</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: var(--vscode-editor-background);
      --fg: var(--vscode-editor-foreground);
      --muted: var(--vscode-descriptionForeground);
      --accent: var(--vscode-focusBorder);
      --temp: var(--vscode-charts-yellow);
      --incoming: var(--vscode-charts-blue);
      --outgoing: var(--vscode-charts-green);
      --open: var(--vscode-charts-orange);
      --pinned: var(--vscode-charts-purple);
    }
    body {
      margin: 0;
      font-family: var(--vscode-font-family);
      background: var(--bg);
      color: var(--fg);
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      padding: 0.9rem 1rem;
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    h1 {
      margin: 0;
      font-size: 1.1rem;
      font-weight: 600;
    }
    .hint {
      color: var(--muted);
      font-size: 0.85rem;
    }
    #graph-root {
      width: 100vw;
      height: calc(100vh - 58px);
      overflow: auto;
    }
    svg {
      min-width: 960px;
      min-height: 640px;
    }
    .node rect {
      fill: var(--vscode-editorWidget-background);
      stroke-width: 2;
      rx: 14;
      ry: 14;
      filter: drop-shadow(0 2px 4px rgba(0,0,0,0.18));
    }
    .node.selected rect { stroke: var(--accent); fill: var(--vscode-button-secondaryBackground); }
    .node.incoming rect { stroke: var(--incoming); }
    .node.outgoing rect { stroke: var(--outgoing); }
    .node.open rect { stroke: var(--open); }
    .node.pinned rect { stroke: var(--pinned); }
    .node.temporary rect { stroke-dasharray: 6 4; opacity: 0.78; }
    .node text { fill: var(--fg); font-weight: 600; pointer-events: none; }
    .node .meta { fill: var(--muted); font-size: 11px; font-weight: 400; }
    .edge { stroke: var(--muted); stroke-width: 1.8; fill: none; marker-end: url(#arrow); }
    .edge.temporary { stroke-dasharray: 5 5; opacity: 0.7; }
    .edge-label { fill: var(--muted); font-size: 11px; }
    .empty { padding: 2rem; max-width: 760px; line-height: 1.5; }
    .legend { display: flex; flex-wrap: wrap; gap: 0.8rem; padding: 0.7rem 1rem 0; color: var(--muted); font-size: 0.8rem; }
    .swatch { display: inline-block; width: 0.8rem; height: 0.8rem; border-radius: 0.2rem; margin-right: 0.3rem; vertical-align: -0.1rem; }
  </style>
</head>
<body>
  <header>
    <h1>Java Structure Analyser</h1>
    <div class="hint">Double-click a node to pin it permanently in the diagram.</div>
  </header>
  <div class="legend">
    <span><span class="swatch" style="background: var(--accent)"></span>Selected class</span>
    <span><span class="swatch" style="background: var(--incoming)"></span>Incoming creators/users</span>
    <span><span class="swatch" style="background: var(--outgoing)"></span>Outgoing dependencies</span>
    <span><span class="swatch" style="background: var(--open)"></span>Open Java editor tabs</span>
    <span><span class="swatch" style="background: var(--pinned)"></span>Pinned</span>
  </div>
  <main id="graph-root"></main>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const graph = ${graphJson};
    const root = document.getElementById('graph-root');

    if (!graph) {
      root.innerHTML = '<section class="empty"><h2>No open Java editor tabs</h2><p>Open one or more Java files and run <strong>Java Structure Analyser: Open Graph</strong> again. The graph stays available while you interact with it and shows the Java files currently open as editor tabs.</p></section>';
    } else {
      renderGraph(graph);
    }

    function renderGraph(graph) {
      const width = Math.max(960, 360 + graph.nodes.length * 150);
      const height = Math.max(640, 260 + graph.nodes.length * 72);
      const layout = layoutGraph(graph, width, height);
      const edgeMarkup = graph.edges.map((edge) => renderEdge(edge, layout)).join('');
      const nodeMarkup = graph.nodes.map((node) => renderNode(node, layout[node.id])).join('');

      root.innerHTML = '<svg viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="Java structure graph">'
        + '<defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,6 L9,3 z" fill="currentColor"></path></marker></defs>'
        + edgeMarkup + nodeMarkup + '</svg>';

      root.querySelectorAll('[data-node-id]').forEach((element) => {
        element.addEventListener('dblclick', () => {
          vscode.postMessage({ type: 'pinNode', nodeId: element.getAttribute('data-node-id') });
        });
      });
    }

    function layoutGraph(graph, width, height) {
      const positions = {};
      const selected = graph.nodes.find((node) => node.kind === 'selected') || graph.nodes[0];
      const incoming = graph.nodes.filter((node) => node.kind === 'incoming');
      const outgoing = graph.nodes.filter((node) => node.kind === 'outgoing');
      const open = graph.nodes.filter((node) => node.kind === 'open');
      const pinned = graph.nodes.filter((node) => node.kind === 'pinned');
      const centerY = height / 2;

      if (selected) positions[selected.id] = { x: width / 2 - 95, y: centerY - 35 };
      placeColumn(incoming, 110, centerY, positions);
      placeColumn(outgoing, width - 300, centerY, positions);
      placeRow(open, width / 2, height - 130, positions);
      placeRow(pinned, width / 2, 110, positions);
      return positions;
    }

    function placeColumn(nodes, x, centerY, positions) {
      const gap = 98;
      const start = centerY - ((nodes.length - 1) * gap) / 2;
      nodes.forEach((node, index) => { positions[node.id] = { x, y: start + index * gap }; });
    }

    function placeRow(nodes, centerX, y, positions) {
      const gap = 230;
      const start = centerX - 95 - ((nodes.length - 1) * gap) / 2;
      nodes.forEach((node, index) => { positions[node.id] = { x: start + index * gap, y }; });
    }

    function renderNode(node, position) {
      const p = position || { x: 40, y: 40 };
      const css = ['node', node.kind, node.temporary ? 'temporary' : 'permanent'].join(' ');
      const meta = getNodeMeta(node);
      return '<g class="' + css + '" data-node-id="' + escapeAttr(node.id) + '" tabindex="0">'
        + '<rect x="' + p.x + '" y="' + p.y + '" width="190" height="70"></rect>'
        + '<text x="' + (p.x + 95) + '" y="' + (p.y + 34) + '" text-anchor="middle">' + escapeHtml(node.label) + '</text>'
        + '<text class="meta" x="' + (p.x + 95) + '" y="' + (p.y + 53) + '" text-anchor="middle">' + meta + '</text>'
        + '</g>';
    }

    function renderEdge(edge, layout) {
      const from = layout[edge.from];
      const to = layout[edge.to];
      if (!from || !to) return '';
      const x1 = from.x + 190;
      const y1 = from.y + 35;
      const x2 = to.x;
      const y2 = to.y + 35;
      const midX = (x1 + x2) / 2;
      const midY = (y1 + y2) / 2;
      const curve = 'M ' + x1 + ' ' + y1 + ' C ' + midX + ' ' + y1 + ', ' + midX + ' ' + y2 + ', ' + x2 + ' ' + y2;
      const css = edge.temporary ? 'edge temporary' : 'edge permanent';
      return '<path class="' + css + '" d="' + curve + '"></path>'
        + '<text class="edge-label" x="' + midX + '" y="' + (midY - 8) + '" text-anchor="middle">' + escapeHtml(edge.reasons.join(', ')) + '</text>';
    }

    function getNodeMeta(node) {
      if (node.kind === 'selected') return 'Current editor';
      if (node.pinned) return 'Pinned';
      if (node.kind === 'open') return 'Open editor';
      return node.temporary ? 'Temporary' : 'Open editor';
    }

    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    }

    function escapeAttr(value) {
      return escapeHtml(value).replace(new RegExp(String.fromCharCode(96), 'g'), '&#96;');
    }
  </script>
</body>
</html>`;
}
