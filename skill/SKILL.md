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

For noninteractive agent runs, pass the saved name explicitly:

```bash
bun run src/cli.ts add <ip|device-id|serial|friendly-name> --name living-room
```

3. After registration, use fully qualified commands. Always include `--device`.

```bash
bun run src/cli.ts action launch Netflix --device living-room
bun run src/cli.ts action home --device living-room
bun run src/cli.ts action type "star trek" --device living-room
bun run src/cli.ts status --device living-room --json
```

Human-friendly commands may use device-first grammar:

```bash
bun run src/cli.ts living-room launch Netflix
bun run src/cli.ts living-room home
bun run src/cli.ts living-room status
```

Users can set a current device for shorter manual commands:

```bash
bun run src/cli.ts use living-room
bun run src/cli.ts launch Netflix
bun run src/cli.ts home
```

## Command Pattern

Prefer these agent-facing commands:

```bash
bun run src/cli.ts devices --json
bun run src/cli.ts channels --device <device> --json
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
- For agent automation, prefer `action <action> [value] --device <device>` and `status --device <device> --json`.
- For human-facing examples, prefer `roku <device> <action>` or `roku use <device>` followed by short commands.
- Use `add <target>` after discovery; target may be IP, device id, serial number, or friendly name. The CLI prompts for the saved name in interactive shells.
- Use `add <target> --name <saved-name>` in noninteractive agent runs.
- Prefer saved device names over raw IPs after setup, but `--device` may also be a saved IP, Roku device id, serial number, or saved Roku friendly name.
- `add` caches installed channels when the Roku allows channel listing.
- Use `channels --device <device> --json` to list installed apps/channels.
- If `channels` fails with Limited mode, launch can still use cached channel ids or built-in common ids.
- If an action fails with HTTP 403, tell the user to set Roku `Settings > System > Advanced system settings > Control by mobile apps > Network access` to `Permissive`.
- Use `--json` for inspection commands when another agent will parse output.
- Do not call `apps` before `action launch`; launch resolves and refreshes apps itself.
- If `action launch` reports ambiguous app matches, ask the user which app to launch.
- Use `remove <target>` when a saved device should no longer be available; target may be saved name, IP, device id, serial number, or friendly name.
- Do not use arbitrary URLs, paths, shell commands, or raw Roku protocol endpoints.
