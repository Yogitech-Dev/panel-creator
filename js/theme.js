/* =====================================================================
 * theme.js — palettes and colour helpers
 *
 * Every palette here is FLAT on purpose. The Tab5's DSI link only has the
 * bandwidth for 16-bit colour (see the note in gen-yaml.js), and RGB565
 * visibly bands any large gradient. So: solid fills, contrast carried by
 * value rather than by glow.
 * ===================================================================== */
(function (PF) {
  'use strict';

  var THEMES = [
    {
      id: 'ember',
      name: 'Ember',
      note: 'Warm brown cards on near-black. The palette the original panel shipped with.',
      bg: 0x0B0E14,
      card: 0x1F1A15,
      cardBorder: 0x453A2E,
      strip: 0x2C2219,
      ink: 0xF4EAD9,
      inkDim: 0xA08D78,
      accent: 0xEAB35C,      // warm — lights
      accentFill: 0x5A4326,  // the dim end of a light slider
      accent2: 0x8FD0F0,     // cool — fans, climate, anything moving air
      accent2Fill: 0x232B33,
      ok: 0x8FD07A,
      warn: 0xD06A5A
    },
    {
      id: 'slate',
      name: 'Slate',
      note: 'Neutral cool grey. Disappears into a white wall better than the warm one.',
      bg: 0x0E1116,
      card: 0x191F26,
      cardBorder: 0x2E3944,
      strip: 0x222B34,
      ink: 0xE8EDF2,
      inkDim: 0x8A97A4,
      accent: 0xF0C674,
      accentFill: 0x40382A,
      accent2: 0x74B8E0,
      accent2Fill: 0x223441,
      ok: 0x82C784,
      warn: 0xE07A6A
    },
    {
      id: 'ink',
      name: 'Ink',
      note: 'Near-black with one bright accent. Highest contrast, lowest backlight power.',
      bg: 0x000000,
      card: 0x0E0E10,
      cardBorder: 0x24242A,
      strip: 0x18181C,
      ink: 0xFFFFFF,
      inkDim: 0x7E7E88,
      accent: 0xFFC857,
      accentFill: 0x3A2E14,
      accent2: 0x5BC8E8,
      accent2Fill: 0x102A33,
      ok: 0x7BD88F,
      warn: 0xFF6B5B
    },
    {
      id: 'paper',
      name: 'Paper',
      note: 'Light theme. Readable in a sunny hallway, and it costs the backlight nothing extra.',
      bg: 0xE9E2D4,
      card: 0xF7F2E7,
      cardBorder: 0xD3C9B6,
      strip: 0xE2D9C6,
      ink: 0x241C12,
      inkDim: 0x776A57,
      accent: 0xC07C1E,
      accentFill: 0xF0D9A8,
      accent2: 0x2C6E8F,
      accent2Fill: 0xC9DEE8,
      ok: 0x3E7D3A,
      warn: 0xA8432F
    }
  ];

  function byId(id) {
    for (var i = 0; i < THEMES.length; i++) if (THEMES[i].id === id) return THEMES[i];
    return THEMES[0];
  }

  /* 0xRRGGBB -> "#rrggbb" */
  function css(n) {
    return '#' + ('000000' + (n >>> 0).toString(16)).slice(-6);
  }

  /* 0xRRGGBB -> "0xRRGGBB", the form ESPHome's LVGL wants */
  function hex(n) {
    return '0x' + ('000000' + (n >>> 0).toString(16).toUpperCase()).slice(-6);
  }

  function parseCss(s) {
    var t = String(s || '').replace('#', '');
    var n = parseInt(t, 16);
    return isNaN(n) ? 0 : n & 0xFFFFFF;
  }

  function rgb(n) {
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  /* ITU-R BT.601 perceived luminance — the same weights tab5_ui.h uses, so
   * the preview picks the same ink colour the panel will. */
  function luma(n) {
    var c = rgb(n);
    return 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
  }

  function inkFor(n, theme) {
    return luma(n) > 150 ? 0x160F08 : (theme ? theme.ink : 0xF4EAD9);
  }

  function mix(a, b, t) {
    var ca = rgb(a), cb = rgb(b);
    var r = Math.round(ca.r + (cb.r - ca.r) * t);
    var g = Math.round(ca.g + (cb.g - ca.g) * t);
    var bl = Math.round(ca.b + (cb.b - ca.b) * t);
    return (r << 16) | (g << 8) | bl;
  }

  /* Kelvin -> RGB over a bulb's own range. Mirrors kelvin_rgb() in tab5_ui.h
   * exactly; if you change one, change the other or the preview lies. */
  function kelvinRgb(k, kmin, kmax) {
    var t = (k - kmin) / (kmax - kmin);
    if (!isFinite(t)) t = 0;
    t = Math.max(0, Math.min(1, t));
    var r = Math.round(255 - t * 40);
    var g = Math.round(150 + t * 78);
    var b = Math.round(55 + t * 190);
    return (r << 16) | (g << 8) | b;
  }

  /* Quantise to RGB565 so the preview shows the banding the panel will show.
   * Only used for the big flat fills, which is where it actually shows up. */
  function to565(n) {
    var c = rgb(n);
    var r = (c.r >> 3) << 3, g = (c.g >> 2) << 2, b = (c.b >> 3) << 3;
    return (r << 16) | (g << 8) | b;
  }

  PF.theme = {
    list: THEMES,
    byId: byId,
    css: css,
    hex: hex,
    parseCss: parseCss,
    rgb: rgb,
    luma: luma,
    inkFor: inkFor,
    mix: mix,
    kelvinRgb: kelvinRgb,
    to565: to565
  };
})(window.PF = window.PF || {});
