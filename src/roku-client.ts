import type { JsonObject, RokuActiveApp, RokuApp } from "./types.ts";
import { CliError, fetchWithTimeout, hostForIp, readResponseText } from "./utils.ts";

export class RokuClient {
  private readonly baseUrl: string;

  constructor(public readonly ip: string, private readonly timeoutMs = 3000) {
    this.baseUrl = `http://${hostForIp(ip)}:8060`;
  }

  async getDeviceInfo(): Promise<JsonObject> {
    const xml = await this.getXml("/query/device-info", "Device info request");
    return parseChildTextFields(xml, "device-info");
  }

  async getApps(): Promise<RokuApp[]> {
    const xml = await this.getXml("/query/apps", "Apps request");
    return parseAppElements(xml);
  }

  async getActiveApp(): Promise<RokuActiveApp | null> {
    const xml = await this.getXml("/query/active-app", "Active app request");
    const apps = parseAppElements(xml, ["app", "screen-saver"]);

    if (apps.length === 0) {
      return null;
    }

    const app = apps[0];
    return {
      id: app.id,
      name: app.name,
      type: app.type,
      version: app.version
    };
  }

  async keypress(key: string): Promise<void> {
    await this.post(`/keypress/${encodeURIComponent(key)}`, "Keypress request");
  }

  async keydown(key: string): Promise<void> {
    await this.post(`/keydown/${encodeURIComponent(key)}`, "Keydown request");
  }

  async keyup(key: string): Promise<void> {
    await this.post(`/keyup/${encodeURIComponent(key)}`, "Keyup request");
  }

  async launch(appId: string): Promise<void> {
    if (!/^[A-Za-z0-9._:-]+$/.test(appId)) {
      throw new CliError(`Unsafe Roku app id: ${appId}`);
    }

    await this.post(`/launch/${encodeURIComponent(appId)}`, "Launch request");
  }

  async inputText(text: string): Promise<void> {
    await this.post(`/input?text=${encodeURIComponent(text)}`, "Text input request");
  }

  private async getXml(path: string, context: string): Promise<string> {
    const response = await fetchWithTimeout(`${this.baseUrl}${path}`, { method: "GET" }, this.timeoutMs);
    return readResponseText(response, context);
  }

  private async post(path: string, context: string): Promise<void> {
    const response = await fetchWithTimeout(`${this.baseUrl}${path}`, { method: "POST" }, this.timeoutMs);
    await readResponseText(response, context);
  }
}

function parseChildTextFields(xml: string, rootName: string): JsonObject {
  const root = matchElement(xml, rootName);
  const result: JsonObject = {};
  const childPattern = /<([a-zA-Z0-9-]+)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/g;

  for (const match of root.matchAll(childPattern)) {
    result[match[1]] = decodeXml(match[2].trim());
  }

  return result;
}

function parseAppElements(xml: string, elementNames = ["app"]): RokuApp[] {
  const names = elementNames.map(escapeRegex).join("|");
  const pattern = new RegExp(`<(${names})(\\s[^>]*)?>([\\s\\S]*?)<\\/\\1>`, "g");
  const apps: RokuApp[] = [];

  for (const match of xml.matchAll(pattern)) {
    const tagName = match[1];
    const attributes = parseAttributes(match[2] ?? "");
    const id = attributes.id;

    if (!id && tagName === "app") {
      throw new CliError("Roku returned app without id.");
    }

    apps.push({
      id: id ?? "",
      name: decodeXml(match[3].trim()) || tagName,
      type: attributes.type ?? tagName,
      version: attributes.version
    });
  }

  return apps;
}

function matchElement(xml: string, name: string): string {
  const pattern = new RegExp(`<${escapeRegex(name)}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapeRegex(name)}>`);
  const match = xml.match(pattern);

  if (!match) {
    throw new CliError(`Roku XML missing <${name}>.`);
  }

  return match[1];
}

function parseAttributes(raw: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const pattern = /([a-zA-Z0-9-]+)="([^"]*)"/g;

  for (const match of raw.matchAll(pattern)) {
    attributes[match[1]] = decodeXml(match[2]);
  }

  return attributes;
}

function decodeXml(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
