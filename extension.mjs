// Extension: agents-under-the-hood
// Guided showcase of how AI agents work under the hood.
// index.html is re-read on every request, so UI edits only need a canvas re-open.

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { joinSession, createCanvas, CanvasError } from "@github/copilot-sdk/extension";
import { COMPONENTS, scramble } from "./components.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const instances = new Map(); // instanceId -> { server, url, cards: Map<id,{stage,scrambled}>, clients:Set }

// Python MAF bridge: one long-lived process, JSON lines over stdio.
const PYTHON = join(HERE, ".venv", "Scripts", "python.exe");
let bridge = null;
let nextId = 1;
const pending = new Map(); // id -> { onDelta, resolve }

function getBridge() {
    if (bridge) return bridge;
    bridge = spawn(PYTHON, ["bridge.py"], { cwd: join(HERE, "maf"), stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let buf = "";
    bridge.stdout.setEncoding("utf8");
    bridge.stdout.on("data", (chunk) => {
        buf += chunk;
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl);
            buf = buf.slice(nl + 1);
            if (!line.trim()) continue;
            const msg = JSON.parse(line);
            const p = pending.get(msg.id);
            if (!p) continue;
            if (msg.delta) p.onDelta(msg.delta);
            if (msg.done || msg.error) { pending.delete(msg.id); p.resolve(msg.error); }
        }
    });
    bridge.stderr.on("data", () => {});
    const fail = (err) => {
        for (const p of pending.values()) p.resolve(`Python bridge stopped: ${err}`);
        pending.clear();
        bridge = null;
    };
    bridge.on("error", (e) => fail(e.message));
    bridge.on("exit", (code) => fail(`exit code ${code}`));
    return bridge;
}

function callBridge(req, onDelta = () => {}) {
    return new Promise((resolve) => {
        const id = nextId++;
        pending.set(id, { onDelta, resolve });
        getBridge().stdin.write(JSON.stringify({ ...req, id }) + "\n");
    });
}

process.on("exit", () => bridge?.kill());

async function readJson(req) {
    let body = "";
    for await (const c of req) body += c;
    return body ? JSON.parse(body) : {};
}

const SNIPPETS = {
    local: "local_agent.py",
    foundry: "foundry_agent.py",
    stateless: "memory_stateless_agent.py",
    session: "memory_session_agent.py",
};

function freshCards() {
    return new Map(COMPONENTS.map((c) => [c.id, { stage: 0, scrambled: [] }]));
}

function snapshot(inst) {
    return {
        cards: COMPONENTS.map((c) => {
            const s = inst.cards.get(c.id);
            return { ...c, letter: c.name[0].toUpperCase(), stage: s.stage, scrambled: s.scrambled };
        }),
    };
}

function setStage(inst, id, stage) {
    const s = inst.cards.get(id);
    if (!s) throw new CanvasError("unknown_component", `Unknown component '${id}'`);
    s.stage = stage;
    if (stage === 1) s.scrambled = scramble(COMPONENTS.find((c) => c.id === id).name);
}

function broadcast(inst) {
    const data = `data: ${JSON.stringify(snapshot(inst))}\n\n`;
    for (const res of inst.clients) res.write(data);
}

function json(res, body) {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(body));
}

