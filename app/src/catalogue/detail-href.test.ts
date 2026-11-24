import { describe, expect, it } from 'vitest';
import { detailHref, interactiveHref, isClientRoutable } from './detail-href';

describe('detailHref', () => {
  it('routes every workflow to /w/view/?id=<id> regardless of isPrerendered', () => {
    expect(detailHref({ id: '26006871febf2139', slug: 'send-mail', isPrerendered: true })).toBe('/w/view/?id=26006871febf2139');
    expect(detailHref({ id: '9a366a688a57c198', slug: 'long-tail-workflow', isPrerendered: false })).toBe('/w/view/?id=9a366a688a57c198');
  });

  it('falls back to encoded slug when id is empty', () => {
    expect(detailHref({ id: '', slug: 'a/b?c', isPrerendered: false })).toBe('/w/view/?id=a%2Fb%3Fc');
  });

  it('encodes ids with special characters', () => {
    expect(detailHref({ id: 'id/one', slug: 'send-mail' })).toBe('/w/view/?id=id%2Fone');
  });

  it('marks /w/view/ as client-routable across all entries', () => {
    expect(isClientRoutable({ isPrerendered: true })).toBe(true);
    expect(isClientRoutable({ isPrerendered: false })).toBe(true);
    expect(isClientRoutable({})).toBe(true);
  });
});

describe('interactiveHref', () => {
  it('addresses the client shell by id, and encodes it', () => {
    expect(interactiveHref('id/one?x=1')).toBe('/w/view/?id=id%2Fone%3Fx%3D1');
  });

  it('carries related ids as a compact, encoded query parameter', () => {
    expect(interactiveHref('main', ['r1', 'r2'])).toBe('/w/view/?id=main&related=r1,r2');
  });

  it('omits the related parameter entirely when there are none', () => {
    expect(interactiveHref('main', [])).toBe('/w/view/?id=main');
    expect(interactiveHref('main')).toBe('/w/view/?id=main');
  });

  it('never lets the current id appear in its own related list', () => {
    expect(interactiveHref('main', ['main', 'r1', 'main'])).toBe('/w/view/?id=main&related=r1');
  });

  it('encodes related ids that would otherwise change the query string', () => {
    expect(interactiveHref('main', ['a,b', 'c&d'])).toBe('/w/view/?id=main&related=a%2Cb,c%26d');
  });
});
