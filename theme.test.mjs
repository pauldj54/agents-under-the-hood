import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createContext, runInContext } from "node:vm";

const html = await readFile(new URL("./index.html", import.meta.url), "utf8");
const script = (id) => html.match(new RegExp(`<script id="${id}">([\\s\\S]*?)</script>`))[1];

function fixture({ saved = null, readError = false, writeError = false } = {}) {
    const dataset = { theme: "default" };
    const listeners = {};
    const select = { value: "", addEventListener: (name, callback) => { listeners[name] = callback; } };
    const status = { textContent: "" };
    const writes = [];
    const warnings = [];
    const context = createContext({
        document: {
            documentElement: { dataset },
            getElementById: (id) => ({ theme: select, themeStatus: status })[id],
        },
        localStorage: {
            getItem: () => {
                if (readError) throw new Error("Storage blocked");
                return saved;
            },
            setItem: (key, value) => {
                if (writeError) throw new Error("Storage blocked");
                writes.push([key, value]);
            },
        },
        console: { warn: (...args) => warnings.push(args) },
    });
    runInContext(script("theme-restore"), context);
    runInContext(script("theme-controls"), context);
    const change = (value) => { select.value = value; listeners.change(); };
    return { dataset, select, status, writes, warnings, change };
}

test("fresh and invalid preferences preserve Default; known themes restore before styles", () => {
    for (const saved of [null, "", "unknown", "<script>", "default"]) {
        const ui = fixture({ saved });
        assert.equal(ui.dataset.theme, "default");
        assert.equal(ui.select.value, "default");
        assert.equal(ui.writes.length, 0);
    }
    for (const saved of ["agents-im-weggla", "halloween"]) {
        const ui = fixture({ saved });
        assert.equal(ui.dataset.theme, saved);
        assert.equal(ui.select.value, saved);
    }
    assert.ok(html.indexOf('id="theme-restore"') < html.indexOf("<style>"));
});

test("all themes can be selected, persisted, and restored including Default", () => {
    const ui = fixture();
    for (const theme of ["agents-im-weggla", "halloween", "default"]) {
        ui.change(theme);
        assert.equal(ui.dataset.theme, theme);
        assert.deepEqual(ui.writes.at(-1), ["agents-under-the-hood.theme", theme]);
        assert.equal(fixture({ saved: ui.writes.at(-1)[1] }).dataset.theme, theme);
    }
    ui.change("invalid");
    assert.equal(ui.dataset.theme, "default");
    assert.equal(ui.writes.length, 3);
});

test("blocked storage reports failures while allowing theme changes", () => {
    const ui = fixture({ readError: true, writeError: true });
    assert.equal(ui.dataset.theme, "default");
    assert.match(ui.status.textContent, /could not be read/);
    ui.change("halloween");
    assert.equal(ui.dataset.theme, "halloween");
    assert.match(ui.status.textContent, /could not be saved/);
    assert.equal(ui.warnings.length, 2);
    const recovered = fixture({ readError: true });
    recovered.change("agents-im-weggla");
    assert.equal(recovered.status.textContent, "");
});

test("Halloween artwork is shared across every screen and hidden in other themes", () => {
    const artwork = html.match(/<div class="theme-art" aria-hidden="true">([\s\S]*?)<\/div>/);
    assert.ok(artwork);
    assert.ok(html.indexOf(artwork[0]) < html.indexOf('<section class="screen">'));
    assert.equal([...html.matchAll(/<section class="screen">/g)].length, 8);
    assert.equal([...html.matchAll(/class="theme-art"/g)].length, 1);
    for (const name of ["pumpkin", "bat", "ghost"]) {
        assert.match(artwork[1], new RegExp(`<svg class="theme-${name}"`));
    }
    assert.equal([...artwork[1].matchAll(/<svg /g)].length, 3);
    assert.match(html, /\.theme-art\s*\{\s*display:\s*none;/);
    assert.match(html, /:root\[data-theme="halloween"\] \.theme-art\s*\{\s*display:\s*flex;/);
});
