/* =====================================================================
 * fonts.js — text sizes, and what they are called in YAML.
 *
 * Two families, and the choice is not cosmetic:
 *
 *   Roboto      pulled from Google Fonts AT COMPILE TIME. Any size you like,
 *               proper weights, needs the build machine to have internet.
 *   Montserrat  built into ESPHome. No download, offline builds work, but it
 *               stops at 48 px — so it cannot do a big scaled readout.
 *
 * SIZES ARE EMITTED ON DEMAND. Every distinct size costs one `font:` entry
 * and its glyph bitmaps in flash, so the generator collects the set actually
 * used and emits exactly those — see collect() in gen-yaml.js.
 *
 * TWO KINDS, and this is what makes big text affordable:
 *
 *   'ui'   full glyph set (~77 chars). Titles, words, anything a user types.
 *   'num'  digits and the handful of symbols a readout needs. A 200 px font
 *          with the default glyph set is most of a megabyte of flash; the
 *          same size restricted to "0123456789:.%° -" is about a tenth of
 *          that, and a clock or a temperature never needs a letter.
 *
 * SYMBOLS ONLY EXIST IN MONTSERRAT. The LVGL symbol glyphs live in the F0xx
 * range and the Google-Fonts Roboto build does not carry them, so any label
 * holding a symbol is forced to a montserrat_NN font regardless of family.
 * ===================================================================== */
(function (PF) {
  'use strict';

  /* The named steps, as CHOSEN by hand. 'fit' is computed per card.
   *
   * `xl` is deliberately far above the others. It is the rung whose job is
   * "as big as this card can take", and it used to be 72 px — which on a
   * 738x300 card, where 185 px fits, delivered under 40% of the space and
   * made "Huge" a misleading name. Nothing is drawn at 160 px unless the
   * card is genuinely that big: text() clamps every size to the box in 4 px
   * steps, so xl simply stops being the thing that limits you. */
  var STEPS = {
    roboto:     { sm: 18, md: 30, lg: 52, xl: 160 },
    montserrat: { sm: 18, md: 28, lg: 38, xl: 48 }    /* built-in, caps at 48 */
  };

  /* What 'auto' resolves to — the ORIGINAL ladder, frozen.
   *
   * 'auto' is what a card uses when its size is left on Default, and the
   * promise there is that an existing panel looks identical until somebody
   * changes something. Raising xl above must therefore not move it, so auto
   * reads from here and an explicit choice reads from STEPS. */
  var AUTO_STEPS = {
    roboto:     { sm: 18, md: 30, lg: 52, xl: 72 },
    montserrat: { sm: 18, md: 28, lg: 38, xl: 48 }
  };

  /* What a 'num' font is allowed to contain. Everything a readout renders:
   * digits, a decimal point, a clock colon, percent, degree, minus, space,
   * and the two words a light tile falls back to when it is not dimmable. */
  var NUM_GLYPHS = '0123456789.:%°- ONF';

  /* Montserrat is built in at even sizes 8..48 only. */
  var MONT_MAX = 48;

  function family() {
    var p = PF.store && PF.store.get();
    return (p && p.fonts && p.fonts.family === 'montserrat') ? 'montserrat' : 'roboto';
  }

  function px(id) {
    var t = STEPS[family()];
    return t[id] || t.md;
  }

  /* The frozen ladder, for 'auto' only — see AUTO_STEPS. */
  function autoPx(id) {
    var t = AUTO_STEPS[family()];
    return t[id] || t.md;
  }

  /* How wide each character actually is, in em, for the heavy weights a
   * readout uses. Roboto's digits run about 0.60; everything else does NOT.
   *
   * This used to be a flat 0.60 for every character, which charged a decimal
   * point the same as an 8 and made "88.8°C" look 3.60 em wide when it is
   * nearer 3.2 — so a temperature came out smaller than it needed to be. It
   * also UNDER-charged '%', which is wider than a digit, so a percentage was
   * sized slightly too big and ran closer to the edge than intended. */
  var EM = {
    '.': 0.30, ':': 0.30, '%': 0.80, '°': 0.45, '-': 0.38, ' ': 0.26, '/': 0.42
  };
  function emWidth(sample) {
    var s = String(sample === undefined || sample === null ? '00' : sample);
    if (!s.length) s = '00';
    var w = 0;
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      if (EM[ch] !== undefined) w += EM[ch];
      else if (ch >= '0' && ch <= '9') w += 0.60;
      else if (ch >= 'A' && ch <= 'Z') w += 0.68;
      else w += 0.58;
    }
    return Math.max(0.3, w);
  }

  /* Largest size at which `sample` still fits the box. The line box runs about
   * 1.22 em, measured off the rendered preview rather than assumed. */
  function fitPx(boxW, boxH, sample, emExtra) {
    var byWidth  = boxW / (emWidth(sample) + (emExtra || 0));
    var byHeight = boxH / 1.22;
    var n = Math.floor(Math.min(byWidth, byHeight));
    /* Snap to 4 px so a row of cards tends to land on the SAME size and
     * shares one font entry instead of each carrying its own. */
    n = Math.floor(n / 4) * 4;
    return clamp(n);
  }

  /* Keep it printable and affordable. A restricted digit set costs roughly
   * (size/216)^2 * 100 kB, so 400 px is about 340 kB of flash — real, but
   * affordable on 8 MB and only if somebody deliberately asks for it. The
   * card still clamps it to what fits. */
  function clamp(n) {
    var max = family() === 'montserrat' ? MONT_MAX : 400;
    if (!isFinite(n) || n < 12) return 12;
    return Math.min(n, max);
  }

  /* Montserrat only exists at even sizes, so snap to one it really has. */
  function real(n) {
    if (family() !== 'montserrat') return clamp(n);
    var v = Math.min(clamp(n), MONT_MAX);
    v = v - (v % 2);
    return Math.max(8, v);
  }

  /* The YAML id for a size. Built-in Montserrat needs no font: entry at all;
   * Roboto sizes are emitted by the generator as f_ui_NN / f_num_NN. */
  function idFor(size, kind) {
    var n = real(size);
    if (family() === 'montserrat') return 'montserrat_' + n;
    return (kind === 'num' ? 'f_num_' : 'f_ui_') + n;
  }

  /* Montserrat comes in even sizes 8..48. Round anything else to fit. */
  function symbolFont(wanted) {
    var n = Math.round(wanted);
    n = n - (n % 2);
    if (n < 8) n = 8;
    if (n > MONT_MAX) n = MONT_MAX;
    return { id: 'montserrat_' + n, px: n };
  }

  function fixedFont(wanted) { return symbolFont(wanted); }

  /* Weight per kind — the big readouts are heavier so they read across a room */
  function weightFor(size, kind) {
    if (kind === 'num') return size >= 60 ? 900 : 700;
    return size >= 40 ? 700 : 500;
  }

  PF.fonts = {
    STEPS: STEPS,
    autoPx: autoPx,
    emWidth: emWidth,
    NUM_GLYPHS: NUM_GLYPHS,
    MONT_MAX: MONT_MAX,
    family: family,
    px: px,
    fitPx: fitPx,
    real: real,
    clamp: clamp,
    idFor: idFor,
    weightFor: weightFor,
    symbolFont: symbolFont,
    fixedFont: fixedFont
  };
})(window.PF = window.PF || {});
