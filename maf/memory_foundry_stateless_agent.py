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
    name="ForgetfulFoundry",
    instructions=CHAT_INSTRUCTIONS,
)


async def chat(message: str):
    # No session: only the current message is sent to the model.
    async for chunk in agent.run(message, stream=True):
        if chunk.text:
            yield chunk.text
