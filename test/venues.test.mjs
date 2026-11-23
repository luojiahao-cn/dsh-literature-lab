import test from 'node:test';
import assert from 'node:assert/strict';
import { lookupVenue, tierOf, normalizeIssn, venueStats } from '../lib/venues.js';

test('venues：CCF 与 SJR 合并，ISSN/名称/缩写匹配', () => {
  assert.deepEqual(normalizeIssn('20019866, 16524772'), ['2001-9866', '1652-4772']);
  const stats = venueStats();
  assert.ok(stats.ccf > 600 && stats.sjr > 30000);

  const tocs = tierOf(lookupVenue({ name: 'ACM Transactions on Computer Systems' }));
  assert.equal(tocs.label, 'CCF-A');
  assert.equal(tocs.ranks.ccf, 'A');

  const abbr = tierOf(lookupVenue({ name: 'TOCS' }));
  assert.equal(abbr.label, 'CCF-A');

  const sjr = tierOf(lookupVenue({ name: '2D Materials' }));
  assert.match(sjr.label, /^SJR Q[1-4]$/);

  assert.equal(lookupVenue({ name: 'Definitely Not A Journal' }), null);
});
