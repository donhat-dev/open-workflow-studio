/** @odoo-module **/

/**
 * Runs a stress test by generating a grid of nodes and connections.
 * Can be run from the browser console via: 
 * odoo.loader.modules.get('workflow_studio.benchmark').runStressTest(window.canvas.props.nodes, window.canvas.props.connections)
 * (Note: requires access to the adapter instance or mimicking addNode calls if interacting with UI directly)
 * 
 * Ideally used within DevDemoApp.
 * 
 * @param {Object} adapter - The WorkflowAdapter instance
 * @param {number} count - Number of nodes to generate (default 200)
 */
export async function runStressTest(adapter, count = 200) {
    console.log(`[Benchmark] Starting stress test with ${count} nodes...`);
    console.time('StressTest:Generation');

    // Clear existing
    adapter.clear();

    const cols = 20; // Wide grid
    const spacingX = 250;
    const spacingY = 150;

    const nodes = [];

    // 1. Generate Data
    for (let i = 0; i < count; i++) {
        const row = Math.floor(i / cols);
        const col = i % cols;

        // Use 'http' (the actual nodeType from HttpRequestNode)
        // Avoid 'loop' or 'if' which might have special behaviors
        const type = 'http';

        nodes.push({
            type,
            position: {
                x: col * spacingX,
                y: row * spacingY,
            },
            config: {
                // Large dummy payload to test memory/reactivity overhead
                url: `https://api.example.com/v1/resource/${i}`,
                method: 'POST',
                headers: Array(10).fill(0).map((_, j) => ({ key: `Header-${j}`, value: `Value-${j}` })),
                body: JSON.stringify(Array(50).fill({ id: i, name: 'Sample Item' }))
            }
        });
    }

    // 2. Add to Adapter (Batch if possible, otherwise loop)
    // We'll loop for now as we don't have a bulk add API yet
    let paramsNodeId = null;

    nodes.forEach((n, index) => {
        const node = adapter.addNode(n.type, n.position);
        if (node && n.config) {
            // If node supports setConfig
            if (node.setConfig) {
                node.setConfig(n.config);
            }
        }

        // Create random connections (chaining neighbors)
        // Connect to previous node in row
        if (node && index > 0 && index % cols !== 0) {
            const allNodes = adapter.getNodesForUI();
            const prevNodeId = allNodes[index - 1]?.id;
            // HttpRequestNode: 'response' output -> 'data' input
            if (prevNodeId) {
                try {
                    adapter.addConnection(prevNodeId, 'response', node.id, 'data');
                } catch (e) { /* ignore invalid connection attempts in bench */ }
            }
        }
    });

    console.timeEnd('StressTest:Generation');

    // 3. Force Layout / Wait for Render
    await new Promise(r => requestAnimationFrame(r));
    await new Promise(r => setTimeout(r, 100)); // Allow Vue/OWL to settle

    console.log(`[Benchmark] Generation complete.`);
    console.log(`[Benchmark] Current Nodes: ${adapter.getNodesForUI().length}`);
    console.log(`[Benchmark] Current Connections: ${adapter.getConnectionsForUI().length}`);
    console.log(`[Benchmark] INSTRUCTIONS: Try dragging the canvas or nodes now to feel FPS.`);
}
