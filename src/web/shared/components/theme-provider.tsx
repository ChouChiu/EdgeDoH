import { createContext, type ReactNode, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { withThemeTransition } from "@/shared/lib/view-transition";

export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

interface ThemeState {
  theme: Theme;
  /** `origin` is where the new theme starts spreading from, usually the control that was clicked */
  setTheme: (theme: Theme, origin?: { x: number; y: number }) => void;
}

const ThemeContext = createContext<ThemeState | null>(null);

/** Light, dark or follow the system; `d` outside text fields flips between light and dark */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => parseTheme(readStorage()));
  const current = useRef(theme);
  current.current = theme;

  const setTheme = useCallback((next: Theme, origin?: { x: number; y: number }) => {
    writeStorage(next);
    const update = () => flushSync(() => setThemeState(next));
    const wasDark = isDark(current.current);
    const dark = isDark(next);
    // Same colours either way (e.g. system while the system is dark): nothing worth animating
    if (dark === wasDark) {
      update();
      return;
    }
    // Dark grows out of the control and shrinks back into it when going light again.
    // flushSync plus the layout effect below put the new class on <html> before the transition snapshots the page
    withThemeTransition(dark ? "expand" : "collapse", update, origin ?? { x: innerWidth / 2, y: innerHeight / 2 });
  }, []);

  useLayoutEffect(() => {
    const media = window.matchMedia(DARK_QUERY);
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && media.matches);
      // Without this, every themed transition animates at once when switching
      const style = document.createElement("style");
      style.textContent = "*,*::before,*::after{transition:none!important}";
      document.head.append(style);
      document.documentElement.classList.toggle("dark", dark);
      document.documentElement.classList.toggle("light", !dark);
      // Browser chrome (mobile address bar, standalone status bar) follows the page background
      document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0a0a0a" : "#ffffff");
      requestAnimationFrame(() => requestAnimationFrame(() => style.remove()));
    };
    apply();
    if (theme !== "system") return;
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey || event.key.toLowerCase() !== "d") return;
      if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select, [contenteditable='true']")) return;
      setTheme(isDark(current.current) ? "light" : "dark");
    };
    // Keeps several open tabs in sync
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) setThemeState(parseTheme(event.newValue));
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("storage", onStorage);
    };
  }, [setTheme]);

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeState {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used within ThemeProvider");
  return value;
}

function isDark(theme: Theme): boolean {
  return theme === "dark" || (theme === "system" && window.matchMedia(DARK_QUERY).matches);
}

function parseTheme(value: string | null): Theme {
  return value === "light" || value === "dark" ? value : "system";
}

function readStorage(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStorage(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Unavailable storage only means the choice is not remembered
  }
}
