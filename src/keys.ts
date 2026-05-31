import { CliError } from "./utils.ts";

export const ALLOWED_KEYS = [
  "Home",
  "Rev",
  "Fwd",
  "Play",
  "Select",
  "Left",
  "Right",
  "Down",
  "Up",
  "Back",
  "InstantReplay",
  "Info",
  "Backspace",
  "Search",
  "Enter",
  "VolumeDown",
  "VolumeMute",
  "VolumeUp",
  "PowerOff",
  "PowerOn",
  "Power",
  "ChannelUp",
  "ChannelDown",
  "InputTuner",
  "InputHDMI1",
  "InputHDMI2",
  "InputHDMI3",
  "InputHDMI4"
] as const;

export type RokuKey = (typeof ALLOWED_KEYS)[number];

const keyMap = new Map<string, RokuKey>();

for (const key of ALLOWED_KEYS) {
  keyMap.set(key.toLowerCase(), key);
}

export const CONVENIENCE_KEYS: Record<string, RokuKey> = {
  home: "Home",
  back: "Back",
  select: "Select",
  up: "Up",
  down: "Down",
  left: "Left",
  right: "Right",
  play: "Play",
  pause: "Play",
  rewind: "Rev",
  forward: "Fwd",
  "volume-up": "VolumeUp",
  "volume-down": "VolumeDown",
  mute: "VolumeMute",
  power: "Power"
};

export function resolveKey(input: string): RokuKey {
  const key = keyMap.get(input.toLowerCase());

  if (!key) {
    throw new CliError(`Unknown or unsafe Roku key: ${input}`);
  }

  return key;
}
