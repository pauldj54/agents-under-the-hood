import os
import unittest
from unittest.mock import AsyncMock, Mock, patch

from agent_framework import ChatResponse, Content, Message
from agent_framework.foundry import FoundryAgent
from azure.identity.aio import AzureCliCredential

import calculator_agent
import foundry_tools_agent
import local_tools_agent
from calculator_agent import calculator, events


class DefinitionTests(unittest.TestCase):
    def test_prompt_contains_hosted_search_and_the_registered_function_schema(self):
        definition = foundry_tools_agent.prompt_definition("test-deployment").as_dict()
        self.assertEqual(definition["kind"], "prompt")
        self.assertEqual(definition["model"], "test-deployment")
        self.assertEqual([tool["type"] for tool in definition["tools"]], ["web_search", "function"])
        function = calculator.to_json_schema_spec()["function"]
        self.assertEqual(definition["tools"][1]["parameters"], function["parameters"])
        self.assertEqual(definition["tools"][1]["name"], function["name"])

    def test_cloud_configuration_failure_is_explicit_and_lazy(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(ValueError, "Foundry tools are not configured"):
                foundry_tools_agent.create_agent()

    def test_local_screen_sessions_are_independent(self):
        self.assertIs(local_tools_agent.agent, calculator_agent.agent)
        self.assertIsNot(local_tools_agent.session, calculator_agent.session)

    def test_search_events_and_citations_are_deduplicated(self):
        contents = [
            Content.from_search_tool_call(
                call_id="search-1", tool_name="web_search",
                arguments={"query": "recent AI news"}, status="in_progress",
            ),
            Content.from_search_tool_result(
                call_id="search-1", tool_name="web_search",
                result={"action": {"query": "recent AI news"}}, status="completed",
            ),
            Content.from_text("News", annotations=[
                {"type": "citation", "url": "https://example.com/news", "title": "News source"},
            ]),
        ]
        trace, seen = [], set()
        foundry_tools_agent.emit_contents(contents, trace.append, seen)
        foundry_tools_agent.emit_contents(contents, trace.append, seen)
        self.assertEqual([item["status"] for item in trace], ["running", "completed", "citation"])
        self.assertTrue(all(item["execution"] == "server-side" for item in trace))
        self.assertEqual(trace[-1]["url"], "https://example.com/news")


class InvocationTests(unittest.IsolatedAsyncioTestCase):
    async def test_native_foundry_agent_executes_local_calculator(self):
        async with AzureCliCredential() as credential:
            agent = FoundryAgent(
                project_endpoint="https://example.services.ai.azure.com/api/projects/test",
                agent_name="tools-test", agent_version="1",
                credential=credential, tools=[calculator],
            )
            agent.client._inner_get_response = AsyncMock(side_effect=[
                ChatResponse(messages=Message("assistant", [
                    Content.from_function_call("test-call", "calculator", arguments={
                        "a": 2, "b": 8, "operation": "sum",
                    }),
                ])),
                ChatResponse(messages=Message("assistant", ["The result is 10."])),
            ])
            trace = []
            token = events.set(trace.append)
            try:
                response = await agent.run("calculate 2 + 8")
                self.assertEqual(response.text, "The result is 10.")
                self.assertEqual(trace[-1]["result"], 10)
                self.assertEqual(agent.client._inner_get_response.await_count, 2)
                continuation = agent.client._inner_get_response.call_args.kwargs["messages"]
                self.assertTrue(any(
                    content.type == "function_result"
                    for message in continuation for content in message.contents
                ))
            finally:
                events.reset(token)
                await agent.client.close()

    async def test_foundry_response_includes_search_events_and_citations(self):
        response = ChatResponse(messages=Message("assistant", [
            Content.from_search_tool_call(
                call_id="s1", tool_name="web_search", status="completed",
                arguments={"query": "news"},
            ),
            Content.from_search_tool_result(
                call_id="s1", tool_name="web_search", status="completed",
                result={"action": {"query": "news"}},
            ),
            Content.from_text("Latest news", annotations=[
                {"type": "citation", "title": "Source", "url": "https://example.com"},
            ]),
        ]))
        mock_agent = Mock()
        mock_agent.run = AsyncMock(return_value=response)
        trace = []
        mock_session = object()
        with patch.object(foundry_tools_agent, "agent", mock_agent), patch.object(
            foundry_tools_agent, "session", mock_session
        ):
            text = "".join([text async for text in foundry_tools_agent.chat("Search", trace.append)])
        self.assertEqual(text, "Latest news")
        self.assertEqual([item["status"] for item in trace], ["running", "completed", "citation"])
        self.assertEqual(trace[-1]["status"], "citation")
        self.assertEqual(mock_agent.run.call_args.kwargs["session"], mock_session)
        self.assertNotIn("stream", mock_agent.run.call_args.kwargs)


if __name__ == "__main__":
    unittest.main()
