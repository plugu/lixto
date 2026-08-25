"use client";

import { useId, useMemo, useState } from "react";
import type { FacetOption } from "@/lib/procurement-queries";

type MultiSelectProps = {
  /** Param name — submitted once per checked value (e.g. `?modality=6&modality=8`),
   * read server-side by parseFilters. */
  name: string;
  label: string;
  options: FacetOption[];
  selected: string[];
};

const SEARCH_THRESHOLD = 10;

/**
 * Checkbox list for one filter dimension. It renders *inline* (no dropdown of
 * its own, no "Aplicar" of its own): it lives inside the Filtrar popover of
 * `components/filters.tsx`, which supplies the single "Aplicar" submit button
 * for the whole GET form.
 *
 * Checked state is controlled and submitted via always-mounted hidden inputs —
 * visible checkboxes carry no `name`. That keeps every filter's selection in
 * the GET payload even while the popover is closed or an option is hidden by
 * the search box (the original bug: submitting one filter dropped all others,
 * because unmounted checkboxes don't submit).
 */
export function MultiSelect({ name, label, options, selected }: MultiSelectProps) {
  const [search, setSearch] = useState("");
  const [checked, setChecked] = useState<ReadonlySet<string>>(
    () => new Set(selected),
  );

  const selectedKey = useMemo(() => [...selected].sort().join(" "), [selected]);
  // Re-sync from the URL-derived props after each server render/navigation.
  // Done during render (not in an effect) — the supported "adjust state when
  // props change" pattern, and it avoids the cascading render an effect causes.
  const [syncedKey, setSyncedKey] = useState(selectedKey);
  if (syncedKey !== selectedKey) {
    setSyncedKey(selectedKey);
    setChecked(new Set(selectedKey ? selectedKey.split(" ") : []));
  }

  const id = useId();
  const hasSelection = checked.size > 0;
  const showSearch = options.length > SEARCH_THRESHOLD;
  const filteredOptions =
    showSearch && search.trim()
      ? options.filter((option) =>
          option.label.toLowerCase().includes(search.trim().toLowerCase()),
        )
      : options;

  function toggle(value: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {[...checked].map((value) => (
        <input key={value} type="hidden" name={name} value={value} />
      ))}

      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-ink-muted">{label}</span>
        {hasSelection ? (
          <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-[9999px] bg-accent-soft px-1 text-[11px] font-semibold text-accent">
            {checked.size}
          </span>
        ) : null}
      </div>

      {showSearch && (
        <input
          type="text"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={`Buscar ${label.toLowerCase()}…`}
          className="h-8 w-full rounded-md border border-line bg-surface px-2 text-[13px] text-ink outline-none placeholder:text-ink-faint focus-visible:border-accent focus-visible:ring-[3px] focus-visible:ring-accent-soft"
        />
      )}

      <div className="max-h-40 space-y-0.5 overflow-y-auto rounded-md bg-surface-raised/60 p-1">
        {filteredOptions.length === 0 ? (
          <p className="px-2 py-1 text-[13px] text-ink-muted">Nenhuma opção.</p>
        ) : (
          filteredOptions.map((option) => {
            const value = String(option.value);
            const checkboxId = `${id}-${value}`;
            return (
              <label
                key={value}
                htmlFor={checkboxId}
                className="flex cursor-pointer items-center justify-between gap-2 rounded-md px-1.5 py-1 text-[13px] text-ink hover:bg-surface"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <input
                    id={checkboxId}
                    type="checkbox"
                    checked={checked.has(value)}
                    onChange={() => toggle(value)}
                    className="h-3.5 w-3.5 shrink-0 rounded-[4px] border-line text-accent accent-accent focus:outline-none focus-visible:ring-[3px] focus-visible:ring-accent-soft"
                  />
                  <span className="truncate">{option.label}</span>
                </span>
                {option.count > 0 ? (
                  <span className="shrink-0 text-[11px] tabular-nums text-ink-faint">
                    {option.count}
                  </span>
                ) : null}
              </label>
            );
          })
        )}
      </div>
    </div>
  );
}
