import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { freshCards, snapshot, setStage, broadcast, startServer } from "./server.mjs";

async function fixture(t, callBridge) {
    const inst = { cards: freshCards(), clients: new Set() };
    const { server, url } = await startServer(inst, { callBridge });
    t.after(async () => {
        for (const res of inst.clients) res.end();
        const closed = new Promise((resolve) => server.close(resolve));
        server.closeAllConnections();
        await closed;
    });
    const post = (path, body = {}) => fetch(new URL(path, url), {
        method: "POST", body: JSON.stringify(body),
    });
    return { inst, url, post };
}

test("serves the identical canvas UI with exactly eight screens", async (t) => {
    const { url } = await fixture(t);
    const response = await fetch(url);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.equal(html, await readFile(new URL("./index.html", import.meta.url), "utf8"));
    assert.equal([...html.matchAll(/<section class="screen">/g)].length, 8);
    assert.match(html, /aria-live="polite"[\s\S]*id="progressFill"/);
    assert.match(html, /prefers-reduced-motion:\s*reduce/);
    assert.match(html, /value="local-llama"/);
    assert.match(html, /models\.local_llama/);
    assert.equal((await fetch(new URL("/missing", url))).status, 404);
});

test("card reveal, reset, SSE updates, and canvas actions share state", async (t) => {
    const { inst, url, post } = await fixture(t);
    const controller = new AbortController();
    t.after(() => controller.abort());
    const events = await fetch(new URL("/events", url), { signal: controller.signal });
    const reader = events.body.getReader();
    const nextEvent = async () => {
        const { value } = await reader.read();
        return JSON.parse(new TextDecoder().decode(value).trim().slice(6));
    };
    assert.equal((await nextEvent()).cards.length, 6);
    let state = await (await post("/api/advance/llm")).json();
    assert.equal(state.cards[0].stage, 1);
    assert.ok(state.cards[0].scrambled.length > 0);
    assert.equal((await nextEvent()).cards[0].stage, 1);
    setStage(inst, "llm", 2);
    broadcast(inst);
    assert.equal((await nextEvent()).cards[0].stage, 2);
    assert.equal(snapshot(inst).cards[0].stage, 2);
    state = await (await post("/api/advance/llm")).json();
    assert.equal(state.cards[0].stage, 0);
    state = await (await post("/api/reset")).json();
    assert.ok(state.cards.every((card) => card.stage === 0));
    assert.equal((await post("/api/advance/missing")).status, 404);
    controller.abort();
});

test("serves all existing code snippets, tool bindings, and skill source", async (t) => {
    const { url } = await fixture(t);
    for (const model of ["local", "local-llama", "foundry", "stateless", "session",
        "memory-llama-stateless", "memory-llama-session",
        "memory-foundry-stateless", "memory-foundry-session", "longterm",
        "calculator", "tools-local", "tools-foundry", "incident-skill"]) {
        const response = await fetch(new URL(`/api/snippet?model=${model}`, url));
        assert.equal(response.status, 200, model);
        const code = await response.text();
        assert.ok(code.length > 100, model);
        if (["local", "local-llama", "foundry", "stateless", "session",
            "memory-llama-stateless", "memory-llama-session",
            "memory-foundry-stateless", "memory-foundry-session"].includes(model)) {
            assert.match(code, /Shared instructions from maf\/chat_instructions\.py/);
            assert.match(code, /one short paragraph/);
        }
    }
    for (const model of ["calculator", "tools-local", "tools-foundry"]) {
        for (const section of ["binding", "definition"]) {
            const response = await fetch(new URL(`/api/snippet?model=${model}&section=${section}`, url));
            assert.equal(response.status, 200);
            assert.match(await response.text(), /calculator/);
        }
    }
});

