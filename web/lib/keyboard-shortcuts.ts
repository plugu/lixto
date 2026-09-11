"use client";

// Keyboard shortcuts for the app chrome (ticket 149): Gmail/Linear-style
// chords — `g` then a letter jumps between sections, `?` opens the command
// palette.
//
// `matchShortcut` is pure and unit-tested (lib/command-search-queries.test.ts);
// the hook is the only part that touches the DOM.

import { useEffect } from "react";

/** A binding's key sequence: single-space separated, already lowercased
 * (`"g o"`, `"?"`). */
export type ShortcutSequence = string;

export type ShortcutBinding = {
  sequence: ShortcutSequence;
  run: () => void;
};

/** `"match"` — the chord fired; `"prefix"` — the keys so far are the start of
 * this binding, keep listening; `"none"` — dead end. */
export type ShortcutMatch = "match" | "prefix" | "none";

/** How long a chord stays open before the buffer is dropped. */
export const CHORD_WINDOW_MS = 1000;

/** Nav shortcuts, keyed by the href they jump to. The sidebar renders these
 * as hints (`G O`) and binds them through `useKeyboardShortcuts`. */
export const NAV_SHORTCUTS: Record<string, ShortcutSequence> = {
  // "/radar" (future tenders) is a tab inside the same page; one chord.
  "/opportunities": "g r",
  "/dashboard": "g p",
  "/procurements": "g l",
};

/** Opens the command palette. */
export const PALETTE_SHORTCUT: ShortcutSequence = "?";

/** Pure chord matcher. `sequence` is the binding (`"g o"`); `keys` are the
 * keys pressed so far inside the chord window, oldest first. */
export function matchShortcut(
  sequence: ShortcutSequence,
  keys: readonly string[],
): ShortcutMatch {
  const expected = sequence.split(" ").filter((key) => key.length > 0);
  if (keys.length === 0 || keys.length > expected.length) return "none";
  for (let i = 0; i < keys.length; i += 1) {
    if (keys[i] !== expected[i]) return "none";
  }
  return keys.length === expected.length ? "match" : "prefix";
}

/** `"g o"` → `"G O"`, the hint rendered next to a nav item. */
export function formatShortcut(sequence: ShortcutSequence): string {
  return sequence.toUpperCase();
}

/** True when the event came from somewhere the user is typing — a shortcut
 * must never steal a keystroke from an input, textarea, select or any
 * contenteditable surface (the command palette input included). */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/** Binds `bindings` to the document for as long as the component is mounted.
 * Modified keystrokes (⌘/Ctrl/Alt) are left alone — they belong to the
 * browser or to the ⌘K handler in the palette. */
export function useKeyboardShortcuts(bindings: readonly ShortcutBinding[]) {
  // `bindings` must be memoized by the caller — the listener is rebound
  // whenever its identity changes.
  useEffect(() => {
    let keys: string[] = [];
    let timer: ReturnType<typeof setTimeout> | null = null;

    function reset() {
      keys = [];
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    }

    function handle(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isEditableTarget(event.target)) return;
      if (event.key.length !== 1) return;

      const key = event.key.toLowerCase();
      let candidate = [...keys, key];
      let matched = bindings.find(
        (binding) => matchShortcut(binding.sequence, candidate) === "match",
      );
      let pending = bindings.some(
        (binding) => matchShortcut(binding.sequence, candidate) === "prefix",
      );

      // A dead end restarts the chord from the key just pressed, so "x g o"
      // still jumps to Radar.
      if (!matched && !pending && keys.length > 0) {
        candidate = [key];
        matched = bindings.find(
          (binding) => matchShortcut(binding.sequence, candidate) === "match",
        );
        pending = bindings.some(
          (binding) => matchShortcut(binding.sequence, candidate) === "prefix",
        );
      }

      if (matched) {
        event.preventDefault();
        reset();
        matched.run();
        return;
      }

      reset();
      if (pending) {
        keys = candidate;
        timer = setTimeout(reset, CHORD_WINDOW_MS);
      }
    }

    document.addEventListener("keydown", handle);
    return () => {
      document.removeEventListener("keydown", handle);
      reset();
    };
  }, [bindings]);
}
