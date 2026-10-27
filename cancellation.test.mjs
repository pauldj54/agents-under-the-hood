import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { freshCards, startServer } from "./server.mjs";
import { browserSkip, openBrowser } from "./test-support/browser.mjs";

test("all chats cancel before and during streaming, free controls, and reject late updates", {
    skip: browserSkip, timeout: 60000,
}, async (t) => {
    const calls = [];
    let holdControls = false;
    const inst = { cards: freshCards(), clients: new Set() };
    const { server, url } = await startServer(inst, {
        callBridge: (request, onDelta, onTool, signal) => {
            if (request.type === "models") {
                onDelta(JSON.stringify({
                    local: "test-local", local_llama: "test-llama", foundry: "test-foundry",
                    memory_foundry: "test-memory", tools: "test-tools",
                }));
                return;
            }
            if (request.type === "memory") {
                onDelta('{"favourite_colour":null}');
                return;
            }
            if (!["chat", "skill_chat"].includes(request.type)
                && !(holdControls && ["reset", "skill_reset", "forget"].includes(request.type))) return;
            const call = { ...request, cancelled: false };
            calls.push(call);
            return new Promise((resolve) => {
                call.complete = () => { onDelta("Finished reply"); resolve(); };
                signal.addEventListener("abort", () => {
                    call.cancelled = true;
                    // Simulate delayed provider cleanup after a new UI request has already begun.
                    setTimeout(() => {
                        onDelta("LATE RESPONSE");
                        onTool({ status: "LATE EVENT" });
                        resolve("Request cancelled.");
                    }, 30);
                }, { once: true });
                if (request.message !== "before") onDelta("Partial reply");
            });
        },
    });
    t.after(async () => {
        for (const response of inst.clients) response.end();
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
    });
    const { cdp, evaluate } = await openBrowser(t, url);
    await evaluate(() => {
        window.waitUntil = async (check) => {
            const deadline = Date.now() + 4000;
            while (!check()) {
                if (Date.now() > deadline) throw new Error("UI condition timed out");
                await new Promise((resolve) => setTimeout(resolve, 10));
            }
        };
    });
    const waitForCall = async (count) => {
        const deadline = Date.now() + 4000;
        while (calls.length < count) {
            if (Date.now() > deadline) throw new Error("Request never reached the backend");
            await delay(10);
        }
        return calls[count - 1];
    };

    const chats = [
        [2, "#composer", "#messages", "#model", "#newChat"],
        [3, "#mem-stateless .composer", "#mem-stateless .messages", "#memoryRuntime", "#mem-stateless .newChat"],
        [3, "#mem-session .composer", "#mem-session .messages", "#memoryRuntime", "#mem-session .newChat"],
        [4, "#lt .composer", "#lt .messages", null, "#lt .newChat"],
        [5, "#toolsComposer", "#toolsMessages", null, "#toolsReset"],
        [6, "#cloudComposer", "#cloudMessages", "#cloudRuntime", "#cloudReset"],
        [7, "#incidentComposer", "#incidentMessages", "#incidentMode", "#incidentReset"],
    ];
    assert.equal(await evaluate(() => document.querySelectorAll(".cancel-chat:disabled").length), 7);
    for (const size of [[1280, 900], [390, 844]]) {
        await cdp.send("Emulation.setDeviceMetricsOverride", {
            width: size[0], height: size[1], deviceScaleFactor: 1, mobile: false,
        });
        for (const [screen, composer, messages, selector, reset] of chats) {
            for (const message of ["before", "partial"]) {
                let count = calls.length + 1;
                await evaluate((screen, composer, message) => {
                    show(screen);
                    const form = document.querySelector(composer);
                    form.querySelector("textarea").value = message;
                    form.requestSubmit();
                    if (form.querySelector(".cancel-chat").disabled) throw new Error("Cancel unavailable while busy");
                    const rect = form.querySelector(".cancel-chat").getBoundingClientRect();
                    if (rect.left < 0 || rect.right > innerWidth) throw new Error("Cancel clipped on narrow layout");
                }, screen, composer, message);
                const original = await waitForCall(count);
                if (message === "partial") {
                    await evaluate(async (messages) => {
                        await waitUntil(() => document.querySelector(messages).textContent.includes("Partial reply"));
                    }, messages);
                    if (process.env.TEST_SCREENSHOT_DIR && screen === 2) {
                        const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
                        await writeFile(join(process.env.TEST_SCREENSHOT_DIR, `chat-cancel-${size[0]}.png`), Buffer.from(data, "base64"));
                    }
                }
                await evaluate((composer, selector, reset) => {
                    const form = document.querySelector(composer);
                    form.querySelector(".cancel-chat").click();
                    if (form.querySelector("textarea").disabled || form.querySelector(".navbtn").disabled
                        || document.querySelector(reset).disabled
                        || (selector && document.querySelector(selector).disabled)) {
                        throw new Error("Cancel did not immediately restore controls");
                    }
                    // Start again in the same event turn, before the old fetch rejection/finally.
                    form.querySelector("textarea").value = "replacement";
                    form.requestSubmit();
                }, composer, selector, reset);
                count++;
                const replacement = await waitForCall(count);
                await delay(80);
                assert.equal(original.cancelled, true);
                assert.equal(replacement.cancelled, false);
                const snapshot = await evaluate((composer, messages) => {
                    const form = document.querySelector(composer);
                    if (form.querySelector(".cancel-chat").disabled || !form.querySelector(".navbtn").disabled) {
                        throw new Error("Late cleanup released controls belonging to the next request");
                    }
                    const text = document.querySelector(messages).textContent;
                    if (!text.includes("Response cancelled.")) throw new Error("Cancellation not marked");
                    if (text.includes("LATE") || text.includes("AbortError")) throw new Error("Late updates leaked");
                    return text;
                }, composer, messages);
                if (message === "partial") assert.match(snapshot, /Partial replyResponse cancelled\./);
                replacement.complete();
                await evaluate(async (composer) => {
                    await waitUntil(() => !document.querySelector(composer).querySelector(".navbtn").disabled);
                }, composer);
            }
        }
    }

    // Original report: cancel local generation, switch to Foundry, then send successfully.
    let count = calls.length + 1;
    await evaluate(() => {
        show(2);
        document.getElementById("prompt").value = "before";
        document.getElementById("composer").requestSubmit();
    });
    await waitForCall(count);
    await evaluate(() => {
        document.querySelector("#composer .cancel-chat").click();
        document.getElementById("model").value = "foundry";
        document.getElementById("model").dispatchEvent(new Event("change"));
        document.getElementById("prompt").value = "foundry request";
        document.getElementById("composer").requestSubmit();
    });
    const foundry = await waitForCall(++count);
    assert.equal(foundry.model, "foundry");
    foundry.complete();
    await evaluate(async () => {
        await waitUntil(() => !document.getElementById("model").disabled);
        if (!document.getElementById("messages").textContent.includes("Finished reply")) {
            throw new Error("Foundry response missing");
        }
    });

    // Both memory chats can run; cancelling one must not unlock their shared selector.
    count = calls.length + 2;
    await evaluate(() => {
        show(3);
        for (const id of ["mem-stateless", "mem-session"]) {
            const root = document.getElementById(id);
            root.querySelector("textarea").value = "before";
            root.querySelector("form").requestSubmit();
        }
    });
    await waitForCall(count);
    await evaluate(() => {
        document.querySelector("#mem-stateless .cancel-chat").click();
        if (!document.getElementById("memoryRuntime").disabled) throw new Error("Unrelated chat was unlocked");
        if (document.querySelector("#mem-session .cancel-chat").disabled) throw new Error("Other chat was cancelled");
        document.querySelector("#mem-session .cancel-chat").click();
        if (document.getElementById("memoryRuntime").disabled) throw new Error("Shared selector still locked");
    });

    // Cancellation of a sample must stop its second turn, not just its current fetch.
    count = calls.length + 1;
    await evaluate(() => {
        show(7);
        document.getElementById("incidentSample").click();
    });
    const sample = await waitForCall(count);
    await evaluate(async () => {
        await waitUntil(() => document.getElementById("incidentMessages").textContent.includes("Partial reply"));
        document.querySelector("#incidentComposer .cancel-chat").click();
        document.getElementById("incidentMode").value = "baseline";
        document.getElementById("incidentMode").dispatchEvent(new Event("change"));
    });
    await delay(100);
    assert.equal(sample.cancelled, true);
    assert.equal(calls.length, count);
    await evaluate(() => {
        if (document.getElementById("incidentSample").disabled) throw new Error("Sample controls still busy");
        if (document.getElementById("incidentMessages").textContent.includes("Partial reply")) {
            throw new Error("Cancelled sample modified another mode");
        }
    });

    // Reset and forget operations use the same cancellation lifecycle as chat requests.
    holdControls = true;
    for (const [screen, composer, , selector, reset] of chats) {
        const expected = calls.length + 1;
        await evaluate((screen, reset) => {
            show(screen);
            document.querySelector(reset).click();
        }, screen, reset);
        const resetCall = await waitForCall(expected);
        await evaluate((composer, selector, reset) => {
            document.querySelector(composer).querySelector(".cancel-chat").click();
            if (document.querySelector(reset).disabled || (selector && document.querySelector(selector).disabled)) {
                throw new Error("Reset cancellation left controls locked");
            }
        }, composer, selector, reset);
        await delay(50);
        assert.equal(resetCall.cancelled, true);
    }
    let expected = calls.length + 1;
    await evaluate(() => {
        show(4);
        document.getElementById("ltForget").click();
    });
    const forgotten = await waitForCall(expected);
    await evaluate(() => document.querySelector("#lt .cancel-chat").click());
    await delay(50);
    assert.equal(forgotten.cancelled, true);

    // Cancel a sample while its initial reset is still waiting: no chat turn may start.
    expected = calls.length + 1;
    await evaluate(() => {
        show(7);
        document.getElementById("incidentSample").click();
    });
    const sampleReset = await waitForCall(expected);
    await evaluate(() => document.querySelector("#incidentComposer .cancel-chat").click());
    await delay(50);
    assert.equal(sampleReset.cancelled, true);
    assert.equal(calls.length, expected);

    // Even a transport that ignores abort cannot apply a late chunk or unlock the next request.
    await evaluate(async () => {
        show(2);
        const originalFetch = window.fetch;
        const streams = [];
        window.fetch = async (url, options) => {
            if (url !== "/api/chat") return originalFetch(url, options);
            return new Response(new ReadableStream({
                start(controller) { streams.push(controller); },
            }));
        };
        try {
            const form = document.getElementById("composer");
            document.getElementById("prompt").value = "stale transport";
            form.requestSubmit();
            await waitUntil(() => streams.length === 1);
            form.querySelector(".cancel-chat").click();
            document.getElementById("prompt").value = "fresh transport";
            form.requestSubmit();
            await waitUntil(() => streams.length === 2);
            streams[0].enqueue(new TextEncoder().encode("STALE CHUNK"));
            streams[0].close();
            await new Promise((resolve) => setTimeout(resolve, 20));
            if (document.getElementById("send").disabled !== true) throw new Error("Old finally unlocked new request");
            if (document.getElementById("messages").textContent.includes("STALE CHUNK")) throw new Error("Stale text leaked");
            streams[1].enqueue(new TextEncoder().encode("Fresh result"));
            streams[1].close();
            await waitUntil(() => !document.getElementById("send").disabled);
            form.querySelector(".cancel-chat").click(); // completion/cancel race: idle Cancel is a no-op
            if (!document.getElementById("messages").textContent.includes("Fresh result")) throw new Error("New result lost");
        } finally {
            window.fetch = originalFetch;
        }
    });
});
