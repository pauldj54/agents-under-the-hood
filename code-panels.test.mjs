import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { freshCards, startServer } from "./server.mjs";

const browser = process.env.TEST_BROWSER_PATH || [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].find(existsSync);

test("each code-rendering path enables the shared fullscreen controls", async () => {
    const html = await readFile(new URL("./index.html", import.meta.url), "utf8");
    assert.match(html, /<dialog class="code-fullscreen"[^>]+aria-label=/);
    for (const root of ['\\$\\("hood"\\)', "hood", "trace", "target"]) {
        assert.match(html, new RegExp(`enhanceCodePanels\\(${root}\\)`));
    }
});

test("code panels fill the viewport and restore via X and Esc across screens and themes", {
    skip: !browser && "Set TEST_BROWSER_PATH to a Chromium-based browser to run UI checks.",
    timeout: 60000,
}, async (t) => {
    const inst = { cards: freshCards(), clients: new Set() };
    const { server, url } = await startServer(inst, {
        callBridge: async (request, onDelta) => {
            if (request.type === "models") {
                onDelta(JSON.stringify({
                    local: "phi3:3.8b", local_llama: "llama3.2:1b",
                    foundry: "test-foundry", memory_foundry: "test-memory", tools: "llama3.2:1b",
                }));
            } else if (request.type === "memory") {
                onDelta('{"favourite_colour":null}');
            }
        },
    });
    t.after(async () => {
        for (const response of inst.clients) response.end();
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
    });

    const profile = await mkdtemp(join(tmpdir(), "agents-code-panels-"));
    const child = spawn(browser, [
        "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
        "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank",
    ], { stdio: ["ignore", "ignore", "pipe"] });
    const exited = once(child, "exit");
    let cdp;
    t.after(async () => {
        if (child.exitCode === null) {
            if (cdp) await cdp.send("Browser.close").catch(() => {});
            else child.kill();
            await exited;
        }
        cdp?.close();
        await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    });
    const endpoint = await new Promise((resolve, reject) => {
        let output = "";
        child.on("error", reject);
        child.on("exit", () => reject(new Error(`Browser exited before startup: ${output}`)));
        child.stderr.on("data", (chunk) => {
            output += chunk;
            const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
            if (match) resolve(match[1]);
        });
    });
    const targets = await (await fetch(new URL("/json/list", endpoint.replace("ws:", "http:")))).json();
    const socket = new WebSocket(targets.find((target) => target.type === "page").webSocketDebuggerUrl);
    await once(socket, "open");
    let nextId = 0;
    const pending = new Map();
    socket.addEventListener("message", ({ data }) => {
        const message = JSON.parse(data);
        const request = pending.get(message.id);
        if (!request) return;
        pending.delete(message.id);
        if (message.error) request.reject(new Error(message.error.message));
        else request.resolve(message.result);
    });
    cdp = {
        send: (method, params = {}) => new Promise((resolve, reject) => {
            const id = ++nextId;
            pending.set(id, { resolve, reject });
            socket.send(JSON.stringify({ id, method, params }));
        }),
        close: () => socket.close(),
    };
    const evaluate = async (fn, ...args) => {
        const result = await cdp.send("Runtime.evaluate", {
            expression: `(${fn})(${args.map((arg) => JSON.stringify(arg)).join(",")})`,
            awaitPromise: true, returnByValue: true,
        });
        if (result.exceptionDetails) {
            throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
        }
        return result.result.value;
    };
    await cdp.send("Page.navigate", { url });
    await evaluate(async () => {
        while (typeof enhanceCodePanels !== "function" || typeof show !== "function") {
            await new Promise((resolve) => setTimeout(resolve, 20));
        }
    });

    for (const [width, height] of [[1280, 900], [390, 844]]) {
        await cdp.send("Emulation.setDeviceMetricsOverride", {
            width, height, deviceScaleFactor: 1, mobile: false,
        });
        for (const theme of ["default", "agents-im-weggla", "halloween"]) {
            await evaluate((theme) => {
                document.getElementById("theme").value = theme;
                document.getElementById("theme").dispatchEvent(new Event("change"));
            }, theme);
            for (const [screen, areaSelector, selector, count] of [
                [2, "#hood", "#lookBtn", 1],
                [3, "#mem-stateless .hood", "#mem-stateless .lookBtn", 1],
                [3, "#mem-session .hood", "#mem-session .lookBtn", 1],
                [4, "#ltHood", "#ltLook", 1],
                [5, "#toolsHood", "#toolsLook", 2],
                [6, "#cloudHood", "#cloudLook", 2],
                [7, "#incidentSkillSource", "#incidentSkillSourceButton", 1],
            ]) {
                await evaluate(async (screen, areaSelector, selector, count) => {
                    show(screen);
                    const root = document.querySelector(areaSelector);
                    // Reopen on later theme/viewport passes so every renderer is exercised.
                    if (root.querySelector(".code-panel")) {
                        const hide = root.querySelector(".hood-controls button, .hideBtn, #hideBtn, #ltHide")
                            || document.getElementById("incidentSkillSourceButton");
                        hide.click();
                    }
                    document.querySelector(selector).click();
                    const deadline = Date.now() + 5000;
                    while (root.querySelectorAll(".code-panel").length !== count) {
                        if (Date.now() > deadline) throw new Error(`Missing code controls: ${selector}`);
                        await new Promise((resolve) => setTimeout(resolve, 10));
                    }
                }, screen, areaSelector, selector, count);
                for (let index = 0; index < count; index++) {
                    const before = await evaluate((areaSelector, index) => {
                        const panel = document.querySelector(areaSelector).querySelectorAll(".code-panel")[index];
                        window.testPanel = panel;
                        window.testCode = panel.querySelector("pre");
                        window.testParent = panel.parentElement;
                        window.testNext = panel.nextSibling;
                        testCode.scrollTop = 42;
                        testCode.scrollLeft = 24;
                        window.testScroll = [testCode.scrollTop, testCode.scrollLeft];
                        window.testLayout = [panel.clientWidth, panel.clientHeight];
                        const text = testCode.innerHTML;
                        panel.querySelector("button").click();
                        const dialog = document.getElementById("codeFullscreen");
                        const rect = dialog.getBoundingClientRect();
                        if (!dialog.open || rect.x !== 0 || rect.y !== 0
                            || rect.width !== innerWidth || rect.height !== innerHeight) {
                            throw new Error("Expanded panel does not fill the viewport");
                        }
                        if (!testPanel.contains(document.activeElement)) throw new Error("Focus was not moved into code");
                        if (getComputedStyle(testCode).overflow !== "auto") throw new Error("Code is not scrollable");
                        if (testCode.clientHeight < innerHeight - 100) throw new Error("Code does not use viewport height");
                        if (dialog.querySelector("button").textContent !== "X") throw new Error("Missing collapse X");
                        return text;
                    }, areaSelector, index);
                    if (process.env.TEST_SCREENSHOT_DIR && areaSelector === "#toolsHood" && index === 0 && theme === "default") {
                        const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
                        await writeFile(join(process.env.TEST_SCREENSHOT_DIR, `code-fullscreen-${width}.png`), Buffer.from(data, "base64"));
                    }
                    // Native dialog focus containment must work in both directions.
                    for (let i = 0; i < 3; i++) {
                        await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
                        await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
                        assert.equal(await evaluate(() => testPanel.contains(document.activeElement)), true);
                    }
                    await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", modifiers: 8, windowsVirtualKeyCode: 9 });
                    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", modifiers: 8, windowsVirtualKeyCode: 9 });
                    assert.equal(await evaluate(() => testPanel.contains(document.activeElement)), true);
                    if (index % 2 === 0) {
                        await evaluate(() => testPanel.querySelector("button").click());
                    } else {
                        await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
                        await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
                    }
                    const restored = await evaluate(async () => {
                        while (expandedCode) await new Promise((resolve) => setTimeout(resolve, 10));
                        if (testPanel.parentElement !== testParent || testPanel.nextSibling !== testNext) {
                            throw new Error("Original panel position was not restored");
                        }
                        if (document.activeElement !== testPanel.querySelector("button")) throw new Error("Focus not restored");
                        if (document.documentElement.classList.contains("code-expanded")) throw new Error("Page scroll remains locked");
                        if (testCode.scrollTop !== testScroll[0] || testCode.scrollLeft !== testScroll[1]) {
                            throw new Error("Code scroll position not restored");
                        }
                        if (testPanel.clientWidth !== testLayout[0] || testPanel.clientHeight !== testLayout[1]) {
                            throw new Error("Original code panel size not restored");
                        }
                        return testCode.innerHTML;
                    });
                    assert.equal(restored, before);
                }
            }
        }
    }
});
