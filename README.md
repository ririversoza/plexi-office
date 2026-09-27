# ✦ Plexi Office

A cozy, chibi-style isometric office for your AI coding agents. You're the manager, walking around in third person. Every agent is a real CLI session (Claude Code, Codex, or Cursor Agent), and where they stand in the office shows what they're actually doing.

```bash
npm install
npm start          # → http://127.0.0.1:4777
```

Requires Node 20+ and macOS or Linux. `npm install` also fixes node-pty's `spawn-helper` permissions (postinstall).

## The floor

| Where | Who goes there | How the office knows |
|---|---|---|
| **Team pods** (Claude / Codex / Cursor) | Agents that are working, or asleep at their desk when off the clock | terminal output, Claude Code hooks |
| **☕ Break Room** | Agents paused between turns, and scheduled breaks | idle terminal, `Stop` hook, Codex `notify` |
| **⚔ Merge Conflict Room** | Agents with unmerged files or conflict output | `git diff --diff-filter=U` in their folder, plus output patterns |
| **★ Manager's Office** | Agents waiting on *you*: permission prompts, trust prompts, questions | `Notification` / `AskUserQuestion` hooks and what's on their screen |
| **🌙 Dorms (2F)** | Agents who are off the clock, asleep in their own beds | the CLI isn't running |

The dorm is on the 2nd floor. Agents ride the elevator up when they clock out and back down when they clock in. You can go upstairs with the **1F / 2F** switch in the HUD, or press `E` at the elevator; the office dims below you while you're up there.

**Click an agent** (or its roster row) to open its terminal. If its CLI isn't installed, the drawer offers the vendor's official installer, runs it in a terminal you can watch, then clocks the agent in:

- Claude Code: `curl -fsSL https://claude.ai/install.sh | bash`
- Codex CLI: `npm install -g @openai/codex`
- Cursor Agent: `curl https://cursor.com/install -fsS | bash`

**Controls:** `WASD`/arrows to walk · click the floor to walk there · drag to look around · scroll to zoom · `E` opens the nearest agent · `Esc` hides the drawer (agents keep working) · `Space` recentres the camera.

## Your character

You're **Starlight** by default: twin buns, long violet hair, sparkly eyes, a lavender off-shoulder dress, and hands on hips. Click yourself or press ✨ in the HUD to customize.

The customizer has a live preview you can turn around or make walk, plus presets (🌙 Starlight, 👑 Classic boss, 🎲 Surprise me). You can change:

- hair style, colour, tips and shine
- eye style and colour, and skin tone
- outfit and its colours, boots
- accessories, idle pose and idle mood
- choker, sparkles and glasses

Your look is saved in `data/settings.json`.

## Staff

- **📋 Juniper, Assistant Manager.** Sits next to your desk. The **Report** button asks her for a progress report. She runs `plexi status --tails`, which reads every agent's live screen, and you get a toast when it's ready.
- **💐 Poppy, HR.** Ask her in her terminal to hire people ("hire two Codex agents for ~/code/api"). She uses `plexi hire`, which only HR may call. New hires walk in through the front door. You can also hire directly with the **Hire** button.


### HR sanctions

Poppy keeps office conduct, for example when an agent copies another agent's code or reads their worktree without being asked.

- **Warning** 🟨 is the first step. It stays on the agent's record for 7 days, the agent is told why in their terminal, and it goes in the Office Feed (📋 HR).
- **Suspension** 🟥 is only possible while a warning is active. It lasts 5–240 minutes, clocks the agent out, and blocks starting or assigning them until it ends.
- Only coding agents can be sanctioned, and every sanction needs a concrete reason. An active sanction is included in the agent's instructions the next time they launch. You can lift any sanction from the agent's panel. Records live in `data/sanctions.json`.
## Personalities

Every agent gets an archetype (Sunshine Optimist, Bug Sleuth, Code Poet, Minimalist…). It's injected into the CLI:

- Claude: `--append-system-prompt`
- Codex: `-c developer_instructions=…`

It shapes tone only. The prompt tells agents it must never cost correctness. Cursor Agent has no documented system-prompt flag, so its personality shows up in the office and via `plexi whoami`.

