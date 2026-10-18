/* =====================================================================
 * layout.js — where every sub-widget sits inside a card.
 *
 * THE ONE RULE: the preview and the YAML generator both read their
 * coordinates from here. Nothing computes geometry twice. If they did, the
 * preview would drift from the panel and the whole tool would be a lie.
 *
 * All coordinates are card-relative panel pixels, which is exactly what
 * LVGL wants for a child of a container object.
 *
 * A text part looks like { x, y, w, px, font, align } where `font` is a
 * font id the generator resolves (f_lg, montserrat_24, ...) and `px` is the
 * pixel size the preview draws at. They always agree because both come
 * from PF.fonts.
 * ===================================================================== */
(function (PF) {
  'use strict';

  var PAD = 22;          // card inner padding, same as the reference panel
  var FAN_SPRITE = 160;  // the blade sprite is a fixed 160x160 flipbook

  /* LVGL lays a label out from its top-left corner; this is the height that
   * box works out to. Roboto and Montserrat both sit near 1.22x the size. */
  function lineH(px) { return Math.round(px * 1.22); }

  /* Resolve a text size to real pixels.
   *
   *   'fit'     scale to the box — what makes one big clock card fill itself
   *             instead of sitting at 72 px in the middle of 700
   *   'custom'  whatever the card says, in px
   *   sm/md/lg/xl   the named ladder, so a row of cards can be made to agree
   *   'auto'    the old behaviour: pick a rung by how much room there is
   *
   * `kind` is 'num' for readouts (digits only, cheap at any size) and 'ui'
   * for anything a user types. `cap` limits the named rungs only.
   */
  function text(sizeId, boxW, boxH, cap, opt) {
    opt = opt || {};
    var kind = opt.kind || 'ui';
    var px;

    if (sizeId === 'fit') {
      px = PF.fonts.fitPx(boxW, boxH, opt.sample || '00', opt.emExtra);
    } else if (sizeId === 'custom') {
      px = PF.fonts.clamp(opt.custom || 40);
    } else {
      var id = sizeId;
      var isAuto = (id === 'auto' || !id);
      if (isAuto) {
        id = (boxH >= 200 && boxW >= 220) ? 'xl'
           : (boxH >= 130 && boxW >= 150) ? 'lg'
           : (boxH >= 70) ? 'md' : 'sm';
      }
      var ORDER = ['sm', 'md', 'lg', 'xl'];
      if (cap && ORDER.indexOf(id) > ORDER.indexOf(cap)) id = cap;

      if (isAuto) {
        /* 'auto' walks DOWN the frozen ladder until a rung fits, which is
         * what it has always done — and it reads the frozen values so that
         * raising `xl` cannot move any panel left on Default. */
        while (ORDER.indexOf(id) > 0 && lineH(PF.fonts.autoPx(id)) > boxH) {
          id = ORDER[ORDER.indexOf(id) - 1];
        }
        px = PF.fonts.autoPx(id);
      } else {
        /* An EXPLICIT choice does not step down the ladder. Stepping meant a
         * cliff: ask for Huge on a card that could take 100 px and the rung
         * search dropped you to Large's 52. Take the asked-for size and let
         * the clamp below walk it to the box in 4 px steps instead — you get
         * the biggest size that actually fits, not the biggest named one. */
        px = PF.fonts.px(id);
      }
    }

    /* Never bigger than the box, whatever was asked for — including an exact
     * size, which should be a preference rather than a way to overflow a card.
     * Width matters as much as height: "CUSTOM" at 80 px needs 288 px and a
     * 326 px card only has 282 after padding. */
    /* emExtra reserves room for something drawn NEXT to this text at a
     * different size — a unit beside a readout — expressed in ems of THIS
     * text, so the pair is sized as one block without being one label. */
    var emW = opt.sample ? PF.fonts.emWidth(opt.sample) + (opt.emExtra || 0) : 0;
    px = PF.fonts.real(px);
    while (px > 12 && (lineH(px) > boxH || (emW && px * emW > boxW))) px -= 4;
    px = PF.fonts.real(px);
    return { px: px, kind: kind, font: PF.fonts.idFor(px, kind) };
  }

  /* A fixed-size label — always montserrat_NN so symbols are safe. */
  function fixed(px) {
    var f = PF.fonts.fixedFont(px);
    return { px: f.px, font: f.id };
  }

  /* ------------------------------------------------------------------
   * Every piece of text in a card goes through here, so all of them are
   * sizeable and not just the headline value.
   *
   *   c        the card
   *   key      slot name — 'title', 'value', 'symbol', 'date', ...
   *   builtin  what this slot has always been: a px number for a fixed
   *            label, or a size id ('auto'/'lg') for one that scales
   *   boxW/H   the space it has
   *   opt      { kind, sample } — kind picks the glyph set
   *
   * 'default' keeps the built-in behaviour, so an existing panel is
   * pixel-identical until someone actually changes a size.
   * ------------------------------------------------------------------ */
  function slot(c, key, builtin, boxW, boxH, opt) {
    opt = opt || {};
    var mode = (c.opts && c.opts['sz_' + key]) || 'default';
    var kind = opt.kind || 'ui';

    /* Callers are inconsistent about which name they read — labels want
     * `.font`, the symbol emitters want `.id` — so hand back both. */
    function norm(r) { return { px: r.px, font: r.font || r.id, id: r.font || r.id, kind: r.kind || kind }; }

    if (kind === 'sym') {
      var want = mode === 'default' ? builtin
               : mode === 'custom'  ? (c.opts['szpx_' + key] || 40)
               : mode === 'fit'     ? Math.round(Math.min(boxW, boxH) * 0.5)
               : PF.fonts.px(mode);
      want = Math.min(want, Math.min(boxW, boxH) * 0.9);
      /* An MDI symbol is an IMAGE, not a glyph: it has no font and its box is
       * square rather than a line height, so hand back `h` and let the callers
       * stack on that. Snapped to the size ladder because each distinct size
       * is its own compiled asset. */
      if (opt.mdi) {
        var ipx = PF.catalog.mdiPx(want);
        return { px: ipx, h: ipx, mdi: opt.mdi, kind: 'sym', font: null, id: null };
      }
      /* glyph symbols only exist in montserrat, whatever was asked for */
      var f = norm(PF.fonts.symbolFont(want));
      f.h = lineH(f.px);
      return f;
    }
    if (mode === 'default') {
      if (typeof builtin === 'number') return norm(fixed(builtin));     /* a fixed label */
      return norm(text(builtin, boxW, boxH, opt.cap, opt));             /* one that scales */
    }
    return norm(text(mode, boxW, boxH, null,
      Object.assign({}, opt, { kind: kind, custom: c.opts['szpx_' + key] })));
  }

  /* ------------------------------------------------------------------
   * Does this card actually need clip_corner?
   *
   * clip_corner is expensive — LVGL renders every child into an off-screen
   * ARGB8888 layer per corner strip, masks it and blits it (lv_refr.c:186).
   * But it is ONLY needed when a child would draw over the card's rounded
   * corner. Two ways to avoid it, and rounding beats clipping every time:
   *
   *   * children that sit inside the padding (labels, inset buttons) never
   *     reach a corner — a sensor or a clock never needed it at all;
   *   * a single full-bleed child can carry the card's OWN radius instead,
   *     so its corners line up and nothing pokes out. lv_bar.c:590 takes the
   *     cheap path whenever `indic_radius >= bg_radius`, so a rounded
   *     indicator costs nothing either.
   *
   * What is left is cards with a full-bleed child AND a toggle strip: two
   * children meeting at a seam, where rounding both would show notches of
   * card behind them. Those still clip.
   * ------------------------------------------------------------------ */
  function roundedFace(c) {
    if (PF.store.cardRadius() === 0) return false;
    var strip = c.opts && c.opts.power && c.opts.power !== 'none';
    if (c.type === 'toggle' || c.type === 'button') return true;   /* one full-bleed button */
    if (c.type === 'light' && !strip) return true;                 /* one full-bleed slider */
    return false;
  }

  function needsClip(c) {
    if (PF.store.cardRadius() === 0) return false;   /* nothing to clip */
    if (roundedFace(c)) return false;                /* the child is rounded instead */
    var strip = c.opts && c.opts.power && c.opts.power !== 'none';
    if (c.type === 'light' || c.type === 'toggle' || c.type === 'button') return true;
    if (c.type === 'fan') return strip;              /* the arc never reaches a corner */
    return false;                                    /* readouts, cover, climate: all inset */
  }

  /* Split a card into "body" and "toggle strip".
   *
   * The strip never takes more than 55 % of the card. A 152 px strip is right
   * on a 420 px card and absurd on a 210 px one — it left the fan's title and
   * its percentage sharing 58 px and drawing on top of each other. Clamping
   * here rather than in the inspector means the preview and the generated
   * YAML agree about it. */
  function split(c) {
    var pos = c.opts.power || 'none';
    var want = c.opts.powerSize || 152;
    var vertical = pos === 'left' || pos === 'right';
    var span = vertical ? c.w : c.h;
    var strip = pos === 'none' ? 0
      : Math.max(0, Math.min(want, Math.round(span * 0.55), span - 40));
    if (!strip) return { body: { x: 0, y: 0, w: c.w, h: c.h }, strip: null };

    if (pos === 'right')  return { body: { x: 0, y: 0, w: c.w - strip, h: c.h },
                                   strip: { x: c.w - strip, y: 0, w: strip, h: c.h } };
    if (pos === 'left')   return { body: { x: strip, y: 0, w: c.w - strip, h: c.h },
                                   strip: { x: 0, y: 0, w: strip, h: c.h } };
    if (pos === 'bottom') return { body: { x: 0, y: 0, w: c.w, h: c.h - strip },
                                   strip: { x: 0, y: c.h - strip, w: c.w, h: strip } };
    return { body: { x: 0, y: strip, w: c.w, h: c.h - strip },
             strip: { x: 0, y: 0, w: c.w, h: strip } };            /* top */
  }

  /* Which way a light tile's fill actually runs. `auto` is LVGL's own rule:
   * horizontal when width >= height. Anything else is forced at boot with
   * lv_slider_set_orientation(), since ESPHome has no YAML key for it. */
  function fillDir(c, body) {
    var f = c.opts.fill || 'auto';
    if (f === 'horizontal') return 'horizontal';
    if (f === 'vertical') return 'vertical';
    return body.w >= body.h ? 'horizontal' : 'vertical';
  }

  /* ------------------------------------------------------------------ */
  var L = {};

  /* ---- LIGHT: the slider IS the card face -------------------------- */
  L.light = function (c) {
    var s = split(c);
    var b = s.body;
    var nf = slot(c, 'title', b.w >= 300 ? 20 : 18, b.w - PAD * 2, Math.max(30, b.h * 0.45), { sample: c.title });
    var out = {
      flat: true,
      slider: c.opts.dimmable ? { x: b.x, y: b.y, w: b.w, h: b.h } : null,
      face:   c.opts.dimmable ? null : { x: b.x, y: b.y, w: b.w, h: b.h },
      name:   { x: b.x + PAD, y: b.y + PAD, w: b.w - PAD * 2, px: nf.px, font: nf.font, align: 'left' },
      power:  s.strip
    };
    /* Bottom-left, and DELIBERATELY not centred. These two labels are the
     * ones tile_ink() re-inks by comparing the fill against the label's own
     * edge — which only works while the label auto-sizes to its text. Give it
     * an explicit width to centre it and the label is always as wide as the
     * card, so it never flips colour until 100 %. */
    var t = slot(c, 'value', 'auto', b.w - PAD * 2, Math.max(40, b.h - PAD * 2 - nf.px),
      { kind: 'num', sample: '100%', cap: 'lg' });
    out.value = {
      x: b.x + PAD,
      y: b.y + b.h - PAD - lineH(t.px),
      autoW: true, w: b.w - PAD * 2,
      px: t.px, font: t.font, align: 'left'
    };
    if (out.value.y < b.y + PAD + lineH(nf.px)) out.value.y = b.y + PAD + lineH(nf.px) + 2;
    out.name.autoW = true;
    out.dir = fillDir(c, b);
    /* the toggle strip's glyph — computed HERE so the preview and the
     * generator cannot disagree about it, and so it is sizeable */
    if (s.strip) out.powerSym = slot(c, 'symbol',
      Math.min(48, Math.round(Math.min(s.strip.w, s.strip.h) * 0.34)),
      s.strip.w, s.strip.h, { kind: 'sym' });
    return out;
  };

  /* ---- TOGGLE / ACTION BUTTON: one big target ---------------------- */
  function bigButton(c, opts) {
    var hasTitle = !!c.title && opts.titleInside;
    var nf = slot(c, 'title', 18, c.w - PAD * 2, Math.max(30, c.h * 0.45), { sample: c.title });
    var symPx = Math.max(16, Math.min(48, Math.round(Math.min(c.w, c.h) * 0.30)));
    var mdi = PF.catalog.mdiName(opts.symbol);
    var sf = slot(c, 'symbol', symPx, c.w, c.h, { kind: 'sym', mdi: mdi });
    var out = {
      face: { x: 0, y: 0, w: c.w, h: c.h },
      name: hasTitle ? { x: PAD, y: PAD - 6, w: c.w - PAD * 2, px: nf.px, font: nf.font, align: 'left' } : null,
      symbol: (opts.symbol && opts.symbol !== 'none')
        ? { x: 0, y: 0, w: c.w, px: sf.px, h: sf.h, mdi: sf.mdi || null, font: sf.id, align: 'center' } : null,
      value: null
    };
    if (opts.showValue) {
      var room = c.h - (hasTitle ? 34 : 0) - (out.symbol ? out.symbol.h + 10 : 0) - 12;
      var t = slot(c, 'value', 'auto', c.w - PAD, Math.max(24, room),
        { kind: opts.valueKind || 'ui', sample: opts.sample, cap: opts.valueCap || 'lg' });
      out.value = { x: 0, y: 0, w: c.w, px: t.px, font: t.font, align: 'center' };
    }
    /* stack whatever is switched on, vertically centred. An image block is
     * square and a label block is a line height, so each carries its own `h`
     * rather than the stack assuming one of them. */
    var blocks = [];
    if (out.symbol) blocks.push(out.symbol);
    if (out.value)  blocks.push(out.value);
    var boxH = function (x) { return x.h || lineH(x.px); };
    var gap = blocks.length > 1 ? 8 : 0;
    var total = function () {
      return blocks.reduce(function (a, x) { return a + boxH(x); }, 0) + gap * (blocks.length - 1);
    };
    var floor = hasTitle ? 34 : 4;

    /* MAKE THE STACK FIT before placing it.
     *
     * A title, a symbol and a value on a card at the 88 px finger minimum
     * want more height than the card has, and the old code only clamped the
     * starting offset — so the bottom block simply ran off the card by up to
     * 10 px. It did that at EVERY size, including the defaults, which is why
     * it went unnoticed: nothing about it looked like a size problem.
     *
     * Shrink the value first (the symbol is the thing you recognise at a
     * glance; the word under it is the thing you can lose). */
    var room = c.h - floor - 4;
    while (out.value && out.value.px > 12 && total() > room) {
      out.value.px -= 4;
      out.value.font = PF.fonts.idFor(out.value.px, out.value.kind || 'ui');
    }
    /* still too tall: the symbol has to give as well */
    while (out.symbol && out.symbol.px > 14 && total() > room) {
      out.symbol.px -= 2;
      if (out.symbol.h) out.symbol.h = out.symbol.px;
      if (!out.symbol.mdi) {
        var sf2 = PF.fonts.symbolFont(out.symbol.px);
        out.symbol.px = sf2.px; out.symbol.font = sf2.id;
        if (out.symbol.h) out.symbol.h = lineH(sf2.px);
      }
    }

    var top = Math.round((c.h - total()) / 2) + (hasTitle ? 10 : 0);
    if (top < floor) top = floor;
    blocks.forEach(function (x) { x.y = top; top += boxH(x) + gap; });
    return out;
  }

  L.toggle = function (c) {
    return bigButton(c, {
      titleInside: true, symbol: c.opts.symbol,
      showValue: !!c.opts.showState, valueCap: 'lg',
      sample: c.opts.onText || 'ON'
    });
  };

  L.button = function (c) {
    var l = bigButton(c, {
      titleInside: false, symbol: c.opts.symbol,
      showValue: true, valueCap: 'md', sample: c.title
    });
    l.isLabelStatic = true;
    return l;
  };

  /* ------------------------------------------------------------------
   * THE ARC, the way LVGL 9.5 actually lays one out.
   *
   * Read out of the vendored source rather than inferred from the widget's
   * width and height, because three of these are not what they look like:
   *
   *   * `get_center()` takes the radius as MIN(w,h)/2 and does NOT subtract
   *     the arc width, and `lv_draw_arc_get_area()` uses `rout = radius`,
   *     `rin = radius - w`. So the radius is the OUTER edge and every stroke
   *     grows INWARD from it.
   *   * the indicator is drawn at that same outer radius (`indic_r = arc_r -
   *     get_indicator_max_pad()`), so making it thicker makes it reach
   *     further IN, never out. A fat fill under a thin track is the intended
   *     look, not an overflow.
   *   * the knob is centred on the indicator's centreline with a half-extent
   *     of `indic_width/2 + knob_pad`, so it pokes `knob_pad` px PAST the
   *     widget box — and lv_arc's LV_EVENT_REFR_EXT_DRAW_SIZE handler grows
   *     the draw area by exactly that, so LVGL does not clip it.
   *
   * That last one is why the box is inset from the room it is given: what the
   * knob reaches still has to land inside the card, which DOES clip.
   * ------------------------------------------------------------------ */
  function arcWidth(size) { return Math.max(8, Math.round(size * 0.043)); }
  function arcKnobPad(width) { return Math.max(4, Math.round(width * 0.6)); }

  function arcGeom(avail) {
    /* the knob's reach depends on the arc width, which depends on the size —
     * so solve it instead of guessing a margin */
    var size = avail;
    for (var i = 0; i < 4; i++) {
      var over = arcKnobPad(arcWidth(size));
      if (size + over * 2 <= avail) break;
      size = avail - over * 2;
    }
    size -= size % 2;
    var width = arcWidth(size);
    var pad = arcKnobPad(width);
    return { size: size, width: width, indWidth: width * 2, knobPad: pad, overflow: pad };
  }

  /* ---- FAN: arc, blades, percentage -------------------------------- */
  L.fan = function (c) {
    var s = split(c);
    var b = s.body;
    var nf = slot(c, 'title', 16, b.w - PAD * 2, Math.max(30, b.h * 0.45), { sample: c.title });
    var titleH = lineH(nf.px) + 12;
    var t = slot(c, 'value', 'auto', b.w - PAD, Math.max(30, Math.round(b.h * 0.26)),
      { kind: 'num', sample: '100%', cap: 'lg' });
    var valueH = lineH(t.px);
    var free = Math.max(60, b.h - titleH - valueH - PAD);
    /* the old floor of 110 could make the dial wider than the card it sits in
     * once a toggle strip had taken its share, so it is capped by the body */
    var avail = Math.min(b.w - PAD * 2, free);
    if (avail < 110) avail = Math.max(60, Math.min(110, b.w - 8, free));
    var G = arcGeom(avail);
    var arcSize = G.size;
    var arcX = b.x + Math.round((b.w - arcSize) / 2);
    var arcY = b.y + titleH + Math.round((free - arcSize) / 2);
    var out = {
      name:  { x: b.x + PAD, y: b.y + PAD - 4, w: b.w - PAD * 2, px: nf.px, font: nf.font, align: 'left' },
      arc:   c.opts.arc ? { x: arcX, y: arcY, w: arcSize, h: arcSize,
                            width: G.width, indWidth: G.indWidth,
                            knobPad: G.knobPad, overflow: G.overflow } : null,
      value: { x: b.x, y: b.y + b.h - PAD + 2 - valueH, w: b.w, px: t.px, font: t.font, align: 'center' },
      power: s.strip,
      blades: null
    };
    if (c.opts.blades) {
      var cx = c.opts.arc ? arcX + arcSize / 2 : b.x + b.w / 2;
      var cy = c.opts.arc ? arcY + arcSize / 2 : b.y + titleH + free / 2;
      out.blades = {
        x: Math.round(cx - FAN_SPRITE / 2), y: Math.round(cy - FAN_SPRITE / 2),
        w: FAN_SPRITE, h: FAN_SPRITE,
        clipped: FAN_SPRITE > b.w - 8 || FAN_SPRITE > free
      };
    }
    if (s.strip) out.powerSym = slot(c, 'symbol',
      Math.min(48, Math.round(Math.min(s.strip.w, s.strip.h) * 0.34)),
      s.strip.w, s.strip.h, { kind: 'sym' });
    return out;
  };

  /* ---- READOUTS: sensor, text sensor, clock ------------------------ */
  function readout(c, sizeId, reserveBelow, opt) {
    var nf = slot(c, 'title', 18, c.w - PAD * 2, Math.max(30, c.h * 0.45), { sample: c.title });
    var titleH = c.title ? lineH(nf.px) + 8 : 0;
    var innerW = c.w - PAD * 2;
    var innerH = c.h - PAD * 2 - titleH - (reserveBelow || 0);
    var t = slot(c, 'value', 'auto', innerW, Math.max(24, innerH),
      Object.assign({ kind: 'num' }, opt || {}));
    /* `Math.max(24, innerH)` above hands the value a floor of 24 px even when
     * the card has less than that left after a big title — so the resolved
     * size can be one the card cannot actually seat, and the readout drops a
     * pixel past the bottom edge. Clamp the position to the card rather than
     * trusting the box we asked about. */
    var vy = PAD + titleH + Math.max(0, Math.round((innerH - lineH(t.px)) / 2));
    vy = Math.min(vy, Math.max(0, c.h - 4 - lineH(t.px)));
    return {
      name: c.title ? { x: PAD, y: PAD - 4, w: innerW, px: nf.px, font: nf.font, align: 'center' } : null,
      value: { x: PAD, y: vy, w: innerW, px: t.px, font: t.font, align: 'center' }
    };
  }

  /* ------------------------------------------------------------------
   * THE UNIT IS ITS OWN LABEL, and that is the difference between a
   * temperature you can read across a room and one you cannot.
   *
   * Sized as one string, "88.8°C" is 3.2 em wide against "88%"'s 2.0 — so a
   * temperature came out roughly HALF the size of a humidity on an identical
   * card, and no size setting could fix it because the constraint was the
   * string, not the choice. Splitting them lets the number be sized on the
   * digits alone, with only a small allowance reserved for the unit beside
   * it: on a 206 px card that takes 44 px to about 76.
   * ------------------------------------------------------------------ */
  var UNIT_RATIO = 0.44;     /* unit size, as a fraction of the number's */
  var GAP_EM = 0.06;         /* space between them, in ems of the number */
  var DESCENT = 0.244;       /* Roboto's descender: -500/2048 em */

  L.sensor = function (c) {
    /* trimmed: the gap between number and unit is placed, so a unit typed as
     * " W" would otherwise be spaced twice */
    var unit = String(c.opts.unit || '').replace(/^\s+|\s+$/g, '');
    /* HOW MANY DIGITS TO LEAVE ROOM FOR. Decimals tell you what kind of
     * number this is: with them you are reading a precise small quantity
     * (temperature, pH, volts) and two integer digits cover it; without them
     * you are counting something (percent, watts, ppm) and it reaches three.
     * Guessing low is what put "681" through the "W" on a fitted card. */
    var num = c.opts.decimals > 0
      ? '88.' + '8'.repeat(c.opts.decimals)
      : '888';
    /* what the unit costs, expressed in ems of the NUMBER's size */
    var extra = unit ? PF.fonts.emWidth(unit) * UNIT_RATIO + 0.12 : 0;
    var out = readout(c, c.opts.valueSize, 0, { sample: num, emExtra: extra });
    if (!unit) return out;

    var v = out.value;
    /* snapped to 4 px so several sensors share one unit font rather than
     * each dragging its own arbitrary size into flash */
    var upx = PF.fonts.real(Math.max(12, Math.round(v.px * UNIT_RATIO / 4) * 4));
    var gap = Math.round(v.px * GAP_EM);

    /* THE PAIR IS A FLEX ROW, not two placed labels.
     *
     * Placing them by hand means centring on a SAMPLE, and the reading is
     * hardly ever the width of the sample: a card sized for "888" showed
     * "24" pushed a whole digit right of centre. LVGL re-runs a flex layout
     * whenever a child's size changes, so the row centres the real text on
     * every update and no estimate is involved. `pairBoxes()` below is the
     * preview's copy of that, fed the string actually being drawn. */
    out.value = {
      x: v.x, y: v.y, w: v.w, px: v.px, font: v.font, align: v.align,
      row: {
        gap: gap,
        h: lineH(v.px),
        /* the row's own box, kept apart from the number's: below, value.x/w
         * become the NUMBER's nominal box, and the row still has to know the
         * room it was given */
        box: { x: v.x, w: v.w },
        sample: num,
        /* Flex can align the boxes' bottoms but knows nothing about
         * baselines, so the smaller label sits low by the difference in
         * descender. Pad it back up. Without this the unit hangs below the
         * number instead of sitting on the same line. */
        unitPad: Math.max(0, Math.round(DESCENT * (v.px - upx)))
      }
    };
    out.unit = {
      x: v.x, y: v.y, w: Math.round(upx * PF.fonts.emWidth(unit)),
      px: upx, font: PF.fonts.idFor(upx, 'num'), align: 'left', text: unit
    };
    /* place() recomputes these once the user's alignment is known */
    return out;
  };

  /* Where the number and the unit land inside the row, for the strings being
   * drawn right now. LVGL does this itself from real glyph widths; here it is
   * the same width model the fitting used, so the two agree. */
  function pairBoxes(out, numText, unitText) {
    var v = out.value, u = out.unit, row = v.row;
    var numW = Math.round(v.px * PF.fonts.emWidth(String(numText)));
    var uW = Math.round(u.px * PF.fonts.emWidth(String(unitText)));
    var total = numW + row.gap + uW;
    var slack = Math.max(0, row.box.w - total);
    var x = row.box.x + (v.align === 'left' ? 0 : v.align === 'right' ? slack : Math.round(slack / 2));
    return {
      value: { x: x, y: v.y, w: numW, autoW: true, px: v.px, font: v.font, align: 'left' },
      unit: { x: x + numW + row.gap, y: v.y + row.h - lineH(u.px) - row.unitPad,
              w: uW, autoW: true, px: u.px, font: u.font, align: 'left', text: u.text }
    };
  }
  L.text_sensor = function (c) {
    /* words, not digits — needs the full glyph set */
    return readout(c, c.opts.valueSize, 0, { kind: 'ui', sample: 'CLOSED' });
  };

  L.clock = function (c) {
    /* work the date's size out FIRST, so the time knows how much room is left
     * — otherwise a big date and a filled time overlap */
    var df = slot(c, 'date', 18, c.w - PAD * 2, Math.max(28, c.h * 0.3), { sample: 'FRI 07 AUG' });
    var dateH = c.opts.showDate ? lineH(df.px) + 10 : 0;
    var out = readout(c, null, dateH,
      { sample: c.opts.format === '12' ? '88:88 PM' : '88:88' });
    if (c.opts.showDate) {
      out.date = {
        x: PAD, y: out.value.y + lineH(out.value.px) + 4,
        w: c.w - PAD * 2, px: df.px, font: df.font, align: 'center'
      };
    }
    return out;
  };

  L.text = function (c) {
    var t = slot(c, 'value', 'md', c.w - PAD * 2, Math.max(24, c.h - PAD),
      { kind: 'ui', sample: c.opts.body || 'TEXT' });
    return {
      body: {
        x: PAD, y: Math.max(0, Math.round((c.h - lineH(t.px)) / 2)),
        w: c.w - PAD * 2, px: t.px, font: t.font, align: c.opts.align
      }
    };
  };

  /* ---- COVER: up / stop / down ------------------------------------- */
  L.cover = function (c) {
    var nf = slot(c, 'title', 16, c.w - PAD * 2, Math.max(30, c.h * 0.45), { sample: c.title });
    var titleH = c.title ? lineH(nf.px) + 12 : 0;
    var posH = c.opts.showPosition ? 44 : 0;
    var gap = 10;
    var out = {
      name: c.title ? { x: PAD, y: PAD - 6, w: c.w - PAD * 2, px: nf.px, font: nf.font, align: 'left' } : null,
      buttons: [], position: null
    };
    var roles = ['up', 'stop', 'down'];
    if (c.opts.layout === 'row') {
      var bw = Math.floor((c.w - PAD * 2 - gap * 2) / 3);
      var bh = Math.max(30, c.h - PAD * 2 - titleH - posH);
      for (var i = 0; i < 3; i++) {
        out.buttons.push({ role: roles[i], x: PAD + i * (bw + gap), y: PAD + titleH, w: bw, h: bh });
      }
    } else {
      var cw = c.w - PAD * 2;
      var ch = Math.max(30, Math.floor((c.h - PAD * 2 - titleH - posH - gap * 2) / 3));
      for (var j = 0; j < 3; j++) {
        out.buttons.push({ role: roles[j], x: PAD, y: PAD + titleH + j * (ch + gap), w: cw, h: ch });
      }
    }
    if (c.opts.showPosition) {
      var pf = slot(c, 'value', 24, c.w - PAD * 2, Math.max(30, c.h * 0.3), { kind: 'num', sample: '100%' });
      out.position = { x: PAD, y: c.h - PAD - lineH(pf.px) + 4, w: c.w - PAD * 2, px: pf.px, font: pf.font, align: 'center' };
    }
    var minSide = out.buttons.reduce(function (a, b) { return Math.min(a, b.w, b.h); }, 999);
    out.symbol = slot(c, 'symbol', Math.max(16, Math.min(40, Math.round(minSide * 0.5))),
      minSide, minSide, { kind: 'sym' });
    return out;
  };

  /* ---- GAUGE: a dial, with the number in the middle of it -----------
   *
   * LVGL's meter puts its scale on a circle inscribed in the widget, so the
   * widget has to be SQUARE or the dial goes oval. Take the smaller side and
   * centre it; the leftover is where the label and the readout live.
   * ------------------------------------------------------------------ */
  L.gauge = function (c) {
    var nf = slot(c, 'title', 16, c.w - PAD * 2, Math.max(28, c.h * 0.22), { sample: c.title });
    var titleH = c.title ? lineH(nf.px) + 8 : 0;
    var side = Math.max(80, Math.min(c.w - PAD * 2, c.h - PAD * 2 - titleH));
    side -= side % 2;
    var dial = {
      x: Math.round((c.w - side) / 2),
      y: titleH + Math.round((c.h - titleH - side) / 2),
      w: side, h: side,
      /* the arc/needle thickness, and the tick length, both scale with the
       * dial or a small card turns into a ring of mush */
      width: Math.max(6, Math.round(side * 0.055)),
      tick: Math.max(4, Math.round(side * 0.05))
    };
    /* the readout sits inside the dial, so it is bounded by the circle's
     * inner square (side / sqrt(2)) rather than by the card */
    var inner = Math.round(side * 0.66);
    /* a gauge states its own range, so the widest reading is known rather
     * than guessed — no need for the sensor card's decimals heuristic */
    var digits = Math.max(
      String(Math.round(Number(c.opts.min) || 0)).length,
      String(Math.round(Number(c.opts.max) || 0)).length, 2);
    var sample = '8'.repeat(digits) +
      (c.opts.decimals > 0 ? '.' + '8'.repeat(c.opts.decimals) : '') + (c.opts.unit || '');
    var t = slot(c, 'value', 'auto', inner, Math.round(inner * 0.5), { kind: 'num', sample: sample, cap: 'lg' });
    /* WHERE THE NUMBER GOES DEPENDS ON THE INDICATOR, and it is not a taste
     * call. A needle pivots at the centre of the dial, which is exactly where
     * a centred readout sits — the needle draws straight through the digits.
     * Every real gauge puts the number below the pivot, so this does too.
     * The filling arc touches nothing in the middle, so there it stays put. */
    var vy = c.opts.style === 'needle'
      ? dial.y + Math.round(side * 0.70)
      : dial.y + Math.round(side / 2 - lineH(t.px) / 2);
    return {
      name: c.title ? { x: PAD, y: PAD - 6, w: c.w - PAD * 2, px: nf.px, font: nf.font, align: 'center' } : null,
      dial: dial,
      value: { x: dial.x, y: vy, w: side, px: t.px, font: t.font, align: 'center' }
    };
  };

  /* ---- MEDIA: what is playing, and the transport --------------------
   *
   * Laid out from the BOTTOM up, because the fixed things are down there: a
   * volume bar of known height and a row of buttons that must stay a finger
   * wide. Whatever is left over goes to the title and the artist, which are
   * the parts that can shrink. Doing it the other way round let a tall card
   * push the buttons off the bottom edge.
   * ------------------------------------------------------------------ */
  L.media = function (c) {
    var nf = slot(c, 'title', 16, c.w - PAD * 2, Math.max(30, c.h * 0.3), { sample: c.title });
    var titleH = c.title ? lineH(nf.px) + 10 : 0;

    /* three buttons, square-ish, never under the finger target unless the
     * card itself is too small to give them one */
    var btn = Math.round(Math.min((c.w - PAD * 2 - 24) / 3, c.h * 0.28));
    btn = Math.max(56, Math.min(btn, PF.catalog.TOUCH_MIN + 28));
    var volH = c.opts.showVolume ? 30 : 0;
    var volGap = c.opts.showVolume ? 12 : 0;

    var rowY = c.h - PAD - volH - volGap - btn;
    var gap = Math.round((c.w - PAD * 2 - btn * 3) / 2);
    var roles = ['prev', 'playpause', 'next'];
    var buttons = roles.map(function (r, i) {
      return { role: r, x: PAD + i * (btn + gap), y: rowY, w: btn, h: btn };
    });

    /* The text block gets what is left between the label and the buttons.
     *
     * NOTE THE SHORT SAMPLES. Everywhere else a sample is the longest string
     * the slot has to show, because a label that overflows its card is a bug.
     * Here it is the opposite: the track label carries long_mode DOT or
     * SCROLL, so it is SUPPOSED to overrun and the panel deals with it. Sizing
     * it to fit "Everything In Its Right Place" would drive the title down to
     * 14 px and leave the artist underneath it looking bigger — which is what
     * it did before this comment existed.
     *
     * The artist is deliberately fixed and small: it is the subordinate line,
     * and letting both scale made the pair fight over the same space. */
    var textTop = PAD + titleH;
    var textH = Math.max(24, rowY - textTop - 10);
    var af = slot(c, 'artist', 16, c.w - PAD * 2, Math.max(18, textH * 0.4), { kind: 'ui', sample: 'Artist' });
    var artistH = c.opts.showArtist ? lineH(af.px) + 4 : 0;
    var tf = slot(c, 'value', 'lg', c.w - PAD * 2, Math.max(20, textH - artistH),
      { kind: 'ui', sample: 'Track', cap: 'lg' });

    var out = {
      name: c.title ? { x: PAD, y: PAD - 6, w: c.w - PAD * 2, px: nf.px, font: nf.font, align: 'left' } : null,
      value: { x: PAD, y: textTop, w: c.w - PAD * 2, px: tf.px, font: tf.font, align: 'left' },
      artist: c.opts.showArtist
        ? { x: PAD, y: textTop + lineH(tf.px) + 4, w: c.w - PAD * 2, px: af.px, font: af.font, align: 'left' }
        : null,
      buttons: buttons,
      volume: c.opts.showVolume
        ? { x: PAD, y: c.h - PAD - volH, w: c.w - PAD * 2, h: volH }
        : null
    };
    /* the transport glyphs. Montserrat carries PREV / PLAY / PAUSE / NEXT, so
     * this needs no asset at all — worth keeping that way, since a media card
     * is the one most likely to end up on several panels. */
    out.symbol = slot(c, 'symbol', Math.max(16, Math.min(36, Math.round(btn * 0.42))),
      btn, btn, { kind: 'sym' });
    return out;
  };

  /* ---- CLIMATE: minus, setpoint, plus ------------------------------ */
  L.climate = function (c) {
    var nf = slot(c, 'title', 16, c.w - PAD * 2, Math.max(30, c.h * 0.45), { sample: c.title });
    var titleH = c.title ? lineH(nf.px) + 12 : 0;
    var modeH = c.opts.showMode ? 34 : 0;
    var btn = Math.round(Math.min(c.w * 0.26, (c.h - titleH - modeH) * 0.34));
    btn = Math.max(PF.catalog.TOUCH_MIN, Math.min(btn, 150));
    var rowY = PAD + titleH;
    var t = slot(c, 'value', 'auto', c.w - PAD * 2 - btn * 2, btn,
      { kind: 'num', sample: '88.8°', cap: 'xl' });
    var cf = slot(c, 'current', 24, c.w - PAD * 2, Math.max(30, c.h * 0.25), { kind: 'num', sample: 'NOW 88.8°' });
    var out = {
      name: c.title ? { x: PAD, y: PAD - 6, w: c.w - PAD * 2, px: nf.px, font: nf.font, align: 'left' } : null,
      minus: { x: PAD, y: rowY, w: btn, h: btn },
      plus:  { x: c.w - PAD - btn, y: rowY, w: btn, h: btn },
      setpoint: {
        x: PAD + btn, y: rowY + Math.round((btn - lineH(t.px)) / 2),
        w: c.w - PAD * 2 - btn * 2, px: t.px, font: t.font, align: 'center'
      },
      current: { x: PAD, y: rowY + btn + 12, w: c.w - PAD * 2, px: cf.px, font: cf.font, align: 'center' },
      mode: null,
      symbol: slot(c, 'symbol', Math.max(20, Math.min(40, Math.round(btn * 0.42))), btn, btn, { kind: 'sym' })
    };
    if (c.opts.showMode) {
      var mf = slot(c, 'mode', 18, c.w - PAD * 2, Math.max(28, c.h * 0.25), { sample: 'HEAT' });
      out.mode = { x: PAD, y: c.h - PAD - lineH(mf.px) + 4, w: c.w - PAD * 2, px: mf.px, font: mf.font, align: 'center' };
    }
    return out;
  };

  /* ==================================================================
   * DETAIL PAGES — the screens behind a hold.
   *
   * These used to be laid out with magic numbers inside the generator,
   * which broke the one rule this file exists for and had a worse
   * consequence than untidiness: the editor could not draw them. A page
   * nobody can see is a page nobody improves, which is exactly how it
   * ended up as two grey slabs.
   *
   * Same contract as a card layout: pure geometry, read by both the
   * preview and the generator.
   * ================================================================== */
  var DPAD = 30;          /* page margin */
  var DGAP = 20;          /* between blocks */

  /* A light's detail page adapts to what the bulb can actually do, because
   * a fixed layout either leaves a hole on a plain bulb or crams a colour
   * row onto one that has none. Three shapes, one function. */
  function detailLight(c, P) {
    var head = 116;                       /* back button + title band */
    var hasCT = !!(c.opts.dimmable && c.opts.colorTemp);
    var hasPresets = !!c.opts.dimmable;   /* brightness presets, always useful */
    var top = head + DGAP;
    var avail = P.h - top - DPAD;
    var W = P.w - DPAD * 2;

    var out = {
      page: { w: P.w, h: P.h },
      back: { x: DPAD, y: 26, w: 208, h: 88 },
      title: { x: DPAD + 208 + 22, y: 26, w: P.w - DPAD * 2 - 208 - 22 - 130, h: 88 },
      toggle: { x: P.w - DPAD - 110, y: 26, w: 110, h: 88 },
      blocks: []
    };

    /* Height split. The brightness block is the one that must stay big —
     * it is the control people actually drag — so it takes the larger
     * share whenever it is sharing. */
    if (hasCT) {
      /* brightness / colour temperature / a row of Kelvin presets. The
       * brightness block keeps the larger share — it is the one people
       * actually drag. */
      var presetH = 96;
      var briH = Math.round((avail - DGAP * 2 - presetH) * 0.52);
      var ctH  = avail - DGAP * 2 - presetH - briH;
      out.blocks.push({ kind: 'bri',       x: DPAD, y: top, w: W, h: briH });
      out.blocks.push({ kind: 'ct',        x: DPAD, y: top + briH + DGAP, w: W, h: ctH });
      out.blocks.push({ kind: 'ctpresets', x: DPAD, y: top + briH + DGAP + ctH + DGAP, w: W, h: presetH });
    } else {
      /* No colour temperature. Give brightness the room and add quick
       * levels, rather than leaving the bottom half of the page empty —
       * which is what the fixed 250 px block used to do. */
      var pH = hasPresets ? 128 : 0;
      var bH = avail - (pH ? pH + DGAP : 0);
      out.blocks.push({ kind: 'bri', x: DPAD, y: top, w: W, h: bH });
      if (pH) out.blocks.push({ kind: 'bripresets', x: DPAD, y: top + bH + DGAP, w: W, h: pH });
    }

    /* Inside a block: kicker top-left, readout top-right, control below. */
    out.blocks.forEach(function (b) {
      b.pad = 22;
      b.kicker = { x: b.x + b.pad, y: b.y + b.pad - 4, w: Math.round(b.w * 0.6) };
      b.readout = { x: b.x + b.pad, y: b.y + b.pad - 10, w: b.w - b.pad * 2 };
      var ctlTop = b.y + b.pad + 52;
      b.control = { x: b.x + b.pad, y: ctlTop, w: b.w - b.pad * 2, h: Math.max(56, b.y + b.h - b.pad - ctlTop) };
      if (b.kind === 'ctpresets' || b.kind === 'bripresets') {
        /* a row of equal buttons, gutter between */
        b.count = b.kind === 'ctpresets' ? 5 : 4;
        var g = 14;
        b.btnW = Math.floor((b.w - b.pad * 2 - g * (b.count - 1)) / b.count);
        b.btnH = Math.max(56, b.h - b.pad * 2 + 8);
        b.btnY = b.y + Math.round((b.h - b.btnH) / 2);
        b.gap = g;
      }
    });
    return out;
  }

  function detail(card, P) {
    if (card.type === 'light' && card.opts.dimmable && card.opts.detailPage) return detailLight(card, P);
    return null;
  }

  /* ------------------------------------------------------------------
   * WHERE THE USER PUT IT — applied once, over the finished layout.
   *
   * Every card type builds its parts by hand, so honouring an alignment
   * inside each of them would be a dozen places to forget. This is the one
   * place: map a text slot to the part it produced, and move that part
   * inside the room the layout already gave it.
   *
   * A shrink-wrapped part (a light tile's percentage, which has to measure
   * itself for the ink rule) has no box to align in, so it is left alone.
   * ------------------------------------------------------------------ */
  var SLOT_PART = { title: 'name', value: 'value', symbol: 'symbol', date: 'date',
                    artist: 'artist', current: 'current', mode: 'mode' };

  function place(card, out) {
    var slots = PF.catalog.slots(card.type) || [];
    slots.forEach(function (sl) {
      var part = out[SLOT_PART[sl[0]]];
      if (!part || part.autoW || part.px === undefined) return;

      var h = card.opts['al_' + sl[0]];
      if (h && h !== 'default') part.align = h;

      /* Vertical only for the headline value, and clamped to the card: the
       * other parts are stacked against each other, so moving one would
       * land it on top of its neighbour. */
      var v = card.opts['av_' + sl[0]];
      if (v && v !== 'default' && sl[0] === 'value') {
        var boxH = (part.row ? part.row.h : lineH(part.px));
        var top = out.name ? out.name.y + lineH(out.name.px) + 4 : PAD;
        var bottom = card.h - PAD - boxH;
        var y = v === 'top' ? top
              : v === 'bottom' ? bottom
              : Math.round((top + bottom) / 2);
        part.y = Math.max(0, Math.min(y, Math.max(0, card.h - 2 - boxH)));
        if (out.unit) out.unit.y = part.y + boxH - lineH(out.unit.px) - part.row.unitPad;
      }
    });
    /* the pair moves as one — recompute it after any of the above */
    if (out.unit && out.value && out.value.row) {
      var nom = pairBoxes(out, out.value.row.sample, out.unit.text);
      out.value.x = nom.value.x; out.value.w = nom.value.w;
      out.unit.x = nom.unit.x; out.unit.y = nom.unit.y;
    }
    return out;
  }

  function of(card) {
    var fn = L[card.type];
    return fn ? place(card, fn(card)) : {};
  }

  PF.layout = { of: of, detail: detail, PAD: PAD, lineH: lineH, split: split, fillDir: fillDir,
                needsClip: needsClip, roundedFace: roundedFace, pairBoxes: pairBoxes,
                text: text, fixed: fixed, FAN_SPRITE: FAN_SPRITE };
})(window.PF = window.PF || {});
