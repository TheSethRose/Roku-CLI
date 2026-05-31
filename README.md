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
bun run src/cli.ts add living-room 192.168.1.78
bun run src/cli.ts list
bun run src/cli.ts apps living-room
bun run src/cli.ts launch living-room YouTube
bun run src/cli.ts key living-room Home
bun run src/cli.ts type living-room "star trek"
```

Most commands also support JSON output:

```sh
bun run src/cli.ts discover --json
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

## Commands

```text
discover
add <name> <ip>
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