## Social life

Agents on break pair up, sometimes walking across the room to find someone, and chat in speech bubbles. The chats draw on their personalities, teams, and project folders: jokes, team banter, high-fives, selfies. Agents in the conflict room argue it out. Thought bubbles show what an agent is doing. For Claude this is live, e.g. `✏️ app.ts` or `$ npm test` from its tool hooks; otherwise they show personality-flavoured musings. Expressions and poses (wink, sparkle eyes, 💢, tears, facepalm, crossed arms, stretch, cheer…) follow what's happening.

**Relationships.** Every pair of agents builds a history. Chats, jokes and high-fives warm them up, and conflict-room arguments cool them down. Personality compatibility matters: a Sunshine Optimist and a Team Cheerleader click, while a Code Poet and a Minimalist bicker. Pairs move through 😤 Enemies ⇄ ⚔️ Rivals ⇄ 🙂 Coworkers ⇄ 🤝 Friends ⇄ 💛 Best friends, and good friends with chemistry can develop a 💗 crush and become 💕 sweethearts.

Relationships change who seeks out whom on breaks and what they say to each other. They also add floating hearts or 💢 sparks when two agents are near each other, and you get an "office gossip" toast whenever a relationship changes. Each agent's drawer has a 💞 Relationships panel.

Relationships are stored in `data/relationships.json`, and the server does the maths; browsers only report what happened. Office romance can be switched off in ⚙ Settings.

**Scheduled breaks** (⚙ Settings, default: 3 min after every 15 min of work). The break starts at the agent's next natural pause. Plexi never freezes a CLI mid-task, because suspending the process could break its API stream. Giving the agent new work ends the break early, and questions and conflicts always take priority.

## Memory: Supermemory Local

