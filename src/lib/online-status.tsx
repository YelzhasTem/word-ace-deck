import { useEffect, useState } from "react";

export const OFFLINE_MESSAGE = "You're offline. Check your internet connection and try again.";
export const OFFLINE_AI_MESSAGE = "AI features need internet. Check your connection and try again.";
export const OFFLINE_SAVE_MESSAGE = "Saving needs internet. Check your connection and try again.";

export function isBrowserOnline() {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine;
}

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    const update = () => setIsOnline(isBrowserOnline());

    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);

    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  return isOnline;
}
