import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QuickFilterRow, visibleQuickFilters } from './quick-filter-row';

afterEach(() => cleanup());

describe('visibleQuickFilters', () => {
  it('deduplicates normalized labels case-insensitively across integrations and tags', () => {
    const filters = visibleQuickFilters(
      {
        integrations: { openai: 180, 'google-sheets': 400, slack: 150 },
        tags: { openai: 180, 'google-sheets': 390, alerts: 50, OpenAI: 40 },
      },
      6,
    );

    expect(filters.map((filter) => `${filter.group}:${filter.slug}:${filter.label}`)).toEqual([
      'integration:google-sheets:Google Sheets',
      'integration:openai:OpenAI',
      'integration:slack:Slack',
      'intent:alerts:Alerts',
    ]);
  });

  it('prefers integration over intent when counts tie and keeps deterministic ordering', () => {
    const filters = visibleQuickFilters(
      {
        integrations: { gmail: 100 },
        tags: { gmail: 100, email: 100 },
      },
      6,
    );

    expect(filters.map((filter) => `${filter.group}:${filter.slug}`)).toEqual([
      'integration:gmail',
      'intent:email',
    ]);
  });
});

describe('QuickFilterRow', () => {
  it('renders deduplicated pills and uses subtle tinted selected state without solid bg-accent', () => {
    render(
      <QuickFilterRow
        counts={{
          rights: {},
          grade: {},
          trigger: {},
          complexity: {},
          capabilities: {},
          integrations: { openai: 180, slack: 150 },
          tags: { openai: 180, alerts: 50 },
        }}
        filters={{ integration: ['openai'] }}
        sort="relevance"
        onFilterChange={vi.fn()}
        onSortChange={vi.fn()}
        onMoreFilters={vi.fn()}
      />,
    );

    expect(screen.getAllByRole('button', { name: /Quick filter OpenAI/i })).toHaveLength(1);
    const selected = screen.getByRole('button', { name: /Quick filter OpenAI 180/ });
    expect(selected.className).toContain('bg-accent-dim');
    expect(selected.className).toContain('border-accent-border');
    expect(selected.className).toContain('text-accent-text');
    expect(selected.className).toContain('font-semibold');
  });
});
