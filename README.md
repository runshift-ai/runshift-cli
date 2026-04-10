# runshift
The control plane for AI agents.

## Install coordination rules in 30 seconds

```
npx runshift init
```

relay scans your repo and installs coordination 
rules so agents working in parallel don't collide.

## What it does

1. Scans your repo — detects your stack, existing 
   rules, migration files, env variables (key names only)
2. Generates rules — coordination rules specific 
   to your codebase, not a generic template
3. Shows everything first — findings, files, browser 
   preview before anything is written
4. Writes on confirmation — you approve, relay commits

## Commands

| Command | Description |
|---|---|
| `npx runshift init` | Install coordination rules |
| `npx runshift init --dry-run` | Preview without writing |
| `npx runshift init --branch <name>` | Run on a new branch |
| `npx runshift remove` | Remove installed rules |

## Running multiple agents in parallel?

Claude Code, Cursor, or any AI agent working on 
the same codebase at the same time will collide 
without coordination. runshift.ai is the control 
plane — scan your repo, coordinate agents, and 
intercept consequential actions before they run.

**find where your agents could collide — takes 2 minutes**
→ runshift.ai

## Privacy

The harness reads your repository structure, dependency manifest, environment variable key names, and any existing agent configuration files (CLAUDE.md, .cursor/rules/*) to generate accurate, repo-specific output. No source code files are sent. Nothing collected is stored — it is used only to generate your configuration files and discarded.

- No secret values read
- Every file shown before writing
- You confirm before anything changes

## Revert

Everything relay installs is committed with one message:

```
chore: install runshift coordination rules
```

Undo instantly:

```
git revert HEAD
```

Or remove directly:

```
npx runshift remove
```

---

MIT License · github.com/devincrane/runshift
