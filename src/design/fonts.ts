// Bundled rather than fetched from a font service, so the page makes no third-party request. Only the
// weights the design uses are imported, and each file covers every script the font has, which the
// browser downloads only for the characters a page actually shows.
import '@fontsource/geist/400.css';
import '@fontsource/geist/500.css';
import '@fontsource/geist/600.css';
import '@fontsource/geist/700.css';
import '@fontsource/jetbrains-mono/500.css';
// The web3privacy theme's Archivo and Domine, web3privacy.info's own typefaces. Declared for every
// theme but downloaded only by a page that uses them, since a browser fetches a face when text needs it.
import '@fontsource/archivo/300.css';
import '@fontsource/archivo/400.css';
import '@fontsource/archivo/500.css';
import '@fontsource/archivo/600.css';
import '@fontsource/archivo/700.css';
import '@fontsource/domine/400.css';
