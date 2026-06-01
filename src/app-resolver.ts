import type { RokuApp, SavedDevice } from "./types.ts";
import { CliError } from "./utils.ts";

export const BUILT_IN_CHANNELS: Record<string, string> = {
  "Apple TV": "551012",
  Disney: "291097",
  "Disney Plus": "291097",
  "Disney+": "291097",
  Hulu: "2285",
  Max: "61322",
  Netflix: "12",
  Peacock: "593099",
  "Prime Video": "13",
  Spotify: "22297",
  YouTube: "837",
  "YouTube TV": "195316"
};

export function appsToCache(apps: RokuApp[]): Record<string, string> {
  return Object.fromEntries(apps.map((app) => [app.name, app.id]));
}

export function resolveApp(input: string, savedDevice: SavedDevice | undefined, fetchedApps: RokuApp[] = []): string {
  if (/^[A-Za-z0-9._:-]+$/.test(input)) {
    const exactFetched = fetchedApps.find((app) => app.id === input);
    if (exactFetched) return exactFetched.id;

    const cachedExact = Object.values(savedDevice?.apps ?? {}).find((id) => id === input);
    if (cachedExact) return cachedExact;
  }

  const lower = input.toLowerCase();
  const cachedMatches = Object.entries(savedDevice?.apps ?? {}).filter(([name]) => name.toLowerCase() === lower);

  if (cachedMatches.length === 1) {
    return cachedMatches[0][1];
  }

  if (cachedMatches.length > 1) {
    throw new CliError(`Multiple cached apps match "${input}": ${cachedMatches.map(([name, id]) => `${name} (${id})`).join(", ")}`);
  }

  const builtInMatches = Object.entries(BUILT_IN_CHANNELS).filter(([name]) => name.toLowerCase() === lower);

  if (builtInMatches.length === 1) {
    return builtInMatches[0][1];
  }

  if (builtInMatches.length > 1) {
    const uniqueIds = new Set(builtInMatches.map(([, id]) => id));
    if (uniqueIds.size === 1) {
      return builtInMatches[0][1];
    }

    throw new CliError(`Multiple built-in channels match "${input}": ${builtInMatches.map(([name, id]) => `${name} (${id})`).join(", ")}`);
  }

  const candidates = fetchedApps.filter((app) => app.name.toLowerCase() === lower);

  if (candidates.length === 1) {
    return candidates[0].id;
  }

  if (candidates.length > 1) {
    throw new CliError(`Multiple apps match "${input}": ${formatMatches(candidates)}`);
  }

  const partial = fetchedApps.filter((app) => app.name.toLowerCase().includes(lower));

  if (partial.length === 1) {
    return partial[0].id;
  }

  if (partial.length > 1) {
    throw new CliError(`Multiple apps match "${input}": ${formatMatches(partial)}`);
  }

  throw new CliError(`No app found for "${input}". Run "roku channels --device <device>" to refresh the channel cache, or launch by exact app id.`);
}

function formatMatches(apps: RokuApp[]): string {
  return apps.map((app) => `${app.name} (${app.id})`).join(", ");
}
