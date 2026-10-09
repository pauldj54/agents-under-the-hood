import re
from typing import Any

from agent_framework import Agent, AgentSession, ContextProvider, SessionContext
from agent_framework.ollama import OllamaChatClient
from pydantic import BaseModel


# 1. What we remember about the user, outside of any conversation
class UserMemory(BaseModel):
    favourite_colour: str | None = None


COLOUR = re.compile(r"favou?rite colou?r is\s+([A-Za-z ]+)", re.IGNORECASE)


# 2. A context provider hooks into every run: it reads the memory before the
#    model is called and updates it after the response
class FavouriteColourMemory(ContextProvider):
    def __init__(self, memory: UserMemory):
        super().__init__(source_id="favourite-colour-memory")
        self.memory = memory

    async def before_run(
        self, *, agent: Any, session: AgentSession, context: SessionContext, state: dict[str, Any]
    ) -> None:
        if self.memory.favourite_colour:
            note = f"The user's favourite colour is {self.memory.favourite_colour}."
        else:
            note = "The user's favourite colour is unknown. Ask them about it."
        context.extend_instructions(self.source_id, note)

    async def after_run(
        self, *, agent: Any, session: AgentSession, context: SessionContext, state: dict[str, Any]
    ) -> None:
        for msg in context.get_messages(include_input=True):
            match = msg.role == "user" and COLOUR.search(msg.text or "")
            if match:
                self.memory.favourite_colour = match.group(1).strip().rstrip(".").capitalize()


memory = UserMemory()

client = OllamaChatClient(host="http://localhost:11434", model="phi3:3.8b")

# 3. Attach the provider to the agent
agent = Agent(
    client=client,
    name="MemoryPhi",
    instructions="You are a friendly assistant.",
    context_providers=[FavouriteColourMemory(memory)],
)

session = agent.create_session()


async def chat(message: str):
    async for chunk in agent.run(message, session=session, stream=True):
        if chunk.text:
            yield chunk.text
