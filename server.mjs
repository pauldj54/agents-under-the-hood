import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { COMPONENTS, scramble } from "./components.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
// Python MAF bridge: one long-lived process, JSON lines over stdio.
const PYTHON = process.env.PYTHON_EXECUTABLE || join(
    HERE, ".venv", process.platform === "win32" ? "Scripts" : "bin",
    process.platform === "win32" ? "python.exe" : "python",
);
let bridge = null;
let nextId = 1;
const pending = new Map(); // id -> { onDelta, resolve }

function getBridge() {
    if (bridge) return bridge;
    const child = spawn(PYTHON, ["bridge.py"], { cwd: join(HERE, "maf"), stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    bridge = child;
    const fail = (err) => {
        if (bridge !== child) return;
        for (const p of pending.values()) p.resolve(`Python bridge stopped: ${err}`);
        pending.clear();
        bridge = null;
    };
    let buf = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
        buf += chunk;
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl);
            buf = buf.slice(nl + 1);
            if (!line.trim()) continue;
            let msg;
            try {
                msg = JSON.parse(line);
            } catch (err) {
                fail(`Invalid bridge response: ${err.message}`);
                child.kill();
                return;
            }
            const p = pending.get(msg.id);
            if (!p) continue;
            if (msg.delta) p.onDelta(msg.delta);
            if (msg.tool_event) p.onTool(msg.tool_event);
            if (msg.done || msg.error) { pending.delete(msg.id); p.resolve(msg.error); }
        }
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (text) => {
        stderr = (stderr + text).slice(-4096);
        process.stderr.write(text);
    });
    child.stdin.on("error", (err) => fail(err.message));
    child.on("error", (err) => fail(`${err.message}. Install Python dependencies; see README.md.`));
    child.on("exit", (code) => fail(`exit code ${code}${stderr ? `: ${stderr.trim()}` : ""}`));
    return child;
}

function defaultCallBridge(req, onDelta = () => {}, onTool = () => {}) {
    return new Promise((resolve) => {
        const id = nextId++;
        pending.set(id, { onDelta, onTool, resolve });
        getBridge().stdin.write(JSON.stringify({ ...req, id }) + "\n", (err) => {
            if (!err) return;
            pending.delete(id);
            resolve(`Python bridge write failed: ${err.message}`);
        });
    });
}

export function stopBridge() {
    bridge?.kill();
}

process.on("exit", stopBridge);

async function readJson(req) {
    let body = "";
    for await (const c of req) body += c;
    return body ? JSON.parse(body) : {};
}

const SNIPPETS = {
    local: "local_agent.py",
    "local-llama": "local_llama_agent.py",
    foundry: "foundry_agent.py",
    stateless: "memory_stateless_agent.py",
    session: "memory_session_agent.py",
    "memory-llama-stateless": "memory_llama_stateless_agent.py",
    "memory-llama-session": "memory_llama_session_agent.py",
    "memory-foundry-stateless": "memory_foundry_stateless_agent.py",
    "memory-foundry-session": "memory_foundry_session_agent.py",
    longterm: "memory_long_term_agent.py",
    calculator: "calculator_agent.py",
    "tools-local": "calculator_agent.py",
    "tools-foundry": "foundry_tools_agent.py",
};

export function freshCards() {
    return new Map(COMPONENTS.map((c) => [c.id, { stage: 0, scrambled: [] }]));
}

export function snapshot(inst) {
    return {
        cards: COMPONENTS.map((c) => {
            const s = inst.cards.get(c.id);
            return { ...c, letter: c.name[0].toUpperCase(), stage: s.stage, scrambled: s.scrambled };
        }),
    };
}

export function setStage(inst, id, stage) {
    const s = inst.cards.get(id);
    if (!s) throw new Error(`Unknown component '${id}'`);
    s.stage = stage;
    if (stage === 1) s.scrambled = scramble(COMPONENTS.find((c) => c.id === id).name);
}

export function broadcast(inst) {
    const data = `data: ${JSON.stringify(snapshot(inst))}\n\n`;
    for (const res of inst.clients) res.write(data);
}

function json(res, body) {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(body));
}

