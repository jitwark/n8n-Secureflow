import MiniSearch from 'minisearch';
import { describe, expect, it } from 'vitest';
import { SEARCH_FIELDS, SEARCH_OPTIONS, SEARCH_STORE_FIELDS } from '@hub/contracts';
import { matchTokens } from './lexical-match';
import type { SearchDocument } from './worker-messages-doc';

/**
 * AUDIT-SEARCH-001: a 96-dimension hashed feature vector always activates two
 * dimensions, even for a token nobody has ever indexed. Without a vocabulary
 * check, an out-of-vocabulary token still produces a "similar" cosine score
 * against whatever else happens to hash into the same bucket — hash
 * collisions presenting as relevance. These tests isolate `matchTokens` from
 * the real corpus so the regression stays provable even as the shipped data
 * changes.
 */
function twoDocIndex(): MiniSearch<SearchDocument> {
  const mini = new MiniSearch<SearchDocument>({
    fields: [...SEARCH_FIELDS], storeFields: [...SEARCH_STORE_FIELDS], searchOptions: SEARCH_OPTIONS,
  });
  const fields = {
    summary: '', tags: [], integrations: [], triggers: [], capabilities: [], content: '',
    grade: 'low', rights: 'redistributable', complexity: 'simple', nodeCount: 4,
    descriptionSource: 'generated', isIndexable: true, isPrerendered: true,
  };
  mini.add({ id: 'has-digest', slug: 'has-digest', title: 'Inbox digest', ...fields });
  mini.add({ id: 'unrelated', slug: 'unrelated', title: 'Something else entirely', ...fields });
  return mini;
}

function indexForTitles(documents: Array<{ id: string; title: string }>): MiniSearch<SearchDocument> {
  const mini = new MiniSearch<SearchDocument>({
    fields: [...SEARCH_FIELDS], storeFields: [...SEARCH_STORE_FIELDS], searchOptions: SEARCH_OPTIONS,
  });
  for (const document of documents) {
    mini.add({
      id: document.id, slug: document.id, title: document.title,
      summary: '', tags: [], integrations: [], triggers: [], capabilities: [], content: '',
      grade: 'low', rights: 'redistributable', complexity: 'simple', nodeCount: 4,
      descriptionSource: 'generated', isIndexable: true, isPrerendered: true,
    });
  }
  return mini;
}

const ordinalOf = (id: string) => (id === 'has-digest' ? 0 : id === 'unrelated' ? 1 : undefined);

describe('matchTokens: semantic-only admission', () => {
  it('admits no matches for a token with zero vocabulary evidence, however high the hashed semantic score', () => {
    const semanticScores = new Map([[0, 0.5], [1, 0.6]]);
    const matches = matchTokens({
      tokens: ['zzz999notaword'],
      indexes: [twoDocIndex()],
      ordinalOf,
      semanticScores,
    });
    expect(matches).toHaveLength(0);
  });

  it('allows semantic-only admission at or above 0.55 once the query has real vocabulary evidence', () => {
    // "digest" has a literal lexical hit on ordinal 0; ordinal 1 has none, but
    // carries a strong (>= 0.55) semantic score and should be admitted when lexical hits < 25.
    const semanticScores = new Map([[0, 0.2], [1, 0.6]]);
    const matches = matchTokens({
      tokens: ['digest'],
      indexes: [twoDocIndex()],
      ordinalOf,
      semanticScores,
    });
    const ordinals = matches.map((match) => match.ordinal).sort();
    expect(ordinals).toEqual([0, 1]);
    const semanticOnly = matches.find((match) => match.ordinal === 1);
    expect(semanticOnly?.bm25).toBe(0);
    expect(semanticOnly?.semantic).toBe(0.6);
  });

  it('rejects semantic-only matches below the 0.55 similarity threshold', () => {
    const semanticScores = new Map([[0, 0.2], [1, 0.54]]);
    const matches = matchTokens({
      tokens: ['digest'],
      indexes: [twoDocIndex()],
      ordinalOf,
      semanticScores,
    });
    expect(matches.map((match) => match.ordinal)).toEqual([0]);
  });

  it('suppresses semantic-only admission when lexical hits reach 25 while preserving semantic ranking scores', () => {
    const docs = [
      ...Array.from({ length: 25 }, (_, i) => ({ id: `gmail-${i}`, title: `Gmail workflow ${i}` })),
      { id: 'unrelated', title: 'Unrelated document' },
    ];
    const index = indexForTitles(docs);
    const mapOrdinal = (id: string) => docs.findIndex((d) => d.id === id);
    const semanticScores = new Map<number, number>([[0, 0.7], [25, 0.95]]);
    const matches = matchTokens({
      tokens: ['gmail'],
      indexes: [index],
      ordinalOf: mapOrdinal,
      semanticScores,
    });
    expect(matches).toHaveLength(25);
    expect(matches.some((match) => match.ordinal === 25)).toBe(false);
    expect(matches.find((match) => match.ordinal === 0)?.semantic).toBe(0.7);
  });

  it('lets one real token carry semantic-only admission even alongside a gibberish token', () => {
    const semanticScores = new Map([[0, 0.2], [1, 0.6]]);
    const matches = matchTokens({
      tokens: ['digest', 'zzz999notaword'],
      indexes: [twoDocIndex()],
      ordinalOf,
      semanticScores,
    });
    expect(matches.some((match) => match.ordinal === 1)).toBe(true);
  });

  it('never admits semantic-only matches when there are no semantic scores at all', () => {
    const matches = matchTokens({
      tokens: ['zzz999notaword'],
      indexes: [twoDocIndex()],
      ordinalOf,
      semanticScores: new Map(),
    });
    expect(matches).toHaveLength(0);
  });
});

