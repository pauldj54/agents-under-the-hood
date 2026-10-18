import contextlib
import io
import json
import os
from pathlib import Path
import runpy
import unittest
from unittest.mock import AsyncMock, Mock, patch

import setup_foundry_tools


class ModelConfigurationTests(unittest.TestCase):
    def test_agents_use_defaults_and_environment_overrides(self):
        cases = [
            ("local_agent", "OLLAMA_MODEL", "phi3:3.8b"),
            ("memory_stateless_agent", "OLLAMA_MODEL", "phi3:3.8b"),
            ("memory_session_agent", "OLLAMA_MODEL", "phi3:3.8b"),
            ("memory_long_term_agent", "OLLAMA_MODEL", "phi3:3.8b"),
            ("calculator_agent", "OLLAMA_TOOLS_MODEL", "llama3.2:1b"),
            ("foundry_agent", "FOUNDRY_MODEL_DEPLOYMENT_NAME", "MAI-Thinking-1"),
        ]
        for module, variable, default in cases:
            for override in (None, "custom-model"):
                with self.subTest(module=module, override=override):
                    env = {"AZURE_TENANT_ID": "test", "FOUNDRY_PROJECT_ENDPOINT": "https://example.test"}
                    if override is not None:
                        env[variable] = override
                    target = (
                        "agent_framework.foundry.FoundryChatClient"
                        if module == "foundry_agent" else "agent_framework.ollama.OllamaChatClient"
                    )
                    with patch.dict(os.environ, env, clear=True), patch(
                        target
                    ) as client, patch("agent_framework.Agent"), patch(
                        "azure.identity.aio.AzureCliCredential"
                    ):
                        runpy.run_path(str(Path(__file__).with_name(module + ".py")))
                    self.assertEqual(client.call_args.kwargs["model"], override or default)


class SetupConfigurationTests(unittest.IsolatedAsyncioTestCase):
    async def test_setup_uses_environment_model_and_cli_override(self):
        for argument, expected in ((None, "env-deployment"), ("cli-deployment", "cli-deployment")):
            with self.subTest(argument=argument):
                project = Mock()
                project.deployments.get = AsyncMock(return_value=Mock(model_publisher="OpenAI"))
                project.agents.create_version = AsyncMock(return_value=Mock(
                    name="test-agent", version="3",
                ))
                credential_context = AsyncMock()
                project_context = AsyncMock()
                project_context.__aenter__.return_value = project
                with patch.dict(os.environ, {
                    "AZURE_TENANT_ID": "test",
                    "FOUNDRY_PROJECT_ENDPOINT": "https://example.test",
                    "FOUNDRY_TOOLS_MODEL_DEPLOYMENT_NAME": "env-deployment",
                }, clear=True), patch.object(
                    setup_foundry_tools, "load_dotenv"
                ), patch.object(
                    setup_foundry_tools, "AzureCliCredential", return_value=credential_context
                ), patch.object(
                    setup_foundry_tools, "AIProjectClient", return_value=project_context
                ), contextlib.redirect_stdout(io.StringIO()):
                    await setup_foundry_tools.setup(argument, "test-agent")
                project.deployments.get.assert_awaited_once_with(expected)
                definition = project.agents.create_version.call_args.kwargs["definition"]
                self.assertEqual(definition.model, expected)

    async def test_missing_setup_model_fails_before_azure_access(self):
        for value in (None, "", "   "):
            env = {} if value is None else {"FOUNDRY_TOOLS_MODEL_DEPLOYMENT_NAME": value}
            with self.subTest(value=value), patch.dict(
                os.environ, env, clear=True
            ), patch.object(setup_foundry_tools, "load_dotenv"), patch.object(
                setup_foundry_tools, "AzureCliCredential"
            ) as credential:
                with self.assertRaisesRegex(ValueError, "FOUNDRY_TOOLS_MODEL_DEPLOYMENT_NAME"):
                    await setup_foundry_tools.setup(None, "test-agent")
                credential.assert_not_called()


class BridgeConfigurationTests(unittest.IsolatedAsyncioTestCase):
    async def test_models_response_only_exposes_model_names(self):
        with patch("dotenv.load_dotenv"), patch("sys.stdout.reconfigure"), patch(
            "sys.stdin.reconfigure"
        ):
            bridge = runpy.run_path(str(Path(__file__).with_name("bridge.py")))
        output = []
        bridge["handle"].__globals__["send"] = output.append
        with patch.dict(os.environ, {
            "OLLAMA_MODEL": "custom-chat",
            "OLLAMA_TOOLS_MODEL": "custom-tools",
            "FOUNDRY_MODEL_DEPLOYMENT_NAME": "custom-foundry",
            "AZURE_TENANT_ID": "not-public",
        }, clear=True):
            await bridge["handle"]({"id": 7, "type": "models"})
        self.assertEqual(json.loads(output[0]["delta"]), {
            "local": "custom-chat", "foundry": "custom-foundry", "tools": "custom-tools",
        })
        self.assertEqual(output[-1], {"id": 7, "done": True})


if __name__ == "__main__":
    unittest.main()
