import { deckCsvFileName, downloadDeckCsv, serializeDeckCsv } from "@/lib/deck-csv";

type CapacitorGlobal = { isNativePlatform?: () => boolean; getPlatform?: () => string };
type CsvDeck = Parameters<typeof downloadDeckCsv>[0];

// True when the web app runs inside the Capacitor iOS/Android shell.
export function isNativeApp(): boolean {
  if (typeof window === "undefined") return false;
  const capacitor = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
  return Boolean(capacitor?.isNativePlatform?.());
}

// Native plugins are imported lazily so the website bundle and SSR never load them.

export function hapticSuccess() {
  if (!isNativeApp()) return;
  void import("@capacitor/haptics")
    .then(({ Haptics, NotificationType }) =>
      Haptics.notification({ type: NotificationType.Success }),
    )
    .catch(() => undefined);
}

export function hapticError() {
  if (!isNativeApp()) return;
  void import("@capacitor/haptics")
    .then(({ Haptics, NotificationType }) => Haptics.notification({ type: NotificationType.Error }))
    .catch(() => undefined);
}

export function hapticTap() {
  if (!isNativeApp()) return;
  void import("@capacitor/haptics")
    .then(({ Haptics, ImpactStyle }) => Haptics.impact({ style: ImpactStyle.Light }))
    .catch(() => undefined);
}

// A blob download does nothing inside the iOS web view, so the app writes the file
// to its cache and opens the system share sheet (Save to Files, AirDrop, Mail...).
export async function exportDeckCsv(deck: CsvDeck) {
  if (!isNativeApp()) {
    downloadDeckCsv(deck);
    return;
  }
  const [{ Filesystem, Directory, Encoding }, { Share }] = await Promise.all([
    import("@capacitor/filesystem"),
    import("@capacitor/share"),
  ]);
  const fileName = deckCsvFileName(deck.name);
  const { uri } = await Filesystem.writeFile({
    path: fileName,
    data: `\uFEFF${serializeDeckCsv(deck.cards)}`,
    directory: Directory.Cache,
    encoding: Encoding.UTF8,
  });
  await Share.share({ title: deck.name, files: [uri] });
}

// Daily study reminder (local notification, no server involved).
const REMINDER_ID = 1001;

export type ReminderTime = { hour: number; minute: number };

export async function getDailyReminder(): Promise<ReminderTime | null> {
  if (!isNativeApp()) return null;
  const { LocalNotifications } = await import("@capacitor/local-notifications");
  const { notifications } = await LocalNotifications.getPending();
  const pending = notifications.find((item) => item.id === REMINDER_ID);
  const on = pending?.schedule?.on;
  if (!on || on.hour === undefined) return null;
  return { hour: on.hour, minute: on.minute ?? 0 };
}

export async function setDailyReminder(time: ReminderTime | null): Promise<boolean> {
  if (!isNativeApp()) return false;
  const { LocalNotifications } = await import("@capacitor/local-notifications");
  await LocalNotifications.cancel({ notifications: [{ id: REMINDER_ID }] });
  if (!time) return true;
  let permission = await LocalNotifications.checkPermissions();
  if (permission.display !== "granted") {
    permission = await LocalNotifications.requestPermissions();
  }
  if (permission.display !== "granted") return false;
  await LocalNotifications.schedule({
    notifications: [
      {
        id: REMINDER_ID,
        title: "Time to review",
        body: "A few minutes with your cards keeps the words in memory.",
        schedule: {
          on: { hour: time.hour, minute: time.minute },
          repeats: true,
          allowWhileIdle: true,
        },
      },
    ],
  });
  return true;
}
