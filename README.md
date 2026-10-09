# Agents Under the Hood

Source for the existing Copilot canvas: six reveal cards, an animated agent
harness, and model chat with a code card. This is a migration of the current
implementation, not yet a standalone browser app.

## Layout

- `extension.mjs`: Copilot canvas registration and loopback HTTP server.
- `index.html`: the three-screen UI.
- `components.mjs`: reveal-card content and helpers.
- `maf\`: Python Agent Framework bridge, local and Foundry agents, dependencies,
  and an example configuration.

The source lives at the project root deliberately. Copilot discovers project
extensions under `.github\extensions\`, so this copy does not register a second
provider. The existing installation at
`C:\Users\pauld\.copilot\extensions\agents-under-the-hood` remains untouched and
continues serving the current canvas. Changes here do not update that installation.

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
