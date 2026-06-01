#!/usr/bin/env bun
import { createInterface } from "node:readline/promises";
import { appsToCache, BUILT_IN_CHANNELS, resolveApp } from "./app-resolver.ts";
import { CONFIG_PATH, readConfig, removeDevice, saveDevice, writeConfig } from "./config.ts";
import { discoverRokus } from "./discovery.ts";
import { CONVENIENCE_KEYS, resolveKey } from "./keys.ts";
import { RokuClient } from "./roku-client.ts";
import type { Config, DeviceListEntry, DiscoveredDevice, JsonObject, OutputMode, RokuActiveApp, RokuApp, SavedDevice } from "./types.ts";
import { assertIp, clampNumber, CliError, isIp, normalizeName, parseJsonFlag, parsePositiveInt, requireArg, RokuHttpError } from "./utils.ts";

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
    await commandHumanAction(command, args, output);
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
    case "channels":
      await commandChannels(args, output);
      break;
    case "use":
      await commandUse(args, output);
      break;
    case "current":
      await commandCurrent(output);
      break;
    case "known-channels":
      await commandKnownChannels(output);
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
      await commandHumanAction(command, args, output);
      break;
    case "launch":
      await commandHumanAction(command, args, output);
      break;
    case "type":
      await commandHumanAction(command, args, output);
      break;
    case "action":
      await commandAction(args, output);
      break;
    default:
      await commandDeviceScoped(command, args, output);
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
  const parsed = parseNameOption(args);
  requireArg(parsed.args[0], "target");
  const lastArg = parsed.args.at(-1);

  if (parsed.args.length >= 2 && lastArg && isIp(lastArg)) {
    await commandAddManual(parsed.name ?? parsed.args.slice(0, -1).join(" "), lastArg, output);
    return;
  }

  await commandAddDiscovered(parsed.args.join(" "), parsed.name, output);
}

async function commandAddManual(name: string, ipInput: string, output: OutputMode): Promise<void> {
  const ip = assertIp(ipInput);
  const client = new RokuClient(ip);
  const deviceInfo = await client.getDeviceInfo();
  const apps = await fetchAppsOrEmpty(client);
  const savedName = await saveDevice(name, {
    ip,
    lastSeen: new Date().toISOString(),
    deviceInfo,
    ...(apps.length > 0 ? { apps: appsToCache(apps) } : {})
  });

  print(output, { name: savedName, ip, channelCount: apps.length, configPath: CONFIG_PATH }, () => `Saved ${savedName} at ${ip}${apps.length ? ` with ${apps.length} channels cached` : ""}.`);
}

