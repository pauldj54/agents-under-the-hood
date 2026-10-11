import unittest
from unittest.mock import AsyncMock

from agent_framework import Agent, ChatResponse, Message

from agent_framework.ollama import OllamaChatClient
from agent_framework import Content
from calculator_agent import calculate, calculator, events


class CalculatorTests(unittest.TestCase):
    def test_operations(self):
        for a, b, op, expected in [
            (2, 8, "sum", 10), (10, 3, "subtract", 7),
            (-2.5, 4, "multiply", -10), (7, 2, "divide", 3.5),
        ]:
            with self.subTest(operation=op):
                self.assertEqual(calculate(a, b, op), {"result": expected})

    def test_errors(self):
        for a, b, op in [
            (2, 0, "divide"), (2, 3, "power"), ("two", 3, "sum"),
            (True, 3, "sum"), (float("nan"), 3, "sum"),
            (2, float("inf"), "sum"), (1e308, 1e308, "sum"),
        ]:
            with self.subTest(a=a, b=b, operation=op):
                self.assertIn("error", calculate(a, b, op))


class InvocationTests(unittest.IsolatedAsyncioTestCase):
    async def test_framework_executes_registered_tool_and_emits_trace(self):
        client = OllamaChatClient(host="http://localhost:11434", model="llama3.2:1b")
        client._inner_get_response = AsyncMock(side_effect=[
            ChatResponse(messages=Message("assistant", [
                Content.from_function_call("test-call", "calculator", arguments={
                    "a": 2, "b": 8, "operation": "sum",
                })
            ])),
            ChatResponse(messages=Message("assistant", ["The result is 10."])),
        ])
        agent = Agent(client=client, tools=[calculator])
        trace = []
        token = events.set(trace.append)
        try:
            response = await agent.run("calculate 2 + 8")
            self.assertEqual(response.text, "The result is 10.")
            self.assertEqual([event["status"] for event in trace], ["running", "completed"])
            self.assertEqual(trace[-1]["result"], 10)
            self.assertEqual(client._inner_get_response.await_count, 2)
        finally:
            events.reset(token)
            await client.client._client.aclose()


if __name__ == "__main__":
    unittest.main()