describe('matchTokens: search query contract', () => {
  it('requires every punctuation-separated term in a compound group and excludes partial matches', () => {
    const index = indexForTitles([
      { id: 'full', title: 'Zzzz Qwerty No Such Token' },
      { id: 'partial', title: 'No Such Token' },
    ]);
    const matches = matchTokens({
      tokens: ['zzzz-qwerty-no-such-token'],
      indexes: [index],
      ordinalOf: (id) => id === 'full' ? 0 : id === 'partial' ? 1 : undefined,
      semanticScores: new Map(),
    });

    expect(matches.map((match) => match.ordinal)).toEqual([0]);
  });

  it('uses aliases as OR alternatives when direct hits are sparse and weights alias-only hits lower', () => {
    const docs = [
      { id: 'direct-gmail', title: 'Gmail inbox workflow' },
      { id: 'alias-email', title: 'Email inbox workflow' },
    ];
    const matches = matchTokens({
      tokens: ['gmail'],
      indexes: [indexForTitles(docs)],
      ordinalOf: (id) => (id === 'direct-gmail' ? 0 : id === 'alias-email' ? 1 : undefined),
      semanticScores: new Map(),
    });

    expect(matches.map((match) => match.ordinal).sort()).toEqual([0, 1]);
    const direct = matches.find((match) => match.ordinal === 0)!;
    const alias = matches.find((match) => match.ordinal === 1)!;
    expect(direct.bm25).toBeGreaterThan(alias.bm25);
    expect(alias.bm25 / direct.bm25).toBeCloseTo(0.55, 2);
  });

  it('does not expand broad aliases or fuzzy synonyms when direct lexical hits are >= 15', () => {
    const docs = [
      ...Array.from({ length: 16 }, (_, i) => ({ id: `gmail-${i}`, title: `Gmail sync ${i}` })),
      ...Array.from({ length: 5 }, (_, i) => ({ id: `email-${i}`, title: `Email newsletter ${i}` })),
      ...Array.from({ length: 5 }, (_, i) => ({ id: `mail-${i}`, title: `Mail archive ${i}` })),
    ];
    const matches = matchTokens({
      tokens: ['gmail'],
      indexes: [indexForTitles(docs)],
      ordinalOf: (id) => {
        const idx = docs.findIndex((d) => d.id === id);
        return idx >= 0 ? idx : undefined;
      },
      semanticScores: new Map(),
    });

    expect(matches).toHaveLength(16);
    expect(matches.every((match) => match.ordinal < 16)).toBe(true);
  });

  it('ANDs whitespace-separated groups when one document satisfies every group', () => {
    const matches = matchTokens({
      tokens: ['gmail', 'slack'],
      indexes: [indexForTitles([
        { id: 'both', title: 'Gmail Slack workflow' },
        { id: 'gmail-only', title: 'Gmail workflow' },
        { id: 'slack-only', title: 'Slack workflow' },
      ])],
      ordinalOf: (id) => id === 'both' ? 0 : id === 'gmail-only' ? 1 : id === 'slack-only' ? 2 : undefined,
      semanticScores: new Map(),
    });

    expect(matches.map((match) => match.ordinal)).toEqual([0]);
  });

  it('falls back to OR across whitespace groups only when strict AND has no result', () => {
    const matches = matchTokens({
      tokens: ['gmail', 'slack'],
      indexes: [indexForTitles([
        { id: 'gmail-only', title: 'Gmail workflow' },
        { id: 'slack-only', title: 'Slack workflow' },
      ])],
      ordinalOf: (id) => id === 'gmail-only' ? 0 : id === 'slack-only' ? 1 : undefined,
      semanticScores: new Map(),
    });

    expect(matches.map((match) => match.ordinal).sort()).toEqual([0, 1]);
  });

  it('treats words such as "no" and "the" as ordinary searchable terms', () => {
    const matches = matchTokens({
      tokens: ['such'],
      indexes: [indexForTitles([{ id: 'stopword-like', title: 'No such token' }])],
      ordinalOf: (id) => id === 'stopword-like' ? 0 : undefined,
      semanticScores: new Map(),
    });

    expect(matches.map((match) => match.ordinal)).toEqual([0]);
  });
});

