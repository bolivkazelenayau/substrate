# Bundle audit — Pass 3 lazy font engine boundary

Measured with `npm run analyze` on 2026-06-30. The interactive report is
generated locally at `dist/bundle-report.html`.

## Result

`opentype.js` moved out of the initial application chunk into the lazy
`opentypeFontEngine` chunk. The application reaches that chunk only through
`loadFontEngine()`, when a user selects a supported font file for parsing.

| Output | Minified | Gzip |
| --- | ---: | ---: |
| Initial application JS | 385.38 kB | 116.98 kB |
| Lazy OpenType font engine | 243.12 kB | 68.16 kB |
| Substrate worker | 5.97 kB | — |
| CSS | 15.55 kB | 3.73 kB |

Compared with Pass 2, the initial application chunk decreased from 627.92 kB
to 385.38 kB minified and from 185.07 kB to 116.98 kB gzip. The Vite 500 kB
chunk warning no longer appears.

## Runtime boundary

- `src/engine/fonts/opentypeFontEngine.ts` is the only product source module
  that imports `opentype.js` directly.
- `src/engine/fonts/loadFontEngine.ts` dynamically imports and caches the local
  implementation. A rejected load clears the cache so a later upload can retry.
- `fontLoader.ts` exposes parsed fonts through local `ParsedFont`,
  `ParsedGlyph`, and `FontEngine` contracts. Glyph layout remains synchronous
  after the uploaded font has resolved.
- Native browser-text fallback and schema-v7 project import do not request the
  parser. Imported font metadata still asks the user to re-upload the original
  file; raw font bytes are not persisted.
- SVG export consumes already-resolved text geometry exactly as before and does
  not import or invoke the font engine.

## UX and runtime tradeoffs

The first `.ttf` or `.otf` upload now includes one network chunk request before
parsing. The existing async upload flow remains intact and displays a minimal
`Loading font engine…` status while this happens. Later uploads reuse the cached
engine module. Font validation, metadata extraction, browser `FontFace`
registration fallback, glyph outlines, kerning, and optical spacing retain
their existing behavior.

## Recommendation

Do not split renderers merely to chase a threshold: the production warning is
resolved and renderer loading would introduce a broader asynchronous registry
contract. Revisit renderer code-splitting only if future measurements show
initial interaction or transfer cost is a product problem.
