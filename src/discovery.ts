import dgram from "node:dgram";
import { RokuClient } from "./roku-client.ts";
import type { DiscoveredDevice } from "./types.ts";

const SSDP_ADDRESS = "239.255.255.250";
const SSDP_PORT = 1900;
const ROKU_SEARCH_TARGET = "roku:ecp";

const discoveryMessage = [
  "M-SEARCH * HTTP/1.1",
  `HOST: ${SSDP_ADDRESS}:${SSDP_PORT}`,
  'MAN: "ssdp:discover"',
  "MX: 2",
  `ST: ${ROKU_SEARCH_TARGET}`,
  "",
  ""
].join("\r\n");

export async function discoverRokus(timeoutMs = 3000): Promise<DiscoveredDevice[]> {
  const responses = await searchSsdp(timeoutMs);
  const byIp = new Map<string, DiscoveredDevice>();

  for (const response of responses) {
    const location = response.headers.location;
    const ip = response.ip;

    if (!location || !ip || byIp.has(ip)) {
      continue;
    }

    const discovered: DiscoveredDevice = {
      ip,
      location,
      server: response.headers.server
    };

    try {
      const client = new RokuClient(ip, 1500);
      const info = await client.getDeviceInfo();
      discovered.friendlyName = stringField(info, "friendly-device-name") ?? stringField(info, "user-device-name");
      discovered.model = stringField(info, "model-name") ?? stringField(info, "model-number");
      discovered.serialNumber = stringField(info, "serial-number");
      discovered.deviceId = stringField(info, "device-id");
    } catch {
      // Discovery still reports the SSDP hit; details are best-effort.
    }

    byIp.set(ip, discovered);
  }

  return [...byIp.values()].sort((a, b) => a.ip.localeCompare(b.ip));
}

function searchSsdp(timeoutMs: number): Promise<Array<{ ip: string; headers: Record<string, string> }>> {
  return new Promise((resolve) => {
    const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
    const found: Array<{ ip: string; headers: Record<string, string> }> = [];
    const timer = setTimeout(() => {
      socket.close();
      resolve(found);
    }, timeoutMs);

    socket.on("message", (message, remote) => {
      const headers = parseSsdpHeaders(message.toString("utf8"));
      if ((headers.st?.toLowerCase() === ROKU_SEARCH_TARGET || headers.usn?.toLowerCase().includes("roku:ecp")) && headers.location) {
        found.push({ ip: remote.address, headers });
      }
    });

    socket.on("error", () => {
      clearTimeout(timer);
      socket.close();
      resolve(found);
    });

    socket.bind(() => {
      socket.setBroadcast(true);
      socket.setMulticastTTL(2);
      sendDiscovery(socket);
    });
  });
}

function sendDiscovery(socket: dgram.Socket): void {
  const message = Buffer.from(discoveryMessage);

  socket.send(message, SSDP_PORT, SSDP_ADDRESS);
  setTimeout(() => socket.send(message, SSDP_PORT, SSDP_ADDRESS), 400);
  setTimeout(() => socket.send(message, SSDP_PORT, SSDP_ADDRESS), 900);
}

function parseSsdpHeaders(raw: string): Record<string, string> {
  const headers: Record<string, string> = {};

  for (const line of raw.split(/\r?\n/)) {
    const index = line.indexOf(":");
    if (index === -1) continue;

    headers[line.slice(0, index).trim().toLowerCase()] = line.slice(index + 1).trim();
  }

  return headers;
}

function stringField(value: Record<string, unknown>, key: string): string | undefined {
  const field = value[key];
  return typeof field === "string" && field ? field : undefined;
}
