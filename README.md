# Agents Under the Hood

Source for the existing Copilot canvas: six reveal cards, an animated agent
harness, and model chat with a code card. This is a migration of the current
implementation, not yet a standalone browser app.

## Layout

- `extension.mjs`: Copilot canvas registration and loopback HTTP server.
- `index.html`: the seven-screen UI.
- `components.mjs`: reveal-card content and helpers.
- `maf\`: Python Agent Framework bridge, local and Foundry agents, the two
  short-term memory demo agents (`memory_stateless_agent.py`,
  `memory_session_agent.py`), dependencies, and an example configuration.

## Screens

1. Six reveal cards.
2. The agent harness.
3. Connecting to an LLM (local Phi or Foundry).
4. Short-term memory: two chats side by side on the local Phi model, one
   stateless (`agent.run(message)`) and one using a session
   (`agent.run(message, session=session)`). Each has a "Look under the hood"
   button that shows its exact code. Requires `ollama pull phi3:3.8b`.
5. Long-term memory: a chat with a context provider
   (`maf\memory_long_term_agent.py`) that stores the user's favourite colour,
   shows the stored value live, keeps it across "New session", and clears it with
   "Forget me". Uses `ContextProvider` from `agent-framework-core` 1.20.0.
   The provider identifies the latest message's language with the local model
   and supplies a per-turn language reminder. Known colours are presented as
   confirmed user preferences, translated into that language, rather than as
   guesses or the assistant's own preferences. Language detection adds a local
   model call before each response.
6. Tools: CalculatorLlama chats on the left, with a calculator invocation trace
   and a disabled Web search card on the right. The calculator supports `sum`,
   `subtract`, `multiply`, and `divide`, including negative and decimal numbers.
   Errors such as division by zero are shown in both chat and the tool pane.
   A third panel on the right reveals the actual `Agent` tool binding above the
   calculator tool definition via "Look under the hood". Each snippet scrolls
   independently, including horizontally for long lines.
   Requires `ollama pull llama3.2:1b`; no cloud credentials
   are needed. Foundry and Bing-grounded search are not implemented here.
7. Tools across runtimes: starts **Local**, with the same calculator and a
   disabled Web Search tool. Explicitly switch to **Foundry** to use a prompt
   agent with hosted Web Search and the local calculator in one conversation.
   The screen has independent conversations for each runtime (and for screen 6),
   tool events labelled `local` or `server-side`, clickable source citations,
   and independently scrollable binding/definition snippets.
   Foundry usage incurs costs; web queries leave Azure compliance/geographic
   boundaries. Do not enter sensitive information.

### Foundry tools setup (screen 7)

Use an **existing Azure OpenAI model deployment that supports Web Search**
in your Foundry project, for example a supported `gpt-4.1-mini` deployment.
The screen 3 default `MAI-Thinking-1` cannot use this Web Search tool.
No separate Bing resource or project connection is required.

After configuring the endpoint/tenant in `maf\.env` and signing in with
`az login`, explicitly create a prompt-agent version:

```powershell
.\.venv\Scripts\python.exe .\maf\setup_foundry_tools.py --model <existing-deployment-name>
```

Alternatively, set `FOUNDRY_TOOLS_MODEL_DEPLOYMENT_NAME` in `maf\.env` and
run the command without `--model`. An explicit `--model` takes precedence.

This creates a version of `agents-under-the-hood-tools` with both tool schemas;
it does not deploy a model or alter `.env`. Add the printed
`FOUNDRY_TOOLS_AGENT_NAME` and `FOUNDRY_TOOLS_AGENT_VERSION` to `maf\.env`
and reload the extension. Rerunning setup deliberately creates a new version.
Missing settings and service/authentication failures are shown in the chat,
never silently replaced with a local response.

`maf\foundry_tools_agent.py` uses the SDK's native `FoundryAgent` wrapper for
a saved prompt-agent reference, rather than the deployment-only
`FoundryChatClient` used on screen 3. The prompt definition binds hosted Web
Search and the calculator schema; `tools=[calculator]` on the local wrapper
registers its implementation. MAF handles function calls and submits results
to Foundry without exposing localhost or deploying the Python function.
Web-search events/citations are forwarded from actual SDK stream contents;
the UI does not fabricate search activity. The pinned SDK supports this mixed
tool configuration and native function dispatch; automated tests exercise
the dispatch with simulated service responses, not live search.

`maf\calculator_agent.py` uses the standard `OllamaChatClient` and an `Agent`
with `tools=[calculator]`. Llama emits native tool calls; Agent Framework executes
the registered `@tool` and returns its result to the model for the chat reply.
There is no JSON planner or tool-call adapter. The installed `phi3:3.8b` and
`gemma3:4b` models do not advertise tool support, while `llama3.2:1b` does.

Run the agent and model-configuration tests with the configured virtual environment:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s .\maf -p "test_*.py"
```

