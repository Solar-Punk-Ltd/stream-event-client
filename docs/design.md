# The design

Two themes, in `src/design/`. `swarm` is Swarm Brand v3.0 as msrs-client's Swarm theme draws it: near-black surfaces,
the Swarm orange `#f47a20` as a sparing accent and Geist for all text. `web3privacy` is web3privacy.info's: a black
page, the neon green `#70ff88`, Archivo for text and Domine for headings. Both use JetBrains Mono only for the
configuration problem's detail and the playback quality panel. A deployment picks its theme in `config.json`, and a
logged-in viewer can switch the look, as [configuration](configuration.md#themes-and-the-theme-switcher) says.

- **The tokens.** The scales (sizes, spacing, type steps, radii, timing) live in `src/design/_tokens.scss`, one Sass
  map per group. What a theme decides, its colours and typefaces, lives in `src/design/themes/`, one file per theme,
  each merged over `themes/_base.scss`, which holds what every theme shares. `src/design/theme.scss` emits the scales
  once on `:root` and each theme under `:root[data-theme='<name>']`, the default theme on a bare `:root` too, and under
  `[data-theme-preview='<name>']` for an element that shows one theme whatever the page wears, as CSS custom properties
  named `--<group>-<name>`, for example `--color-primary` or `--spacing-base`. It also sets the page's base styles.
- **The theme's content.** The logo, the hero, the footer links and the tab's title and icon per theme are in
  `src/design/themes.ts`, and `src/design/look.ts` applies a look (`applyLook`) and a theme's content
  (`applyThemeContent`) to the document. The theme names and the default are in `src/design/themeNames.ts`, which
  imports nothing so the config schema can read it under Node.
- **Components read only the variables**, `var(--color-primary)`, never a Sass token or a literal colour, so a switch of
  the look reaches every part of the page. The tokens test refuses a colour a stylesheet outside `src/design/` writes
  out. The breakpoints are the one exception, because a media query cannot read a custom property: they are the mixins
  in `src/design/_media.scss`, and every layout is written for a phone first and widened by them.
- **To add a token**, add a scale to its map in `_tokens.scss`, or a colour or typeface to every theme in
  `src/design/themes/`, and read it where it is needed. The tokens test (`test/designTokens.test.ts`) fails when a
  stylesheet reads a variable the design does not define, when the design defines one nothing reads, when one theme
  lacks a variable another has, and when a text colour falls below 4.5:1 against its background. A new colour pairing
  goes into its list too.
- **The fonts** are bundled from `@fontsource`, only the weights used: Geist 400, 500, 600 and 700, Archivo 300 to
  700, Domine 400 and JetBrains Mono 500, imported in `src/design/fonts.ts`. A browser downloads a typeface only when
  text on the page is set in it, which the switcher's swatches do for each theme's heading typeface once the menu is
  open. The page makes no font request to a third party. Another weight needs its file imported there, or the browser
  fakes it. The build never inlines a font file into the stylesheet (`vite.config.js`), because inlining throws away
  the unicode-range that lets the browser skip the subsets it never shows.
- **Shared components** live in `src/shared/components/`: `Button`, `Dialog`, `Spinner`, `SocialLinks`, the short
  address with its copy button (`Address/`) and the badge icons (`Icons/`).
