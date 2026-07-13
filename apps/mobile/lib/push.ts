import { Platform } from "react-native";
import type { DevicePlatform } from "@mesomed/contracts/communication";
import { devicePlatform as mapPlatform } from "./push-platform";

/** The wire platform for THIS device, or null when push doesn't apply. */
export function devicePlatform(): DevicePlatform | null {
  return mapPlatform(Platform.OS);
}

/**
 * Obtain the Expo push token for this device, or null when unavailable:
 * unsupported platform, permission denied, or no push infrastructure
 * (emulator without Google services, Expo Go without a projectId). Never
 * throws — push is an enhancement (MM-DEC §6), and a patient who denies
 * the permission keeps WhatsApp/SMS delivery server-side.
 */
export async function getPushToken(): Promise<string | null> {
  if (devicePlatform() === null) return null;
  try {
    const Notifications = await import("expo-notifications");
    const existing = await Notifications.getPermissionsAsync();
    const status = existing.granted ? existing : await Notifications.requestPermissionsAsync();
    if (!status.granted) return null;
    const token = await Notifications.getExpoPushTokenAsync();
    return token.data;
  } catch {
    return null;
  }
}
