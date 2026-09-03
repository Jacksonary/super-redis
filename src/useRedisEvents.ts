import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";

/**
 * Subscribe to a Tauri backend event. Cleans up on unmount.
 */
export function useRedisEvent<T>(event: string, handler: (payload: T) => void) {
  useEffect(() => {
    const unlisten = listen<T>(event, (e) => handler(e.payload));
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [event, handler]);
}
