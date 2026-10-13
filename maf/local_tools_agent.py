"""Screen 7's independent local conversation, reusing the native calculator."""

from typing import Callable

from calculator_agent import agent, events

session = agent.create_session()


async def chat(message: str, on_tool: Callable[[dict], None]):
    token = events.set(lambda event: on_tool({**event, "execution": "local"}))
    try:
        response = await agent.run(message, session=session)
        yield response.text
    finally:
        events.reset(token)
