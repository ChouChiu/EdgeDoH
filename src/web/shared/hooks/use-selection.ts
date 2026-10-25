import { useCallback, useMemo, useState } from "react";

/** Checkbox selection over items identified by string keys; keys no longer in `available` drop out */
export function useSelection(available: readonly string[]) {
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const selected = useMemo(() => available.filter((key) => picked.has(key)), [available, picked]);

  const toggle = useCallback((key: string, on: boolean) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);
  const setAll = useCallback((on: boolean) => setPicked(on ? new Set(available) : new Set()), [available]);
  const clear = useCallback(() => setPicked(new Set()), []);

  return {
    selected,
    has: (key: string) => picked.has(key),
    toggle,
    setAll,
    clear,
    /** Tri-state value for a "select all" checkbox */
    allState: selected.length === 0 ? false : selected.length === available.length ? true : ("indeterminate" as const),
  };
}

export type Selection = ReturnType<typeof useSelection>;