describe('matchTokens: coverage relaxation', () => {
  const groupedIndex = () => indexForTitles([
    { id: 'all-groups', title: 'Gmail Slack digest' },
    { id: 'two-groups', title: 'Gmail digest' },
    { id: 'one-group', title: 'Slack workflow' },
  ]);
  const groupedOrdinal = (id: string) => ({ 'all-groups': 0, 'two-groups': 1, 'one-group': 2 })[id];

  it('admits only the strict intersection when that intersection can fill the requested window', () => {
    const matches = matchTokens({
      tokens: ['gmail', 'slack', 'digest'],
      indexes: [groupedIndex()],
      ordinalOf: groupedOrdinal,
      semanticScores: new Map(),
      requiredCandidates: 1,
    });

    expect(matches.map((match) => match.ordinal)).toEqual([0]);
  });

  it('relaxes one group at a time until the requested window can be filled', () => {
    const matches = matchTokens({
      tokens: ['gmail', 'slack', 'digest'],
      indexes: [groupedIndex()],
      ordinalOf: groupedOrdinal,
      semanticScores: new Map(),
      requiredCandidates: 3,
    });

    // Strict first, then the two-group answer, then the one-group answer: a
    // query the strict intersection cannot answer still reaches the documents
    // that answer most of it, and each of them is behind the fuller answer.
    expect(matches.map((match) => match.ordinal)).toEqual([0, 1, 2]);
  });

  it('discounts a partial answer by the share of the query it covers', () => {
    // The same document, admitted for a two-group query it answers completely
    // and for a three-group query it answers two thirds of. Per-group scores do
    // not depend on the rest of the query, so the two admissions differ only by
    // the discount: missing a group must cost the document what that group is
    // worth, or widening the window could reorder the full answers.
    const windowTwo = matchTokens({
      tokens: ['gmail', 'slack', 'digest'],
      indexes: [groupedIndex()],
      ordinalOf: groupedOrdinal,
      semanticScores: new Map(),
      requiredCandidates: 2,
    });
    const windowOne = matchTokens({
      tokens: ['gmail', 'digest'],
      indexes: [groupedIndex()],
      ordinalOf: groupedOrdinal,
      semanticScores: new Map(),
      requiredCandidates: 1,
    });

    expect(windowTwo.map((match) => match.ordinal)).toEqual([0, 1]);
    const twoOfThree = windowTwo.find((match) => match.ordinal === 1);
    const twoOfTwo = windowOne.find((match) => match.ordinal === 1);
    expect((twoOfThree?.bm25 ?? 0) / (twoOfTwo?.bm25 ?? 1)).toBeCloseTo(2 / 3, 6);
  });
});
