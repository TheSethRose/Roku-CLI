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
  "InputHDMI4",
  "InputAV1"
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
  info: "Info",
  replay: "InstantReplay",
  search: "Search",
  enter: "Enter",
  backspace: "Backspace",
  play: "Play",
  pause: "Play",
  rewind: "Rev",
  forward: "Fwd",
  "volume-up": "VolumeUp",
  "volume-down": "VolumeDown",
  mute: "VolumeMute",
  power: "Power",
  "power-on": "PowerOn",
  "power-off": "PowerOff",
  "channel-up": "ChannelUp",
  "channel-down": "ChannelDown",
  "input-tuner": "InputTuner",
  "input-hdmi1": "InputHDMI1",
  "input-hdmi2": "InputHDMI2",
  "input-hdmi3": "InputHDMI3",
  "input-hdmi4": "InputHDMI4",
  "input-av1": "InputAV1"
};

export function resolveKey(input: string): RokuKey {
  const key = keyMap.get(input.toLowerCase());

  if (!key) {
    throw new CliError(`Unknown or unsafe Roku key: ${input}`);
  }

  return key;
}
