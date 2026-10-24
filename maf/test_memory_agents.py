import os
from pathlib import Path
import runpy
import unittest
from unittest.mock import patch

from agent_framework import ChatResponseUpdate, Content
from chat_instructions import CHAT_INSTRUCTIONS


class MemoryTests(unittest.IsolatedAsyncioTestCase):
    async def test_history_is_replayed_only_for_session_agents(self):
        for module in (
            "memory_stateless_agent", "memory_session_agent",
            "memory_llama_stateless_agent", "memory_llama_session_agent",
            "memory_foundry_stateless_agent", "memory_foundry_session_agent",
            "local_agent", "local_llama_agent", "foundry_agent",
        ):
            with self.subTest(module=module), patch.dict(os.environ, {
                "AZURE_TENANT_ID": "test",
                "FOUNDRY_PROJECT_ENDPOINT": "https://example.test/api/projects/test",
            }), patch("azure.identity.aio.AzureCliCredential"):
                namespace = runpy.run_path(str(Path(__file__).with_name(module + ".py")))
                client = namespace["client"]
                requests = []
                options = []

                def respond(*, messages, **kwargs):
                    requests.append([(str(message.role), message.text) for message in messages])
                    options.append(dict(kwargs["options"]))

                    async def stream():
                        yield ChatResponseUpdate(
                            role="assistant", contents=[Content.from_text("Verstanden.")],
                            conversation_id="resp_memory_test" if "foundry" in module else None,
                        )
                    return client._build_response_stream(stream())

                try:
                    with patch.object(client, "_inner_get_response", side_effect=respond):
                        for prompt in ("Ich wohne in Nürnberg", "Wo wohne ich?"):
                            reply = "".join([part async for part in namespace["chat"](prompt)])
                            self.assertEqual(reply, "Verstanden.")
                    self.assertTrue(all(item["instructions"] == CHAT_INSTRUCTIONS for item in options))
                    self.assertEqual(requests[1][-1], ("user", "Wo wohne ich?"))
                    previous_facts = [
                        text for role, text in requests[1]
                        if role == "user" and text == "Ich wohne in Nürnberg"
                    ]
                    if "foundry" in module:
                        self.assertFalse(previous_facts)
                        self.assertEqual(
                            options[1].get("conversation_id"),
                            None if "stateless" in module else "resp_memory_test",
                        )
                    else:
                        self.assertEqual(bool(previous_facts), "stateless" not in module)
                    if "stateless" in module:
                        self.assertEqual(len(requests[1]), 1)
                    elif "foundry" not in module:
                        self.assertIn(("assistant", "Verstanden."), requests[1])
                    if "foundry" not in module:
                        self.assertTrue(all(item["temperature"] == 0 for item in options))
                finally:
                    if "foundry" not in module:
                        await client.client._client.aclose()


if __name__ == "__main__":
    unittest.main()
