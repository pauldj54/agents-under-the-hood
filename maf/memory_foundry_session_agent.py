import os

from agent_framework import Agent
from agent_framework.foundry import FoundryChatClient
from azure.identity.aio import AzureCliCredential
from chat_instructions import CHAT_INSTRUCTIONS

credential = AzureCliCredential(tenant_id=os.environ["AZURE_TENANT_ID"])
client = FoundryChatClient(
    project_endpoint=os.environ["FOUNDRY_PROJECT_ENDPOINT"],
    model=os.getenv("FOUNDRY_MEMORY_MODEL_DEPLOYMENT_NAME", "gpt-chat-latest"),
    credential=credential,
)
agent = Agent(
    client=client,
    name="RememberingFoundry",
    instructions=CHAT_INSTRUCTIONS,
)
session = agent.create_session()


async def chat(message: str):
    # The session carries Foundry's response ID so it can retrieve prior turns.
    async for chunk in agent.run(message, session=session, stream=True):
        if chunk.text:
            yield chunk.text