async function commandAddDiscovered(target: string, nameInput: string | undefined, output: OutputMode): Promise<void> {
  const discovered = isIp(target) ? undefined : await resolveDiscoveredTarget(target);
  const ip = discovered?.ip ?? (isIp(target) ? assertIp(target) : undefined);

  if (!ip) {
    throw new CliError(`No discovered Roku matched "${target}". Run "roku discover --json" or use "roku add <name> <ip>".`);
  }

  const client = new RokuClient(ip);
  const deviceInfo = await client.getDeviceInfo();
  const apps = await fetchAppsOrEmpty(client);
  const config = await readConfig();
  const suggestedName = deriveDeviceName(target, ip, discovered, deviceInfo, config);
  const name = nameInput ?? (await promptForDeviceName(suggestedName));
  const savedName = await saveDevice(name, {
    ip,
    lastSeen: new Date().toISOString(),
    deviceInfo,
    ...(apps.length > 0 ? { apps: appsToCache(apps) } : {})
  });

  print(output, { name: savedName, ip, channelCount: apps.length, configPath: CONFIG_PATH }, () => `Saved ${savedName} at ${ip}${apps.length ? ` with ${apps.length} channels cached` : ""}.`);
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

async function commandUse(args: string[], output: OutputMode): Promise<void> {
  const target = args.join(" ");
  requireArg(target, "device");

  const config = await readConfig();
  const name = await resolveSavedDeviceForRemoval(target, config);
  config.defaultDevice = name;
  await writeConfig(config);

  print(output, { device: name, current: true }, () => `Using ${name}.`);
}

async function commandCurrent(output: OutputMode): Promise<void> {
  const config = await readConfig();

  if (!config.defaultDevice) {
    print(output, { device: null }, () => "No current device set.");
    return;
  }

  const device = config.devices[config.defaultDevice];

  if (!device) {
    print(output, { device: config.defaultDevice, missing: true }, () => `Current device ${config.defaultDevice} is not saved.`);
    return;
  }

  print(output, { device: config.defaultDevice, ip: device.ip }, () => `${config.defaultDevice}  ${device.ip}`);
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

async function commandChannels(args: string[], output: OutputMode): Promise<RokuApp[]> {
  const parsed = parseDeviceOption(args);
  const deviceArg = parsed.device ?? parsed.args[0] ?? (await getDefaultDeviceName());

  return commandApps(deviceArg, output);
}

async function commandKnownChannels(output: OutputMode): Promise<void> {
  const channels = Object.entries(BUILT_IN_CHANNELS)
    .map(([name, id]) => ({ name, id }))
    .sort((a, b) => a.name.localeCompare(b.name));

  print(output, { channels }, () => channels.map((channel) => `${channel.name}  ${channel.id}`).join("\n"));
}

async function commandStatus(args: string[], output: OutputMode): Promise<void> {
  const parsed = parseDeviceOption(args);
  const deviceArg = parsed.device ?? parsed.args[0] ?? (await getDefaultDeviceName());

  const { client, name, ip } = await resolveDevice(deviceArg);

  try {
    const [deviceInfo, activeApp] = await Promise.all([client.getDeviceInfo(), client.getActiveApp()]);
    const apps = await fetchAppsOrEmpty(client);
    await updateSavedDevice(name, {
      deviceInfo,
      ...(apps.length > 0 ? { apps: appsToCache(apps) } : {}),
      lastSeen: new Date().toISOString()
    });

    const ecpMode = stringField(deviceInfo, "ecp-setting-mode");
    print(output, { device: name ?? deviceArg, ip, online: true, activeApp, deviceInfo, appCount: apps.length, ecpMode }, () => {
      const active = activeApp ? formatActiveApp(activeApp) : "none";
      const mode = ecpMode ? `  mode: ${ecpMode}` : "";
      return `${name ?? deviceArg}  ${ip}  online  active: ${active}  apps: ${apps.length}${mode}`;
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
  const apps = await fetchAppsOrEmpty(resolved.client);
  const appId = resolveApp(appInput, resolved.savedDevice, apps);

  await resolved.client.launch(appId);
  await updateSavedDevice(resolved.name, apps.length > 0 ? { apps: appsToCache(apps), lastSeen: new Date().toISOString() } : { lastSeen: new Date().toISOString() });

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

  if (!parsed.device) {
    throw new CliError("Missing required option: --device <device>");
  }

  await dispatchDeviceAction(parsed.device, action, parsed.args.slice(1), output);
}

async function commandHumanAction(action: string, args: string[], output: OutputMode): Promise<void> {
  const parsed = parseDeviceOption(args);
  let deviceArg = parsed.device;
  let actionArgs = parsed.args;

  if (!deviceArg && parsed.args.length > 1) {
    const maybeDevice = await findSavedDeviceName(parsed.args[0]);
    if (maybeDevice) {
      deviceArg = maybeDevice;
      actionArgs = parsed.args.slice(1);
    }
  }

  await dispatchDeviceAction(deviceArg ?? (await getDefaultDeviceName()), action, actionArgs, output);
}

async function commandDeviceScoped(deviceArg: string, args: string[], output: OutputMode): Promise<void> {
  if (args.length === 0) {
    await commandStatus(["--device", deviceArg], output);
    return;
  }

  await dispatchDeviceAction(deviceArg, args[0], args.slice(1), output);
}

async function dispatchDeviceAction(deviceArg: string, action: string, args: string[], output: OutputMode): Promise<void> {
  if (action === "status") {
    await commandStatus(["--device", deviceArg], output);
    return;
  }

  if (action === "channels" || action === "apps") {
    await commandChannels(["--device", deviceArg], output);
    return;
  }

  if (action === "active") {
    await commandActive(deviceArg, output);
    return;
  }

  if (action === "info") {
    await commandInfo(deviceArg, output);
    return;
  }

  if (action === "launch") {
    await commandLaunch(deviceArg, requireArg(args.join(" "), "app"), output);
    return;
  }

  if (action === "type") {
    await commandType(deviceArg, requireArg(args.join(" "), "text"), output);
    return;
  }

  if (action === "hold") {
    await commandHold(deviceArg, resolveKey(requireArg(args[0], "key")), requireArg(args[1], "ms"), output);
    return;
  }

  const key = CONVENIENCE_KEYS[action];

  if (!key) {
    throw new CliError(`Unknown action: ${action}`);
  }

  await commandKey(deviceArg, key, output);
}

async function resolveDevice(deviceArg: string): Promise<{ client: RokuClient; ip: string; name?: string; savedDevice?: SavedDevice }> {
  const config = await readConfig();

  if (isIp(deviceArg)) {
    const ip = assertIp(deviceArg);
    const savedMatches = Object.entries(config.devices).filter(([, device]) => device.ip === ip);

    if (savedMatches.length === 1) {
      const [name, savedDevice] = savedMatches[0];
      return { client: new RokuClient(savedDevice.ip), ip: savedDevice.ip, name, savedDevice };
    }

    if (savedMatches.length > 1) {
      throw new CliError(`Multiple saved devices use ${ip}: ${savedMatches.map(([name]) => name).join(", ")}`);
    }

    return { client: new RokuClient(ip), ip };
  }

  const name = await resolveSavedDeviceForRemoval(deviceArg, config);
  const savedDevice = config.devices[name];

  return { client: new RokuClient(savedDevice.ip), ip: savedDevice.ip, name, savedDevice };
}

async function getDeviceList(): Promise<DeviceListEntry[]> {
  const config = await readConfig();
  const devices = await Promise.all(
    Object.entries(config.devices).map(async ([name, device]) => {
      const client = new RokuClient(device.ip, 1500);

      try {
        const [deviceInfo, activeApp] = await Promise.all([client.getDeviceInfo(), client.getActiveApp()]);
        device.lastSeen = new Date().toISOString();
        device.deviceInfo = deviceInfo;
        return { name, ip: device.ip, online: true, activeApp, ecpMode: stringField(deviceInfo, "ecp-setting-mode") };
      } catch {
        return { name, ip: device.ip, online: false, activeApp: null };
      }
    })
  );

  await writeConfig(config);
  return devices;
}

async function fetchAppsOrEmpty(client: RokuClient): Promise<RokuApp[]> {
  try {
    return await client.getApps();
  } catch {
    return [];
  }
}

async function getDefaultDeviceName(): Promise<string> {
  const config = await readConfig();

  if (config.defaultDevice && config.devices[config.defaultDevice]) {
    return config.defaultDevice;
  }

  const savedNames = Object.keys(config.devices);

  if (savedNames.length === 1) {
    return savedNames[0];
  }

  if (savedNames.length === 0) {
    throw new CliError("No saved devices. Run: roku discover, then roku add <target>.");
  }

  throw new CliError("No current device set. Run: roku use <device> or pass --device <device>.");
}

async function findSavedDeviceName(target: string): Promise<string | undefined> {
  const config = await readConfig();

  try {
    return await resolveSavedDeviceForRemoval(target, config);
  } catch {
    return undefined;
  }
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

function parseNameOption(args: string[]): { args: string[]; name?: string } {
  const filtered: string[] = [];
  let name: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--name") {
      name = requireArg(args[index + 1], "name");
      index += 1;
    } else {
      filtered.push(arg);
    }
  }

  return { args: filtered, name };
}

async function promptForDeviceName(suggestedName: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new CliError(`Missing required option: --name <friendly-name>. Suggested name: ${suggestedName}`);
  }

  const readline = createInterface({ input: process.stdin, output: process.stdout });

  try {
    const answer = await readline.question(`Save this Roku as [${suggestedName}]: `);
    return answer.trim() || suggestedName;
  } finally {
    readline.close();
  }
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
  const mode = entry.ecpMode ? `  mode: ${entry.ecpMode}` : "";
  return `${entry.name}  ${entry.ip}  ${status}${active}${mode}`;
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
  use <device>
  current

Use:
  <device> status
  <device> channels
  <device> launch <channel>
  <device> home
  <device> volume-up

Current device shortcuts:
  launch <channel>
  home
  status

Agent:
  devices
  channels --device <device>
  status --device <device>
  action <action> [value] --device <device>

Examples:
  roku discover --json
  roku add <ip|id|name>
  roku add <ip|id|name> --name <name>
  roku use <name>
  roku <name> launch Netflix
  roku <name> home
  roku action launch Netflix --device <name> --json

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
  use <device>
  current
  devices
  channels --device <device>
  status --device <device>
  action <action> [value] --device <device>

Human commands:
  <device> status
  <device> channels
  <device> launch <channel>
  <device> home|back|select|up|down|left|right
  <device> play|pause|rewind|forward
  <device> volume-up|volume-down|mute
  <device> power|power-on|power-off
  <device> channel-up|channel-down
  <device> input-tuner|input-hdmi1|input-hdmi2|input-hdmi3|input-hdmi4

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
  if (error instanceof RokuHttpError && error.status === 403) {
    const limitedMessage = error.body.includes("Limited mode")
      ? " Roku says ECP is in Limited mode."
      : "";
    console.error(`${error.message}${limitedMessage} On the Roku, set Settings > System > Advanced system settings > Control by mobile apps > Network access to Permissive.`);
    process.exit(error.exitCode);
  }

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
