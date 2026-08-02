Project by Zach Fisher and York Li

## Spin up API and Client
From root repo
``` bash
pnpm install
pnpm dev
```

Local URLs:
* Web app: http://localhost:5173
* API health check: http://localhost:3001/health


## BMAD instructions

### Quick installer
```bash
npx bmad-method install
```
Then ask the agent to "use the bmad-loop-setup skill" to finish project bootstrapping.

### BMAD commands (quick reference)

- `bmad-loop init --project <path> [--cli <name>] [--force-skills]` : bootstrap project hooks, write `policy.toml`, and optionally refresh per-project skills.
- `bmad-loop validate --project <path>` : run preflight checks (config, skills, multiplexer, CLIs).
- `bmad-loop run --project <path>` : start the orchestrator loop for the project (requires validated environment and auth for adapters like Copilot).
- `bmad-loop tui --project <path>` : launch the TUI dashboard for interactive monitoring.
- `bmad-loop diagnose --project <path>` : detailed environment and adapter diagnostics.
- `bmad-loop mux` / `bmad-loop mux set <backend>` : list or set multiplexer backend (e.g., `tmux`).

- `npx bmad-method install --directory <path> --modules <comma-list> --tools <tool-ids>` : install BMAD modules and wire tool-specific skills (e.g. `--tools github-copilot,claude-code`).
- `npx bmad-method install --list-tools` : list available tool IDs the installer can wire into your project.


### Example workflow (common)
```bash
uv tool install "bmad-loop[tui] @ git+https://github.com/bmad-code-org/bmad-loop.git"
bmad-loop init --project "/path/to/project" --cli copilot --cli claude
npx bmad-method install --directory "/path/to/project" --modules bmm --tools github-copilot --yes
bmad-loop validate --project "/path/to/project"
bmad-loop run --project "/path/to/project"
```

Notes:
- Ensure your git worktree is clean before `bmad-loop run` (commit or stash installer artifacts).
- Install a multiplexer (e.g., `tmux`) and authenticate any CLIs (Copilot, Claude) used by your `policy.toml` adapter.


### BMAD Agent Skills
```
bmad-product-brief (CB) - define the app’s purpose, target users, must-have PWA behaviors, and non-goals.
bmad-ux (CU) - if the UI is central, lock the mobile-first flows, install prompt, offline states, and empty/error states early.
bmad-prd (PRD) - freeze scope and requirements so the scaffold does not drift.
bmad-architecture (CA) - define the monorepo boundaries, app/package layout, data flow, and deployment shape.
bmad-create-epics-and-stories (CE) - break the scaffold into buildable slices.
bmad-check-implementation-readiness (IR) - verify the plan is consistent before implementation.
```

Chat Skills (Copilot Chat): You use @bmad-pm to write the PRD and @bmad-sm to break it into markdown story files.

Terminal Skills (CLI): Once the stories exist, open the terminal and run a command like /bmad-build (or the equivalent Developer skill) against story-1.md to actually generate the code.