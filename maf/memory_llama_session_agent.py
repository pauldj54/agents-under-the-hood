import os

from agent_framework import Agent
from agent_framework.ollama import OllamaChatClient
from chat_instructions import CHAT_INSTRUCTIONS

client = OllamaChatClient(
    host="http://localhost:11434",
    model=os.getenv("OLLAMA_CHAT_LLAMA_MODEL", "llama3.2:1b"),
)
agent = Agent(
    client=client,
    name="RememberingLlama",
    instructions=CHAT_INSTRUCTIONS,
    default_options={"temperature": 0},
)
session = agent.create_session()


async def chat(message: str):
    async for chunk in agent.run(message, session=session, stream=True):
        if chunk.text:
            yield chunk.text
