import { describe, expect, it } from 'vitest';

import { swarmIdButtonFontFaces } from '../../src/features/chat/swarmId/swarmIdButtonFonts';

const GEIST = '"Geist", system-ui, -apple-system, sans-serif';

describe("the font files Swarm ID's button is handed", () => {
  it("are the page's own file of the theme's typeface at the button's weight, absolute on the page's origin", () => {
    expect(swarmIdButtonFontFaces(GEIST, '700', 'https://viewer.example.com/#/watch')).toEqual([
      {
        family: 'Geist',
        url: expect.stringMatching(/^https:\/\/viewer\.example\.com\/.*geist-latin-700-normal[^/]*\.woff2$/),
        weight: '700',
      },
    ]);
    expect(swarmIdButtonFontFaces('Archivo, system-ui', '600', 'https://viewer.example.com/')).toEqual([
      { family: 'Archivo', url: expect.stringMatching(/archivo-latin-600-normal[^/]*\.woff2$/), weight: '600' },
    ]);
  });

  it('are served over plain http only to a page on this machine, which is all Swarm ID takes', () => {
    expect(swarmIdButtonFontFaces(GEIST, '700', 'http://127.0.0.1:4173/')).toHaveLength(1);
    expect(swarmIdButtonFontFaces(GEIST, '700', 'http://localhost:5173/')).toHaveLength(1);
    expect(swarmIdButtonFontFaces(GEIST, '700', 'http://viewer.example.com/')).toEqual([]);
  });

  it('are none for a typeface or a weight the page bundles no file for', () => {
    expect(swarmIdButtonFontFaces('Domine, serif', '400', 'https://viewer.example.com/')).toEqual([]);
    expect(swarmIdButtonFontFaces(GEIST, '300', 'https://viewer.example.com/')).toEqual([]);
    expect(swarmIdButtonFontFaces(undefined, '700', 'https://viewer.example.com/')).toEqual([]);
  });
});
