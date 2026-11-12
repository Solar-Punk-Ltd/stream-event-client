import { describe, expect, it } from 'vitest';

import { shownLinks } from '../src/features/catalog/streamLinks';

describe('the links a stream shows', () => {
  it('keeps https links with a label, trimmed', () => {
    expect(shownLinks([{ label: ' Watch on X ', href: ' https://x.com/i/broadcasts/abc ' }])).toEqual([
      { label: 'Watch on X', href: 'https://x.com/i/broadcasts/abc' },
    ]);
  });

  it('reads anything that is not a list as no links', () => {
    for (const value of [undefined, null, 'https://x.com', { label: 'X', href: 'https://x.com' }, 7]) {
      expect(shownLinks(value)).toEqual([]);
    }
  });

  it('leaves out an address that is not https, and an item without a label', () => {
    const links = [
      { label: 'Script', href: 'javascript:alert(1)' },
      { label: 'Plain', href: 'http://example.com' },
      { label: 'Not an address', href: 'youtube' },
      { label: '  ', href: 'https://example.com' },
      { href: 'https://example.com' },
      null,
      'https://example.com',
      { label: 'Watch on YouTube', href: 'https://youtube.com/live/abc' },
    ];
    expect(shownLinks(links)).toEqual([{ label: 'Watch on YouTube', href: 'https://youtube.com/live/abc' }]);
  });

  it('shows four at most', () => {
    const links = Array.from({ length: 6 }, (_, i) => ({ label: `Link ${i}`, href: `https://example.com/${i}` }));
    expect(shownLinks(links)).toHaveLength(4);
  });
});
