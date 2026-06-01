import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type { Config, SavedDevice } from "./types.ts";
import { CliError, normalizeName } from "./utils.ts";

export const CONFIG_PATH = join(homedir(), ".config", "roku-cli", "config.json");

const emptyConfig = (): Config => ({ devices: {} });

export async function readConfig(): Promise<Config> {
  try {
    const raw = await readFile(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw) as unknown;

    if (!isConfig(parsed)) {
      throw new CliError(`Invalid config shape at ${CONFIG_PATH}`);
    }

    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return emptyConfig();
    }

    throw error;
  }
}

export async function writeConfig(config: Config): Promise<void> {
  await mkdir(dirname(CONFIG_PATH), { recursive: true });
  await writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export async function saveDevice(name: string, device: SavedDevice): Promise<string> {
  const normalized = normalizeName(name);
  const config = await readConfig();

  config.devices[normalized] = {
    ...config.devices[normalized],
    ...device,
    ip: device.ip,
    lastSeen: device.lastSeen ?? new Date().toISOString()
  };

  await writeConfig(config);
  return normalized;
}

export async function removeDevice(name: string): Promise<string> {
  const normalized = normalizeName(name);
  const config = await readConfig();

  if (!config.devices[normalized]) {
    throw new CliError(`Unknown device: ${name}`);
  }

  delete config.devices[normalized];
  if (config.defaultDevice === normalized) {
    delete config.defaultDevice;
  }

  await writeConfig(config);
  return normalized;
}

function isConfig(value: unknown): value is Config {
  if (!value || typeof value !== "object") return false;
  const maybe = value as { devices?: unknown };
  if (!maybe.devices || typeof maybe.devices !== "object" || Array.isArray(maybe.devices)) return false;

  const defaultDevice = (maybe as { defaultDevice?: unknown }).defaultDevice;
  return defaultDevice === undefined || typeof defaultDevice === "string";
}
