/* =====================================================================
 * canvas.js — the WYSIWYG panel: draw it, drag it, resize it.
 *
 * Everything on screen is a plain absolutely-positioned div at real panel
 * pixel coordinates, sitting inside a 1280x720 stage that is CSS-scaled to
 * fit the window. So what you measure here is what LVGL gets.
 *
 * Colours are quantised to RGB565 before drawing, because the panel's DSI
 * link only carries 16-bit colour and two shades that differ by 1/255 will
 * come out identical on the wall.
 * ===================================================================== */
(function (PF) {
  'use strict';

  var stage, wrap, scale = 1, demo = 'evening';
  var gesture = null;
  var guides = [];

  var FAN_SVG =
    '<svg viewBox="0 0 200 200" class="pf-blades"><defs>' +
    '<linearGradient id="pfblade" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="#DCE9F2"/><stop offset=".55" stop-color="#B8CEDE"/>' +
    '<stop offset="1" stop-color="#8FA9BC"/></linearGradient>' +
    '<radialGradient id="pfhub" cx="42%" cy="36%">' +
    '<stop offset="0" stop-color="#8C7059"/><stop offset="1" stop-color="#3A2C22"/></radialGradient>' +
    '<g id="pfb"><path d="M 26,-4 C 46,-19 74,-24 92,-16 C 98,-13 98,13 92,16 C 74,24 46,19 26,4 Z" ' +
    'fill="url(#pfblade)" stroke="#7B93A6" stroke-width="1.4" stroke-linejoin="round"/></g></defs>' +
    '<g transform="translate(100,100)"><use href="#pfb" transform="rotate(0)"/>' +
    '<use href="#pfb" transform="rotate(72)"/><use href="#pfb" transform="rotate(144)"/>' +
    '<use href="#pfb" transform="rotate(216)"/><use href="#pfb" transform="rotate(288)"/>' +
    '<circle r="17" fill="url(#pfhub)" stroke="#2A2018" stroke-width="2.5"/>' +
    '<circle r="5.5" fill="#241B14"/></g></svg>';

  var C = function (n) { return PF.theme.css(PF.theme.to565(n)); };
  var esc = function (s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };

  function weightFor(font) {
    if (font === 'f_xl') return 900;
    if (font === 'f_lg' || font === 'f_md') return 700;
    if (font === 'f_sm') return 500;
    return 600;                       /* montserrat_NN */
  }

  /* Render a text part from layout.js. `tint` marks labels that follow the
   * light-tile ink rule and get recoloured after measuring. */
  function T(part, str, color, extra) {
    if (!part) return '';
    /* autoW mirrors an LVGL label with no width set: it shrink-wraps its
     * text, which is what makes the light-tile ink rule work. */
    var w = part.autoW ? 'white-space:pre;' : 'width:' + part.w + 'px;text-align:' + (part.align || 'left') + ';';
    return '<div class="pf-t' + (extra && extra.cls ? ' ' + extra.cls : '') + '"' +
      (extra && extra.data ? ' ' + extra.data : '') +
      ' style="left:' + part.x + 'px;top:' + part.y + 'px;' + w +
      'font-size:' + part.px + 'px;line-height:' + PF.layout.lineH(part.px) + 'px;' +
      'font-weight:' + weightFor(part.font) + ';' +
      'color:' + C(color) + '">' + esc(str) + '</div>';
  }

  function SYM(part, symId, color) {
    if (!part) return '';
    /* An MDI symbol is an image on the panel, so its box is square rather than
     * a line height — and it is tinted by image_recolor, which takes the whole
     * glyph because an MDI outline is one solid shape. Drawing the real path
     * data rather than a stand-in is the point: see js/mdi.js. */
    var mdi = PF.catalog.mdiName(symId);
    if (mdi) {
      if (!PF.mdi.has(mdi)) return '';
      return '<div class="pf-t pf-symwrap" style="left:' + part.x + 'px;top:' + part.y + 'px;width:' + part.w + 'px;' +
        'height:' + (part.h || part.px) + 'px;text-align:' + (part.align || 'center') + '">' +
        PF.mdi.svg(mdi, part.px, C(color)) + '</div>';
    }
    /* Test what can be DRAWN, not what is in the picker. Role glyphs like
     * prev/next are drawn by icons.js but were never offered as choices, so
     * looking them up in the catalog returned the 'none' entry and the
     * transport buttons came out empty. */
    if (!symId || symId === 'none' || !PF.icons.has(symId)) return '';
    return '<div class="pf-t pf-symwrap" style="left:' + part.x + 'px;top:' + part.y + 'px;width:' + part.w + 'px;' +
      'height:' + (part.h || PF.layout.lineH(part.px)) + 'px;text-align:' + (part.align || 'center') + '">' +
      PF.icons.svg(symId, part.px, C(color)) + '</div>';
  }

  function box(g, style) {
    return '<div class="pf-box" style="left:' + g.x + 'px;top:' + g.y + 'px;width:' + g.w + 'px;height:' + g.h + 'px;' + (style || '') + '"></div>';
  }

  /* ------------------------------------------------------------------ */
  /* Arc, drawn the way LVGL draws it: 270 degrees with the gap at the
   * bottom (start 135, end 45, clockwise).                              */
  function arcPath(cx, cy, r, a0, a1) {
    function pt(a) {
      var rad = a * Math.PI / 180;
      return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
    }
    var sweep = (a1 - a0 + 360) % 360;
    var p0 = pt(a0), p1 = pt(a1);
    return 'M' + p0[0].toFixed(2) + ' ' + p0[1].toFixed(2) +
      ' A' + r + ' ' + r + ' 0 ' + (sweep > 180 ? 1 : 0) + ' 1 ' + p1[0].toFixed(2) + ' ' + p1[1].toFixed(2);
  }

  /* Geometry comes from layout.js arcGeom(), which follows LVGL's own model:
   * the radius is the OUTER edge and strokes grow INWARD from it, so the
   * indicator shares that edge with the track rather than straddling its
   * centreline — and the knob reaches `overflow` px OUTSIDE the widget box,
   * which LVGL deliberately does not clip. The svg is therefore grown by that
   * overflow on all four sides and offset back by it. Sized to the box alone,
   * the viewport ate the knob and the fill's outer edge at left, right and
   * top — the bottom survived only because the arc's gap is down there. */
  function arc(g, pct, track, ind) {
    var over = g.overflow || 0;
    var iw = g.indWidth || g.width;
    var R = Math.min(g.w, g.h) / 2;                 /* LVGL: MIN(w,h)/2, width NOT subtracted */
    var W = g.w + over * 2, H = g.h + over * 2;
    var cx = over + g.w / 2, cy = over + g.h / 2;
    var rTrack = R - g.width / 2;                   /* stroke centrelines; outer edge is R */
    var rInd = R - iw / 2;
    var end = 135 + 270 * Math.max(0, Math.min(100, pct)) / 100;
    var html = '<svg class="pf-arc" style="left:' + (g.x - over) + 'px;top:' + (g.y - over) +
      'px;width:' + W + 'px;height:' + H + 'px" viewBox="0 0 ' + W + ' ' + H + '">' +
      '<path d="' + arcPath(cx, cy, rTrack, 135, 45) + '" fill="none" stroke="' + C(track) +
      '" stroke-width="' + g.width + '" stroke-linecap="round"/>';
    if (pct > 0) {
      html += '<path d="' + arcPath(cx, cy, rInd, 135, end % 360) + '" fill="none" stroke="' + C(ind) +
        '" stroke-width="' + iw + '" stroke-linecap="round"/>';
      /* the knob rides the indicator's centreline, half-extent iw/2 + knob_pad */
      var rad = (end % 360) * Math.PI / 180;
      html += '<circle cx="' + (cx + rInd * Math.cos(rad)).toFixed(2) + '" cy="' + (cy + rInd * Math.sin(rad)).toFixed(2) +
        '" r="' + (iw / 2 + (g.knobPad || 0)).toFixed(1) + '" fill="#fff"/>';
    }
    return html + '</svg>';
  }

  /* ------------------------------------------------------------------ */
  function cardHtml(c) {
    var th = PF.store.theme();
    var L = PF.layout.of(c);
    var st = PF.mock.state(c, demo);
    var body = '';
    var flat = (c.type === 'light' || c.type === 'fan');
    var chrome = !(c.type === 'text' && !c.opts.card);

    switch (c.type) {

      /* ---- LIGHT ------------------------------------------------- */
      case 'light': {
        var fill = c.opts.colorTemp
          ? PF.theme.kelvinRgb(st.kelvin, c.opts.kMin, c.opts.kMax)
          : PF.store.colorOf(c, 'accent', 'accent');
        var pct = c.opts.dimmable ? st.pct : (st.on ? 100 : 0);
        var g = L.slider || L.face;
        var vert = L.dir === 'vertical';
        body += '<div class="pf-box" style="left:' + g.x + 'px;top:' + g.y + 'px;width:' + g.w + 'px;height:' + g.h + 'px;background:' + C(th.card) + '"></div>';
        if (pct > 0) {
          /* a vertical bar grows from the BOTTOM, same as LVGL */
          var fw = vert ? g.w : Math.round(g.w * pct / 100);
          var fh = vert ? Math.round(g.h * pct / 100) : g.h;
          /* when the slider carries the card's corners, the INDICATOR is
             rounded too — LVGL draws it as a rounded rect, so the fill has a
             rounded leading edge as well. Show that rather than a hard edge. */
          var fr = PF.layout.roundedFace(c) ? PF.store.cardRadius() : 0;
          body += '<div class="pf-box pf-fill" style="left:' + g.x + 'px;top:' + (vert ? g.y + g.h - fh : g.y) +
            'px;width:' + fw + 'px;height:' + fh + 'px;border-radius:' + fr + 'px;background:' + C(fill) + '"></div>';
        }
        /* the ink rule: a label is on the fill when the fill reaches past it,
           measured along whichever axis the bar actually runs */
        var edge = vert
          ? g.y + g.h - Math.round(g.h * pct / 100)     /* top of the fill */
          : g.x + Math.round(g.w * pct / 100);          /* right of the fill */
        var tintData = ' data-dir="' + (vert ? 'v' : 'h') + '" data-edge="' + edge +
          '" data-on="' + PF.theme.inkFor(fill, th) + '" data-off="' + th.ink + '"';
        body += T(L.name, c.title, th.ink, { cls: 'pf-tint', data: tintData });
        body += T(L.value, (c.opts.dimmable ? st.pct + '%' : (st.on ? 'ON' : 'OFF')), th.ink,
          { cls: 'pf-tint', data: tintData });
        if (L.power) {
          body += box(L.power, 'background:' + C(th.strip));
          var pf = L.powerSym;
          body += SYM({ x: L.power.x, y: L.power.y + (L.power.h - PF.layout.lineH(pf.px)) / 2, w: L.power.w, px: pf.px, align: 'center' },
            'power', st.on ? th.accent : th.inkDim);
        }
        break;
      }

      /* ---- FAN --------------------------------------------------- */
      case 'fan': {
        var acc = PF.store.colorOf(c, 'accent', 'accent2');
        body += T(L.name, c.title, th.inkDim);
        if (L.arc) body += arc(L.arc, st.pct, th.cardBorder, acc);
        if (L.blades) {
          var dur = st.pct <= 0 ? 0 : st.pct < 20 ? 2.6 : st.pct < 45 ? 1.8 : st.pct < 75 ? 1.1 : 0.6;
          body += '<div class="pf-bladewrap" style="left:' + L.blades.x + 'px;top:' + L.blades.y + 'px;width:' +
            L.blades.w + 'px;height:' + L.blades.h + 'px;' +
            (dur ? 'animation-duration:' + dur + 's' : 'animation:none') + '">' + FAN_SVG + '</div>';
        }
        body += T(L.value, st.pct + '%', th.ink);
        if (L.power) {
          body += box(L.power, 'background:' + C(th.accent2Fill));
          var pf2 = L.powerSym;
          body += SYM({ x: L.power.x, y: L.power.y + (L.power.h - PF.layout.lineH(pf2.px)) / 2, w: L.power.w, px: pf2.px, align: 'center' },
            'power', st.on ? acc : th.inkDim);
        }
        break;
      }

      /* ---- TOGGLE / BUTTON --------------------------------------- */
      case 'toggle': {
        var on = PF.store.colorOf(c, 'onColor', 'accent');
        var off = PF.store.colorOf(c, 'offColor', 'strip');
        var bg = st.on ? on : off;
        var ink = st.on ? PF.theme.inkFor(bg, th) : th.ink;
        body += box(L.face, 'background:' + C(bg));
        body += T(L.name, c.title, st.on ? ink : th.inkDim);
        body += SYM(L.symbol, c.opts.symbol, ink);
        body += T(L.value, st.text, ink);
        break;
      }
      case 'button': {
        var bcol = PF.store.colorOf(c, 'color', 'strip');
        var bink = PF.theme.inkFor(bcol, th);
        body += box(L.face, 'background:' + C(bcol));
        body += SYM(L.symbol, c.opts.symbol, bink);
        body += T(L.value, c.title, bink);
        break;
      }

      /* ---- READOUTS ---------------------------------------------- */
      case 'sensor':
        body += T(L.name, c.title, th.inkDim);
        if (L.unit) {
          /* the number and the unit are a flex row on the panel, so draw
           * them where LVGL would put THIS text — not where the sample sat */
          var pair = PF.layout.pairBoxes(L, st.value, L.unit.text);
          body += T(pair.value, st.value, PF.store.colorOf(c, 'color', 'ink'));
          body += T(pair.unit, L.unit.text, PF.store.colorOf(c, 'color', 'ink'));
        } else {
          body += T(L.value, st.value, PF.store.colorOf(c, 'color', 'ink'));
        }
        break;
      case 'text_sensor':
        body += T(L.name, c.title, th.inkDim);
        body += T(L.value, st.value, PF.store.colorOf(c, 'color', 'ink'));
        break;
      case 'clock': {
        var ck = PF.mock.clock();
        body += T(L.name, c.title, th.inkDim);
        body += T(L.value, c.opts.format === '12' ? ck.t12 : ck.t24, PF.store.colorOf(c, 'color', 'ink'));
        if (L.date) body += T(L.date, ck.date, th.inkDim);
        break;
      }
      case 'text':
        body += T(L.body, c.opts.body, PF.store.colorOf(c, 'color', 'inkDim'));
        break;

      /* ---- COVER ------------------------------------------------- */
      case 'cover': {
        var ccol = PF.store.colorOf(c, 'accent', 'strip');
        var cink = PF.theme.inkFor(ccol, th);
        body += T(L.name, c.title, th.inkDim);
        L.buttons.forEach(function (b) {
          body += '<div class="pf-box pf-btn" style="left:' + b.x + 'px;top:' + b.y + 'px;width:' + b.w + 'px;height:' + b.h + 'px;background:' + C(ccol) + '"></div>';
          body += SYM({ x: b.x, y: b.y + (b.h - PF.layout.lineH(L.symbol.px)) / 2, w: b.w, px: L.symbol.px, align: 'center' },
            b.role, cink);
        });
        if (L.position) body += T(L.position, st.pct + '%', th.inkDim);
        break;
      }

      /* ---- GAUGE ------------------------------------------------- */
      case 'gauge': {
        var gcol = PF.store.colorOf(c, 'accent', 'accent');
        var g = L.dial;
        var lo = Number(c.opts.min), hi = Number(c.opts.max);
        var span = (hi > lo) ? hi - lo : 1;
        var frac = Math.max(0, Math.min(1, (st.value - lo) / span));
        /* LVGL's meter sweeps `angle_range` degrees starting at `rotation`.
           270 from 135 is the same geometry as the fan arc, so the two cards
           read as the same family. */
        var A0 = 135, SWEEP = 270;
        var cx = g.w / 2, cy = g.h / 2;
        var r = g.w / 2 - g.width / 2 - (c.opts.ticks ? g.tick + 3 : 0);
        var svg = '<svg class="pf-arc" style="left:' + g.x + 'px;top:' + g.y + 'px;width:' + g.w +
          'px;height:' + g.h + 'px" viewBox="0 0 ' + g.w + ' ' + g.h + '">';
        /* the scale ticks */
        if (c.opts.ticks) {
          for (var ti = 0; ti <= 24; ti++) {
            var ta = (A0 + SWEEP * ti / 24) * Math.PI / 180;
            var major = ti % 6 === 0;
            var r1 = g.w / 2 - 1, r2 = r1 - (major ? g.tick * 1.7 : g.tick);
            svg += '<line x1="' + (cx + r1 * Math.cos(ta)).toFixed(1) + '" y1="' + (cy + r1 * Math.sin(ta)).toFixed(1) +
              '" x2="' + (cx + r2 * Math.cos(ta)).toFixed(1) + '" y2="' + (cy + r2 * Math.sin(ta)).toFixed(1) +
              '" stroke="' + C(major ? th.inkDim : th.cardBorder) + '" stroke-width="' + (major ? 3 : 2) + '"/>';
          }
        }
        /* the good zone, drawn under the indicator */
        if (c.opts.band) {
          var bf = Math.max(0, Math.min(1, (Number(c.opts.bandFrom) - lo) / span));
          var bt = Math.max(0, Math.min(1, (Number(c.opts.bandTo) - lo) / span));
          if (bt > bf) {
            svg += '<path d="' + arcPath(cx, cy, r, A0 + SWEEP * bf, (A0 + SWEEP * bt) % 360) +
              '" fill="none" stroke="' + C(PF.store.colorOf(c, 'bandColor', 'accent2')) +
              '" stroke-width="' + g.width + '" stroke-linecap="butt"/>';
          }
        } else {
          svg += '<path d="' + arcPath(cx, cy, r, A0, (A0 + SWEEP) % 360) + '" fill="none" stroke="' +
            C(th.cardBorder) + '" stroke-width="' + Math.round(g.width * 0.5) + '" stroke-linecap="round"/>';
        }
        /* the indicator */
        if (c.opts.style === 'needle') {
          var na = (A0 + SWEEP * frac) * Math.PI / 180;
          svg += '<line x1="' + cx + '" y1="' + cy + '" x2="' + (cx + r * 0.86 * Math.cos(na)).toFixed(1) +
            '" y2="' + (cy + r * 0.86 * Math.sin(na)).toFixed(1) + '" stroke="' + C(gcol) +
            '" stroke-width="' + Math.max(3, Math.round(g.width * 0.55)) + '" stroke-linecap="round"/>' +
            '<circle cx="' + cx + '" cy="' + cy + '" r="' + Math.max(4, g.width * 0.6).toFixed(1) + '" fill="' + C(gcol) + '"/>';
        } else if (frac > 0) {
          svg += '<path d="' + arcPath(cx, cy, r, A0, (A0 + SWEEP * frac) % 360) + '" fill="none" stroke="' +
            C(gcol) + '" stroke-width="' + g.width + '" stroke-linecap="round"/>';
        }
        body += svg + '</svg>';
        body += T(L.name, c.title, th.inkDim);
        body += T(L.value, st.value + (c.opts.unit || ''), PF.store.colorOf(c, 'accent', 'ink'));
        break;
      }

      /* ---- MEDIA ------------------------------------------------- */
      case 'media': {
        var mcol2 = PF.store.colorOf(c, 'accent', 'strip');
        var mink2 = PF.theme.inkFor(mcol2, th);
        body += T(L.name, c.title, th.inkDim);
        body += T(L.value, st.track, th.ink);
        if (L.artist) body += T(L.artist, st.artist, th.inkDim);
        L.buttons.forEach(function (b) {
          body += '<div class="pf-box pf-btn" style="left:' + b.x + 'px;top:' + b.y + 'px;width:' + b.w + 'px;height:' + b.h + 'px;background:' + C(mcol2) + '"></div>';
          /* the middle key shows what pressing it will DO, so a playing
             player shows pause — same as every transport ever made */
          var glyph = b.role === 'playpause' ? (st.playing ? 'pause' : 'play') : b.role;
          body += SYM({ x: b.x, y: b.y + (b.h - PF.layout.lineH(L.symbol.px)) / 2, w: b.w, px: L.symbol.px, align: 'center' },
            glyph, mink2);
        });
        if (L.volume) {
          var v = L.volume;
          body += '<div class="pf-box" style="left:' + v.x + 'px;top:' + (v.y + v.h / 2 - 5) + 'px;width:' + v.w + 'px;height:10px;border-radius:5px;background:' + C(th.cardBorder) + '"></div>';
          body += '<div class="pf-box" style="left:' + v.x + 'px;top:' + (v.y + v.h / 2 - 5) + 'px;width:' + Math.round(v.w * st.vol / 100) + 'px;height:10px;border-radius:5px;background:' + C(th.accent) + '"></div>';
          body += '<div class="pf-box" style="left:' + (v.x + Math.round(v.w * st.vol / 100) - v.h / 2) + 'px;top:' + v.y + 'px;width:' + v.h + 'px;height:' + v.h + 'px;border-radius:50%;background:#fff"></div>';
        }
        break;
      }

      /* ---- CLIMATE ----------------------------------------------- */
      case 'climate': {
        var mcol = PF.store.colorOf(c, 'accent', 'accent');
        body += T(L.name, c.title, th.inkDim);
        [['minus', L.minus], ['plus', L.plus]].forEach(function (p) {
          body += '<div class="pf-box pf-btn" style="left:' + p[1].x + 'px;top:' + p[1].y + 'px;width:' + p[1].w + 'px;height:' + p[1].h + 'px;background:' + C(th.strip) + '"></div>';
          body += SYM({ x: p[1].x, y: p[1].y + (p[1].h - PF.layout.lineH(L.symbol.px)) / 2, w: p[1].w, px: L.symbol.px, align: 'center' },
            p[0], mcol);
        });
        body += T(L.setpoint, st.setpoint + '°', mcol);
        body += T(L.current, 'NOW ' + st.current + '°', th.inkDim);
        if (L.mode) body += T(L.mode, st.mode, th.inkDim);
        break;
      }
    }

    var sel = PF.store.get().selected === c.id;
    var style = 'left:' + c.x + 'px;top:' + c.y + 'px;width:' + c.w + 'px;height:' + c.h + 'px;';
    if (chrome) {
      style += 'background:' + C(th.card) + ';border:2px solid ' + C(th.cardBorder) + ';border-radius:' + PF.store.cardRadius() + 'px;';
      if (flat) style += 'padding:0;';
    } else {
      /* a hint of where the box is, in the editor only — mid grey so it shows
         on a light theme as well as a dark one. Nothing is emitted for it. */
      style += 'background:transparent;border:1px dashed rgba(128,128,128,.45);';
    }

    return '<div class="pf-card' + (sel ? ' is-sel' : '') + '" data-id="' + c.id + '" style="' + style + '">' +
      body +
      (sel ? handlesHtml() : '') +
      '</div>';
  }

  var HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  function handlesHtml() {
    return HANDLES.map(function (h) {
      return '<div class="pf-h pf-h-' + h + '" data-h="' + h + '"></div>';
    }).join('');
  }

  /* ------------------------------------------------------------------
   * DETAIL PAGE PREVIEW.
   *
   * The page behind a hold used to be invisible here — laid out with magic
   * numbers inside the generator and drawn nowhere — so the only way to see
   * it was to flash a panel. Predictably it stayed ugly. Geometry now comes
   * from layout.js like everything else, and this draws it.
   *
   * Not editable: you cannot drag things on it. The layout is derived from
   * what the light can DO, which is the whole point — a bulb with no colour
   * temperature gets a different page rather than a hole.
   * ------------------------------------------------------------------ */
  function detailHtml(c) {
    var th = PF.store.theme();
    var P = PF.store.panelSize();
    var d = PF.layout.detail(c, P);
    if (!d) return '';
    var st = PF.mock.state(c, demo);
    var r = PF.store.cardRadius();
    var accent = c.opts.colorTemp
      ? PF.theme.kelvinRgb(st.kelvin, c.opts.kMin, c.opts.kMax)
      : PF.store.colorOf(c, 'accent', 'accent');
    var h = '';

    /* ---- header: back, title, power ---- */
    h += '<div class="pf-box pf-btn" style="left:' + d.back.x + 'px;top:' + d.back.y + 'px;width:' + d.back.w +
      'px;height:' + d.back.h + 'px;border-radius:' + Math.min(r, d.back.h / 2) + 'px;background:' + C(th.strip) + '"></div>';
    h += '<div class="pf-symwrap" style="position:absolute;left:' + (d.back.x + 18) + 'px;top:' + (d.back.y + (d.back.h - 34) / 2) +
      'px;width:34px;height:34px">' + PF.icons.svg('left', 34, C(th.ink)) + '</div>';
    h += '<div class="pf-t" style="left:' + (d.back.x + 62) + 'px;top:' + (d.back.y + (d.back.h - 30) / 2) +
      'px;white-space:pre;font-size:24px;line-height:30px;font-weight:700;color:' + C(th.ink) + '">BACK</div>';

    h += '<div class="pf-t" style="left:' + d.title.x + 'px;top:' + (d.title.y + 18) + 'px;width:' + d.title.w +
      'px;font-size:38px;line-height:48px;font-weight:700;color:' + C(th.ink) + '">' + esc(c.title || c.entity) + '</div>';

    h += '<div class="pf-box pf-btn" style="left:' + d.toggle.x + 'px;top:' + d.toggle.y + 'px;width:' + d.toggle.w +
      'px;height:' + d.toggle.h + 'px;border-radius:' + Math.min(r, d.toggle.h / 2) + 'px;background:' +
      C(st.on ? accent : th.strip) + '"></div>';
    h += '<div class="pf-symwrap" style="position:absolute;left:' + d.toggle.x + 'px;top:' + (d.toggle.y + (d.toggle.h - 40) / 2) +
      'px;width:' + d.toggle.w + 'px;height:40px">' +
      PF.icons.svg('power', 40, C(st.on ? PF.theme.inkFor(accent, th) : th.inkDim)) + '</div>';

    /* ---- blocks ---- */
    d.blocks.forEach(function (b) {
      h += '<div class="pf-box" style="left:' + b.x + 'px;top:' + b.y + 'px;width:' + b.w + 'px;height:' + b.h +
        'px;border-radius:' + r + 'px;background:' + C(th.card) + ';border:2px solid ' + C(th.cardBorder) + '"></div>';

      if (b.kind === 'bri' || b.kind === 'ct') {
        var isBri = b.kind === 'bri';
        h += '<div class="pf-t" style="left:' + b.kicker.x + 'px;top:' + b.kicker.y + 'px;white-space:pre;' +
          'font-size:17px;line-height:22px;font-weight:600;letter-spacing:1px;color:' + C(th.inkDim) + '">' +
          (isBri ? 'BRIGHTNESS' : 'COLOUR TEMPERATURE') + '</div>';
        h += '<div class="pf-t" style="left:' + b.readout.x + 'px;top:' + b.readout.y + 'px;width:' + b.readout.w +
          'px;text-align:right;font-size:46px;line-height:56px;font-weight:900;color:' + C(accent) + '">' +
          (isBri ? st.pct + '%' : st.kelvin + 'K') + '</div>';
        var frac = isBri ? st.pct / 100
          : (st.kelvin - c.opts.kMin) / Math.max(1, c.opts.kMax - c.opts.kMin);
        var cr = Math.min(b.control.h / 2, r);
        h += '<div class="pf-box" style="left:' + b.control.x + 'px;top:' + b.control.y + 'px;width:' + b.control.w +
          'px;height:' + b.control.h + 'px;border-radius:' + cr + 'px;background:' + C(th.strip) + '"></div>';
        h += '<div class="pf-box" style="left:' + b.control.x + 'px;top:' + b.control.y + 'px;width:' +
          Math.round(b.control.w * Math.max(0, Math.min(1, frac))) + 'px;height:' + b.control.h +
          'px;border-radius:' + cr + 'px;background:' + C(accent) + '"></div>';
      } else {
        /* preset rows: flat swatches, no gradients — RGB565 bands them */
        var labels = b.kind === 'ctpresets' ? ['WARMEST', 'WARM', 'NEUTRAL', 'COOL', 'COOLEST'] : ['25%', '50%', '75%', '100%'];
        for (var i = 0; i < b.count; i++) {
          var bx = b.x + b.pad + i * (b.btnW + b.gap);
          var fillC = b.kind === 'ctpresets'
            ? PF.theme.kelvinRgb(Math.round(c.opts.kMin + (c.opts.kMax - c.opts.kMin) * (i / (b.count - 1))), c.opts.kMin, c.opts.kMax)
            : th.strip;
          h += '<div class="pf-box pf-btn" style="left:' + bx + 'px;top:' + b.btnY + 'px;width:' + b.btnW +
            'px;height:' + b.btnH + 'px;border-radius:' + Math.min(r, b.btnH / 2) + 'px;background:' + C(fillC) + '"></div>';
          h += '<div class="pf-t" style="left:' + bx + 'px;top:' + (b.btnY + (b.btnH - 24) / 2) + 'px;width:' + b.btnW +
            'px;text-align:center;font-size:19px;line-height:24px;font-weight:700;color:' +
            C(b.kind === 'ctpresets' ? PF.theme.inkFor(fillC, th) : th.ink) + '">' + labels[i] + '</div>';
        }
      }
    });
    return h;
  }

  /* ------------------------------------------------------------------ */
  function render() {
    if (!stage) return;
    var p = PF.store.get();
    var P = PF.store.panelSize();
    stage.style.width = P.w + 'px';
    stage.style.height = P.h + 'px';
    stage.style.background = C(PF.store.theme().bg);

    /* a detail page takes over the whole stage when one is being viewed */
    var vp = p.viewPage && PF.store.byId(p.viewPage);
    if (vp) {
      stage.innerHTML = detailHtml(vp);
      fit();
      return;
    }

    stage.innerHTML = p.cards.map(cardHtml).join('') +
      guides.map(function (g) {
        return g.v
          ? '<div class="pf-guide pf-guide-v" style="left:' + g.at + 'px"></div>'
          : '<div class="pf-guide pf-guide-h" style="top:' + g.at + 'px"></div>';
      }).join('');
    fit();
    tintPass();
  }

  /* Second pass: the light-tile ink rule. tile_ink() in tab5_ui.h decides a
   * label's colour by whether the fill actually reaches it, so measure the
   * rendered label and do the same, instead of guessing from a brightness
   * threshold — which is what left black text stranded on a dimmed tile. */
  function tintPass() {
    var nodes = stage.querySelectorAll('.pf-tint');
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      var edge = parseFloat(n.getAttribute('data-edge'));
      var covered = n.getAttribute('data-dir') === 'v'
        ? edge <= parseFloat(n.style.top)                       /* fill rises past the label's top */
        : edge >= parseFloat(n.style.left) + n.offsetWidth;     /* fill runs past its right edge */
      n.style.color = C(parseInt(n.getAttribute(covered ? 'data-on' : 'data-off'), 10));
    }
  }

  function fit() {
    if (!wrap || !stage) return;
    var P = PF.store.panelSize();
    var availW = wrap.clientWidth - 32;
    var availH = wrap.clientHeight - 32;
    scale = Math.min(availW / P.w, availH / P.h);
    scale = Math.max(0.12, Math.min(scale, 1));
    stage.style.transform = 'scale(' + scale + ')';
    var holder = stage.parentNode;
    holder.style.width = (P.w * scale) + 'px';
    holder.style.height = (P.h * scale) + 'px';
  }

  /* ------------------------------------------------------------------ */
  function toPanel(e) {
    var r = stage.getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  }

  var SNAP = 7;
  function snapTargets(exceptId) {
    var P = PF.store.panelSize(), M = PF.store.MARGIN;
    var vx = [M, P.w - M, P.w / 2], hy = [M, P.h - M, P.h / 2];
    PF.store.get().cards.forEach(function (c) {
      if (c.id === exceptId) return;
      vx.push(c.x, c.x + c.w, c.x + c.w / 2, c.x - PF.store.GUTTER, c.x + c.w + PF.store.GUTTER);
      hy.push(c.y, c.y + c.h, c.y + c.h / 2, c.y - PF.store.GUTTER, c.y + c.h + PF.store.GUTTER);
    });
    return { vx: vx, hy: hy };
  }

  function snap1(value, list) {
    var best = null, bd = SNAP;
    list.forEach(function (t) {
      var d = Math.abs(value - t);
      if (d < bd) { bd = d; best = t; }
    });
    return best;
  }

  function snapMove(card, x, y) {
    var t = snapTargets(card.id);
    guides = [];
    var edgesX = [[x, 0], [x + card.w / 2, card.w / 2], [x + card.w, card.w]];
    var pick = null;
    edgesX.forEach(function (e) {
      var s = snap1(e[0], t.vx);
      if (s !== null && (pick === null || Math.abs(e[0] - s) < pick.d)) pick = { d: Math.abs(e[0] - s), x: s - e[1], at: s };
    });
    if (pick) { x = pick.x; guides.push({ v: true, at: pick.at }); }

    var edgesY = [[y, 0], [y + card.h / 2, card.h / 2], [y + card.h, card.h]];
    var picky = null;
    edgesY.forEach(function (e) {
      var s = snap1(e[0], t.hy);
      if (s !== null && (picky === null || Math.abs(e[0] - s) < picky.d)) picky = { d: Math.abs(e[0] - s), y: s - e[1], at: s };
    });
    if (picky) { y = picky.y; guides.push({ v: false, at: picky.at }); }
    return { x: Math.round(x), y: Math.round(y) };
  }

  function onDown(e) {
    /* Touching the stage means you are done with the inspector, so say so.
     * preventDefault() below stops the browser moving focus by itself, which
     * left document.activeElement pointing at whatever inspector field was
     * last used — and two things read that: the inspector skips re-rendering
     * a tab that has focus, and onKey ignores arrows while an input is
     * focused. So after clicking one checkbox, picking another card kept the
     * old card's fields on screen AND the arrow keys stopped nudging. */
    var act = document.activeElement;
    if (act && act.blur && act.closest && act.closest('.tabbody')) act.blur();

    var handle = e.target.closest ? e.target.closest('.pf-h') : null;
    var cardEl = e.target.closest ? e.target.closest('.pf-card') : null;
    if (!cardEl) { PF.store.select(null); return; }
    var id = cardEl.getAttribute('data-id');
    if (PF.store.get().selected !== id) PF.store.select(id);
    var c = PF.store.byId(id);
    if (!c) return;
    e.preventDefault();
    stage.setPointerCapture(e.pointerId);
    PF.store.beginGesture();
    gesture = {
      id: id, mode: handle ? handle.getAttribute('data-h') : 'move',
      start: toPanel(e), box: { x: c.x, y: c.y, w: c.w, h: c.h }
    };
  }

  function onMove(e) {
    if (!gesture) return;
    var c = PF.store.byId(gesture.id);
    if (!c) return;
    var now = toPanel(e);
    var dx = now.x - gesture.start.x, dy = now.y - gesture.start.y;
    var b = gesture.box;
    var t = PF.catalog.types[c.type];

    if (gesture.mode === 'move') {
      var s = snapMove(c, b.x + dx, b.y + dy);
      PF.store.gestureUpdate(gesture.id, { x: s.x, y: s.y });
    } else {
      var nx = b.x, ny = b.y, nw = b.w, nh = b.h;
      var m = gesture.mode;
      if (m.indexOf('e') >= 0) nw = b.w + dx;
      if (m.indexOf('s') >= 0) nh = b.h + dy;
      if (m.indexOf('w') >= 0) { nx = b.x + dx; nw = b.w - dx; }
      if (m.indexOf('n') >= 0) { ny = b.y + dy; nh = b.h - dy; }
      /* snap the moving edges */
      var tt = snapTargets(c.id);
      guides = [];
      if (m.indexOf('e') >= 0) { var se = snap1(nx + nw, tt.vx); if (se !== null) { nw = se - nx; guides.push({ v: true, at: se }); } }
      if (m.indexOf('w') >= 0) { var sw = snap1(nx, tt.vx); if (sw !== null) { nw += nx - sw; nx = sw; guides.push({ v: true, at: sw }); } }
      if (m.indexOf('s') >= 0) { var ss = snap1(ny + nh, tt.hy); if (ss !== null) { nh = ss - ny; guides.push({ v: false, at: ss }); } }
      if (m.indexOf('n') >= 0) { var sn = snap1(ny, tt.hy); if (sn !== null) { nh += ny - sn; ny = sn; guides.push({ v: false, at: sn }); } }
      if (nw < t.min.w) { if (m.indexOf('w') >= 0) nx -= (t.min.w - nw); nw = t.min.w; }
      if (nh < t.min.h) { if (m.indexOf('n') >= 0) ny -= (t.min.h - nh); nh = t.min.h; }
      PF.store.gestureUpdate(gesture.id, { x: Math.round(nx), y: Math.round(ny), w: Math.round(nw), h: Math.round(nh) });
    }
  }

  function onUp(e) {
    if (!gesture) return;
    try { stage.releasePointerCapture(e.pointerId); } catch (_) { }
    gesture = null;
    guides = [];
    PF.store.endGesture();
  }

  function onKey(e) {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return;
    var c = PF.store.selected();
    var mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? PF.store.redo() : PF.store.undo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); PF.store.redo(); return; }
    if (!c) return;
    if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); PF.store.duplicateCard(c.id); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); PF.store.removeCard(c.id); return; }
    var step = e.shiftKey ? 10 : 2;
    var d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (d) {
      e.preventDefault();
      if (e.altKey) PF.store.updateCard(c.id, { w: c.w + d[0], h: c.h + d[1] });
      else PF.store.updateCard(c.id, { x: c.x + d[0], y: c.y + d[1] });
    }
  }

  function mount(wrapEl) {
    wrap = wrapEl;
    var holder = document.createElement('div');
    holder.className = 'pf-holder';
    stage = document.createElement('div');
    stage.className = 'pf-stage';
    holder.appendChild(stage);
    wrap.appendChild(holder);

    stage.addEventListener('pointerdown', onDown);
    stage.addEventListener('pointermove', onMove);
    stage.addEventListener('pointerup', onUp);
    stage.addEventListener('pointercancel', onUp);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', function () { fit(); });
    PF.store.on(function () { render(); });
    render();
  }

  function setDemo(mode) { demo = mode; render(); }
  function getDemo() { return demo; }
  function getScale() { return scale; }

  PF.canvas = { mount: mount, render: render, setDemo: setDemo, getDemo: getDemo, scale: getScale, fit: fit };
})(window.PF = window.PF || {});