test("forwards chat streams, tool events, models, memory, and reset requests", async (t) => {
    const calls = [];
    const callBridge = async (req, onDelta = () => {}, onTool = () => {}) => {
        calls.push(req);
        if (req.type === "models") onDelta(JSON.stringify({
            local: "test-local", local_llama: "test-llama",
            foundry: "test-cloud", tools: "test-tools",
        }));
        else if (req.type === "memory") onDelta('{"favourite_colour":"blue"}');
        else if (req.type === "chat" || req.type === "skill_chat") {
            onDelta("Hello ");
            onTool({ type: "test-event" });
            onDelta("world");
        }
    };
    const { url, post } = await fixture(t, callBridge);
    const models = await (await fetch(new URL("/api/models", url))).json();
    assert.equal(models.local, "test-local");
    assert.equal(models.local_llama, "test-llama");
    assert.equal(await (await post("/api/chat", { model: "local", message: "Hi" })).text(), "Hello world");
    for (const model of ["local-llama", "memory-llama-stateless", "memory-llama-session"]) {
        assert.equal(await (await post("/api/chat", { model, message: "Hi" })).text(), "Hello world");
        assert.equal((await (await post("/api/chat/reset", { model })).json()).ok, true);
        assert.ok(calls.some((req) => req.type === "chat" && req.model === model));
        assert.ok(calls.some((req) => req.type === "reset" && req.model === model));
    }
    for (const model of ["memory-foundry-stateless", "memory-foundry-session"]) {
        assert.equal(await (await post("/api/chat", { model, message: "Wo wohne ich?" })).text(), "Hello world");
        assert.equal((await (await post("/api/chat/reset", { model })).json()).ok, true);
        assert.ok(calls.some((req) => req.type === "chat" && req.model === model));
        assert.ok(calls.some((req) => req.type === "reset" && req.model === model));
    }
    for (const [path, body] of [
        ["/api/tools/chat", { model: "tools-local", message: "2 + 2" }],
        ["/api/tools/chat", { model: "tools-foundry", message: "Search" }],
        ["/api/skills/chat", { mode: "skill", message: "Incident" }],
        ["/api/skills/chat", { mode: "baseline", message: "Incident" }],
    ]) {
        const response = await post(path, body);
        assert.match(response.headers.get("content-type"), /ndjson/);
        const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line));
        assert.deepEqual(events, [
            { text: "Hello " }, { tool_event: { type: "test-event" } },
            { text: "world" }, { done: true },
        ]);
    }
    assert.deepEqual(await (await post("/api/memory", { action: "read" })).json(), { favourite_colour: "blue" });
    assert.deepEqual(await (await post("/api/memory", { action: "forget" })).json(), { favourite_colour: null });
    assert.equal((await (await post("/api/chat/reset", { model: "session" })).json()).ok, true);
    assert.equal((await (await post("/api/skills/reset", { mode: "baseline" })).json()).ok, true);
    assert.ok(calls.some((req) => req.type === "forget" && req.model === "longterm"));
    assert.ok(calls.some((req) => req.type === "skill_reset" && req.mode === "baseline"));
});

test("surfaces bridge failures and rejects invalid and cross-origin requests", async (t) => {
    const { url, post } = await fixture(t, async () => "Demo backend unavailable");
    const models = await fetch(new URL("/api/models", url));
    assert.equal(models.status, 500);
    assert.equal((await models.json()).error, "Demo backend unavailable");
    assert.match(await (await post("/api/chat", { model: "local", message: "Hi" })).text(), /Demo backend unavailable/);
    assert.deepEqual(await (await post("/api/chat/reset", { model: "local" })).json(),
        { ok: false, error: "Demo backend unavailable" });
    const events = await (await post("/api/skills/chat", { mode: "skill", message: "Hi" })).text();
    assert.deepEqual(JSON.parse(events), { error: "Demo backend unavailable" });
    for (const [path, body] of [
        ["/api/tools/chat", { model: "invalid", message: "Hi" }],
        ["/api/tools/chat", { model: "calculator", message: "" }],
        ["/api/skills/chat", { mode: "invalid", message: "Hi" }],
        ["/api/skills/reset", { mode: "invalid" }],
    ]) assert.equal((await post(path, body)).status, 400);
    assert.equal((await fetch(new URL("/api/reset", url), {
        method: "POST", headers: { Origin: "https://example.com" },
    })).status, 403);
});

test("standalone launcher starts without Copilot and reports missing Python explicitly", async (t) => {
    const child = spawn(process.execPath, ["app.mjs"], {
        cwd: new URL(".", import.meta.url),
        env: { ...process.env, PORT: "0", PYTHON_EXECUTABLE: "missing-demo-python-executable" },
        stdio: ["ignore", "pipe", "pipe"],
    });
    t.after(() => child.kill());
    child.stderr.resume();
    let output = "";
    const url = await new Promise((resolve, reject) => {
        child.on("error", reject);
        child.on("exit", (code) => reject(new Error(`App exited before startup: ${code}`)));
        child.stdout.on("data", (chunk) => {
            output += chunk;
            const match = output.match(/http:\/\/127\.0\.0\.1:\d+\//);
            if (match) resolve(match[0]);
        });
    });
    assert.equal((await fetch(url)).status, 200);
    const response = await fetch(new URL("/api/models", url));
    assert.equal(response.status, 500);
    assert.match((await response.json()).error, /Python bridge stopped/);
});

test("standalone launcher rejects invalid ports", async () => {
    const child = spawn(process.execPath, ["app.mjs"], {
        cwd: new URL(".", import.meta.url), env: { ...process.env, PORT: "invalid" },
    });
    let error = "";
    child.stderr.on("data", (chunk) => { error += chunk; });
    const [code] = await once(child, "exit");
    assert.equal(code, 1);
    assert.match(error, /PORT must be an integer/);
});
