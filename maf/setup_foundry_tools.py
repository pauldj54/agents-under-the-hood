"""Explicitly create a prompt-agent version; never deploys a model or rewrites .env."""

import argparse
import asyncio
import os
from pathlib import Path

from azure.ai.projects.aio import AIProjectClient
from azure.identity.aio import AzureCliCredential
from dotenv import load_dotenv

from foundry_tools_agent import prompt_definition


async def setup(model: str, name: str):
    load_dotenv(Path(__file__).with_name(".env"), override=False)
    async with AzureCliCredential(tenant_id=os.environ["AZURE_TENANT_ID"]) as credential:
        async with AIProjectClient(
            endpoint=os.environ["FOUNDRY_PROJECT_ENDPOINT"], credential=credential,
        ) as project:
            deployment = await project.deployments.get(model)
            if deployment.model_publisher.lower() != "openai":
                raise ValueError(
                    "Web Search requires an Azure OpenAI deployment. "
                    f"{model} is not an OpenAI deployment. No agent was created."
                )
            version = await project.agents.create_version(
                agent_name=name, definition=prompt_definition(model),
            )
            print("Add these values to maf\\.env, then reload extensions:")
            print(f"FOUNDRY_TOOLS_AGENT_NAME={version.name}")
            print(f"FOUNDRY_TOOLS_AGENT_VERSION={version.version}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", required=True, help="Existing Azure OpenAI deployment with Web Search support")
    parser.add_argument("--name", default="agents-under-the-hood-tools")
    args = parser.parse_args()
    asyncio.run(setup(args.model, args.name))