The source lives at the project root deliberately. Copilot discovers project
extensions under `.github\extensions\`, so this copy does not register a second
provider. The existing installation at
`C:\Users\pauld\.copilot\extensions\agents-under-the-hood`
serves its installed snapshot. Editing source here does not update it automatically;
to test changes, explicitly copy the updated source and Python modules there,
preserve its `.venv` and private `maf\.env`, then reload extensions and reopen
the canvas.

## Setup (Windows PowerShell)

Use a Python version supported by the pinned dependencies in
`maf\requirements.txt`. From the extension source directory:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r .\maf\requirements.txt
# Only create .env if it does not already exist:
if (-not (Test-Path .\maf\.env)) {
    Copy-Item .\maf\.env.example .\maf\.env
}
```

The server expects `.venv\Scripts\python.exe` beside `extension.mjs`.
Virtual environments are not copied or tracked. A private `maf\.env` was
preserved during migration and is ignored by Git; `.env.example` is trackable.
Do not commit tenant/project configuration or credentials.

For local chat, install Ollama, then run `ollama pull phi3:3.8b` and ensure
Ollama is serving at `http://localhost:11434`.

For Foundry chat, set `AZURE_TENANT_ID` and `FOUNDRY_PROJECT_ENDPOINT` in
`maf\.env`, then run `az login --tenant <your-tenant-id>`. The default deployment
is `MAI-Thinking-1`; `FOUNDRY_MODEL_DEPLOYMENT_NAME` can override it. Existing
environment variables take precedence over `.env` values.

Model names can be edited in `maf\.env`:

| Variable | Default | Used by |
|---|---|---|
| `FOUNDRY_MODEL_DEPLOYMENT_NAME` | `MAI-Thinking-1` | Foundry chat |
| `OLLAMA_MODEL` | `phi3:3.8b` | Local chat and all memory demos |
| `OLLAMA_TOOLS_MODEL` | `llama3.2:1b` | Local calculator and tools demos |
| `FOUNDRY_TOOLS_MODEL_DEPLOYMENT_NAME` | None; supply an existing Azure OpenAI deployment | Foundry tools setup |

Pull any newly selected local model with `ollama pull <model-name>`.
Restart the Python bridge (reload the extension) after changing chat models.
For Foundry tools, changing the model setting alone does not modify an existing
saved agent: rerun `setup_foundry_tools.py`, update
`FOUNDRY_TOOLS_AGENT_VERSION` to the printed version, then reload.
These settings apply to the copy of `maf\.env` beside the running bridge;
the separately installed extension does not read this repository's `.env`.

### Foundry conversation tracing with Application Insights

An existing **Azure Monitor Application Insights** resource has been connected
to the Foundry project to inspect conversations with the Foundry agent.
This is a project-side Azure configuration, not a new resource provisioned by
this repository.

To configure the same setup in another project, open the project in
[Microsoft Foundry](https://ai.azure.com/), select **Agents > Traces > Connect**,
and select an existing Application Insights resource. An alternative path is
**Manage > Project details > Connected resources > Add connection >
Application Insights**. You need permission to connect the resource and
appropriate telemetry-reading permissions, such as **Log Analytics Reader**.

Once connected, Foundry automatically exports server-side traces for its
hosted agent runtime, including the saved prompt agent used by screen 7's
**Foundry** option. This connection does not require an Application Insights
connection string in `maf\.env` or a telemetry SDK in the local bridge.

To inspect a conversation, send a message through screen 7 with **Foundry**
selected, then open **Agents > Traces** in the same Foundry project. Allow a
few minutes for ingestion and refresh if needed. Select a trace to inspect
available model calls, tool activity, duration, status, and errors. Open its
**Conversation ID**, when available, to review the dialogue and run steps.
Telemetry can also be inspected in the connected Application Insights resource
in the Azure portal.

This is not end-to-end instrumentation of the Copilot canvas or local Python
process. Local Ollama conversations and the locally executed calculator are not
automatically traced by this connection. Screen 3's `FoundryChatClient` is a
direct model client, not the saved prompt agent; do not assume it has the same
agent conversation tracing. Additional client-side OpenTelemetry instrumentation
would be needed to capture local operations and correlate them with service calls.

Trace data can include prompts, responses, and tool arguments or results.
Avoid sensitive inputs, restrict access, and review the connected resource's
retention and ingestion costs. See Microsoft's
[Foundry tracing setup guide](https://learn.microsoft.com/en-us/azure/foundry/observability/how-to/trace-agent-setup)
for configuration, permissions, and troubleshooting.

## Run

The current working installation runs through Copilot. Open the
**Agents Under the Hood** canvas there; Copilot provides the extension SDK and
the extension starts its loopback server automatically. Opening `index.html`
directly or running `node extension.mjs` outside Copilot is not equivalent.

To activate this project copy later, install its source in
`.github\extensions\agents-under-the-hood`, create the virtual environment
alongside that installed `extension.mjs`, and provide its private `maf\.env`.
Ensure only one version of the provider is enabled before reloading extensions.
No provider switch or reload was performed during migration.

## Local Git

This folder is initialized as a local Git repository. No files have been staged
or committed, and no remote has been configured. `.gitignore` excludes private
environment files, dependency directories, caches, and logs.