export async function startServer(inst, { port = 0, callBridge = defaultCallBridge } = {}) {
    const server = createServer(async (req, res) => {
        try {
            const url = new URL(req.url, "http://localhost");
            // Local demos can invoke cloud tools: reject requests from other websites.
            if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) {
                res.statusCode = 403;
                return json(res, { error: "Cross-origin requests are not allowed." });
            }
            if (req.method === "GET" && url.pathname === "/") {
                res.setHeader("Content-Type", "text/html; charset=utf-8");
                res.setHeader("Cache-Control", "no-store");
                return res.end(await readFile(join(HERE, "index.html"), "utf8"));
            }
            if (req.method === "GET" && url.pathname === "/events") {
                res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
                res.write(`data: ${JSON.stringify(snapshot(inst))}\n\n`);
                inst.clients.add(res);
                res.on("close", () => inst.clients.delete(res));
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
            if (req.method === "POST" && url.pathname === "/api/tools/chat") {
                const { message, model = "calculator" } = await readJson(req);
                if (!["calculator", "tools-local", "tools-foundry"].includes(model)) {
                    res.statusCode = 400;
                    return json(res, { error: "Select a valid tools runtime." });
                }
                if (typeof message !== "string" || !message.trim()) {
                    res.statusCode = 400;
                    return json(res, { error: "A message is required." });
                }
                res.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" });
                const emit = (event) => res.write(JSON.stringify(event) + "\n");
                const err = await callBridge({ type: "chat", model, message },
                    (text) => emit({ text }), (event) => emit({ tool_event: event }));
                emit(err ? { error: err } : { done: true });
                return res.end();
            }
            if (req.method === "POST" && url.pathname === "/api/skills/chat") {
                const { message, mode } = await readJson(req);
                if (!["skill", "baseline"].includes(mode)) {
                    res.statusCode = 400;
                    return json(res, { error: "Select a valid incident demo mode." });
                }
                if (typeof message !== "string" || !message.trim()) {
                    res.statusCode = 400;
                    return json(res, { error: "A message is required." });
                }
                res.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" });
                const emit = (event) => res.write(JSON.stringify(event) + "\n");
                const err = await callBridge(
                    { type: "skill_chat", mode, message },
                    (text) => emit({ text }),
                    (event) => emit({ tool_event: event }),
                );
                emit(err ? { error: err } : { done: true });
                return res.end();
            }
            if (req.method === "POST" && url.pathname === "/api/skills/reset") {
                const { mode } = await readJson(req);
                if (!["skill", "baseline"].includes(mode)) {
                    res.statusCode = 400;
                    return json(res, { error: "Select a valid incident demo mode." });
                }
                const err = await callBridge({ type: "skill_reset", mode });
                return json(res, { ok: !err, error: err });
            }
            if (req.method === "POST" && url.pathname === "/api/chat/reset") {
                const { model } = await readJson(req);
                const err = await callBridge({ type: "reset", model });
                return json(res, { ok: !err, error: err });
            }
            if (req.method === "GET" && url.pathname === "/api/models") {
                let text = "";
                const err = await callBridge({ type: "models" }, (t) => (text += t));
                if (err) {
                    res.statusCode = 500;
                    return json(res, { error: err });
                }
                res.setHeader("Cache-Control", "no-store");
                return json(res, JSON.parse(text));
            }
            if (req.method === "POST" && url.pathname === "/api/memory") {
                const { action } = await readJson(req);
                let text = "";
                const err = await callBridge({ type: action === "forget" ? "forget" : "memory", model: "longterm" }, (t) => (text += t));
                if (err) return json(res, { error: err });
                if (action === "forget") return json(res, { favourite_colour: null });
                return json(res, JSON.parse(text));
            }
            if (req.method === "GET" && url.pathname === "/api/snippet") {
                if (url.searchParams.get("model") === "incident-skill") {
                    const code = await readFile(join(HERE, ".github", "skills", "incident-triage", "SKILL.md"), "utf8");
                    res.setHeader("Content-Type", "text/plain; charset=utf-8");
                    return res.end(code);
                }
                const file = SNIPPETS[url.searchParams.get("model")];
                res.setHeader("Content-Type", "text/plain; charset=utf-8");
                if (!file) return res.end("# Microsoft Foundry snippet: coming in the next iteration.");
                const code = await readFile(join(HERE, "maf", file), "utf8");
                const section = url.searchParams.get("section");
                if (url.searchParams.get("model") === "tools-foundry" && ["binding", "definition"].includes(section)) {
                    const start = code.indexOf("def prompt_definition(");
                    const end = code.indexOf("\nagent:", start);
                    if (start < 0 || end < 0) throw new Error("Foundry tool binding snippet was not found.");
                    if (section === "binding") return res.end(code.slice(start, end).trim());
                    const calculator = await readFile(join(HERE, "maf", "calculator_agent.py"), "utf8");
                    return res.end(
                        "# Web search is a hosted Foundry tool; there is no local search function.\n"
                        + code.slice(start, code.indexOf("\ndef create_agent(", start)).trim()
                        + "\n\n# Calculator implementation runs locally:\n"
                        + calculator.slice(calculator.indexOf("def calculate("), calculator.indexOf("\nagent = Agent(")).trim()
                    );
                }
                if (["calculator", "tools-local"].includes(url.searchParams.get("model")) && ["binding", "definition"].includes(section)) {
                    const start = code.indexOf(section === "binding" ? "agent = Agent(" : "def calculate(");
                    const end = code.indexOf(section === "binding" ? "\nsession =" : "\nagent = Agent(", start);
                    if (start < 0 || end < 0) throw new Error(`Calculator ${section} snippet was not found.`);
                    return res.end(code.slice(start, end).trim());
                }
                const sharedInstructions = [
                    "local", "local-llama", "foundry", "stateless", "session",
                    "memory-llama-stateless", "memory-llama-session",
                    "memory-foundry-stateless", "memory-foundry-session",
                ].includes(url.searchParams.get("model"));
                return res.end(sharedInstructions
                    ? code + "\n\n# Shared instructions from maf/chat_instructions.py:\n"
                        + await readFile(join(HERE, "maf", "chat_instructions.py"), "utf8")
                    : code);
            }
            res.statusCode = 404;
            res.end();
        } catch (err) {
            console.error(err);
            if (!res.headersSent) {
                res.statusCode = err instanceof SyntaxError ? 400 : 500;
                return json(res, { error: err.message });
            }
            res.end(`\n${err.message}`);
        }
    });
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", resolve);
    });
    return { server, url: `http://127.0.0.1:${server.address().port}/` };
}
