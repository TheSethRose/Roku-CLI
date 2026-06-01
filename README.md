# Roku CLI

Local-first TypeScript/Bun CLI for discovering and controlling Roku devices on a LAN.

The command surface is intentionally constrained so it can be called by an AI agent without granting arbitrary network or HTTP access.

## Install

```sh
bun install
```

## Run

```sh
bun run src/cli.ts discover
bun run src/cli.ts add 192.168.1.78
bun run src/cli.ts action launch Netflix --device living-room
bun run src/cli.ts action home --device living-room
bun run src/cli.ts action type "star trek" --device living-room
bun run src/cli.ts status --device living-room
```

Most commands also support JSON output:

```sh
bun run src/cli.ts discover --json
bun run src/cli.ts devices --json
bun run src/cli.ts status --device living-room --json
```

## Build

```sh
bun run build
./roku discover
```

## Config

Saved devices live at:

```text
~/.config/roku-cli/config.json
```

Device names are normalized to lowercase kebab-case. A device argument can be a saved name or a raw IP address. Raw IPs are not saved unless `add` is used.

## Agent Workflow

Roku ECP is stateless HTTP, so there is no connect or disconnect step. Discover/register a device once, then send fully qualified commands.

```sh
bun run src/cli.ts discover --json
bun run src/cli.ts add 192.168.1.78
bun run src/cli.ts action launch Netflix --device living-room
```

`add` can resolve a discovered Roku by IP, device id, serial number, or discovered friendly name:

```sh
bun run src/cli.ts add 192.168.1.78
bun run src/cli.ts add S0EF333HGTJ8
bun run src/cli.ts add "Living Room TV"
```

Manual naming is still supported:

```sh
bun run src/cli.ts add living-room 192.168.1.78
```

Preferred agent command pattern:

```text
bun run src/cli.ts action <action> [value] --device <saved-device-name>
```

Examples:

```sh
bun run src/cli.ts devices --json
bun run src/cli.ts status --device living-room --json
bun run src/cli.ts action launch Netflix --device living-room
bun run src/cli.ts action volume-up --device living-room
bun run src/cli.ts action type "star trek" --device living-room
bun run src/cli.ts remove living-room
bun run src/cli.ts remove 192.168.1.78
```

## Primary Commands

```text
discover
add <ip|id|name>
add <name> <ip>
remove <ip|id|name>
devices
status --device <device>
action <action> [value] --device <device>
```

## Advanced Commands

These are kept for debugging and direct Roku protocol work. Agents should prefer `action`, `status`, and `devices`.

```text
list
info <device>
apps <device>
active <device>
key <device> <key>
hold <device> <key> <ms>
launch <device> <app>
type <device> <text>
home|back|select|up|down|left|right|play|pause|rewind|forward|volume-up|volume-down|mute|power <device>
```

## Safety

- No arbitrary URLs.
- No arbitrary Roku endpoint paths.
- No shell execution.
- No public server.
- Only allowlisted Roku keys.
- Text input is URL encoded and length-limited.
- Held button duration is clamped to a safe range.
