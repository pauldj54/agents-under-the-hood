import { joinSession, createCanvas, CanvasError } from "@github/copilot-sdk/extension";
import { COMPONENTS } from "./components.mjs";
import { freshCards, snapshot, setStage, broadcast, startServer } from "./server.mjs";

const instances = new Map();

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
                        for (const id of ids) {
                            if (!inst.cards.has(id)) {
                                throw new CanvasError("unknown_component", `Unknown component '${id}'`);
                            }
                            setStage(inst, id, ctx.input.stage);
                        }
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
                await new Promise((resolve) => inst.server.close(resolve));
            },
        }),
    ],
});
