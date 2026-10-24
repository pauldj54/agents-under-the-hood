import os

from agent_framework import Agent
from agent_framework.ollama import OllamaChatClient
from chat_instructions import CHAT_INSTRUCTIONS

# 1. Connect to the LLM running locally in Ollama
client = OllamaChatClient(
    host="http://localhost:11434",
    model=os.getenv("OLLAMA_MODEL", "phi3:3.8b"),
)

# 2. Wrap the model in an agent with instructions
agent = Agent(
    client=client,
    name="ForgetfulPhi",
    instructions=CHAT_INSTRUCTIONS,
    default_options={"temperature": 0},
)


async def chat(message: str):
    # 3. No session is passed: every call starts from a blank slate,
    #    so the agent only ever sees the current message
    async for chunk in agent.run(message, stream=True):
        if chunk.text:
            yield chunk.text
