import { useEffect } from "react";
import { useBlocker } from "react-router";

export interface UnsavedGuard {
  blocked: boolean;
  stay: () => void;
  leave: () => void;
}

/** Asks before closing, reloading, or navigating away while there are unsaved edits */
export function useUnsavedGuard(dirty: boolean): UnsavedGuard {
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const blocker = useBlocker(dirty);
  return {
    blocked: blocker.state === "blocked",
    stay: () => blocker.reset?.(),
    leave: () => blocker.proceed?.(),
  };
}

/** Triggers `onSave` on Ctrl/Cmd+S while `enabled` */
export function useSaveShortcut(enabled: boolean, onSave: (() => void) | undefined): void {
  useEffect(() => {
    if (!enabled || !onSave) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        onSave();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, onSave]);
}
