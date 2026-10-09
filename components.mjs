export const COMPONENTS = [
    {
        id: "llm",
        name: "Large Language Models",
        icon: "🧠",
        definition:
            "The reasoning engine. A model trained on vast text that predicts the next token, letting the agent understand requests, plan steps, and generate answers.",
    },
    {
        id: "instructions",
        name: "Instructions & Skills",
        icon: "📜",
        definition:
            "The playbook. System prompts set the agent's role, rules, and tone; skills package reusable know-how the agent loads when a task calls for it.",
    },
    {
        id: "memory",
        name: "Memory",
        icon: "💾",
        definition:
            "What the agent remembers. Short-term memory is the current conversation context; long-term memory persists facts and preferences across sessions.",
    },
    {
        id: "tools",
        name: "Tools",
        icon: "🛠️",
        definition:
            "The agent's hands. Functions and APIs (search, code execution, databases, apps) the model can call to act in the world and fetch live data.",
    },
    {
        id: "knowledge",
        name: "Knowledge",
        icon: "📚",
        definition:
            "Grounding beyond training data. Documents and data sources retrieved at runtime (e.g. RAG) so answers are accurate, current, and specific to you.",
    },
    {
        id: "governance",
        name: "Governance",
        icon: "🛡️",
        definition:
            "The guardrails. Permissions, policies, safety filters, audit logs, and human approvals that keep the agent secure, compliant, and accountable.",
    },
];

export function scramble(name) {
    const letters = name.replace(/[^A-Za-z]/g, "").toUpperCase().split("");
    if (new Set(letters).size < 2) return letters;
    const original = letters.join("");
    let out;
    do {
        out = [...letters];
        for (let i = out.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [out[i], out[j]] = [out[j], out[i]];
        }
    } while (out.join("") === original);
    return out;
}
