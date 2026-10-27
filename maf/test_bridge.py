import asyncio
from copy import deepcopy
import json
import os
import importlib
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import bridge
from agent_framework import AgentSession, ChatResponseUpdate, Content


class BridgeCancellationTests(unittest.IsolatedAsyncioTestCase):
    async def test_real_agent_stream_cancellation_releases_transport_and_preserves_history(self):
        for name in ("local_agent", "memory_foundry_session_agent"):
            with self.subTest(module=name), patch.dict(os.environ, {
                "AZURE_TENANT_ID": "test",
                "FOUNDRY_PROJECT_ENDPOINT": "https://example.test/api/projects/test",
            }), patch("azure.identity.aio.AzureCliCredential"):
                module = importlib.import_module(name)
                module.session = module.agent.create_session()
                entered = asyncio.Event()
                closed = asyncio.Event()
                prompts = []

                def respond(*, messages, **kwargs):
                    prompts.append([message.text for message in messages])
                    prompt = messages[-1].text

                    async def stream():
                        try:
                            yield ChatResponseUpdate(
                                role="assistant", contents=[Content.from_text("Partial" if prompt == "cancel" else "Done")],
                                conversation_id="response_" + prompt if "foundry" in name else None,
                            )
                            if prompt == "cancel":
                                entered.set()
                                await asyncio.Event().wait()
                        finally:
                            if prompt == "cancel":
                                closed.set()
                    return module.client._build_response_stream(stream())

                model = "local" if name == "local_agent" else "memory-foundry-session"
                replies = []
                try:
                    with patch.object(module.client, "_inner_get_response", side_effect=respond), patch.object(
                        bridge, "send", replies.append
                    ):
                        await bridge.handle({"id": 1, "type": "chat", "model": model, "message": "first"})
                        task = asyncio.create_task(bridge.handle({
                            "id": 2, "type": "chat", "model": model, "message": "cancel",
                        }))
                        await asyncio.wait_for(entered.wait(), 2)
                        task.cancel()
                        with self.assertRaises(asyncio.CancelledError):
                            await task
                        await bridge.handle({"id": 3, "type": "chat", "model": model, "message": "next"})
                    self.assertTrue(closed.is_set())
                    self.assertNotIn("cancel", prompts[-1])
                    self.assertIn({"id": 3, "done": True}, replies)
                    self.assertFalse(any("error" in reply for reply in replies))
                    if name == "local_agent":
                        self.assertIn("first", prompts[-1])
                finally:
                    if name == "local_agent":
                        await module.client.client._client.aclose()

    async def test_cancel_restores_session_memory_and_closes_generator(self):
        for model in ("local", "longterm", "tools-foundry"):
            with self.subTest(model=model):
                session = AgentSession()
                session.state["history"] = ["previous turn"]
                module = SimpleNamespace(session=session, memory=SimpleNamespace(favourite_colour="Blue"))
                entered = asyncio.Event()
                closed = asyncio.Event()

                async def chat(message, *args):
                    module.session.state["history"].append(message)
                    module.memory.favourite_colour = "Red"
                    try:
                        yield "Partial reply"
                        entered.set()
                        await asyncio.Event().wait()
                    finally:
                        closed.set()

                module.chat = chat
                replies = []
                with patch.object(bridge.importlib, "import_module", return_value=module), patch.object(
                    bridge, "send", replies.append
                ):
                    task = asyncio.create_task(bridge.handle({
                        "id": 1, "type": "chat", "model": model, "message": "cancelled turn",
                    }))
                    await asyncio.wait_for(entered.wait(), 1)
                    task.cancel()
                    with self.assertRaises(asyncio.CancelledError):
                        await task
                self.assertTrue(closed.is_set())
                self.assertEqual(module.session.state["history"], ["previous turn"])
                self.assertEqual(replies, [{"id": 1, "delta": "Partial reply"}])
                if model == "longterm":
                    self.assertEqual(module.memory.favourite_colour, "Blue")

    async def test_cancel_restores_skill_runtime_and_replayed_history(self):
        for existing in (False, True):
            with self.subTest(existing=existing):
                old_runtime = {
                    "session": AgentSession(), "history": ["completed"],
                    "agent": object(), "skill_loaded": False,
                }
                module = SimpleNamespace(_runtimes={"skill": old_runtime} if existing else {})
                entered = asyncio.Event()

                async def chat(message, mode, on_event):
                    runtime = deepcopy(old_runtime)
                    runtime["history"].append(message)
                    module._runtimes[mode] = runtime
                    entered.set()
                    await asyncio.Event().wait()
                    yield "unreachable"

                module.chat = chat
                with patch.object(bridge.importlib, "import_module", return_value=module):
                    task = asyncio.create_task(bridge.handle({
                        "id": 1, "type": "skill_chat", "mode": "skill", "message": "cancelled",
                    }))
                    await asyncio.wait_for(entered.wait(), 1)
                    task.cancel()
                    with self.assertRaises(asyncio.CancelledError):
                        await task
                if existing:
                    self.assertEqual(module._runtimes["skill"]["history"], ["completed"])
                    self.assertIs(module._runtimes["skill"]["agent"], old_runtime["agent"])
                else:
                    self.assertNotIn("skill", module._runtimes)

    async def test_tasks_cancel_independently_and_serialize_conversation_cleanup(self):
        incoming = asyncio.Queue()
        outgoing = asyncio.Queue()
        entered = asyncio.Queue()
        cleanup_started = asyncio.Event()
        release_cleanup = asyncio.Event()
        active = set()

        async def handle(req):
            key = req.get("model")
            self.assertNotIn(key, active)
            active.add(key)
            await entered.put(req["id"])
            try:
                await asyncio.Event().wait()
            finally:
                if req["id"] == 1:
                    cleanup_started.set()
                    await release_cleanup.wait()
                active.remove(key)

        async def submit(**req):
            await incoming.put(json.dumps(req))

        with patch.object(bridge, "handle", handle), patch.object(bridge, "send", outgoing.put_nowait):
            serving = asyncio.create_task(bridge.serve(incoming.get))
            try:
                await submit(id=1, type="chat", model="local")
                self.assertEqual(await asyncio.wait_for(entered.get(), 1), 1)
                await submit(id=2, type="chat", model="foundry")
                self.assertEqual(await asyncio.wait_for(entered.get(), 1), 2)
                await submit(id=3, type="chat", model="local")
                await submit(id=1, type="cancel")
                await asyncio.wait_for(cleanup_started.wait(), 1)
                self.assertTrue(entered.empty())
                # Cancelling a queued turn must not run it or affect the active one.
                await submit(id=3, type="cancel")
                self.assertEqual((await asyncio.wait_for(outgoing.get(), 1))["id"], 3)
                await submit(id=4, type="chat", model="local")
                release_cleanup.set()
                self.assertEqual((await asyncio.wait_for(outgoing.get(), 1))["id"], 1)
                self.assertEqual(await asyncio.wait_for(entered.get(), 1), 4)
                self.assertIn("foundry", active)
                await submit(id=1, type="cancel")  # repeated cancellation is harmless
                await submit(id=4, type="cancel")
                self.assertEqual((await asyncio.wait_for(outgoing.get(), 1))["id"], 4)
                self.assertIn("foundry", active)
            finally:
                release_cleanup.set()
                await incoming.put("")
                await asyncio.wait_for(serving, 1)
        self.assertFalse(active)


if __name__ == "__main__":
    unittest.main()
