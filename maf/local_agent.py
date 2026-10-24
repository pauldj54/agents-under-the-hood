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
    name="LocalPhi",
    instructions=CHAT_INSTRUCTIONS,
    default_options={"temperature": 0},
)

# 3. A session keeps the short-term memory of the conversation
session = agent.create_session()


async def chat(message: str):
    # 4. Run the agent and stream tokens as the model generates them
    async for chunk in agent.run(message, session=session, stream=True):
        if chunk.text:
            yield chunk.text
