import re
from typing import Any

from agent_framework import Agent, AgentSession, ContextProvider, Message, SessionContext
from agent_framework.ollama import OllamaChatClient
from pydantic import BaseModel


# 1. What we remember about the user, outside of any conversation
class UserMemory(BaseModel):
    favourite_colour: str | None = None


EXTRACT = (
    "Extract the favourite colour that the user states about themselves, in English, as a single word. "
    "Questions and greetings do not state a colour. "
    "Reply with only that word, or NONE if the message does not state one."
)


# 2. A context provider hooks into every run: it reads the memory before the
#    model is called and updates it after the response
class FavouriteColourMemory(ContextProvider):
    def __init__(self, memory: UserMemory, client: OllamaChatClient):
        super().__init__(source_id="favourite-colour-memory")
        self.memory = memory
        self.client = client

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
            if msg.role != "user" or not msg.text or "?" in msg.text:
                continue
            # Ask the model to pull out the colour, so any language or phrasing works
            reply = await self.client.get_response(
                [Message("system", [EXTRACT]), Message("user", [msg.text])]
            )
            colour = re.sub(r"[^A-Za-z ]", "", reply.text or "").strip()
            if colour and colour.upper() != "NONE" and len(colour.split()) == 1:
                self.memory.favourite_colour = colour.capitalize()


memory = UserMemory()

client = OllamaChatClient(host="http://localhost:11434", model="phi3:3.8b")

# 3. Attach the provider to the agent
agent = Agent(
    client=client,
    name="MemoryPhi",
    instructions="You are a friendly assistant.",
    context_providers=[FavouriteColourMemory(memory, client)],
)

session = agent.create_session()


async def chat(message: str):
    async for chunk in agent.run(message, session=session, stream=True):
        if chunk.text:
            yield chunk.text
