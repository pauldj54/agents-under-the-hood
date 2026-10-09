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
    name="ForgetfulPhi",
    instructions="You are a friendly assistant.",
)


async def chat(message: str):
    # 3. No session is passed: every call starts from a blank slate,
    #    so the agent only ever sees the current message
    async for chunk in agent.run(message, stream=True):
        if chunk.text:
            yield chunk.text
