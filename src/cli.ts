#!/usr/bin/env bun
import { appsToCache, resolveApp } from "./app-resolver.ts";
import { CONFIG_PATH, readConfig, saveDevice, writeConfig } from "./config.ts";
import { discoverRokus } from "./discovery.ts";
import { CONVENIENCE_KEYS, resolveKey } from "./keys.ts";
import { RokuClient } from "./roku-client.ts";
import type { Config, OutputMode, RokuActiveApp, RokuApp, SavedDevice } from "./types.ts";
import { assertIp, clampNumber, CliError, isIp, normalizeName, parseJsonFlag, parsePositiveInt, requireArg } from "./utils.ts";

const TEXT_MAX_LENGTH = 256;

async function main(): Promise<void> {
  const parsed = parseJsonFlag(Bun.argv.slice(2));
  const [command, ...args] = parsed.args;
  const output: OutputMode = parsed.json ? "json" : "text";

  if (!command || command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command in CONVENIENCE_KEYS) {
    await commandKey(requireArg(args[0], "device"), CONVENIENCE_KEYS[command], output);
    return;
  }

  switch (command) {
    case "discover":
      await commandDiscover(output);
      break;
    case "add":
      await commandAdd(requireArg(args[0], "name"), requireArg(args[1], "ip"), output);
      break;
    case "list":
      await commandList(output);
      break;
    case "info":
      await commandInfo(requireArg(args[0], "device"), output);
      break;
    case "apps":
      await commandApps(requireArg(args[0], "device"), output);
      break;
    case "active":
      await commandActive(requireArg(args[0], "device"), output);
      break;
    case "key":
      await commandKey(requireArg(args[0], "device"), resolveKey(requireArg(args[1], "key")), output);
      break;
    case "hold":
      await commandHold(requireArg(args[0], "device"), resolveKey(requireArg(args[1], "key")), requireArg(args[2], "ms"), output);
      break;
    case "launch":
      await commandLaunch(requireArg(args[0], "device"), requireArg(args[1], "app"), output);
      break;
    case "type":
      await commandType(requireArg(args[0], "device"), args.slice(1).join(" "), output);
      break;
    default:
      throw new CliError(`Unknown command: ${command}`);
  }
}

async function commandDiscover(output: OutputMode): Promise<void> {
  const devices = await discoverRokus();

  print(output, devices, () => {
    if (devices.length === 0) {
      return "No Roku devices found.";
    }

    return devices
      .map((device) => {
        const details = [
          device.friendlyName,
          device.model,
          device.serialNumber ? `serial ${device.serialNumber}` : undefined,
          device.deviceId ? `id ${device.deviceId}` : undefined
        ].filter(Boolean);

        return `${device.ip}${details.length ? `  ${details.join("  ")}` : ""}`;
      })
      .join("\n");
  });
}

async function commandAdd(name: string, ipInput: string, output: OutputMode): Promise<void> {
  const ip = assertIp(ipInput);
  const client = new RokuClient(ip);
  const deviceInfo = await client.getDeviceInfo();
  const normalized = await saveDevice(name, {
    ip,
    lastSeen: new Date().toISOString(),
    deviceInfo
  });

  print(output, { name: normalized, ip, configPath: CONFIG_PATH }, () => `Saved ${normalized} at ${ip}.`);
}

async function commandList(output: OutputMode): Promise<void> {
  const config = await readConfig();
  const entries = await Promise.all(
    Object.entries(config.devices).map(async ([name, device]) => {
      const client = new RokuClient(device.ip, 1500);

      try {
        const activeApp = await client.getActiveApp();
        device.lastSeen = new Date().toISOString();
        return { name, ip: device.ip, reachable: true, activeApp };
      } catch {
        return { name, ip: device.ip, reachable: false, activeApp: null };
      }
    })
  );

  await writeConfig(config);
  print(output, entries, () => {
    if (entries.length === 0) {
      return `No saved devices. Add one with "roku add <name> <ip>".`;
    }

    return entries
      .map((entry) => {
        const status = entry.reachable ? "online" : "offline";
        const active = entry.activeApp ? `  active: ${formatActiveApp(entry.activeApp)}` : "";
        return `${entry.name}  ${entry.ip}  ${status}${active}`;
      })
      .join("\n");
  });
}

async function commandInfo(deviceArg: string, output: OutputMode): Promise<void> {
  const { client, name } = await resolveDevice(deviceArg);
  const info = await client.getDeviceInfo();
  await updateSavedDevice(name, { deviceInfo: info, lastSeen: new Date().toISOString() });

  print(output, info, () =>
    Object.entries(info)
      .map(([key, value]) => `${key}: ${String(value)}`)
      .join("\n")
  );
}