Each agent has its own long-term memory space in a local [Supermemory](https://github.com/supermemoryai/supermemory#supermemory-local--run-it-yourself) server, plus shared office notes. Click the **Memory** chip or the server racks in the corner to set it up:

1. **Install:** runs `curl -fsSL https://supermemory.ai/install | bash`.
2. **Start server:** runs `supermemory-server` in a terminal here. Answer its first-boot questions there; they go straight to Supermemory.
3. **Connect:** the API key printed on first boot is picked up automatically, or you can paste it. It's kept in memory only and never written to disk or sent to the browser. Set `SUPERMEMORY_API_KEY` before `npm start` to keep it across restarts.

**Using a local model (LM Studio, Ollama…):** in the Memory Vault, under **Model provider**:

1. Enter the OpenAI-compatible base URL, e.g. `http://localhost:1234/v1` for LM Studio.
2. Click **Load models** and pick a chat model.
3. Save, then restart the memory server.

Plexi starts `supermemory-server` with `OPENAI_BASE_URL` / `OPENAI_MODEL` set. Embeddings stay local by default (bge-base, no key needed). If first boot still asks for a provider, choose the OpenAI-compatible option and enter the same URL and model.

Once connected:

- Claude agents get relevant memories injected at session start and on each prompt (hooks).
- Every agent can run `plexi memory search|add [--office] …`.
- Each finished turn is saved automatically (`PLEXI_AUTO_MEMORY=0` turns that off).

## The `plexi` helper (inside agent terminals)

```
plexi whoami | status [--tails] | tail <name> | memory search|add [--office] <text>
plexi roster | personalities | hire --name N --team claude|codex|cursor [--cwd DIR]   (HR only)
plexi assign <name> <task>   (Assistant Manager only: types the task into that agent's terminal)
plexi push | fetch | pr create --title T [--body B | --body-file F] [--draft]   (coding agents)
plexi pr list | pr view <number> [--diff]   (everyone, including the Assistant Manager)
plexi pr merge <number> [--squash|--rebase]   (Assistant Manager only; refuses drafts, conflicts, failing checks)
plexi sanction warn|suspend|lift|record <name> [--minutes N] --reason R   (HR; record also for the Assistant Manager)
plexi decor catalog | show | set [--desk plant,lamp,duck] [--desk-color C] [--blanket C] [--pillow C] [--plush P] [--lights on|off]   (anyone, own desk and bed)
plexi decor draw --desk FILE.svg | --bed FILE.svg   (their own SVG drawing; shown only as an image, no scripts or external links)
plexi chat read [--limit N] | chat post <message>   (office group chat; @Name / @all mentions reach Claude agents mid-work)
plexi report <what you did>   (tell Juniper you finished; filed automatically after a long turn if forgotten)  ·  plexi reports   (Juniper's inbox; the office wakes her with each new report when she's idle, batched, at most every 20 s)
```

## Security notes

This app spawns shells, so it's locked to your machine:

- It binds to `127.0.0.1` only and checks the `Host` header, which blocks DNS rebinding.
- State changes and the WebSocket require the office's own `Origin`, so other websites can't drive it.
- Agent callbacks (hooks, `plexi`) use per-agent HMAC tokens derived from a per-launch secret.
- Installers are a fixed allow-list; nothing you type reaches a shell command line.

### Workspace lock

Agents can only change files in the office workspace, `~/plexi-workspace` (a clone of [ririversoza/plexi-workspace](https://github.com/ririversoza/plexi-workspace)). This applies whatever permission preset you pick:

- Every agent's folder must be inside the workspace. Hires and edits pointing elsewhere are refused, and older saves are moved back in.
- **Claude Code**: a `PreToolUse` hook (`server/hooks/guard.js`) denies Edit/Write/MultiEdit/NotebookEdit outside the workspace, symlinks included, and fails closed. The Bash sandbox (macOS Seatbelt) keeps shell writes in the workspace and temp dir, with unsandboxed retries turned off. Its network is limited to the office helper, GitHub and npm; anything else prompts. Localhost is reachable from inside the sandbox (`allowLocalBinding`) so `plexi` works even in chained commands. Nothing runs unsandboxed. Agents push and open PRs through `plexi`, which the office runs with your own git and `gh` login (`server/github.js`). Only the workspace repo, never `main`, never a force push.
- **Claude Code** also launches with `--setting-sources user`, so a `.claude/settings.json` written into the workspace is ignored. The edit guard and sandbox also block writes to `.claude/`, `.codex/` and `.cursor/` there.
- **Codex**: always `--sandbox workspace-write` (the full-access option is gone). Network is on so `plexi` works, and extra writable roots are pinned to none.
- **Cursor Agent**: `--sandbox enabled --workspace <workspace>`. Its sandbox allows localhost and blocks writes outside the workspace, including to `.cursor/`. Codex's sandbox can still write there, so Plexi moves any `.cursor/sandbox.json` that appears aside (`sandbox.json.rejected-<time>`), checks again before each launch, and warns you. Avoid Cursor's "Run Everything" option: it turns the sandbox off.

## Configuration

| Env var | Default |
|---|---|
| `PLEXI_PORT` | `4777` |
| `PLEXI_DEFAULT_CWD` | `~/plexi-workspace`, the only folder agents may change |
| `PLEXI_DATA_DIR` | `./data` (`agents.json`, `settings.json`, `relationships.json`, `supermemory/`) |
| `SUPERMEMORY_URL` / `SUPERMEMORY_API_KEY` | `http://localhost:6767` / unset |
| `PLEXI_AUTO_MEMORY` | on (`0` disables) |

Codex note: Plexi sets Codex's `notify` hook with `-c`, which overrides any `notify` in your `~/.codex/config.toml` for office sessions.

## Development

```bash
npm test           # node:test — status detection, breaks, relationships, tools API, pathfinding, memory
npm run dev        # restart the server on changes
```

Add `?debug` to the URL to get `window.plexi` in devtools.

Code map:

- `server/`: Express + ws + node-pty. `status.js` works out where each agent belongs; `breaks.js` runs the schedule; `tools.js` is the `plexi` API.
- `public/js/`: canvas renderer.
  - `world.js`: floor plan
  - `chibi.js`, `chibi-face.js`: characters
  - `social.js`, `dialog.js`: conversations
  - `drawer.js`: terminals
