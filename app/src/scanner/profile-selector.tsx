'use client';

import type { ScanProfile } from './scan-profiles';

type SelectableProfile = 'standard' | 'strict';

const PROFILE_OPTIONS: ReadonlyArray<{
  id: SelectableProfile;
  label: string;
  description: string;
}> = [
  { id: 'standard', label: 'Standard', description: 'Default · full v0.3 rules & flow' },
  { id: 'strict', label: 'Strict', description: 'CI mode · warns & misses block' },
];

export function ProfileSelector({
  value,
  disabled = false,
  onChange,
}: {
  value: ScanProfile;
  disabled?: boolean;
  onChange: (profile: SelectableProfile) => void;
}) {
  const activeOption = PROFILE_OPTIONS.find((item) => item.id === value) ?? PROFILE_OPTIONS[0]!;

  return (
    <div className="min-w-0 max-w-full rounded-control border border-hairline bg-raised/60 p-2">
      <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Scanner profile">
        {PROFILE_OPTIONS.map((option) => {
          const selected = activeOption.id === option.id;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onChange(option.id)}
              className={`inline-flex min-h-11 items-center justify-center rounded-control border px-3 font-mono text-xs font-semibold transition-all active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40 ${
                selected
                  ? 'border-accent-border bg-accent-dim text-accent-text'
                  : 'border-hairline bg-panel text-ink-muted hover:border-hairline-strong hover:text-ink'
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      <p className="mt-1.5 px-1 text-2xs text-ink-muted">{activeOption.description}</p>
    </div>
  );
}
