/* =====================================================================
 * store.js — the project, and everything that mutates it.
 *
 * One object holds the whole design. Every change goes through here so
 * undo, autosave and re-render all happen in one place instead of being
 * remembered at each call site.
 * ===================================================================== */
(function (PF) {
  'use strict';

  var LS_KEY = 'panel-creator.project.v1';
  var PANEL = {
    landscape: { w: 1280, h: 720 },
    portrait:  { w: 720,  h: 1280 }
  };
  var MARGIN = 30;   // page edge to first card, matches the reference panel
  var GUTTER = 16;

  var listeners = [];
  var undoStack = [];
  var redoStack = [];
  var seq = 1;

  /* THE PANEL SHOWS A CLOCK, so the timezone has to be right — and the only
   * thing that knows it is the browser. A hard-coded default geo-tags the
   * tool: every visitor who did not notice the field got the author's
   * timezone on their wall. Falls back to UTC, which is at least honest. */
  function browserTz() {
    try {
      var tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      /* ESPHome wants a tz database name; anything else is not one */
      return /^[A-Za-z]+\/[A-Za-z0-9_+\-\/]+$/.test(tz) ? tz : 'Etc/UTC';
    } catch (e) { return 'Etc/UTC'; }
  }

  function blank() {
    return {
      version: 1,
      device: {
        name: 'tab5-wall-panel',
        friendly: 'Wall Panel',
        timezone: browserTz(),
        rotation: 'landscape'
      },
      /* No ssid/password field, deliberately. This tool never asks for a
       * WiFi credential and has nowhere to put one: the generator always
       * writes `!secret wifi_ssid` / `!secret wifi_password`, which the
       * user's own secrets.yaml resolves on their machine. The fields used
       * to exist here, empty and unreachable — a loaded gun for a later
       * edit that adds an input "because the field is already there". */
      wifi: { apFallback: true },
      api:  { encryption: true },
      ota:  { password: '' },
      /* Has this panel been flashed before? It decides the install steps and
       * whether a fresh API key is offered — regenerating one on an existing
       * device rekeys every panel sharing that secret and drops Home
       * Assistant's connection. Kept on the project because it is a fact
       * about THIS panel, so it does not have to be re-picked every export. */
      deploy: { mode: 'new' },              // new | update
      /* Two facts about the physical Tab5 that ESPHome cannot work out at
       * build time, and both look like a dead board when wrong.
       * chip: 'production' (ESP32-P4 rev 3+) | 'early' (rev 1.x engineering
       *   sample). From ESPHome 2026.8 a P4 build assumes rev 3 unless told,
       *   and an early chip then boot-loops with "Illegal instruction".
       * display: 'ST7123' | 'ST7121'. Both ship as "V2" with the same touch
       *   address and no way to tell from the label; the wrong one leaves the
       *   backlight on and the screen black. The firmware's boot self-check
       *   reports which one the board really has. */
      board: { chip: 'production', display: 'ST7123' },
      /* style: 'rounded' = 26 px corners, 'square' = 0.
       *
       * Not just taste. A card with a radius AND children needs clip_corner,
       * and LVGL's clip_corner path (lv_refr.c:186) allocates an off-screen
       * ARGB8888 layer for the top corner strip, redraws EVERY child into it,
       * masks it, blits it — then does the same again for the bottom strip.
       * Two allocations and two extra full child redraws, every time the card
       * repaints, on a chip with no GPU. LVGL short-circuits the whole thing
       * when the radius is 0 (`if(radius == 0) clip_corner = false`), so
       * square corners make it cost nothing. */
      theme: { id: 'ember', style: 'rounded' },
      fonts: { family: 'roboto' },
      screen:{ dimAfter: 45, offAfter: 120, dimLevel: 15, alwaysOnSwitch: true, gamma: 1.8 },
      /* The Tab5's onboard INA226. Off by default: it is three more entities
       * on a device page that is already busy, and most panels do not care
       * what they draw. Worth switching on when you do. */
      power: { monitor: false },
      audio: { mode: 'none' },              // none | panel | external
      voice: {
        enabled: false,
        wakeWord: 'okay_nabu',
        extraWakeWords: false,
        externalPlayer: '',                 // media_player.x when audio.mode = external
        /* OFF by default on purpose. Everything else on this tab is stock
         * ESPHome behaviour; the follow-up chain is ours — a globals counter,
         * a turn_had_speech flag and a script that re-arms the mic after the
         * reply. It works, but it is the one thing here with no upstream to
         * match, so the default is what a plain voice_assistant panel does. */
        followUp: false,
        defaultOn: true,
        showPage: true
      },
      cards: [],
      selected: null,
      /* which screen the EDITOR is showing: null = the home page, or the id
       * of a card whose detail page is being previewed. View state, not
       * design — stripped on export like `selected`. */
      viewPage: null
    };
  }

  var project = blank();

  /* ---------------------------------------------------------------- */
  function on(fn) { listeners.push(fn); }
  function emit(reason) {
    for (var i = 0; i < listeners.length; i++) listeners[i](project, reason);
  }

  function snapshot() {
    return JSON.stringify(project);
  }

  function pushUndo() {
    undoStack.push(snapshot());
    if (undoStack.length > 80) undoStack.shift();
    redoStack.length = 0;
  }

  function undo() {
    if (!undoStack.length) return;
    redoStack.push(snapshot());
    project = JSON.parse(undoStack.pop());
    persist();
    emit('undo');
  }

  function redo() {
    if (!redoStack.length) return;
    undoStack.push(snapshot());
    project = JSON.parse(redoStack.pop());
    persist();
    emit('redo');
  }

  function persist() {
    try { localStorage.setItem(LS_KEY, snapshot()); } catch (e) { /* private mode */ }
  }

  function restore() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (!raw) return false;
      var p = JSON.parse(raw);
      if (!p || !p.cards) return false;
      project = migrate(p);
      reseed();
      return true;
    } catch (e) { return false; }
  }

  /* Fill in anything a newer version added, so an old saved project still
   * opens instead of throwing on a missing key. */
  function migrate(p) {
    var base = blank();
    var out = Object.assign({}, base, p);
    ['device', 'wifi', 'api', 'ota', 'deploy', 'board', 'theme', 'fonts', 'screen', 'power', 'audio', 'voice'].forEach(function (k) {
      out[k] = Object.assign({}, base[k], p[k] || {});
    });
    /* projects saved while the one-file output existed carry an `output` key.
     * Two files is the only mode now, so drop it rather than let a stale
     * `mode: single` sit in the file confusing anyone who opens it. */
    delete out.output;
    out.cards = (p.cards || []).map(function (c) {
      var t = PF.catalog.types[c.type];
      if (!t) return null;
      return {
        id: c.id, type: c.type, title: c.title || '', entity: c.entity || '',
        x: c.x | 0, y: c.y | 0, w: c.w | 0, h: c.h | 0,
        opts: Object.assign({}, t.defaults, c.opts || {})
      };
    }).filter(Boolean);
    return out;
  }

  function reseed() {
    var max = 0;
    project.cards.forEach(function (c) {
      var n = parseInt(String(c.id).replace(/\D/g, ''), 10);
      if (n > max) max = n;
    });
    seq = max + 1;
  }

  /* ---------------------------------------------------------------- */
  function panelSize() {
    return PANEL[project.device.rotation] || PANEL.landscape;
  }

  function theme() {
    return PF.theme.byId(project.theme.id);
  }

  /* Card corner radius, and the reason clip_corner can be switched off. */
  function cardRadius() {
    return project.theme.style === 'square' ? 0 : 26;
  }

  /* Colour for a card field: the card's own override, else the theme's. */
  function colorOf(card, key, themeKey) {
    var v = card.opts ? card.opts[key] : null;
    if (v !== null && v !== undefined && v !== '') return typeof v === 'number' ? v : PF.theme.parseCss(v);
    return theme()[themeKey];
  }

  function byId(id) {
    for (var i = 0; i < project.cards.length; i++) if (project.cards[i].id === id) return project.cards[i];
    return null;
  }

  function selected() { return byId(project.selected); }

  function showPage(id) {
    if (project.viewPage === id) return;
    project.viewPage = id || null;
    emit('page');
  }

  /* ---------------------------------------------------------------- */
  function overlaps(a, b) {
    return !(a.x + a.w + GUTTER <= b.x || b.x + b.w + GUTTER <= a.x ||
             a.y + a.h + GUTTER <= b.y || b.y + b.h + GUTTER <= a.y);
  }

  /* Drop a new card in the first gap that fits, scanning in reading order.
   * Beats stacking everything at 30,30 and making the user untangle it. */
  function findSpot(w, h) {
    var P = panelSize();
    var step = 10;
    for (var y = MARGIN; y + h <= P.h - MARGIN; y += step) {
      for (var x = MARGIN; x + w <= P.w - MARGIN; x += step) {
        var box = { x: x, y: y, w: w, h: h };
        var clash = false;
        for (var i = 0; i < project.cards.length; i++) {
          if (overlaps(box, project.cards[i])) { clash = true; break; }
        }
        if (!clash) return { x: x, y: y };
      }
    }
    var n = project.cards.length;
    return { x: MARGIN + (n % 6) * 18, y: MARGIN + (n % 6) * 18 };
  }

  function addCard(type, patch) {
    var t = PF.catalog.types[type];
    if (!t) return null;
    pushUndo();
    var P = panelSize();
    var w = Math.min(t.size.w, P.w - MARGIN * 2);
    var h = Math.min(t.size.h, P.h - MARGIN * 2);
    var at = findSpot(w, h);
    var card = {
      id: 'c' + (seq++),
      type: type,
      title: (patch && patch.title) || defaultTitle(type),
      entity: (patch && patch.entity) || '',
      x: at.x, y: at.y, w: w, h: h,
      opts: Object.assign({}, t.defaults, (patch && patch.opts) || {})
    };
    project.cards.push(card);
    project.selected = card.id;
    persist();
    emit('add');
    return card;
  }

  function defaultTitle(type) {
    var t = PF.catalog.types[type];
    var f = (t.fields || [])[0];
    if (f && f.placeholder) return f.placeholder;
    return t.name.toUpperCase();
  }

  function updateCard(id, patch, opts) {
    var c = byId(id);
    if (!c) return;
    if (!(opts && opts.quiet)) pushUndo();
    Object.keys(patch).forEach(function (k) {
      if (k === 'opts') Object.assign(c.opts, patch.opts);
      else c[k] = patch[k];
    });
    clamp(c);
    persist();
    emit(opts && opts.reason ? opts.reason : 'update');
  }

  /* Live drag/resize: no undo entry per pointer move, one at the end. */
  function beginGesture() { pushUndo(); }
  function gestureUpdate(id, patch) {
    var c = byId(id);
    if (!c) return;
    Object.assign(c, patch);
    clamp(c);
    emit('gesture');
  }
  function endGesture() { persist(); emit('update'); }

  function clamp(c) {
    var P = panelSize();
    var t = PF.catalog.types[c.type];
    c.w = Math.max(t.min.w, Math.min(c.w, P.w));
    c.h = Math.max(t.min.h, Math.min(c.h, P.h));
    c.x = Math.max(0, Math.min(c.x, P.w - c.w));
    c.y = Math.max(0, Math.min(c.y, P.h - c.h));
  }

  function removeCard(id) {
    pushUndo();
    project.cards = project.cards.filter(function (c) { return c.id !== id; });
    if (project.selected === id) project.selected = null;
    persist();
    emit('remove');
  }

  function duplicateCard(id) {
    var c = byId(id);
    if (!c) return;
    pushUndo();
    var copy = JSON.parse(JSON.stringify(c));
    copy.id = 'c' + (seq++);
    var at = findSpot(copy.w, copy.h);
    copy.x = at.x; copy.y = at.y;
    project.cards.push(copy);
    project.selected = copy.id;
    persist();
    emit('add');
  }

  function raise(id, dir) {
    var i = project.cards.findIndex(function (c) { return c.id === id; });
    if (i < 0) return;
    var j = dir > 0 ? i + 1 : i - 1;
    if (j < 0 || j >= project.cards.length) return;
    pushUndo();
    var tmp = project.cards[i];
    project.cards[i] = project.cards[j];
    project.cards[j] = tmp;
    persist();
    emit('order');
  }

  function select(id) {
    if (project.selected === id) return;
    project.selected = id;
    emit('select');
  }

  function setGlobal(path, value) {
    pushUndo();
    var parts = path.split('.');
    var node = project;
    for (var i = 0; i < parts.length - 1; i++) node = node[parts[i]];
    node[parts[parts.length - 1]] = value;
    if (path === 'device.rotation') project.cards.forEach(clamp);
    persist();
    emit('global');
  }

  function replace(p) {
    pushUndo();
    project = migrate(p);
    reseed();
    persist();
    emit('replace');
  }

  function reset() {
    pushUndo();
    project = blank();
    seq = 1;
    persist();
    emit('replace');
  }

  /* ---------------------------------------------------------------- */
  /* A short, stable, C-identifier-safe name per card. It ends up in every
   * generated widget id, so it has to be unique and it has to not start
   * with a digit. */
  function keys() {
    var used = {};
    var map = {};
    project.cards.forEach(function (c) {
      var base = (c.entity ? c.entity.split('.').pop() : '') || c.title || c.type;
      base = String(base).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      if (!base || /^[0-9]/.test(base)) base = c.type + '_' + base;
      base = base.slice(0, 22).replace(/_+$/, '');
      var k = base, n = 2;
      while (used[k]) { k = base + '_' + (n++); }
      used[k] = true;
      map[c.id] = k;
    });
    return map;
  }

  /* Everything the user should see before hitting Generate. */
  function issues() {
    var out = [];
    var P = panelSize();
    var TM = PF.catalog.TOUCH_MIN;
    var seen = {};

    if (!/^[a-z0-9-]+$/.test(project.device.name)) {
      out.push({ kind: 'name', one: 'the device name is not valid', level: 'error', text: 'Device name must be lower case letters, digits and dashes only — ESPHome uses it as the hostname.' });
    }
    if (project.audio.mode === 'external' && !/^media_player\./.test(project.voice.externalPlayer || '')) {
      out.push({ kind: 'speaker', one: 'no external speaker chosen', level: 'error', text: 'Pick the media_player entity that should speak the replies.' });
    }
    if (project.voice.enabled && project.audio.mode === 'none') {
      out.push({ kind: 'audio', one: 'voice has no audio', level: 'error', text: 'Voice needs the audio stack. Choose a panel or external speaker.' });
    }
    if (!project.cards.length) {
      out.push({ kind: 'empty', one: 'the panel is empty', level: 'warn', text: 'The panel is empty. Add a card from the left.' });
    }

    project.cards.forEach(function (c) {
      var t = PF.catalog.types[c.type];
      var who = c.title || t.name;
      if (t.needsEntity && !c.entity) {
        out.push({ kind: 'noent', one: 'card with no entity', many: 'cards with no entity', level: 'error', card: c.id, text: who + ': no entity set.' });
      } else if (t.needsEntity && !/^[a-z_]+\.[a-z0-9_]+$/.test(c.entity)) {
        out.push({ kind: 'badent', one: 'invalid entity id', many: 'invalid entity ids', level: 'error', card: c.id, text: who + ': "' + c.entity + '" is not a valid entity id.' });
      } else if (t.needsEntity && t.domains.length && t.domains.indexOf(c.entity.split('.')[0]) < 0) {
        out.push({ kind: 'domain', one: 'entity in an unexpected domain', many: 'entities in unexpected domains', level: 'warn', card: c.id, text: who + ': a ' + t.name + ' card normally takes ' + t.domains.slice(0, 3).join(' / ') + ', not ' + c.entity.split('.')[0] + '.' });
      }
      if (t.needsEntity && c.entity) {
        if (seen[c.entity + '|' + c.type]) {
          out.push({ kind: 'dup', one: 'entity used twice', many: 'entities used twice', level: 'warn', card: c.id, text: who + ': ' + c.entity + ' is already on another ' + t.name + ' card.' });
        }
        seen[c.entity + '|' + c.type] = true;
      }
      if (c.x < 0 || c.y < 0 || c.x + c.w > P.w || c.y + c.h > P.h) {
        out.push({ kind: 'offscreen', one: 'card off the screen', many: 'cards off the screen', level: 'error', card: c.id, text: who + ' hangs off the edge of the screen.' });
      }
      /* touch targets — read from the real split, so what is flagged is what
       * gets drawn rather than what was asked for */
      if (c.type === 'light' || c.type === 'fan') {
        var s = PF.layout.split(c);
        if (s.strip) {
          var thin = Math.min(s.strip.w, s.strip.h);
          if (thin < TM) out.push({ kind: 'touch', one: 'target under 8 mm', many: 'targets under 8 mm', level: 'warn', card: c.id, text: who + ': the toggle strip comes out at ' + thin + ' px — under the ' + TM + ' px finger target.' });
          if (s.strip.w < (c.opts.powerSize || 152) && c.opts.power === 'right') {
            out.push({ kind: 'trim', one: 'trimmed toggle strip', many: 'trimmed toggle strips', level: 'warn', card: c.id, text: who + ': the strip was trimmed to ' + s.strip.w + ' px so the card still has a face.' });
          }
        }
        if (s.body.w < TM * 2) out.push({ kind: 'cramped', one: 'cramped card', many: 'cramped cards', level: 'warn', card: c.id, text: who + ': only ' + s.body.w + ' px left for the ' + (c.type === 'fan' ? 'dial' : 'slider') + '.' });
        if (s.body.h < 110) out.push({ kind: 'cramped', one: 'cramped card', many: 'cramped cards', level: 'warn', card: c.id, text: who + ': ' + s.body.h + ' px of height for the label and the value — they will crowd.' });
      }
      if ((c.type === 'toggle' || c.type === 'button') && (c.w < TM || c.h < TM)) {
        out.push({ kind: 'touch', one: 'target under 8 mm', many: 'targets under 8 mm', level: 'warn', card: c.id, text: who + ' is smaller than an 8 mm finger target (' + TM + ' px).' });
      }
      /* An MDI name that is not in the picker can only get here through a
       * hand-edited project file, and it would fail at BUILD time with a 404
       * from GitHub — long after the download, on someone else's machine. */
      var mdi = PF.catalog.mdiName(c.opts && c.opts.symbol);
      if (mdi && PF.mdi && !PF.mdi.has(mdi)) {
        out.push({ kind: 'icon', one: 'unknown icon', many: 'unknown icons', level: 'error', card: c.id,
          text: who + ': "mdi:' + mdi + '" is not one of the icons this tool knows, so it cannot be previewed and may not exist upstream.' });
      }
      /* A media card stacks a label, a track name, an artist, a row of
       * buttons and a volume slider. Everything below the text is a fixed
       * height, so a short card takes it all out of the track name — which is
       * the one thing on the card you read from across the room. Name the
       * cause, because "make it taller" is not the only fix. */
      if (c.type === 'media') {
        var ml = PF.layout.of(c);
        if (ml.value.px < 22) {
          var offer = [];
          if (c.opts.showArtist) offer.push('the artist');
          if (c.opts.showVolume) offer.push('the volume slider');
          out.push({ kind: 'cramped', one: 'cramped card', many: 'cramped cards', level: 'warn', card: c.id,
            text: who + ': the track name comes out at ' + ml.value.px + ' px. Make the card taller' +
                  (offer.length ? ', or turn off ' + offer.join(' or ') : '') + '.' });
        }
      }
      if (c.type === 'cover') {
        var btn = c.opts.layout === 'row' ? Math.floor((c.w - 44 - 24) / 3) : Math.floor((c.h - 60 - (c.opts.showPosition ? 60 : 0) - 24) / 3);
        if (btn < TM) out.push({ kind: 'touch', one: 'target under 8 mm', many: 'targets under 8 mm', level: 'warn', card: c.id, text: who + ': cover buttons come out at ' + btn + ' px — under the ' + TM + ' px finger target.' });
      }
    });

    /* overlap check — LVGL will happily draw one card on top of another */
    for (var i = 0; i < project.cards.length; i++) {
      for (var j = i + 1; j < project.cards.length; j++) {
        var a = project.cards[i], b = project.cards[j];
        if (!(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y)) {
          out.push({ kind: 'overlap', one: 'overlapping card', many: 'overlapping cards', level: 'warn', card: b.id, text: (b.title || b.type) + ' overlaps ' + (a.title || a.type) + '.' });
        }
      }
    }
    return out;
  }

  PF.store = {
    PANEL: PANEL, MARGIN: MARGIN, GUTTER: GUTTER,
    get: function () { return project; },
    on: on, emit: emit,
    panelSize: panelSize, theme: theme, cardRadius: cardRadius, colorOf: colorOf,
    byId: byId, selected: selected, select: select, showPage: showPage,
    addCard: addCard, updateCard: updateCard, removeCard: removeCard,
    duplicateCard: duplicateCard, raise: raise,
    beginGesture: beginGesture, gestureUpdate: gestureUpdate, endGesture: endGesture,
    setGlobal: setGlobal, replace: replace, reset: reset,
    undo: undo, redo: redo, restore: restore, persist: persist,
    keys: keys, issues: issues, blank: blank
  };
})(window.PF = window.PF || {});
