import type { RokuApp, SavedDevice } from "./types.ts";
import { CliError } from "./utils.ts";

export function appsToCache(apps: RokuApp[]): Record<string, string> {
  return Object.fromEntries(apps.map((app) => [app.name, app.id]));
}

export function resolveApp(input: string, savedDevice: SavedDevice | undefined, fetchedApps: RokuApp[]): string {
  if (/^[A-Za-z0-9._:-]+$/.test(input)) {
    const exactFetched = fetchedApps.find((app) => app.id === input);
    if (exactFetched) return exactFetched.id;

    const cachedExact = Object.values(savedDevice?.apps ?? {}).find((id) => id === input);
    if (cachedExact) return cachedExact;
  }

  const lower = input.toLowerCase();
  const candidates = fetchedApps.filter((app) => app.name.toLowerCase() === lower);

  if (candidates.length === 1) {
    return candidates[0].id;
  }

  if (candidates.length > 1) {
    throw new CliError(`Multiple apps match "${input}": ${formatMatches(candidates)}`);
  }

  const cachedMatches = Object.entries(savedDevice?.apps ?? {}).filter(([name]) => name.toLowerCase() === lower);

  if (cachedMatches.length === 1) {
    return cachedMatches[0][1];
  }

  if (cachedMatches.length > 1) {
    throw new CliError(`Multiple cached apps match "${input}": ${cachedMatches.map(([name, id]) => `${name} (${id})`).join(", ")}`);
  }

  const partial = fetchedApps.filter((app) => app.name.toLowerCase().includes(lower));

  if (partial.length === 1) {
    return partial[0].id;
  }

  if (partial.length > 1) {
    throw new CliError(`Multiple apps match "${input}": ${formatMatches(partial)}`);
  }

  throw new CliError(`No app found for "${input}". Run "roku apps <device>" to refresh the app cache.`);
}

function formatMatches(apps: RokuApp[]): string {
  return apps.map((app) => `${app.name} (${app.id})`).join(", ");
}
