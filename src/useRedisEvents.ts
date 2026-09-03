import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";

/**
 * Subscribe to a Tauri backend event. The handler is held in a ref so the
 * subscription is only (re)established when `event` changes — not on every
 * render — avoiding listener churn during high-frequency event streams.
 */
export function useRedisEvent<T>(event: string, handler: (payload: T) => void) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const unlisten = listen<T>(event, (e) => handlerRef.current(e.payload));
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [event]);
}
