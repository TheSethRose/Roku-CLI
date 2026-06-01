#!/usr/bin/env bun
import { appsToCache, resolveApp } from "./app-resolver.ts";
import { CONFIG_PATH, readConfig, removeDevice, saveDevice, writeConfig } from "./config.ts";
import { discoverRokus } from "./discovery.ts";
import { CONVENIENCE_KEYS, resolveKey } from "./keys.ts";
import { RokuClient } from "./roku-client.ts";
import type { Config, DeviceListEntry, DiscoveredDevice, JsonObject, OutputMode, RokuActiveApp, RokuApp, SavedDevice } from "./types.ts";
import { assertIp, clampNumber, CliError, isIp, normalizeName, parseJsonFlag, parsePositiveInt, requireArg } from "./utils.ts";

const TEXT_MAX_LENGTH = 256;

async function main(): Promise<void> {
  const parsed = parseJsonFlag(Bun.argv.slice(2));
  const [command, ...args] = parsed.args;
  const output: OutputMode = parsed.json ? "json" : "text";

  if (command === "help" && args[0] === "advanced") {
    printAdvancedHelp();
    return;
  }

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
      await commandAdd(args, output);
      break;
    case "remove":
      await commandRemove(args, output);
      break;
    case "devices":
      await commandDevices(output);
      break;
    case "list":
      await commandList(output);
      break;
    case "status":
      await commandStatus(args, output);
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
    case "action":
      await commandAction(args, output);
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

async function commandAdd(args: string[], output: OutputMode): Promise<void> {
  requireArg(args[0], "target");
  const lastArg = args.at(-1);

  if (args.length >= 2 && lastArg && isIp(lastArg)) {
    await commandAddManual(args.slice(0, -1).join(" "), lastArg, output);
    return;
  }

  await commandAddDiscovered(args.join(" "), output);
}

async function commandAddManual(name: string, ipInput: string, output: OutputMode): Promise<void> {
  const ip = assertIp(ipInput);
  const client = new RokuClient(ip);
  const deviceInfo = await client.getDeviceInfo();
  const savedName = await saveDevice(name, {
    ip,
    lastSeen: new Date().toISOString(),
    deviceInfo
  });

  print(output, { name: savedName, ip, configPath: CONFIG_PATH }, () => `Saved ${savedName} at ${ip}.`);
}

async function commandAddDiscovered(target: string, output: OutputMode): Promise<void> {
  const discovered = isIp(target) ? undefined : await resolveDiscoveredTarget(target);
  const ip = discovered?.ip ?? (isIp(target) ? assertIp(target) : undefined);

  if (!ip) {
    throw new CliError(`No discovered Roku matched "${target}". Run "roku discover --json" or use "roku add <name> <ip>".`);
  }

  const client = new RokuClient(ip);
  const deviceInfo = await client.getDeviceInfo();
  const config = await readConfig();
  const savedName = await saveDevice(deriveDeviceName(target, ip, discovered, deviceInfo, config), {
    ip,
    lastSeen: new Date().toISOString(),
    deviceInfo
  });

  print(output, { name: savedName, ip, configPath: CONFIG_PATH }, () => `Saved ${savedName} at ${ip}.`);
}

async function commandRemove(args: string[], output: OutputMode): Promise<void> {
  const target = args.join(" ");
  requireArg(target, "target");
  const config = await readConfig();
  const name = await resolveSavedDeviceForRemoval(target, config);

  await removeDevice(name);
  print(output, { name, removed: true }, () => `Removed ${name}.`);
}

async function commandDevices(output: OutputMode): Promise<void> {
  const devices = await getDeviceList();

  print(output, { devices }, () => {
    if (devices.length === 0) {
      return `No saved devices. Add one with "roku add <name> <ip>".`;
    }

    return devices.map(formatDeviceListEntry).join("\n");
  });
}

async function commandList(output: OutputMode): Promise<void> {
  const devices = await getDeviceList();

  print(output, devices, () => {
    if (devices.length === 0) {
      return `No saved devices. Add one with "roku add <name> <ip>".`;
    }

    return devices.map(formatDeviceListEntry).join("\n");
  });
}

async function commandStatus(args: string[], output: OutputMode): Promise<void> {
  const parsed = parseDeviceOption(args);
  const deviceArg = parsed.device ?? parsed.args[0];

  if (!deviceArg) {
    throw new CliError("Missing required option: --device <device>");
  }

  const { client, name, ip } = await resolveDevice(deviceArg);

  try {
    const [deviceInfo, activeApp, apps] = await Promise.all([client.getDeviceInfo(), client.getActiveApp(), client.getApps()]);
    await updateSavedDevice(name, {
      deviceInfo,
      apps: appsToCache(apps),
      lastSeen: new Date().toISOString()
    });

    print(output, { device: name ?? deviceArg, ip, online: true, activeApp, deviceInfo, appCount: apps.length }, () => {
      const active = activeApp ? formatActiveApp(activeApp) : "none";
      return `${name ?? deviceArg}  ${ip}  online  active: ${active}  apps: ${apps.length}`;
    });
  } catch {
    print(output, { device: name ?? deviceArg, ip, online: false, activeApp: null }, () => `${name ?? deviceArg}  ${ip}  offline`);
  }
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

async function commandAction(args: string[], output: OutputMode): Promise<void> {
  const parsed = parseDeviceOption(args);
  const action = requireArg(parsed.args[0], "action");
  const value = parsed.args.slice(1).join(" ");

  if (!parsed.device) {
    throw new CliError("Missing required option: --device <device>");
  }

  if (action === "launch") {
    await commandLaunch(parsed.device, requireArg(value, "app"), output);
    return;
  }

  if (action === "type") {
    await commandType(parsed.device, requireArg(value, "text"), output);
    return;
  }

  if (action === "hold") {
    const key = resolveKey(requireArg(parsed.args[1], "key"));
    const ms = requireArg(parsed.args[2], "ms");
    await commandHold(parsed.device, key, ms, output);
    return;
  }

  const key = CONVENIENCE_KEYS[action];

  if (!key) {
    throw new CliError(`Unknown action: ${action}`);
  }

  await commandKey(parsed.device, key, output);
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

async function getDeviceList(): Promise<DeviceListEntry[]> {
  const config = await readConfig();
  const devices = await Promise.all(
    Object.entries(config.devices).map(async ([name, device]) => {
      const client = new RokuClient(device.ip, 1500);

      try {
        const activeApp = await client.getActiveApp();
        device.lastSeen = new Date().toISOString();
        return { name, ip: device.ip, online: true, activeApp };
      } catch {
        return { name, ip: device.ip, online: false, activeApp: null };
      }
    })
  );

  await writeConfig(config);
  return devices;
}

async function updateSavedDevice(name: string | undefined, patch: Partial<SavedDevice>): Promise<void> {
  if (!name) return;

  const config: Config = await readConfig();
  const existing = config.devices[name];
  if (!existing) return;

  config.devices[name] = { ...existing, ...patch };
  await writeConfig(config);
}

function parseDeviceOption(args: string[]): { args: string[]; device?: string } {
  const filtered: string[] = [];
  let device: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--device") {
      device = requireArg(args[index + 1], "device");
      index += 1;
    } else {
      filtered.push(arg);
    }
  }

  return { args: filtered, device };
}

async function resolveDiscoveredTarget(target: string): Promise<DiscoveredDevice | undefined> {
  const devices = await discoverRokus();
  const matches = devices.filter((device) => discoveredDeviceMatches(device, target));

  if (matches.length > 1) {
    throw new CliError(`Multiple discovered Rokus match "${target}": ${matches.map(formatDiscoveredMatch).join(", ")}`);
  }

  return matches[0];
}

async function resolveSavedDeviceForRemoval(target: string, config: Config): Promise<string> {
  const savedName = tryNormalizeName(target);

  if (savedName && config.devices[savedName]) {
    return savedName;
  }

  const savedMatches = Object.entries(config.devices).filter(([name, device]) => savedDeviceMatches(name, device, target));

  if (savedMatches.length === 1) {
    return savedMatches[0][0];
  }

  if (savedMatches.length > 1) {
    throw new CliError(`Multiple saved devices match "${target}": ${savedMatches.map(([name, device]) => `${name} (${device.ip})`).join(", ")}`);
  }

  const discovered = await resolveDiscoveredTarget(target);

  if (discovered) {
    const discoveredMatches = Object.entries(config.devices).filter(([, device]) => device.ip === discovered.ip);

    if (discoveredMatches.length === 1) {
      return discoveredMatches[0][0];
    }

    if (discoveredMatches.length > 1) {
      throw new CliError(`Multiple saved devices use ${discovered.ip}: ${discoveredMatches.map(([name]) => name).join(", ")}`);
    }
  }

  throw new CliError(`Unknown saved device: ${target}`);
}

function deriveDeviceName(target: string, ip: string, discovered: DiscoveredDevice | undefined, deviceInfo: JsonObject, config: Config): string {
  const base =
    stringField(deviceInfo, "friendly-device-name") ??
    stringField(deviceInfo, "user-device-name") ??
    discovered?.friendlyName ??
    stringField(deviceInfo, "model-name") ??
    discovered?.model ??
    (isIp(target) ? `roku-${ip.split(".").at(-1) ?? "device"}` : target);

  return uniqueDeviceName(base, ip, deviceInfo, config);
}

function uniqueDeviceName(base: string, ip: string, deviceInfo: JsonObject, config: Config): string {
  const normalized = normalizeName(base);
  const existing = config.devices[normalized];

  if (!existing || existing.ip === ip) {
    return normalized;
  }

  const suffix = suffixFromDeviceInfo(deviceInfo) ?? ip.split(".").at(-1) ?? "device";
  const withSuffix = normalizeName(`${normalized}-${suffix}`);
  const suffixedExisting = config.devices[withSuffix];

  if (!suffixedExisting || suffixedExisting.ip === ip) {
    return withSuffix;
  }

  for (let index = 2; index < 100; index += 1) {
    const candidate = normalizeName(`${withSuffix}-${index}`);
    const candidateExisting = config.devices[candidate];

    if (!candidateExisting || candidateExisting.ip === ip) {
      return candidate;
    }
  }

  throw new CliError(`Could not create a unique saved name for ${ip}.`);
}

function suffixFromDeviceInfo(deviceInfo: JsonObject): string | undefined {
  const id = stringField(deviceInfo, "device-id") ?? stringField(deviceInfo, "serial-number");
  return id ? id.slice(-4) : undefined;
}

function savedDeviceMatches(name: string, device: SavedDevice, target: string): boolean {
  if (device.ip === target) return true;
  if (normalizeIdentity(name) === normalizeIdentity(target)) return true;

  return deviceInfoIdentities(device.deviceInfo ?? {}).some((identity) => identity === normalizeIdentity(target));
}

function discoveredDeviceMatches(device: DiscoveredDevice, target: string): boolean {
  if (device.ip === target) return true;

  const normalizedTarget = normalizeIdentity(target);
  const identities = [device.deviceId, device.serialNumber, device.friendlyName, device.model]
    .filter((value): value is string => Boolean(value))
    .map(normalizeIdentity);

  return identities.includes(normalizedTarget);
}

function deviceInfoIdentities(deviceInfo: JsonObject): string[] {
  return [
    "device-id",
    "serial-number",
    "friendly-device-name",
    "user-device-name",
    "model-name",
    "model-number"
  ]
    .map((key) => stringField(deviceInfo, key))
    .filter((value): value is string => Boolean(value))
    .map(normalizeIdentity);
}

function normalizeIdentity(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function tryNormalizeName(value: string): string | undefined {
  try {
    return normalizeName(value);
  } catch {
    return undefined;
  }
}

function stringField(value: JsonObject, key: string): string | undefined {
  const field = value[key];
  return typeof field === "string" && field ? field : undefined;
}

function formatDiscoveredMatch(device: DiscoveredDevice): string {
  const label = device.friendlyName ?? device.model ?? device.deviceId ?? device.serialNumber ?? "Roku";
  return `${label} (${device.ip})`;
}

function print(output: OutputMode, jsonValue: unknown, text: () => string): void {
  if (output === "json") {
    console.log(JSON.stringify(jsonValue, null, 2));
  } else {
    console.log(text());
  }
}

function formatDeviceListEntry(entry: DeviceListEntry): string {
  const status = entry.online ? "online" : "offline";
  const active = entry.activeApp ? `  active: ${formatActiveApp(entry.activeApp)}` : "";
  return `${entry.name}  ${entry.ip}  ${status}${active}`;
}

function formatActiveApp(activeApp: RokuActiveApp): string {
  return activeApp.id ? `${activeApp.name} (${activeApp.id})` : activeApp.name;
}

function printHelp(): void {
  console.log(`Usage: roku <command> [args] [--json]

Setup:
  discover
  add <ip|id|name>
  add <name> <ip>
  remove <ip|id|name>

Agent commands:
  devices
  status --device <device>
  action <action> [value] --device <device>

Examples:
  roku discover --json
  roku add <ip|id|name>
  roku action launch Netflix --device <name>
  roku action home --device <name>
  roku action type "star trek" --device <name>
  roku status --device <name> --json

Advanced/debug commands:
  roku help advanced`);
}

function printAdvancedHelp(): void {
  console.log(`Usage: roku <command> [args] [--json]

Setup and agent commands:
  discover
  add <ip|id|name>
  add <name> <ip>
  remove <ip|id|name>
  devices
  status --device <device>
  action <action> [value] --device <device>

Low-level/debug commands:
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