async function commandApps(deviceArg: string, output: OutputMode): Promise<RokuApp[]> {
  const { client, name } = await resolveDevice(deviceArg);
  const apps = await client.getApps();
  await updateSavedDevice(name, { apps: appsToCache(apps), lastSeen: new Date().toISOString() });

  print(output, apps, () => apps.map((app) => `${app.name}  ${app.id}`).join("\n"));
  return apps;
}

async function commandActive(deviceArg: string, output: OutputMode): Promise<void> {
  const { client, name } = await resolveDevice(deviceArg);
  const activeApp = await client.getActiveApp();
  await updateSavedDevice(name, { lastSeen: new Date().toISOString() });

  print(output, activeApp, () => (activeApp ? formatActiveApp(activeApp) : "No active app reported."));
}

async function commandKey(deviceArg: string, key: string, output: OutputMode): Promise<void> {
  const { client, name } = await resolveDevice(deviceArg);
  await client.keypress(key);
  await updateSavedDevice(name, { lastSeen: new Date().toISOString() });

  print(output, { device: deviceArg, key }, () => `Sent ${key}.`);
}

async function commandHold(deviceArg: string, key: string, msInput: string, output: OutputMode): Promise<void> {
  const ms = clampNumber(parsePositiveInt(msInput, "Hold duration"), 100, 5000);
  const { client, name } = await resolveDevice(deviceArg);

  try {
    await client.keydown(key);
    await Bun.sleep(ms);
  } finally {
    await client.keyup(key);
  }

  await updateSavedDevice(name, { lastSeen: new Date().toISOString() });
  print(output, { device: deviceArg, key, ms }, () => `Held ${key} for ${ms}ms.`);
}

async function commandLaunch(deviceArg: string, appInput: string, output: OutputMode): Promise<void> {
  const resolved = await resolveDevice(deviceArg);
  const apps = await resolved.client.getApps();
  const appId = resolveApp(appInput, resolved.savedDevice, apps);

  await resolved.client.launch(appId);
  await updateSavedDevice(resolved.name, { apps: appsToCache(apps), lastSeen: new Date().toISOString() });

  print(output, { device: deviceArg, app: appInput, appId }, () => `Launched ${appInput} (${appId}).`);
}

async function commandType(deviceArg: string, text: string, output: OutputMode): Promise<void> {
  if (!text) {
    throw new CliError("Missing required argument: text");
  }

  if (text.length > TEXT_MAX_LENGTH) {
    throw new CliError(`Text is too long. Maximum length is ${TEXT_MAX_LENGTH} characters.`);
  }

  const { client, name } = await resolveDevice(deviceArg);
  await client.inputText(text);
  await updateSavedDevice(name, { lastSeen: new Date().toISOString() });

  print(output, { device: deviceArg, length: text.length }, () => `Sent ${text.length} characters.`);
}

async function resolveDevice(deviceArg: string): Promise<{ client: RokuClient; ip: string; name?: string; savedDevice?: SavedDevice }> {
  if (isIp(deviceArg)) {
    const ip = assertIp(deviceArg);
    return { client: new RokuClient(ip), ip };
  }

  const name = normalizeName(deviceArg);
  const config = await readConfig();
  const savedDevice = config.devices[name];

  if (!savedDevice) {
    throw new CliError(`Unknown device: ${deviceArg}`);
  }

  return { client: new RokuClient(savedDevice.ip), ip: savedDevice.ip, name, savedDevice };
}

async function updateSavedDevice(name: string | undefined, patch: Partial<SavedDevice>): Promise<void> {
  if (!name) return;

  const config: Config = await readConfig();
  const existing = config.devices[name];
  if (!existing) return;

  config.devices[name] = { ...existing, ...patch };
  await writeConfig(config);
}

function print(output: OutputMode, jsonValue: unknown, text: () => string): void {
  if (output === "json") {
    console.log(JSON.stringify(jsonValue, null, 2));
  } else {
    console.log(text());
  }
}

function formatActiveApp(activeApp: RokuActiveApp): string {
  return activeApp.id ? `${activeApp.name} (${activeApp.id})` : activeApp.name;
}

function printHelp(): void {
  console.log(`Usage: roku <command> [args] [--json]

Commands:
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
  home|back|select|up|down|left|right|play|pause|rewind|forward|volume-up|volume-down|mute|power <device>`);
}

main().catch((error: unknown) => {
  if (error instanceof CliError) {
    console.error(error.message);
    process.exit(error.exitCode);
  }

  if (error instanceof Error && error.name === "AbortError") {
    console.error("Roku request timed out.");
    process.exit(1);
  }

  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
