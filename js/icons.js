/* =====================================================================
 * icons.js — the LVGL symbol set, redrawn as SVG for the preview.
 *
 * On the panel these are font glyphs in the F0xx range that live inside
 * ESPHome's built-in Montserrat. A browser has no such glyph, so the
 * preview draws its own copy. Shapes are matched to the Font Awesome
 * originals LVGL took them from, close enough that what you place is what
 * you get.
 *
 * Everything is drawn in a 24x24 box and inherits currentColor.
 * ===================================================================== */
(function (PF) {
  'use strict';

  var P = {
    power:    '<path d="M12 2.6v9.2" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none"/><path d="M7.1 5.6a7.2 7.2 0 1 0 9.8 0" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none"/>',
    home:     '<path d="M12 3 2.6 11.2h2.5V21h5.1v-5.6h3.6V21h5.1v-9.8h2.5z" fill="currentColor"/>',
    settings: '<path d="M12 8.4a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 0 0 0-7.2zm9 5.1v-3l-2.5-.4a6.9 6.9 0 0 0-.8-1.9l1.5-2-2.1-2.1-2 1.5a6.9 6.9 0 0 0-1.9-.8L12.8 2h-3l-.4 2.5a6.9 6.9 0 0 0-1.9.8l-2-1.5-2.1 2.1 1.5 2a6.9 6.9 0 0 0-.8 1.9L2 10.5v3l2.5.4c.2.7.5 1.3.8 1.9l-1.5 2 2.1 2.1 2-1.5c.6.4 1.2.6 1.9.8l.4 2.5h3l.4-2.5c.7-.2 1.3-.5 1.9-.8l2 1.5 2.1-2.1-1.5-2c.4-.6.6-1.2.8-1.9z" fill="currentColor"/>',
    left:     '<path d="M15.5 4 7.4 12l8.1 8" stroke="currentColor" stroke-width="2.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    right:    '<path d="M8.5 4l8.1 8-8.1 8" stroke="currentColor" stroke-width="2.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    up:       '<path d="M4 15.5 12 7.4l8 8.1" stroke="currentColor" stroke-width="2.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    down:     '<path d="M4 8.5 12 16.6l8-8.1" stroke="currentColor" stroke-width="2.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    plus:     '<path d="M12 4v16M4 12h16" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"/>',
    minus:    '<path d="M4 12h16" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"/>',
    ok:       '<path d="m4 12.6 5.2 5.2L20 6.6" stroke="currentColor" stroke-width="2.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    close:    '<path d="M5.5 5.5 18.5 18.5M18.5 5.5 5.5 18.5" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"/>',
    stop:     '<rect x="5" y="5" width="14" height="14" rx="1.5" fill="currentColor"/>',
    play:     '<path d="M6.5 4.4 19 12 6.5 19.6z" fill="currentColor"/>',
    pause:    '<rect x="5.6" y="4.6" width="4.6" height="14.8" rx="1" fill="currentColor"/><rect x="13.8" y="4.6" width="4.6" height="14.8" rx="1" fill="currentColor"/>',
    /* LV_SYMBOL_PREV / _NEXT, so the media card's transport needs no asset */
    prev:     '<rect x="4.6" y="4.6" width="2.8" height="14.8" rx="1" fill="currentColor"/><path d="M19.4 4.4 8.8 12l10.6 7.6z" fill="currentColor"/>',
    next:     '<rect x="16.6" y="4.6" width="2.8" height="14.8" rx="1" fill="currentColor"/><path d="M4.6 4.4 15.2 12 4.6 19.6z" fill="currentColor"/>',
    refresh:  '<path d="M20 12a8 8 0 1 1-2.6-5.9" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round"/><path d="M20 3.4V8h-4.6" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    bell:     '<path d="M12 3a5.4 5.4 0 0 0-5.4 5.4c0 4.3-1.4 5.6-2.1 6.3-.3.3-.1.9.4.9h14.2c.5 0 .7-.6.4-.9-.7-.7-2.1-2-2.1-6.3A5.4 5.4 0 0 0 12 3z" fill="currentColor"/><path d="M9.7 18.2a2.4 2.4 0 0 0 4.6 0z" fill="currentColor"/>',
    warning:  '<path d="M12 3.4 22 20.6H2z" fill="currentColor"/><path d="M12 9.6v4.6" stroke="#000" stroke-opacity=".55" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="17.4" r="1.2" fill="#000" fill-opacity=".55"/>',
    tint:     '<path d="M12 2.6S5.4 10 5.4 14.4a6.6 6.6 0 0 0 13.2 0C18.6 10 12 2.6 12 2.6z" fill="currentColor"/>',
    charge:   '<path d="M13.6 2 5 13.4h5.2L9.4 22 19 10.2h-5.4z" fill="currentColor"/>',
    wifi:     '<path d="M2.6 8.6a13.4 13.4 0 0 1 18.8 0" stroke="currentColor" stroke-width="2.3" fill="none" stroke-linecap="round"/><path d="M6 12.3a8.6 8.6 0 0 1 12 0" stroke="currentColor" stroke-width="2.3" fill="none" stroke-linecap="round"/><path d="M9.3 15.9a4 4 0 0 1 5.4 0" stroke="currentColor" stroke-width="2.3" fill="none" stroke-linecap="round"/><circle cx="12" cy="19.4" r="1.6" fill="currentColor"/>',
    audio:    '<path d="M19 3.2 9.4 5.4v9.9a3.4 3.4 0 1 0 1.9 3V8.9L19 7.2z" fill="currentColor"/><circle cx="16.4" cy="15.6" r="2.9" fill="currentColor"/>',
    volume:   '<path d="M4 9.4h3.4L12 5.2v13.6L7.4 14.6H4z" fill="currentColor"/><path d="M15.4 9a4.4 4.4 0 0 1 0 6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M18.2 6.4a8 8 0 0 1 0 11.2" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>',
    mute:     '<path d="M4 9.4h3.4L12 5.2v13.6L7.4 14.6H4z" fill="currentColor"/><path d="m15.4 9.4 5 5.2M20.4 9.4l-5 5.2" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
    list:     '<circle cx="4.4" cy="6.4" r="1.7" fill="currentColor"/><circle cx="4.4" cy="12" r="1.7" fill="currentColor"/><circle cx="4.4" cy="17.6" r="1.7" fill="currentColor"/><path d="M9 6.4h11M9 12h11M9 17.6h11" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
    eye:      '<path d="M12 5C6.6 5 2.6 9.4 1.6 12c1 2.6 5 7 10.4 7s9.4-4.4 10.4-7c-1-2.6-5-7-10.4-7z" stroke="currentColor" stroke-width="2.1" fill="none"/><circle cx="12" cy="12" r="3.1" fill="currentColor"/>',
    gps:      '<path d="M12 2.2c-3.7 0-6.7 3-6.7 6.7 0 5 6.7 12.9 6.7 12.9s6.7-7.9 6.7-12.9c0-3.7-3-6.7-6.7-6.7z" fill="currentColor"/><circle cx="12" cy="8.9" r="2.5" fill="#000" fill-opacity=".5"/>',
    battery:  '<rect x="1.8" y="7" width="17.2" height="10" rx="2.2" stroke="currentColor" stroke-width="2" fill="none"/><rect x="4" y="9.2" width="12.8" height="5.6" rx="1" fill="currentColor"/><rect x="20.6" y="10" width="1.8" height="4" rx=".8" fill="currentColor"/>'
  };

  function svg(id, sizePx, color) {
    var body = P[id];
    if (!body) return '';
    return '<svg class="pf-sym" viewBox="0 0 24 24" width="' + sizePx + '" height="' + sizePx +
      '" style="color:' + color + '" aria-hidden="true">' + body + '</svg>';
  }

  function has(id) { return !!P[id]; }

  PF.icons = { svg: svg, has: has, paths: P };
})(window.PF = window.PF || {});
