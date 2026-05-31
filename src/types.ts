export type JsonObject = Record<string, unknown>;

export interface RokuApp {
  id: string;
  name: string;
  type?: string;
  version?: string;
}

export interface RokuActiveApp {
  id?: string;
  name: string;
  type?: string;
  version?: string;
}

export interface SavedDevice {
  ip: string;
  lastSeen?: string;
  deviceInfo?: JsonObject;
  apps?: Record<string, string>;
}

export interface Config {
  devices: Record<string, SavedDevice>;
}

export interface DiscoveredDevice {
  ip: string;
  location: string;
  server?: string;
  friendlyName?: string;
  model?: string;
  serialNumber?: string;
  deviceId?: string;
}

export type OutputMode = "text" | "json";
