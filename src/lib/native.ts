type CapacitorGlobal = { isNativePlatform?: () => boolean; getPlatform?: () => string };

// True when the web app runs inside the Capacitor iOS/Android shell.
export function isNativeApp(): boolean {
  if (typeof window === "undefined") return false;
  const capacitor = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
  return Boolean(capacitor?.isNativePlatform?.());
}
