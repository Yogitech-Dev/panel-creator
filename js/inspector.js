/* =====================================================================
 * inspector.js — the right-hand property panel.
 *
 * Three tabs: the selected card, the panel as a whole, and the sound/voice
 * choices. Fields are built from catalog.js so a new card type needs no
 * code here at all.
 * ===================================================================== */
(function (PF) {
  'use strict';

  var els = {};
  var entityPool = [];
  /* which cards are mid-burst of typing — see upTyping() */
  var typing = {};
  /* picking a symbol rebuilds the tab, which would otherwise fold the MDI
   * list shut on every click — so its open state outlives the rebuild */
  var mdiOpen = false;

  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ---- small builders ---------------------------------------------- */

  /* A hint has two jobs and they fight: tell a first-timer what the control
   * does, and carry the reasoning for anyone who wants it. Showing both at
   * once turns the panel into a wall of prose. So: the first sentence stays
   * visible, the rest goes behind a "why" the user opens on demand. */
  function hint(text) {
    if (!text) return '';
    var m = /^(.*?[.!?])\s+(.+)$/.exec(String(text).replace(/\s+/g, ' '));
    if (!m || m[2].length < 40) return '<div class="hint">' + text + '</div>';
    return '<div class="hint">' + m[1] +
      ' <details class="why"><summary>why</summary>' + m[2] + '</details></div>';
  }

  function group(title, inner) {
    return '<div class="group">' + (title ? '<h3>' + esc(title) + '</h3>' : '') + inner + '</div>';
  }
  /* A group whose heading IS the toggle. For blocks whose defaults are right
   * for most panels — you should be able to see that they exist without
   * scrolling past every field in them. */
  function groupFold(title, inner, open) {
    return '<div class="group"><details' + (open ? ' open' : '') + '><summary>' + esc(title) +
      '</summary>' + inner + '</details></div>';
  }
  function fText(id, label, value, h, ph, list) {
    return '<div class="f"><label for="' + id + '">' + esc(label) + '</label>' +
      '<input type="text" id="' + id + '" value="' + esc(value) + '" spellcheck="false"' +
      (ph ? ' placeholder="' + esc(ph) + '"' : '') + (list ? ' list="' + list + '"' : '') + '>' +
      hint(h) + '</div>';
  }
  function fNum(id, label, value, min, max, step, h) {
    return '<div class="f"><label for="' + id + '">' + esc(label) + '</label>' +
      '<input type="number" id="' + id + '" value="' + value + '"' +
      (min !== undefined ? ' min="' + min + '"' : '') +
      (max !== undefined ? ' max="' + max + '"' : '') +
      (step !== undefined ? ' step="' + step + '"' : '') + '>' +
      hint(h) + '</div>';
  }
  function fSel(id, label, value, options, h) {
    var o = options.map(function (x) {
      return '<option value="' + esc(x.id) + '"' + (String(x.id) === String(value) ? ' selected' : '') + '>' + esc(x.name) + '</option>';
    }).join('');
    return '<div class="f"><label for="' + id + '">' + esc(label) + '</label>' +
      '<select id="' + id + '">' + o + '</select>' +
      hint(h) + '</div>';
  }
  function fBool(id, label, value, h, badge) {
    return '<div class="f checkline"><input type="checkbox" id="' + id + '"' + (value ? ' checked' : '') + '>' +
      '<div><label for="' + id + '">' + esc(label) +
      (badge ? ' <span class="badge">' + esc(badge) + '</span>' : '') + '</label>' +
      hint(h) + '</div></div>';
  }
  function fColor(id, label, value, h) {
    return '<div class="f"><label for="' + id + '">' + esc(label) + '</label>' +
      '<div class="colorrow"><input type="color" id="' + id + '" value="' + PF.theme.css(value) + '">' +
      '<button class="btn small ghost" id="' + id + '_r">Use theme</button></div>' +
      hint(h) + '</div>';
  }
  /* Two kinds of symbol in one picker — see catalog.js. The built-in glyphs
   * cost nothing at all; the MDI icons cost flash and a build-time download,
   * so the group heading says so rather than leaving it to be discovered. */
  function fSymbol(id, value) {
    function btn(sym, name, inner, extra) {
      return '<button class="' + (extra || '') + (sym === value ? ' is-on' : '') +
        '" data-sym="' + esc(sym) + '" title="' + esc(name) + '">' + inner + '</button>';
    }
    /* The id goes on the WRAPPER, not on the first grid — the MDI buttons are
     * in sibling grids inside the fold, and the click handler binds by
     * querying this one node for every button under it. */
    var h = '<div class="f" id="' + id + '"><label>Symbol</label><div class="symgrid">';
    h += PF.catalog.symbols.map(function (s) {
      return btn(s.id, s.name, s.id === 'none' ? 'none' : PF.icons.svg(s.id, 18, 'currentColor'),
                 s.id === 'none' ? 'none' : '');
    }).join('');
    h += '</div>';

    /* The size is decided by the card, not here, so quote the range rather
     * than one figure — an earlier version said "2 kB at 40 px" while the
     * generator was emitting 48 px for the very card being edited. */
    h += '<div class="symmore"><details' + (PF.catalog.isMdi(value) || mdiOpen ? ' open' : '') + '>' +
      '<summary>Material Design icons</summary>' +
      '<div class="hint">Downloaded when you build, not shipped with the config — so the ' +
      'machine running the build needs internet, the same as the Roboto option. Each one is a ' +
      'greyscale mask tinted to the theme, and it is sized to fit the card: ' +
      (PF.catalog.mdiBytes(32) / 1024).toFixed(1) + ' kB of flash at 32 px, ' +
      (PF.catalog.mdiBytes(64) / 1024).toFixed(0) + ' kB at 64.</div>';
    PF.mdi.groups().forEach(function (g) {
      h += '<div class="symgroup">' + esc(g.name) + '</div><div class="symgrid">' +
        g.icons.map(function (i) {
          return btn('mdi:' + i.n, i.n, PF.mdi.svg(i.n, 18, 'currentColor'));
        }).join('') + '</div>';
    });
    h += '</details></div></div>';
    return h;
  }

  /* ---- which optional fields apply right now ------------------------ */
  function visible(field, card) {
    if (!field.when) return true;
    if (field.when === 'powerNotNone') return card.opts.power && card.opts.power !== 'none';
    var eq = field.when.indexOf('==');
    if (eq > 0) return String(card.opts[field.when.slice(0, eq)]) === field.when.slice(eq + 2);
    return !!card.opts[field.when];
  }

  /* ================= CARD TAB ================= */
  function renderCard() {
    var c = PF.store.selected();
    var el = els.card;
    if (!c) {
      el.innerHTML = '<p class="empty-note">Nothing selected.<br><br>' +
        'Pick a card on the panel, or add one from the left. Each card is one Home ' +
        'Assistant entity, and what you place here is what ends up on the wall.</p>';
      return;
    }
    var t = PF.catalog.types[c.type];
    var h = '';

    h += '<div class="card-actions">' +
      '<button class="btn small" id="ciRot" title="Swap width and height">Rotate 90°</button>' +
      '<button class="btn small" id="ciDup">Duplicate</button>' +
      '<button class="btn small" id="ciBack">Send back</button>' +
      '<button class="btn small" id="ciFront">Bring front</button>' +
      '<button class="btn small ghost" id="ciDel">Delete</button></div>';

    h += '<div class="group"><h3>' + esc(t.name) + '</h3>' + hint(esc(t.blurb));
    if (t.needsEntity) {
      h += fText('ciEntity', 'Home Assistant entity', c.entity,
        'Settings → Tools → States in Home Assistant, or use <b>Import entities</b> on the left. Importing also ' +
        'brings each entity\'s own settings with it — a bulb\'s colour-temperature range and ' +
        'whether it can dim, a thermostat\'s limits, a sensor\'s unit — so they fill themselves ' +
        'in here instead of being looked up by hand.',
        t.domains[0] + '.something');
    }
    (t.fields || []).forEach(function (f) {
      if (f.group === 'sizes') return;             /* their own group, below */
      if (!visible(f, c)) return;
      var id = 'ci_' + f.key;
      var val = f.key === 'title' ? c.title : c.opts[f.key];
      if (f.type === 'text') h += fText(id, f.label, val, f.hint, f.placeholder);
      else if (f.type === 'number') h += fNum(id, f.label, val, f.min, f.max, f.step, f.hint);
      else if (f.type === 'bool') h += fBool(id, f.label, val, f.hint);
      else if (f.type === 'select') {
        var extra = f.hint;
        /* say which way the fill will actually run, so 'Follow the card
         * shape' is not something you have to work out from the aspect */
        if (f.key === 'fill') {
          var dir = PF.layout.fillDir(c, PF.layout.split(c).body);
          extra = (extra ? extra + ' ' : '') + '<b>Right now: ' +
            (dir === 'vertical' ? 'bottom to top' : 'left to right') + '.</b>';
        }
        h += fSel(id, f.label, val, f.options, extra);
      }
      else if (f.type === 'symbol') h += fSymbol(id, val);
      else if (f.type === 'color') {
        var eff = (val === null || val === undefined || val === '') ? PF.store.theme()[f.themeKey] : val;
        h += fColor(id, f.label, eff, f.hint);
      }
    });
    h += '</div>';

    /* Text sizes — one row per piece of text the card draws. Two columns so
     * five slots do not push everything else off the panel. */
    var sizeFields = (t.fields || []).filter(function (f) { return f.group === 'sizes'; });
    if (sizeFields.length) {
      /* Sizes are set often, alignment occasionally — and a card with five
       * text slots has five of one and nine of the other, which buried the
       * sizes under controls nobody had come for. Alignment goes behind a
       * fold that names itself, and opens by itself if this card is already
       * using it. */
      var rows = '', alignRows = '', usingAlign = false;
      sizeFields.forEach(function (f) {
        if (!visible(f, c)) return;
        var id = 'ci_' + f.key;
        var isAlign = /^a[lv]_/.test(f.key);
        if (isAlign && c.opts[f.key] && c.opts[f.key] !== 'default') usingAlign = true;
        var html = f.type === 'select'
          ? '<div class="szrow"><label for="' + id + '">' + esc(f.label) + '</label>' +
            '<select id="' + id + '">' + f.options.map(function (o) {
              return '<option value="' + o.id + '"' + (c.opts[f.key] === o.id ? ' selected' : '') + '>' + esc(o.name) + '</option>';
            }).join('') + '</select></div>'
          : '<div class="szrow"><label for="' + id + '">px</label>' +
            '<input type="number" id="' + id + '" value="' + c.opts[f.key] + '" min="' + f.min + '" max="' + f.max + '" step="' + f.step + '"></div>';
        if (isAlign) alignRows += html; else rows += html;
      });
      if (alignRows) {
        rows += '<details class="subfold"' + (usingAlign ? ' open' : '') +
          '><summary>Alignment &#8596; &#8597;</summary>' + alignRows + '</details>';
      }
      h += group('Text size and position', rows +
        hint('Default keeps each element as it has always been. Fill the space ' +
             'scales it to the room it has, which is how one big clock ends up ' +
             'filling its card instead of sitting at 72 px in the middle of it. ' +
             '↔ and ↕ move an element inside the room the card gave it, so a ' +
             'value can sit against the top, the bottom or either side rather than ' +
             'always in the middle. ' +
             'Every distinct size is its own font in flash, so a panel using five ' +
             'sizes costs more than one using two — and a size carrying letters ' +
             'costs far more than one carrying only digits.'));
    }

    h += group('Position and size',
      '<div class="geo">' +
      fNum('ciX', 'X', c.x, 0, 4000, 1) + fNum('ciY', 'Y', c.y, 0, 4000, 1) +
      fNum('ciW', 'Width', c.w, t.min.w, 4000, 1) + fNum('ciH', 'Height', c.h, t.min.h, 4000, 1) +
      '</div><div class="hint">Panel pixels. This screen is 11.6 px per mm, so an 8 mm ' +
      'finger target is about 95 px — anything tappable below that gets flagged at the bottom.</div>');

    el.innerHTML = h;

    /* ---- wiring ---- */
    function up(patch) { PF.store.updateCard(c.id, patch); }

    /* Typing updates the preview on every keystroke but adds ONE undo entry
     * per burst: a checkpoint on the first key, quiet updates after. Undo is
     * 80 deep, so a per-keystroke entry would push everything else off the
     * stack while you type an entity id. */
    function upTyping(patch) {
      if (!typing[c.id]) { PF.store.beginGesture(); typing[c.id] = true; }
      PF.store.updateCard(c.id, patch, { quiet: true });
      debounce('typing:' + c.id, function () { typing[c.id] = false; });
    }
    /* Swap width and height about the card's own centre, so it turns on the
     * spot instead of jumping to a corner. On a light tile this also flips
     * the fill direction, because LVGL reads the shape. */
    byId('ciRot').onclick = function () {
      var cx = c.x + c.w / 2, cy = c.y + c.h / 2;
      up({ w: c.h, h: c.w, x: Math.round(cx - c.h / 2), y: Math.round(cy - c.w / 2) });
      render('card', true);
    };
    byId('ciDup').onclick = function () { PF.store.duplicateCard(c.id); };
    byId('ciDel').onclick = function () { PF.store.removeCard(c.id); };
    byId('ciBack').onclick = function () { PF.store.raise(c.id, -1); };
    byId('ciFront').onclick = function () { PF.store.raise(c.id, 1); };

    if (byId('ciEntity')) {
      /* If the imported list knows this entity, take its real capabilities
       * rather than leaving the defaults sitting there: the colour range a
       * bulb actually has, whether it can dim, a thermostat's limits. Only
       * fires on a full match, so it does not thrash while you type. */
      var applyEntity = function (id, keepFocus) {
        var caps = capsFor(id);
        var opts = caps ? PF.catalog.fromEntity(c.type, caps) : null;
        upTyping(opts ? { entity: id, opts: opts } : { entity: id });
        /* those options can add or remove fields (colour temperature only
         * exists on a dimmable light), so the tab has to be rebuilt — after
         * the value lands, and with focus put back where it was */
        if (opts) {
          var at = keepFocus === undefined ? null : keepFocus;
          setTimeout(function () {
            render('card', true);
            var again = byId('ciEntity');
            if (again) {
              again.focus();
              if (at !== null) { try { again.setSelectionRange(at, at); } catch (_) {} }
            }
          }, 0);
        }
      };
      byId('ciEntity').oninput = function () { applyEntity(this.value.trim(), this.selectionStart); };
      makeCombo('card', byId('ciEntity'), t.domains, function (id) { applyEntity(id); });
    }
    (t.fields || []).forEach(function (f) {
      if (!visible(f, c)) return;
      var id = 'ci_' + f.key;
      var node = byId(id);
      if (!node) return;
      var apply = function (v, lazy) {
        var patch = f.key === 'title' ? { title: v } : { opts: (function () { var o = {}; o[f.key] = v; return o; })() };
        (lazy ? upTyping : up)(patch);
      };
      /* A switch or a dropdown can reveal or hide other fields (colour
       * temperature only exists on a dimmable light), so those force a rebuild
       * — the normal render skips a tab that has focus inside it, which is
       * right while typing and wrong here. */
      var applyAndRebuild = function (v) { apply(v); render('card', true); };

      if (f.type === 'text') node.oninput = function () { apply(this.value, true); };
      else if (f.type === 'number') node.oninput = function () {
        var v = parseFloat(this.value);
        if (!isNaN(v)) apply(v, true);
      };
      else if (f.type === 'bool') node.onchange = function () { applyAndRebuild(this.checked); };
      else if (f.type === 'select') node.onchange = function () { applyAndRebuild(this.value); };
      else if (f.type === 'color') {
        node.oninput = function () { apply(PF.theme.parseCss(this.value), true); };
        byId(id + '_r').onclick = function () { apply(null); };
      } else if (f.type === 'symbol') {
        node.querySelectorAll('button').forEach(function (b) {
          b.onclick = function () { applyAndRebuild(b.getAttribute('data-sym')); };
        });
        var det = node.querySelector('details');
        if (det) det.ontoggle = function () { mdiOpen = det.open; };
      }
    });
    sizeFields.forEach(function (f) {
      var node = byId('ci_' + f.key);
      if (!node) return;
      if (f.type === 'select') {
        node.onchange = function () {
          var o = {}; o[f.key] = this.value; up({ opts: o }); render('card', true);
        };
      } else {
        node.oninput = function () {
          var v = parseInt(this.value, 10);
          if (isNaN(v)) return;
          var o = {}; o[f.key] = v; upTyping({ opts: o });
        };
      }
    });

    ['X', 'Y', 'W', 'H'].forEach(function (k) {
      byId('ci' + k).oninput = function () {
        var v = parseInt(this.value, 10);
        if (isNaN(v)) return;
        var p = {}; p[k.toLowerCase()] = v; up(p);
      };
    });
  }

  /* ================= PANEL TAB ================= */
  function renderPanel() {
    var p = PF.store.get();
    var th = PF.store.theme();
    var h = '';

    var upd = p.deploy.mode === 'update';
    h += group('Device',
      fSel('pgDeploy', 'This panel is', p.deploy.mode, [
        { id: 'new',    name: 'New — never flashed' },
        { id: 'update', name: 'Already installed — updating it' }
      ], upd
        ? 'Install steps become <b>EDIT the existing device → paste → Install wirelessly</b>, and ' +
          'no new encryption key is generated. Regenerating one would rekey every panel reading ' +
          'that same secret and Home Assistant would drop the connection until you handed it the ' +
          'new key. The name below has to match the device you already have.'
        : 'Full first-time install, including a freshly generated encryption key. Switch this to ' +
          '<b>Already installed</b> when you come back to change a panel that is on the wall.') +
      fText('pgName', 'ESPHome name', p.device.name,
        upd ? '<b>Must match the device you already have</b>, exactly. It becomes <code>name:</code>, ' +
              'which is how Home Assistant identifies it — a different one gives you a second ' +
              'device with every entity duplicated and suffixed <code>_2</code>.'
            : 'Lower case, digits and dashes. It becomes the hostname.') +
      fText('pgFriendly', 'Friendly name', p.device.friendly, 'What Home Assistant shows.') +
      fText('pgTz', 'Time zone', p.device.timezone, 'A tz database name, e.g. <code>Europe/Berlin</code> or <code>America/Denver</code>.') +
      fSel('pgRot', 'Orientation', p.device.rotation, [
        { id: 'landscape', name: 'Landscape — 1280 × 720' },
        { id: 'portrait', name: 'Portrait — 720 × 1280' }
      ]));

    var bd = p.board || { chip: 'production', display: 'ST7123' };
    h += group('Your Tab5',
      fSel('pgChip', 'ESP32-P4 chip', bd.chip, [
        { id: 'production', name: 'Revision 3 or newer' },
        { id: 'early', name: 'Revision 1.x (early)' }
      ], 'Check it before you flash: open <b>espressif.github.io/esptool-js</b>, click Connect, ' +
         'pick the Tab5, and read the line that says <i>Chip is ESP32-P4 (revision v…)</i>. Then ' +
         'Disconnect; nothing gets written. The ESPHome Builder\'s USB flasher prints the same line ' +
         'when it connects. The wrong choice makes the panel restart over and over, with no screen and ' +
         'no Wi-Fi, so it is worth the ten seconds.') +
      fSel('pgDisp', 'Display controller', bd.display, [
        { id: 'ST7123', name: 'ST7123' },
        { id: 'ST7121', name: 'ST7121' }
      ], 'If you do not know, leave ST7123 and flash. Tab5s sold as V2 come with either, and the ' +
         'label does not say which. The firmware asks the board at start-up and shows the answer in ' +
         'Home Assistant as <b>Display controller</b> under the device\'s Diagnostics. If the screen ' +
         'stays black, read it there, change this, and install again over Wi-Fi.'));

    h += group('Look',
      fSel('pgTheme', 'Theme', p.theme.id, PF.theme.list.map(function (t) { return { id: t.id, name: t.name }; }),
        esc(th.note)) +
      fSel('pgStyle', 'Card corners', p.theme.style, [
        { id: 'rounded', name: 'Rounded — 26 px' },
        { id: 'square',  name: 'Square — cheaper to redraw' }
      ], p.theme.style === 'square'
        ? 'Nothing to clip, so no card pays the layer cost. The most literal option.'
        : 'Rounded is <b>not</b> the expensive part — clipping is. And most cards avoid clipping: ' +
          'anything with only labels inside never touches a corner, and a card whose whole face ' +
          'is one slider or button carries the radius on that child instead. Only a card with a ' +
          'full-bleed face <i>and</i> a toggle strip still has to clip.') +
      fSel('pgFont', 'Typeface', p.fonts.family, [
        { id: 'roboto', name: 'Roboto — downloaded at build time' },
        { id: 'montserrat', name: 'Montserrat — built in, works offline' }
      ], 'Roboto scales to any size. It is downloaded at build time, so the machine running ' +
         'the build needs internet; Montserrat is bundled with ESPHome and works offline, but ' +
         'stops at 48 px, so the big numbers cannot get big.'));

    h += groupFold('Screen',
      fNum('pgDim', 'Dim after (seconds)', p.screen.dimAfter, 5, 3600, 5) +
      fNum('pgOff', 'Sleep after (seconds)', p.screen.offAfter, 10, 7200, 5,
        'At sleep the backlight goes off and rendering stops, so the CPU idles too. Any touch wakes it.') +
      fNum('pgDimLvl', 'Dim brightness (%)', p.screen.dimLevel, 5, 100, 5) +
      fBool('pgAlways', 'Add a "Screen Always On" switch', p.screen.alwaysOnSwitch,
        'Pins the screen awake from Home Assistant without reflashing.') +
      fBool('pgPower', 'Report the panel’s own power use', p.power.monitor,
        'Reads the Tab5’s onboard INA226 and publishes volts, amps and watts. They come ' +
        'through as <b>diagnostic</b> entities on a one-minute interval, so Home Assistant ' +
        'files them under Diagnostics rather than adding three more rows to your controls. ' +
        'Off by default because most panels do not care what they draw.'));

    h += groupFold('Network',
      fBool('pgEnc', 'Encrypt the Home Assistant connection', p.api.encryption,
        'Recommended. A fresh key is generated for you at export and goes in your secrets.yaml.') +
      fBool('pgOta', 'Password-protect OTA updates', !!p.ota.password) +
      fBool('pgAp', 'Fallback hotspot if WiFi fails', p.wifi.apFallback) +
      '<div class="hint">WiFi credentials are always written as <code>!secret</code> — this tool never ' +
      'asks for them and never stores them.</div>');

    els.panel.innerHTML = h;

    byId('pgDeploy').onchange = function () {
      PF.store.setGlobal('deploy.mode', this.value);
      render('panel', true);        /* the hints below it change wording */
    };
    bindText('pgName', function (v) { PF.store.setGlobal('device.name', v.toLowerCase().replace(/[^a-z0-9-]+/g, '-')); });
    bindText('pgFriendly', function (v) { PF.store.setGlobal('device.friendly', v); });
    bindText('pgTz', function (v) { PF.store.setGlobal('device.timezone', v.trim()); });
    byId('pgRot').onchange = function () { PF.store.setGlobal('device.rotation', this.value); };
    byId('pgChip').onchange = function () { PF.store.setGlobal('board.chip', this.value); };
    byId('pgDisp').onchange = function () { PF.store.setGlobal('board.display', this.value); };
    byId('pgTheme').onchange = function () { PF.store.setGlobal('theme.id', this.value); render('panel', true); };
    byId('pgStyle').onchange = function () { PF.store.setGlobal('theme.style', this.value); render('panel', true); };
    byId('pgFont').onchange = function () { PF.store.setGlobal('fonts.family', this.value); };
    bindNum('pgDim',function (v) { PF.store.setGlobal('screen.dimAfter', v); });
    bindNum('pgOff', function (v) { PF.store.setGlobal('screen.offAfter', v); });
    bindNum('pgDimLvl', function (v) { PF.store.setGlobal('screen.dimLevel', v); });
    byId('pgAlways').onchange = function () { PF.store.setGlobal('screen.alwaysOnSwitch', this.checked); };
    byId('pgPower').onchange = function () { PF.store.setGlobal('power.monitor', this.checked); };
    byId('pgEnc').onchange = function () { PF.store.setGlobal('api.encryption', this.checked); };
    byId('pgOta').onchange = function () { PF.store.setGlobal('ota.password', this.checked ? 'secret' : ''); };
    byId('pgAp').onchange = function () { PF.store.setGlobal('wifi.apFallback', this.checked); };
  }

  /* ================= VOICE TAB ================= */
  function renderVoice() {
    var p = PF.store.get();
    var h = '';

    h += group('Sound',
      fSel('vcMode', 'Where sound comes out', p.audio.mode, [
        { id: 'none', name: 'Silent — no speaker, no microphone' },
        { id: 'panel', name: 'The panel\'s own speaker' },
        { id: 'external', name: 'A speaker elsewhere in the room' }
      ], p.audio.mode === 'none'
        ? 'Smallest and most stable build. Leaves out the whole audio stack.'
        : p.audio.mode === 'panel'
          ? 'Instant and quieter. Home Assistant announcements and <code>tts.speak</code> ' +
            'only work with this option.'
          : 'Louder, about a second slower to start, and the microphone stops fighting the ' +
            'speaker for the shared I2S bus.'));

    if (p.audio.mode === 'external') {
      h += group('', fText('vcPlayer', 'Speaker entity', p.voice.externalPlayer,
        'Any Home Assistant media player — a Nest, a Sonos, a Music Assistant target.',
        'media_player.kitchen_speaker'));
    }

    if (p.audio.mode !== 'none') {
      h += group('Voice assistant',
        fBool('vcOn', 'Wake word and voice control', p.voice.enabled,
          'The panel listens locally, then streams to your Home Assistant voice pipeline. ' +
          'Nothing leaves the device until the wake word fires.'));

      if (p.voice.enabled) {
        h += group('',
          fSel('vcWord', 'Wake word', p.voice.wakeWord, [
            { id: 'okay_nabu', name: 'Okay Nabu' },
            { id: 'hey_jarvis', name: 'Hey Jarvis' },
            { id: 'alexa', name: 'Alexa' }
          ], 'Okay Nabu is an invented phrase, so it rarely false-triggers. Do not pick Alexa ' +
             'in a house with Echo devices.') +
          fBool('vcAll', 'Compile all three, pick later in Home Assistant', p.voice.extraWakeWords,
            'Only one is ever live — ESPHome allows exactly one at a time. Worth it with more ' +
            'than one panel: Home Assistant cannot work out which panel is nearest, so every ' +
            'panel that hears the same word answers together.') +
          fBool('vcFollow', 'Keep listening for a follow-up', p.voice.followUp,
            'Up to three more turns without repeating the wake word. Off by default because ' +
            'this one is not stock ESPHome — nothing upstream re-opens the mic after a reply, ' +
            'so the config carries a turn counter, a "did this turn hear anything" flag and a ' +
            'script that waits out the reply before listening again. The chain stops as soon ' +
            'as a turn hears nothing. With the reply on another speaker it has to guess when ' +
            'that speaker finished, and no echo cancellation is applied — so a mic opened too ' +
            'early transcribes the assistant along with you. The Tab5 does carry an ES7210 AEC ' +
            'front-end for its mic array, but ESPHome drives it as a plain microphone ADC, so ' +
            'none of that silicon is doing anything here.',
            'Experimental') +
          fBool('vcPage', 'Show a listening screen with the transcript', p.voice.showPage,
            'Worth keeping. Seeing what it heard tells you instantly whether it misheard you ' +
            'or simply does not know that entity name.') +
          fBool('vcDefault', 'Listening switched on after a power cut', p.voice.defaultOn));
      }
    }

    els.voice.innerHTML = h;

    byId('vcMode').onchange = function () { PF.store.setGlobal('audio.mode', this.value); render('voice', true); };
    if (byId('vcPlayer')) {
      bindText('vcPlayer', function (v) { PF.store.setGlobal('voice.externalPlayer', v.trim()); });
      makeCombo('voice', byId('vcPlayer'), ['media_player'], function (id) {
        PF.store.setGlobal('voice.externalPlayer', id);
      });
    }
    if (byId('vcOn')) byId('vcOn').onchange = function () { PF.store.setGlobal('voice.enabled', this.checked); render('voice', true); };
    if (byId('vcWord')) byId('vcWord').onchange = function () { PF.store.setGlobal('voice.wakeWord', this.value); };
    if (byId('vcAll')) byId('vcAll').onchange = function () { PF.store.setGlobal('voice.extraWakeWords', this.checked); };
    if (byId('vcFollow')) byId('vcFollow').onchange = function () { PF.store.setGlobal('voice.followUp', this.checked); };
    if (byId('vcPage')) byId('vcPage').onchange = function () { PF.store.setGlobal('voice.showPage', this.checked); };
    if (byId('vcDefault')) byId('vcDefault').onchange = function () { PF.store.setGlobal('voice.defaultOn', this.checked); };
  }

  /* ---- helpers ------------------------------------------------------ */
  function byId(id) { return document.getElementById(id); }

  /* One undo entry per pause in typing, not per keystroke. Keyed so two
   * fields being edited in turn don't cancel each other. */
  var timers = {};
  function debounce(key, fn) {
    clearTimeout(timers[key]);
    timers[key] = setTimeout(fn, 260);
  }

  function bindText(id, fn) {
    byId(id).oninput = function () {
      var v = this.value;
      debounce(id, function () { fn(v); });
    };
  }
  function bindNum(id, fn) {
    byId(id).oninput = function () {
      var v = parseFloat(this.value);
      if (!isNaN(v)) fn(v);
    };
  }

  /* ------------------------------------------------------------------
   * The imported entity list is saved, for the same reason the project is.
   * It used to live only in memory, so every reload silently emptied it —
   * and the very act of picking up a new version of the tool is a reload.
   * The search then had nothing to search and looked broken.
   *
   * Its own key rather than part of the project: the list describes the
   * Home Assistant instance, not this panel, so it should still be there
   * after Start over, and it should be shared by every panel you design.
   * ------------------------------------------------------------------ */
  var LS_ENTITIES = 'panel-creator.entities.v1';

  function setEntities(list) {
    entityPool = list || [];
    try {
      localStorage.setItem(LS_ENTITIES, JSON.stringify(entityPool));
    } catch (e) { /* private mode, or a very large instance over quota */ }
    announce();
  }

  function restoreEntities() {
    try {
      var raw = localStorage.getItem(LS_ENTITIES);
      if (!raw) return;
      var list = JSON.parse(raw);
      if (Object.prototype.toString.call(list) === '[object Array]') entityPool = list;
    } catch (e) { /* corrupt or unreadable — start empty rather than throw */ }
    announce();
  }

  /* Put the count on the Import button, so "are my entities loaded?" is
   * answerable at a glance instead of by opening a dropdown and guessing. */
  function announce() {
    var b = document.getElementById('btnImport');
    if (!b) return;
    b.textContent = entityPool.length ? 'Import entities (' + entityPool.length + ')' : 'Import entities';
  }

  function entities() { return entityPool; }

  /* Turn a plain entity box into the searching one. The search panel lives on
   * <body> so the scrolling inspector cannot clip it, which means it outlives
   * the input that owns it and has to be destroyed by hand.
   *
   * Tagged with the tab it belongs to, and dropped ONLY when that tab is
   * genuinely being rebuilt. Dropping them all at the top of render() looked
   * equivalent and was not: render() skips a tab that has focus inside it, so
   * typing one character destroyed the panel and then skipped the rebuild
   * that would have put it back. The list appeared on focus and vanished on
   * the first keystroke, which is the opposite of the point. */
  var combos = [];
  function dropCombos(tab) {
    combos = combos.filter(function (c) {
      if (tab && c.tab !== tab) return true;
      c.ctl.destroy();
      return false;
    });
  }
  function makeCombo(tab, input, domains, onPick) {
    if (!input || !PF.entitypick) return;
    combos.push({
      tab: tab,
      ctl: PF.entitypick.attach(input, entities, onPick, { domains: function () { return domains || []; } })
    });
  }

  /* What the import managed to read about one entity, or null. */
  function capsFor(id) {
    for (var i = 0; i < entityPool.length; i++) {
      if (entityPool[i].id === id && entityPool[i].caps &&
          Object.keys(entityPool[i].caps).length) return entityPool[i].caps;
    }
    return null;
  }

  function mount() {
    els.card = byId('tabCard');
    els.panel = byId('tabPanel');
    els.voice = byId('tabVoice');
    /* restore, NOT setEntities([]) — that used to be here to build the old
     * datalist, and left as-is it would wipe the saved list on every boot */
    restoreEntities();
  }

  function render(which, force) {
    /* Re-rendering the tab under a focused input would eat the keystroke, so
     * leave that one alone and let its own handler keep the model in step.
     * `force` is for changes that alter which fields exist. */
    var active = document.activeElement;
    var inTab = !force && active && active.closest && active.closest('.tabbody');
    /* Drop a tab's search panels only when that tab is ACTUALLY rebuilt --
     * see dropCombos(). Doing it above these ifs destroyed panels the skipped
     * branches never recreated. */
    if (which === 'card' || !which) { if (!(inTab && inTab.id === 'tabCard')) { dropCombos('card'); renderCard(); } }
    if (which === 'panel' || !which) { if (!(inTab && inTab.id === 'tabPanel')) renderPanel(); }
    if (which === 'voice' || !which) { if (!(inTab && inTab.id === 'tabVoice')) { dropCombos('voice'); renderVoice(); } }
  }

  PF.inspector = { mount: mount, render: render, setEntities: setEntities,
                   entities: entities, capsFor: capsFor,
                   count: function () { return entityPool.length; } };
})(window.PF = window.PF || {});
