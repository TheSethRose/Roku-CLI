---
name: skill
description: "Control Roku TVs with the local Roku CLI. Use when an agent needs to discover, register, inspect, launch apps, send remote actions, type text, or remove saved Roku devices using explicit --device commands."
---

# Roku TV Control

Use the repo-local Roku CLI. Do not call Roku HTTP endpoints directly.

## Agent Workflow

1. Discover devices when the user has not named a saved device:

```bash
bun run src/cli.ts discover --json
```

2. Register the target once with a stable lowercase kebab-case name:

```bash
bun run src/cli.ts add <ip|device-id|serial|friendly-name>
```

3. After registration, use fully qualified commands. Always include `--device`.

```bash
bun run src/cli.ts action launch Netflix --device living-room
bun run src/cli.ts action home --device living-room
bun run src/cli.ts action type "star trek" --device living-room
bun run src/cli.ts status --device living-room --json
```

## Command Pattern

Prefer these agent-facing commands:

```bash
bun run src/cli.ts devices --json
bun run src/cli.ts status --device <device> --json
bun run src/cli.ts action <action> [value] --device <device>
bun run src/cli.ts remove <ip|device-id|serial|saved-name>
```

Supported actions:

```text
home
back
select
up
down
left
right
play
pause
rewind
forward
volume-up
volume-down
mute
power
launch <app>
type <text>
hold <key> <ms>
```

## Rules

- Treat Roku control as stateless. There is no connect or disconnect step.
- Use `add <target>` after discovery; target may be IP, device id, serial number, or friendly name. Use `add <name> <ip>` only when a manual saved name is needed.
- Prefer saved device names over raw IPs after setup.
- Use `--json` for inspection commands when another agent will parse output.
- Do not call `apps` before `action launch`; launch resolves and refreshes apps itself.
- If `action launch` reports ambiguous app matches, ask the user which app to launch.
- Use `remove <target>` when a saved device should no longer be available; target may be saved name, IP, device id, serial number, or friendly name.
- Do not use arbitrary URLs, paths, shell commands, or raw Roku protocol endpoints.
