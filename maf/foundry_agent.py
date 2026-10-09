import os

from agent_framework import Agent
from agent_framework.foundry import FoundryChatClient
from azure.identity.aio import AzureCliCredential

# Reuse az login in this tenant. No API key or browser token is needed.
credential = AzureCliCredential(
    tenant_id=os.environ["AZURE_TENANT_ID"],
)

client = FoundryChatClient(
    project_endpoint=os.environ["FOUNDRY_PROJECT_ENDPOINT"],
    model=os.getenv("FOUNDRY_MODEL_DEPLOYMENT_NAME", "MAI-Thinking-1"),
    credential=credential,
)

agent = Agent(
    client=client,
    name="FoundryAgent",
    instructions="You are a friendly assistant.",
)
session = agent.create_session()


async def chat(message: str):
    async for chunk in agent.run(message, session=session, stream=True):
        if chunk.text:
            yield chunk.text
