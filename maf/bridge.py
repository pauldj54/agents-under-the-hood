"""Plumbing between the canvas (Node) and the MAF agents.

Reads JSON lines on stdin and streams JSON lines on stdout:
  -> {"id": 1, "type": "chat", "model": "local", "message": "Hi"}
  <- {"id": 1, "delta": "Hel"} ... {"id": 1, "done": true}  or  {"id": 1, "error": "..."}
  -> {"id": 2, "type": "reset", "model": "local"}

The "foundry" model uses MAI-Thinking-1 with the Azure CLI's Entra sign-in.
Configure AZURE_TENANT_ID and FOUNDRY_PROJECT_ENDPOINT in maf/.env,
then sign in with az login --tenant <your-tenant-id>.
FOUNDRY_MODEL_DEPLOYMENT_NAME optionally overrides the model deployment.
Existing environment variables take precedence over .env values.
Both model sessions reset on bridge restart.
"""

import asyncio
import importlib
import json
import sys
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
    try:
        modules = {"local": "local_agent", "foundry": "foundry_agent"}
        if req.get("model") not in modules:
            raise ValueError("Select either the local or Foundry model.")
        selected_agent = importlib.import_module(modules[req["model"]])

        if req["type"] == "reset":
            selected_agent.session = selected_agent.agent.create_session()
        else:
            async for text in selected_agent.chat(req["message"]):
                send({"id": rid, "delta": text})
        send({"id": rid, "done": True})
    except Exception as exc:  # report every failure back to the UI
        send({"id": rid, "error": f"{type(exc).__name__}: {exc}"})


async def main():
    while True:
        line = await asyncio.to_thread(sys.stdin.readline)
        if not line:
            break
        if line.strip():
            await handle(json.loads(line))


if __name__ == "__main__":
    asyncio.run(main())
