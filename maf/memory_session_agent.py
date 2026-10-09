from agent_framework import Agent
from agent_framework.ollama import OllamaChatClient

# 1. Connect to the LLM running locally in Ollama
client = OllamaChatClient(
    host="http://localhost:11434",
    model="phi3:3.8b",
)

# 2. Wrap the model in an agent with instructions
agent = Agent(
    client=client,
    name="RememberingPhi",
    instructions="You are a friendly assistant.",
)

# 3. A session holds the short-term memory (the conversation history)
session = agent.create_session()


async def chat(message: str):
    # 4. Passing the same session to every run replays the history to the model
    async for chunk in agent.run(message, session=session, stream=True):
        if chunk.text:
            yield chunk.text
