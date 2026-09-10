"use client";

import { useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "@/components/ui/icons";

export type Theme = "system" | "light" | "dark";

const STORAGE_KEY = "lixto.theme";

const THEMES: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "system", label: "Tema do sistema", icon: Monitor },
  { value: "light", label: "Tema claro", icon: Sun },
  { value: "dark", label: "Tema escuro", icon: Moon },
];

// Theme lives in a module-level store read through useSyncExternalStore
// (server snapshot = "system") — same pattern as the sidebar's collapsed
// state — so we avoid a setState-in-effect hydration dance while still
// persisting across reloads. `layout.tsx` runs an inline script before
// hydration that reads the same key and sets `data-theme` to avoid a flash;
// this store just keeps the toggle UI and `data-theme` in sync afterwards.
let themeStore: Theme | null = null;
const themeListeners = new Set<() => void>();

function readTheme(): Theme {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
    return "system";
  } catch {
    // localStorage unavailable (private mode, disabled) — default system.
    return "system";
  }
}

function getThemeSnapshot(): Theme {
  if (themeStore === null) themeStore = readTheme();
  return themeStore;
}

function getThemeServerSnapshot(): Theme {
  return "system";
}

function subscribeTheme(listener: () => void): () => void {
  themeListeners.add(listener);
  return () => {
    themeListeners.delete(listener);
  };
}

function applyTheme(next: Theme) {
  if (next === "system") {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = next;
  }
}

function setThemeStore(next: Theme) {
  themeStore = next;
  try {
    if (next === "system") {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, next);
    }
  } catch {
    // ignore
  }
  applyTheme(next);
  for (const listener of themeListeners) listener();
}

/** Three-state segmented control (system/light/dark). Renders as a single
 * icon button cycling the three states when `collapsed`. */
export function ThemeToggle({ collapsed = false }: { collapsed?: boolean }) {
  const theme = useSyncExternalStore(
    subscribeTheme,
    getThemeSnapshot,
    getThemeServerSnapshot,
  );

  if (collapsed) {
    const index = THEMES.findIndex((t) => t.value === theme);
    const current = THEMES[index] ?? THEMES[0];
    const Icon = current.icon;
    return (
      <button
        type="button"
        onClick={() => {
          const next = THEMES[(index + 1) % THEMES.length] ?? THEMES[0];
          setThemeStore(next.value);
        }}
        aria-label={current.label}
        title={current.label}
        className="flex h-7 w-7 items-center justify-center rounded-md text-ink-muted hover:bg-surface-raised hover:text-ink focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent-soft"
      >
        <Icon size={16} />
      </button>
    );
  }

  return (
    <div
      role="radiogroup"
      aria-label="Tema"
      className="flex items-center gap-0.5 rounded-md bg-surface-raised p-0.5"
    >
      {THEMES.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={theme === value}
          aria-label={label}
          title={label}
          onClick={() => setThemeStore(value)}
          className={`flex h-6 flex-1 items-center justify-center rounded-[5px] transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent-soft ${
            theme === value
              ? "bg-surface text-ink shadow-subtle"
              : "text-ink-muted hover:text-ink"
          }`}
        >
          <Icon size={14} />
        </button>
      ))}
    </div>
  );
}
