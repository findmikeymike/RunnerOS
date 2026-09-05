type DeviceChoice = Readonly<{ deviceId: string; label: string }>;

export function selectPreferredDeviceId(
  devices: readonly DeviceChoice[],
  priorDeviceId: string,
  preferredLabelFragments: readonly string[],
): string {
  const normalizedFragments = preferredLabelFragments.map((fragment) => fragment.toLowerCase());
  const preferred = devices.find((device) => {
    const label = device.label.toLowerCase();
    return normalizedFragments.some((fragment) => label.includes(fragment));
  });
  if (preferred) return preferred.deviceId;
  return devices.some((device) => device.deviceId === priorDeviceId) ? priorDeviceId : "";
}
