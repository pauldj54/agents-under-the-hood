"""Local incident-triage skill demo with a traceable, deterministic selector."""

import os
from pathlib import Path
from typing import Callable

from agent_framework import Agent
from agent_framework.ollama import OllamaChatClient


SKILL_PATH = Path(__file__).resolve().parents[1] / ".github" / "skills" / "incident-triage" / "SKILL.md"
SELECTOR_TERMS = (
    "incident",
    "checkout",
    "unreliable",
    "deploy",
    "http 500",
    "500s",
    "timeout",
    "database connection",
    "logs",
)
BASE_INSTRUCTIONS = "You are a helpful assistant. Use only information provided by the user."

_runtimes = {}


def matching_terms(message: str) -> list[str]:
    normalized = message.casefold()
    return [term for term in SELECTOR_TERMS if term in normalized]


def read_skill() -> tuple[str, str, str]:
    raw = SKILL_PATH.read_text(encoding="utf-8")
    if not raw.startswith("---\n"):
        raise ValueError(f"Skill file has no YAML front matter: {SKILL_PATH}")
    _, front_matter, body = raw.split("---", 2)
    metadata = {}
    for line in front_matter.splitlines():
        key, separator, value = line.partition(":")
        if separator:
            metadata[key.strip()] = value.strip().strip('"\'')
    if metadata.get("name") != "incident-triage" or not metadata.get("description"):
        raise ValueError(f"Skill metadata is incomplete: {SKILL_PATH}")
    if not body.strip():
        raise ValueError(f"Skill instructions are empty: {SKILL_PATH}")
    return metadata["name"], metadata["description"], body.strip()


def _new_runtime(mode: str, skill_body: str | None = None):
    instructions = BASE_INSTRUCTIONS
    if skill_body:
        instructions = f"{BASE_INSTRUCTIONS}\n\n{skill_body}"
    agent = Agent(
        client=OllamaChatClient(
            host="http://localhost:11434",
            model=os.getenv("OLLAMA_MODEL", "phi3:3.8b"),
        ),
        name="IncidentTriage",
        instructions=instructions,
        default_options={"temperature": 0},
    )
    return {
        "agent": agent,
        "session": agent.create_session(),
        "history": [],
        "skill_loaded": bool(skill_body),
        "mode": mode,
    }


def reset(mode: str):
    if mode not in ("skill", "baseline"):
        raise ValueError("Select a valid incident demo mode.")
    _runtimes.pop(mode, None)


async def chat(message: str, mode: str, on_event: Callable[[dict], None]):
    if mode not in ("skill", "baseline"):
        raise ValueError("Select a valid incident demo mode.")
    if not isinstance(message, str) or not message.strip():
        raise ValueError("A message is required.")

    runtime = _runtimes.get(mode)
    matches = matching_terms(message) if mode == "skill" else []

    if mode == "baseline":
        on_event({
            "kind": "selection",
            "status": "unavailable",
            "message": "Baseline mode: no skill candidates are available.",
        })
    elif matches:
        on_event({
            "kind": "selection",
            "status": "matched",
            "skill": "incident-triage",
            "matched_terms": matches,
            "message": "Incident context matched the skill selector.",
        })
        if not runtime or not runtime["skill_loaded"]:
            name, description, body = read_skill()
            on_event({
                "kind": "load",
                "status": "loaded",
                "skill": name,
                "path": ".github/skills/incident-triage/SKILL.md",
                "description": description,
            })
            upgraded = _new_runtime(mode, body)
            if runtime:
                for previous_message in runtime["history"]:
                    await upgraded["agent"].run(previous_message, session=upgraded["session"])
                upgraded["history"] = list(runtime["history"])
            runtime = upgraded
            _runtimes[mode] = runtime
        else:
            on_event({
                "kind": "load",
                "status": "reused",
                "skill": "incident-triage",
                "path": ".github/skills/incident-triage/SKILL.md",
                "message": "The skill-loaded agent and conversation session are already active.",
            })
    else:
        on_event({
            "kind": "selection",
            "status": "no-match",
            "message": "No incident-triage selector terms were found; no skill was loaded.",
        })

    if not runtime:
        runtime = _new_runtime(mode)
        _runtimes[mode] = runtime

    async for chunk in runtime["agent"].run(message, session=runtime["session"], stream=True):
        if chunk.text:
            yield chunk.text
    runtime["history"].append(message)
