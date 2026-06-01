import { isIP } from "node:net";

export class CliError extends Error {
  constructor(message: string, public readonly exitCode = 1) {
    super(message);
    this.name = "CliError";
  }
}

export class RokuHttpError extends CliError {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string
  ) {
    super(message);
    this.name = "RokuHttpError";
  }
}

export function normalizeName(name: string): string {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!normalized) {
    throw new CliError("Device name must contain at least one letter or number.");
  }

  return normalized;
}

export function assertIp(value: string): string {
  if (!isIP(value)) {
    throw new CliError(`Invalid IP address: ${value}`);
  }

  return value;
}

export function isIp(value: string): boolean {
  return isIP(value) !== 0;
}

export function hostForIp(ip: string): string {
  return isIP(ip) === 6 ? `[${ip}]` : ip;
}

export function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function parsePositiveInt(value: string, label: string): number {
  if (!/^\d+$/.test(value)) {
    throw new CliError(`${label} must be a positive integer.`);
  }

  return Number(value);
}

export function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 3000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timeout));
}

export async function readResponseText(response: Response, context: string): Promise<string> {
  const text = await response.text();

  if (!response.ok) {
    throw new RokuHttpError(`${context} failed with HTTP ${response.status}.`, response.status, text);
  }

  return text;
}

export function requireArg(value: string | undefined, label: string): string {
  if (!value) {
    throw new CliError(`Missing required argument: ${label}`);
  }

  return value;
}

export function parseJsonFlag(args: string[]): { args: string[]; json: boolean } {
  const filtered: string[] = [];
  let json = false;

  for (const arg of args) {
    if (arg === "--json") {
      json = true;
    } else {
      filtered.push(arg);
    }
  }

  return { args: filtered, json };
}
