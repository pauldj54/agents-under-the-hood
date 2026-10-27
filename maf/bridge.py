"""Plumbing between the canvas (Node) and the MAF agents.

Reads JSON lines on stdin and streams JSON lines on stdout:
  -> {"id": 1, "type": "chat", "model": "local", "message": "Hi"}
  <- {"id": 1, "delta": "Hel"} ... {"id": 1, "done": true}  or  {"id": 1, "error": "..."}
  -> {"id": 2, "type": "reset", "model": "local"}
  -> {"id": 1, "type": "cancel"}
  <- {"id": 1, "cancelled": true, "done": true}

The "foundry" model uses MAI-Thinking-1 with the Azure CLI's Entra sign-in.
Configure AZURE_TENANT_ID and FOUNDRY_PROJECT_ENDPOINT in maf/.env,
then sign in with az login --tenant <your-tenant-id>.
FOUNDRY_MODEL_DEPLOYMENT_NAME optionally overrides the model deployment.
OLLAMA_MODEL configures local chat and memory; OLLAMA_TOOLS_MODEL configures tools.
Existing environment variables take precedence over .env values.
Both model sessions reset on bridge restart.
"""

import asyncio
import importlib
import json
import os
import sys
from contextlib import aclosing
from copy import deepcopy
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).with_name(".env"), override=False)

sys.stdout.reconfigure(encoding="utf-8")
sys.stdin.reconfigure(encoding="utf-8")


def send(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


async def handle(req):
    rid = req.get("id")
    restore = None
    try:
        if req["type"] in ("skill_chat", "skill_reset"):
            skill_agent = importlib.import_module("incident_triage_agent")
            mode = req.get("mode")
            if req["type"] == "skill_reset":
                skill_agent.reset(mode)
            else:
                previous = skill_agent._runtimes.get(mode)
                saved = None if previous is None else {
                    **previous, "session": deepcopy(previous["session"]),
                    "history": list(previous["history"]),
                }

                def restore():
                    if saved is None:
                        skill_agent._runtimes.pop(mode, None)
                    else:
                        skill_agent._runtimes[mode] = saved

                stream = skill_agent.chat(req["message"], mode, lambda event: send({"id": rid, "tool_event": event}))
                async with aclosing(stream):
                    async for text in stream:
                        send({"id": rid, "delta": text})
            send({"id": rid, "done": True})
            return
        if req["type"] == "models":
            send({"id": rid, "delta": json.dumps({
                "local": os.getenv("OLLAMA_MODEL", "phi3:3.8b"),
                "local_llama": os.getenv("OLLAMA_CHAT_LLAMA_MODEL", "llama3.2:1b"),
                "foundry": os.getenv("FOUNDRY_MODEL_DEPLOYMENT_NAME", "MAI-Thinking-1"),
                "tools": os.getenv("OLLAMA_TOOLS_MODEL", "llama3.2:1b"),
                "memory_foundry": os.getenv("FOUNDRY_MEMORY_MODEL_DEPLOYMENT_NAME", "gpt-chat-latest"),
            })})
            send({"id": rid, "done": True})
            return
        modules = {
            "local": "local_agent",
            "local-llama": "local_llama_agent",
            "foundry": "foundry_agent",
            "stateless": "memory_stateless_agent",
            "session": "memory_session_agent",
            "memory-llama-stateless": "memory_llama_stateless_agent",
            "memory-llama-session": "memory_llama_session_agent",
            "memory-foundry-stateless": "memory_foundry_stateless_agent",
            "memory-foundry-session": "memory_foundry_session_agent",
            "longterm": "memory_long_term_agent",
            "calculator": "calculator_agent",
            "tools-local": "local_tools_agent",
            "tools-foundry": "foundry_tools_agent",
        }
        if req.get("model") not in modules:
            raise ValueError("Select a valid model.")
        selected_agent = importlib.import_module(modules[req["model"]])

        if req["type"] == "reset":
            if hasattr(selected_agent, "reset"):
                selected_agent.reset()
            elif hasattr(selected_agent, "session"):
                selected_agent.session = selected_agent.agent.create_session()
        elif req["type"] == "forget":
            selected_agent.memory.favourite_colour = None
            selected_agent.session = selected_agent.agent.create_session()
        elif req["type"] == "memory":
            send({"id": rid, "delta": selected_agent.memory.model_dump_json()})
        else:
            session = deepcopy(getattr(selected_agent, "session", None))
            colour = selected_agent.memory.favourite_colour if req["model"] == "longterm" else None

            def restore():
                if hasattr(selected_agent, "session"):
                    selected_agent.session = session
                if req["model"] == "longterm":
                    selected_agent.memory.favourite_colour = colour

            stream = (
                selected_agent.chat(req["message"], lambda event: send({"id": rid, "tool_event": event}))
                if req["model"] in ("calculator", "tools-local", "tools-foundry")
                else selected_agent.chat(req["message"])
            )
            async with aclosing(stream):
                async for text in stream:
                    send({"id": rid, "delta": text})
        send({"id": rid, "done": True})
    except asyncio.CancelledError:
        if restore:
            restore()
        raise
    except Exception as exc:  # report every failure back to the UI
        send({"id": rid, "error": f"{type(exc).__name__}: {exc}"})


async def serve(readline):
    # Serialize each conversation while allowing cancellation and other chats to proceed.
    tasks = {}
    locks = {}

    async def run(req):
        key = ("skill", req.get("mode")) if req["type"].startswith("skill_") else ("model", req.get("model"))
        try:
            async with locks.setdefault(key, asyncio.Lock()):
                await handle(req)
        except asyncio.CancelledError:
            send({"id": req["id"], "cancelled": True, "done": True})
        finally:
            tasks.pop(req["id"], None)

    try:
        while True:
            line = await readline()
            if not line:
                break
            if not line.strip():
                continue
            req = json.loads(line)
            if req["type"] == "cancel":
                task = tasks.get(req["id"])
                if task:
                    task.cancel()
            else:
                tasks[req["id"]] = asyncio.create_task(run(req))
    finally:
        remaining = list(tasks.values())
        for task in remaining:
            task.cancel()
        await asyncio.gather(*remaining, return_exceptions=True)


async def main():
    await serve(lambda: asyncio.to_thread(sys.stdin.readline))


if __name__ == "__main__":
    asyncio.run(main())
