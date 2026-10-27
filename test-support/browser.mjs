import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const browser = process.env.TEST_BROWSER_PATH || [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].find(existsSync);

export const browserSkip = !browser && "Set TEST_BROWSER_PATH to a Chromium-based browser to run UI checks.";

export async function openBrowser(t, url) {
    const profile = await mkdtemp(join(tmpdir(), "agents-browser-"));
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
    return { cdp, evaluate };
}
