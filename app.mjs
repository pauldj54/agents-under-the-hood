import { freshCards, startServer, stopBridge } from "./server.mjs";

const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error("PORT must be an integer from 0 to 65535 (0 chooses an available port).");
    process.exitCode = 1;
} else {
    try {
        const inst = { cards: freshCards(), clients: new Set() };
        const { server, url } = await startServer(inst, { port });
        console.log(`Agents Under the Hood: ${url}\nEight screens. Press Ctrl+C to stop.`);
        let stopping = false;
        const stop = () => {
            if (stopping) return;
            stopping = true;
            for (const res of inst.clients) res.end();
            stopBridge();
            server.close();
            server.closeAllConnections();
        };
        process.on("SIGINT", stop);
        process.on("SIGTERM", stop);
    } catch (err) {
        console.error(`Cannot start local app: ${err.message}`);
        process.exitCode = 1;
    }
}
