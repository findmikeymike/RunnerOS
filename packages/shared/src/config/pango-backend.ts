/**
 * Stop libvips taking twenty-five seconds to draw a word.
 *
 * sharp bundles libvips with librsvg and Pango statically linked. On macOS,
 * Pango defaults to its CoreText backend, and rendering any SVG containing a
 * `<text>` element through that backend takes 20-45 seconds per render on
 * Apple Silicon. The same SVG with the text removed renders in 82ms, so it is
 * the text path specifically, not rasterization.
 *
 * It is not the machine's fonts: Core Text enumerates 2548 fonts in 64-188ms
 * and matches a family in 3-40ms when called directly. It is not the sharp
 * version either — 0.34.5 (libvips 8.17) and 0.35.4 (libvips 8.18) are both
 * affected. It reproduces under bun, under Node, and inside Electron with a
 * live run loop, so it reaches the shipped app: the Art Director agent stalls
 * for twenty seconds every time it composes a cover.
 *
 * Pango's fontconfig backend renders the same text 200x faster and produces a
 * pixel-identical image (18109 vs 18108 lit pixels on a 800x300 sample, one
 * pixel of antialiasing rounding).
 *
 * Two things about the timing, both learned the hard way:
 *
 * This has to run BEFORE anything imports sharp. Pango reads the variable when
 * the library initialises, so setting it afterwards only works by luck — which
 * looks exactly like a fix until it does not.
 *
 * And it only works under Node, which is what Electron runs, so the desktop
 * app is covered. Bun does not push `process.env` writes into the real
 * environment, so under Bun this file is inert no matter how early it loads —
 * verified against a preload, a `.env.test`, and a dynamic import, all still
 * 20s+. Bun processes need the variable in the actual environment instead:
 * the root `test` script sets it, and the standalone server entry relaunches
 * once with it set before importing the server runtime.
 *
 * Do not upgrade sharp past 0.34.5 expecting this to still hold. Measured on
 * 0.35.4 / libvips 8.18.6: the CoreText path improves (45s to ~5.5s per
 * render) but the fontconfig path regresses badly — ~27s on the first render
 * of *every* process, and no, the on-disk fontconfig cache does not help; a
 * fresh process pays it again. Against 60-115ms here, both options are worse,
 * so an upgrade needs this measured rather than assumed.
 *
 * macOS only. Linux already defaults to fontconfig, and Windows Pango uses its
 * own backend that this would break.
 *
 * Expect one `Fontconfig error: Cannot load default config file` line on
 * stderr the first time text is rendered. It is noise, not a failure —
 * fontconfig falls back to scanning the default font directories and finds the
 * same families, which is why the output is pixel-identical. Giving it a
 * config file to silence the line would mean choosing which fonts it can see,
 * so the warning is the safer trade.
 */

if (process.platform === 'darwin' && !process.env['PANGOCAIRO_BACKEND']) {
  process.env['PANGOCAIRO_BACKEND'] = 'fontconfig';
}

export {};
