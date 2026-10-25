# Agents Under the Hood

An eight-screen local web application and Copilot canvas: six reveal cards, an
animated agent harness, model chat with code cards, and local demos of memory,
tools, and skills. Both entry points serve the exact same UI and demo backend.

## Run the local web application

### Requirements

- **Node.js 22 or later** (npm is included).
- For live chat demos: **Python 3.11** and [Ollama](https://ollama.com/).
- Microsoft Foundry is optional; the local demos do not require Azure credentials.

You can start the UI without Python or Ollama, but chat features need their
respective local model services.

### First-time setup (Windows PowerShell)

Run these commands from the repository root to create the Python environment,
install the agent dependencies, and download the models used by the local demos:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r .\maf\requirements.txt

# Preserve an existing private configuration file.
if (-not (Test-Path .\maf\.env)) {
    Copy-Item .\maf\.env.example .\maf\.env
}

ollama pull phi3:3.8b
ollama pull llama3.2:1b
```

Make sure Ollama is running. If it did not start automatically, run `ollama
serve` in a separate terminal and leave it running.

### Start the app

From the repository root, run:

```powershell
npm start
```

Open **http://127.0.0.1:3000/** in your browser. All eight screens, reveal
cards, animations, navigation, and code views are available. Chat features use
the local Ollama models configured above. If a backend dependency or model is
unavailable, the app reports the error rather than showing a simulated answer.
No `npm install`, frontend build, Copilot installation, or Azure account is
needed for the local app.

Stop the app with **Ctrl+C**; this also stops its Python bridge.

### UI themes

Use **Theme** in the top-right navigation to choose **Default**, **Agents im
Weggla**, or **Halloween**. Default preserves the original slate-and-teal
appearance and is selected on a fresh browser profile. Agents im Weggla takes
its plum, pink, yellow, and typography cues from the
[meetup website](https://agentsimweggla.de/meetups/02-oktober/); Halloween pairs
pumpkin orange and spectral lavender. Every Halloween screen shows a pumpkin
agent on the left and a bat and ghost on the right, aligned above the heading.

Themes apply to all eight screens without resetting cards, conversations, model
choices, or navigation. The browser remembers your choice on the same origin
(host and port); it is not shared with other browsers or the Copilot canvas.
If browser storage is blocked, themes still work for the current visit and the
UI explains that the preference could not be saved. The meetup fonts load from
Google Fonts, with local fallbacks when offline. The theme selector moves onto
its own right-aligned row on narrow screens.

The server listens only on your computer (`127.0.0.1`). To use a different port:

```powershell
$env:PORT = "3001"
npm start
```

Set `PORT=0` to let the app choose an available port; open the URL printed at
startup. Restart the app after changing `maf\.env` or Python code; refresh the
browser after changing HTML. The app is a single-user local demo: browser tabs
share conversations and reveal-card state. Conversation and preference memory
survive the demo's "New session" operation, but not an app restart.

The launcher uses `.venv\Scripts\python.exe` on Windows or `.venv/bin/python`
on macOS/Linux. Set `PYTHON_EXECUTABLE` to use a different Python executable.
Foundry remains opt-in on screens 3, 4, and 7; the app does not create Azure resources.

## Layout

- `app.mjs`: standalone local web application launcher (`npm start`).
- `server.mjs`: shared loopback HTTP server and Python bridge.
- `extension.mjs`: optional Copilot canvas registration and actions.
- `index.html`: the eight-screen UI.
- `components.mjs`: reveal-card content and helpers.
- `maf\chat_instructions.py`: shared concise, language-matching instructions for
  screens 3 and 4, also shown by their code views.
- `.github\skills\incident-triage\SKILL.md`: reusable incident-triage instructions
  loaded by the skills demonstration.
- `maf\`: Python Agent Framework bridge, local and Foundry agents, the two
  short-term memory demo agents (`memory_stateless_agent.py`,
  `memory_session_agent.py`), the incident-skill demo, dependencies, and an
  example configuration.

## Screens

1. Six reveal cards.
2. The agent harness.
3. Connecting to an LLM: choose Local Phi, Local Llama, or Foundry. Replies are
   instructed to use the user's language and one short paragraph (at most three
   sentences and 60 words), without inventing personal facts.
4. Short-term memory: two chats side by side, one
   stateless (`agent.run(message)`) and one using a session
   (`agent.run(message, session=session)`). Starts with **Local · Phi** (default
   `OLLAMA_MODEL=phi3:3.8b`). Choose **Local · Llama** to use
   `OLLAMA_CHAT_LLAMA_MODEL` (default `llama3.2:1b`), or **Foundry** to use
   `FOUNDRY_MEMORY_MODEL_DEPLOYMENT_NAME` (default `gpt-chat-latest`) in both
   panels. Within a selection, both panels use identical instructions and model
   settings; only session history differs. Local runs use temperature 0.
   Local sessions replay the messages; Foundry sessions carry the previous
   response ID so the service can retrieve prior turns.
   Runtime conversations are separate from each other and from screen 3.
   Each panel has a "Look under the hood" button showing the selected runtime's
   exact code and shared instructions. Foundry sends prompts to Azure and incurs
   costs; it requires the login and deployment configuration below.
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
8. Skills: an incident-triage chat with a **Skill available** mode and a
   **Baseline** mode using the same configured local Ollama model. Run the
   two-turn sample to see the incident context select and load the actual
   `.github\skills\incident-triage\SKILL.md`, inspect the observable execution
   events, and compare against a fresh baseline conversation. The local demo
   uses a small deterministic keyword selector for a reproducible walkthrough;
   it is not a model's private reasoning or a general-purpose skill-selection
   engine. No Azure access is needed.

### Concise replies and German memory example (screens 3 and 4)

Both screens share instructions to respond briefly in the latest message's
language, preserve user-provided names/places, and admit when a personal fact is
not present in the available conversation. These are model instructions, not
output truncation or a guarantee of factual accuracy.

For screen 4, select **Foundry** for the more reliable German walkthrough with
the deployed `gpt-chat-latest` model. In **each** panel, click **New chat**, send
`Ich wohne in Nürnberg`, then send `Wo wohne ich?`. The session panel should
answer Nürnberg; the stateless panel should say it does not know, because the
previous message is not sent on its second call. **New chat** resets only the
selected panel/runtime. Switching runtimes restores that runtime's conversation
without copying local messages to Foundry.

Small local models can invent a city or fail to use genuine history. The installed
`llama3.2:1b` also guessed incorrectly in a German stateless comparison, so
switching from Phi to that model is not a reliable fix. A model response alone
does not prove that session history was lost; history forwarding is covered by
the automated tests (including Foundry continuation IDs). Do not compare one local
panel with one cloud panel, since that would confound model quality with memory
behavior.

### Incident-triage skill demo (screen 8)

The example skill's discovery metadata is its YAML `name` and `description`;
its reusable procedure is the Markdown body in `SKILL.md`. The local demo
checks the incoming text for incident-related selector terms and, on a match,
reads that file and supplies the instructions to the Ollama-backed Agent
Framework agent. The trace records the selection, matched terms, file load (or
reuse), and the skill path. **Show actual SKILL.md** displays the file used.
This is an observable runtime trace, not hidden chain-of-thought.
Both modes on this screen use local Ollama: they compare skill availability,
not local versus Foundry. The Foundry agents on screens 3, 4, and 7 do not load this
skill.

Select **Skill available** and click **Run sample conversation**:

> Our checkout service has been unreliable since this morning's release. Help me investigate, but don't change anything.

**Sample prompt to test the incident-triage skill:** Paste the following query into screen 8, either on its own or as the follow-up in the sample conversation:

> At 10:02 we deployed version 2.8. At 10:05, HTTP 500s rose from 0.2% to 12%. Logs include “database connection timeout.” Database CPU stayed at 35%. Restarting one instance helped for two minutes. What’s happening, and what should we check next?

The skill asks the agent to separate facts, hypotheses, and unknowns; rank explanations by evidence; provide checks that can support or weaken each hypothesis; favor read-only diagnostics; and avoid claiming an unproven root cause. The sample makes the release timing a correlation and does not treat moderate database CPU as ruling out connection issues.

For a controlled comparison, run the sample in **Skill available**, then select **Baseline · skill unavailable** and run it again. Each mode has an independent conversation; the sample button resets the selected one first. Both use `OLLAMA_MODEL` (default `phi3:3.8b`) through local Ollama, with temperature 0. Baseline mode exposes no skill candidate or skill instructions. A baseline model can still produce some of the same good advice: compare observable outputs rather than assuming it must fail. Selection uses documented keyword matching, so the trace is deterministic; a production runtime may select skills differently.

Local setup is the Ollama setup below. Start Ollama with the configured model available, start the local app (or reload the extension), open screen 8, and run the sample. For an implementation smoke test, run:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s .\maf -p "test_incident_triage_agent.py"
```

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
and restart the app (or reload the extension). Rerunning setup deliberately creates a new version.
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

The optional canvas source lives at the project root deliberately. Copilot discovers project
extensions under `.github\extensions\`, so this copy does not register a second
provider. The existing installation at
`C:\Users\pauld\.copilot\extensions\agents-under-the-hood`
serves its installed snapshot. Editing source here does not update it automatically;
to test canvas changes, copy the updated `index.html`, `extension.mjs`,
`server.mjs`, `components.mjs`, and Python modules there, copy
`.github\skills\incident-triage\SKILL.md` to the matching
path under the installed extension, preserve its `.venv` and private `maf\.env`,
then reload extensions and reopen the canvas. The standalone app runs directly
from this checkout and does not require copying anything.

## Model and Foundry configuration

Python virtual environments are not tracked by Git. `maf\.env` is private and
ignored; `.env.example` is the shareable template. Do not commit tenant/project
configuration or credentials.

### Authenticate to Foundry

Screens 3 and 4's Microsoft Foundry chats use Azure Identity's
`AzureCliCredential`. Sign in to Azure CLI **as the same Windows user running
the app**, using the tenant configured as `AZURE_TENANT_ID` in `maf\.env`:

```powershell
az login --tenant <your-tenant-id>
az account show --query "{user:user.name, tenant:tenantId, subscription:name}" -o table
```

The second command confirms which account and tenant Azure CLI will use. Restart
the local app after signing in, then retry the Foundry chat. Do not copy an
access token into the app or `.env`.

Signing in supplies an identity token; it **does not grant access** to the
Foundry project or model. If the chat returns `403` or `PermissionDeniedError`,
verify that the signed-in identity has the required Foundry project and model
inference permissions, and that `FOUNDRY_PROJECT_ENDPOINT` points to the intended
project. A `403` alone cannot distinguish missing permissions from every other
access restriction.

If the installed canvas works but the standalone app fails, compare
`FOUNDRY_PROJECT_ENDPOINT` in each copy's `maf\.env`. They are separate files:
the standalone app does not inherit the installed extension's configuration.
Use the project endpoint containing the intended model deployment, then restart
the app. A valid login cannot compensate for pointing at a different project
where the deployment or inference permissions are missing.

For Foundry chat, set `AZURE_TENANT_ID` and `FOUNDRY_PROJECT_ENDPOINT` in
`maf\.env`. The default deployment is `MAI-Thinking-1`;
`FOUNDRY_MODEL_DEPLOYMENT_NAME` can override it. Existing environment variables
take precedence over `.env` values.

Model names can be edited in `maf\.env`:

| Variable | Default | Used by |
|---|---|---|
| `FOUNDRY_MODEL_DEPLOYMENT_NAME` | `MAI-Thinking-1` | Foundry chat |
| `FOUNDRY_MEMORY_MODEL_DEPLOYMENT_NAME` | `gpt-chat-latest` | Screen 4 Foundry memory comparison; must be an existing deployment in the configured project |
| `OLLAMA_MODEL` | `phi3:3.8b` | Local Phi chat, memory, and skills demos |
| `OLLAMA_CHAT_LLAMA_MODEL` | `llama3.2:1b` | Local Llama choice on screens 3 and 4 |
| `OLLAMA_TOOLS_MODEL` | `llama3.2:1b` | Local calculator and tools demos |
| `FOUNDRY_TOOLS_MODEL_DEPLOYMENT_NAME` | None; supply an existing Azure OpenAI deployment | Foundry tools setup |

Pull any newly selected local model with `ollama pull <model-name>`.
Restart the app (or reload the extension) after changing chat models.
For Foundry tools, changing the model setting alone does not modify an existing
saved agent: rerun `setup_foundry_tools.py`, update
`FOUNDRY_TOOLS_AGENT_VERSION` to the printed version, then restart.
These settings apply to the copy of `maf\.env` beside the running bridge;
the separately installed extension does not read this repository's `.env`.

### Development checks

```powershell
npm test
.\.venv\Scripts\python.exe -m unittest discover -s .\maf -p "test_*.py"
```

The dependency-free Node tests cover the exact eight-screen HTML, reveal/SSE
state, code views, HTTP request forwarding, streamed chat/tool/skill events,
backend errors, and standalone startup. They stub agent responses and do not
contact Ollama or Azure. The Python tests exercise agent behavior with simulated
model/service responses; live chats require your configured model services.

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
