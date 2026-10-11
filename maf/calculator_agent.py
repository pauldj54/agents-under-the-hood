"""Native Ollama tool calling with Agent Framework's registered calculator."""

import math
from contextvars import ContextVar
from typing import Callable

from agent_framework import Agent, tool
from agent_framework.ollama import OllamaChatClient


events: ContextVar[Callable[[dict], None]] = ContextVar("calculator_events")


def calculate(a: float, b: float, operation: str) -> dict:
    try:
        if any(isinstance(n, bool) or not isinstance(n, (int, float)) or not math.isfinite(n) for n in (a, b)):
            raise ValueError("a and b must be finite numbers.")
        if operation == "sum":
            result = a + b
        elif operation == "subtract":
            result = a - b
        elif operation == "multiply":
            result = a * b
        elif operation == "divide":
            if b == 0:
                raise ValueError("Cannot divide by zero.")
            result = a / b
        else:
            raise ValueError("Allowed operations: sum, subtract, multiply, divide.")
        if not math.isfinite(result):
            raise ValueError("The result is outside the supported numeric range.")
        return {"result": result}
    except ValueError as exc:
        return {"error": str(exc)}


@tool
def calculator(a: float, b: float, operation: str) -> dict:
    """Calculate with two numbers. Operation: sum, subtract, multiply, or divide."""
    inputs = {"a": a, "b": b, "operation": operation}
    emit = events.get()
    emit({"tool": "calculator", "status": "running", "inputs": inputs})
    outcome = calculate(a, b, operation)
    emit({"tool": "calculator", "status": "error" if "error" in outcome else "completed",
          "inputs": inputs, **outcome})
    return outcome


agent = Agent(
    client=OllamaChatClient(host="http://localhost:11434", model="llama3.2:1b"),
    name="CalculatorLlama",
    instructions=(
        "Always call the calculator tool for arithmetic, even for division by zero. "
        "Use operations sum, subtract, multiply, divide. Do not calculate yourself. "
        "After receiving the tool result, report its result or error briefly. "
        "Do not call the tool again for the same calculation. Web search is disabled locally."
    ),
    default_options={"temperature": 0},
    tools=[calculator],
)
session = agent.create_session()


async def chat(message: str, on_tool: Callable[[dict], None]):
    token = events.set(on_tool)
    try:
        response = await agent.run(message, session=session)
        yield response.text
    finally:
        events.reset(token)