async function startServer(inst) {
    const server = createServer(async (req, res) => {
        try {
            const url = new URL(req.url, "http://localhost");
            if (req.method === "GET" && url.pathname === "/") {
                res.setHeader("Content-Type", "text/html; charset=utf-8");
                res.setHeader("Cache-Control", "no-store");
                return res.end(await readFile(join(HERE, "index.html"), "utf8"));
            }
            if (url.pathname === "/events") {
                res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
                res.write(`data: ${JSON.stringify(snapshot(inst))}\n\n`);
                inst.clients.add(res);
                req.on("close", () => inst.clients.delete(res));
                return;
            }
            if (req.method === "POST" && url.pathname.startsWith("/api/advance/")) {
                const id = decodeURIComponent(url.pathname.slice("/api/advance/".length));
                const s = inst.cards.get(id);
                if (!s) { res.statusCode = 404; return res.end(); }
                setStage(inst, id, (s.stage + 1) % 3);
                broadcast(inst);
                return json(res, snapshot(inst));
            }
            if (req.method === "POST" && url.pathname === "/api/reset") {
                inst.cards = freshCards();
                broadcast(inst);
                return json(res, snapshot(inst));
            }
            if (req.method === "POST" && url.pathname === "/api/chat") {
                const { model, message } = await readJson(req);
                res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
                const err = await callBridge({ type: "chat", model, message }, (t) => res.write(t));
                if (err) res.write(`\n⚠️ ${err}`);
                return res.end();
            }
            if (req.method === "POST" && url.pathname === "/api/chat/reset") {
                const { model } = await readJson(req);
                const err = await callBridge({ type: "reset", model });
                return json(res, { ok: !err, error: err });
            }
            if (req.method === "GET" && url.pathname === "/api/snippet") {
                const file = SNIPPETS[url.searchParams.get("model")];
                res.setHeader("Content-Type", "text/plain; charset=utf-8");
                if (!file) return res.end("# Microsoft Foundry snippet: coming in the next iteration.");
                return res.end(await readFile(join(HERE, "maf", file), "utf8"));
            }
            res.statusCode = 404;
            res.end();
        } catch (err) {
            res.statusCode = 500;
            res.end(String(err));
        }
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    return { server, url: `http://127.0.0.1:${server.address().port}/` };
}

function getInst(instanceId) {
    const inst = instances.get(instanceId);
    if (!inst) throw new CanvasError("not_open", `Canvas instance '${instanceId}' is not open`);
    return inst;
}

const componentIds = COMPONENTS.map((c) => c.id);

await joinSession({
    canvases: [
        createCanvas({
            id: "agents-under-the-hood",
            displayName: "Agents Under the Hood",
            description: "Interactive card screen revealing the six building blocks of AI agents (LLM, instructions & skills, memory, tools, knowledge, governance).",
            actions: [
                {
                    name: "get_state",
                    description: "Return the current reveal stage (0=letter, 1=scrambled, 2=revealed) of each card.",
                    handler: (ctx) => snapshot(getInst(ctx.instanceId)),
                },
                {
                    name: "set_stage",
                    description: "Set a card's reveal stage. Omit componentId to apply to all cards.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            componentId: { type: "string", enum: componentIds },
                            stage: { type: "integer", minimum: 0, maximum: 2 },
                        },
                        required: ["stage"],
                        additionalProperties: false,
                    },
                    handler: (ctx) => {
                        const inst = getInst(ctx.instanceId);
                        const ids = ctx.input?.componentId ? [ctx.input.componentId] : componentIds;
                        for (const id of ids) setStage(inst, id, ctx.input.stage);
                        broadcast(inst);
                        return snapshot(inst);
                    },
                },
                {
                    name: "reset",
                    description: "Reset all cards to show only their first letter.",
                    handler: (ctx) => {
                        const inst = getInst(ctx.instanceId);
                        inst.cards = freshCards();
                        broadcast(inst);
                        return snapshot(inst);
                    },
                },
            ],
            open: async (ctx) => {
                let inst = instances.get(ctx.instanceId);
                if (!inst) {
                    inst = { cards: freshCards(), clients: new Set() };
                    Object.assign(inst, await startServer(inst));
                    instances.set(ctx.instanceId, inst);
                }
                return { title: "Agents Under the Hood", url: inst.url };
            },
            onClose: async (ctx) => {
                const inst = instances.get(ctx.instanceId);
                if (!inst) return;
                instances.delete(ctx.instanceId);
                for (const res of inst.clients) res.end();
                await new Promise((r) => inst.server.close(() => r()));
            },
        }),
    ],
});
