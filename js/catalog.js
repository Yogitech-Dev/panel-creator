/* =====================================================================
 * catalog.js — what a card can be.
 *
 * One entry per card type. Each says how big it starts, how small it may
 * get before a finger can't hit it, which Home Assistant domain it expects,
 * and what the inspector should offer. Rendering lives in canvas.js and the
 * YAML in gen-yaml.js; keeping them apart means adding a card type is three
 * small edits rather than one big one.
 *
 * SIZE UNITS ARE PANEL PIXELS. The Tab5 is 1280x720 at 11.6 px/mm, so a
 * comfortable 8 mm finger target is about 95 px — which is where the minimum
 * sizes below come from, not from taste.
 * ===================================================================== */
(function (PF) {
  'use strict';

  /* 8 mm of finger. Anything tappable narrower than this gets flagged. */
  var TOUCH_MIN = 88;

  /* The LVGL symbols that are built into the montserrat fonts ESPHome ships.
   * Anything outside this list needs an image, and images are the standing
   * crash suspect on this board — so the picker is deliberately closed. */
  var SYMBOLS = [
    { id: 'none',    ch: '',       name: 'None' },
    { id: 'power',   ch: '', name: 'Power' },
    { id: 'home',    ch: '', name: 'Home' },
    { id: 'settings',ch: '', name: 'Settings' },
    { id: 'left',    ch: '', name: 'Left' },
    { id: 'right',   ch: '', name: 'Right' },
    { id: 'up',      ch: '', name: 'Up' },
    { id: 'down',    ch: '', name: 'Down' },
    { id: 'plus',    ch: '', name: 'Plus' },
    { id: 'minus',   ch: '', name: 'Minus' },
    { id: 'ok',      ch: '', name: 'Tick' },
    { id: 'close',   ch: '', name: 'Cross' },
    { id: 'stop',    ch: '', name: 'Stop' },
    { id: 'play',    ch: '', name: 'Play' },
    { id: 'pause',   ch: '', name: 'Pause' },
    { id: 'refresh', ch: '', name: 'Refresh' },
    { id: 'bell',    ch: '', name: 'Bell' },
    { id: 'warning', ch: '', name: 'Warning' },
    { id: 'tint',    ch: '', name: 'Droplet' },
    { id: 'charge',  ch: '', name: 'Bolt' },
    { id: 'wifi',    ch: '', name: 'WiFi' },
    { id: 'audio',   ch: '', name: 'Note' },
    { id: 'volume',  ch: '', name: 'Volume' },
    { id: 'mute',    ch: '', name: 'Mute' },
    { id: 'list',    ch: '', name: 'List' },
    { id: 'eye',     ch: '', name: 'Eye' },
    { id: 'gps',     ch: '', name: 'Pin' },
    { id: 'battery', ch: '', name: 'Battery' }
  ];

  /* ------------------------------------------------------------------
   * A symbol is one of two quite different things, and the whole of the
   * rest of the tool has to know which:
   *
   *   'power'      a glyph in a montserrat font. Costs nothing, ships
   *                nothing, and the choice is limited to the ~28 above.
   *   'mdi:fan'    a Material Design icon. ESPHome downloads the real SVG
   *                at build time (components/file/image.py -> MDI_SOURCES)
   *                and rasterises it, so again nothing ships in the zip —
   *                but it IS an image widget rather than a label, and it
   *                costs flash.
   *
   * Keeping both in one string field means a card's `symbol` option did not
   * have to change shape, and an older saved project still opens.
   * ------------------------------------------------------------------ */
  function isMdi(id) { return typeof id === 'string' && id.slice(0, 4) === 'mdi:'; }
  function mdiName(id) { return isMdi(id) ? id.slice(4) : ''; }

  function symbol(id) {
    if (isMdi(id)) return { id: id, ch: '', name: mdiName(id), mdi: mdiName(id) };
    for (var i = 0; i < SYMBOLS.length; i++) if (SYMBOLS[i].id === id) return SYMBOLS[i];
    return SYMBOLS[0];
  }

  /* Image sizes are snapped to a ladder for the same reason font sizes are:
   * every distinct size is its own compiled asset, so two cards asking for
   * 61 px and 64 px would otherwise cost two copies of the same icon. */
  var MDI_STEP = 8, MDI_MIN = 16, MDI_MAX = 128;
  function mdiPx(want) {
    var px = Math.round(want / MDI_STEP) * MDI_STEP;
    return Math.max(MDI_MIN, Math.min(MDI_MAX, px));
  }
  /* GRAYSCALE is one byte per pixel — see ImageEncoder in components/image. */
  function mdiBytes(px) { return px * px; }

  /* Font steps. 'auto' scales with the card; the rest are fixed so a row of
   * cards can be made to agree. */
  var SIZES = [
    { id: 'default', name: 'Default' },
    { id: 'fit',     name: 'Fill the space' },
    { id: 'sm',      name: 'Small' },
    { id: 'md',      name: 'Medium' },
    { id: 'lg',      name: 'Large' },
    { id: 'xl',      name: 'Huge' },
    { id: 'custom',  name: 'Exact size…' }
  ];

  /* ------------------------------------------------------------------
   * TEXT SLOTS — every piece of text a card draws, so all of them can be
   * sized, not just the headline value.
   *
   * Stored FLAT on opts as sz_<slot> / szpx_<slot> rather than a nested
   * object, because migrate() merges opts with Object.assign: a nested map
   * from an older save would replace the defaults wholesale and any slot
   * added later would come back undefined.
   *
   * 'default' means "whatever this slot has always been", so an existing
   * panel looks identical until someone changes something.
   *
   * kind decides the glyph set the generator emits: 'num' fonts carry digits
   * only and stay cheap at any size, 'ui' fonts carry the lot.
   * ------------------------------------------------------------------ */
  var SLOTS = {
    light:       [['title', 'Label', 'ui'], ['value', 'Percentage', 'num'], ['symbol', 'Toggle symbol', 'sym']],
    toggle:      [['title', 'Label', 'ui'], ['value', 'On / off text', 'ui'], ['symbol', 'Symbol', 'sym']],
    fan:         [['title', 'Label', 'ui'], ['value', 'Percentage', 'num'], ['symbol', 'Toggle symbol', 'sym']],
    sensor:      [['title', 'Label', 'ui'], ['value', 'Value', 'num']],
    gauge:       [['title', 'Label', 'ui'], ['value', 'Value', 'num']],
    text_sensor: [['title', 'Label', 'ui'], ['value', 'State', 'ui']],
    cover:       [['title', 'Label', 'ui'], ['value', 'Position', 'num'], ['symbol', 'Arrows', 'sym']],
    climate:     [['title', 'Label', 'ui'], ['value', 'Setpoint', 'num'], ['current', 'Current temp', 'num'],
                  ['mode', 'Mode', 'ui'], ['symbol', 'Plus / minus', 'sym']],
    button:      [['value', 'Label', 'ui'], ['symbol', 'Symbol', 'sym']],
    media:       [['title', 'Label', 'ui'], ['value', 'Track title', 'ui'],
                  ['artist', 'Artist', 'ui'], ['symbol', 'Transport buttons', 'sym']],
    clock:       [['title', 'Label', 'ui'], ['value', 'Time', 'num'], ['date', 'Date', 'ui']],
    text:        [['value', 'Text', 'ui']]
  };

  function slots(type) { return SLOTS[type] || []; }

  /* Where a piece of text sits in the room the layout gave it. 'default' is
   * whatever that element has always done, so an existing panel does not
   * move until someone chooses otherwise. */
  var ALIGN_H = [
    { id: 'default', name: 'Default' },
    { id: 'left',    name: 'Left' },
    { id: 'center',  name: 'Centre' },
    { id: 'right',   name: 'Right' }
  ];
  var ALIGN_V = [
    { id: 'default', name: 'Default' },
    { id: 'top',     name: 'Top' },
    { id: 'middle',  name: 'Middle' },
    { id: 'bottom',  name: 'Bottom' }
  ];

  /* The size fields for a type, appended to its own field list. */
  function sizeFields(type) {
    var out = [];
    slots(type).forEach(function (sl) {
      out.push({ key: 'sz_' + sl[0], label: sl[1], type: 'select', options: SIZES, group: 'sizes' });
      out.push({ key: 'szpx_' + sl[0], label: sl[1] + ' (px)', type: 'number',
                 min: 8, max: 400, step: 2, group: 'sizes', when: 'sz_' + sl[0] + '==custom' });
      out.push({ key: 'al_' + sl[0], label: sl[1] + ' ↔', type: 'select',
                 options: ALIGN_H, group: 'sizes' });
      /* only the headline value moves vertically: it is the one element with
       * slack around it, and the rest are stacked against each other */
      if (sl[0] === 'value') {
        out.push({ key: 'av_' + sl[0], label: sl[1] + ' ↕', type: 'select',
                   options: ALIGN_V, group: 'sizes' });
      }
    });
    return out;
  }

  function sizeDefaults(type) {
    var d = {};
    slots(type).forEach(function (sl) {
      d['sz_' + sl[0]] = 'default';
      d['szpx_' + sl[0]] = sl[2] === 'sym' ? 40 : 48;
      d['al_' + sl[0]] = 'default';
      if (sl[0] === 'value') d['av_' + sl[0]] = 'default';
    });
    return d;
  }

  var POWER_POS = [
    { id: 'right',  name: 'Right edge' },
    { id: 'left',   name: 'Left edge' },
    { id: 'bottom', name: 'Bottom edge' },
    { id: 'top',    name: 'Top edge' },
    { id: 'none',   name: 'No toggle strip' }
  ];

  /* LVGL's bar/slider defaults to LV_BAR_ORIENTATION_AUTO, which is
   * `horizontal = width >= height` — so a tall tile fills UPWARDS on its own.
   * The other two force it, via lv_slider_set_orientation() at boot, because
   * ESPHome's slider schema has no key for it. */
  var FILL_DIR = [
    { id: 'auto',       name: 'Follow the card shape' },
    { id: 'horizontal', name: 'Left to right' },
    { id: 'vertical',   name: 'Bottom to top' }
  ];

  var TYPES = {

    /* ---------------------------------------------------------------- */
    light: {
      name: 'Light',
      short: 'Brightness tile',
      blurb: 'The whole card is the brightness slider. Corner strip toggles, hold it to open the detail page.',
      domains: ['light'],
      size: { w: 340, h: 330 },
      min:  { w: 200, h: 160 },
      needsEntity: true,
      fields: [
        { key: 'title',      label: 'Label',           type: 'text',   placeholder: 'NIGHTSTAND' },
        { key: 'dimmable',   label: 'Has brightness',  type: 'bool',
          hint: 'Off makes it a plain on/off tile with no slider.' },
        { key: 'fill',       label: 'Fill direction',  type: 'select', options: FILL_DIR, when: 'dimmable',
          hint: 'A tile taller than it is wide fills upwards on its own — that is LVGL\'s default. Pick one to override it.' },
        { key: 'colorTemp',  label: 'Has colour temperature', type: 'bool', when: 'dimmable',
          hint: 'Tints the fill to the real Kelvin value and adds a second slider on the detail page. Needs brightness — the tint recolours the slider.' },
        { key: 'kMin',       label: 'Warmest (K)',     type: 'number', min: 1500, max: 8000, step: 1, when: 'colorTemp' },
        { key: 'kMax',       label: 'Coolest (K)',     type: 'number', min: 1500, max: 8000, step: 1, when: 'colorTemp',
          hint: 'Read these off your bulb: Developer Tools > States > min_color_temp_kelvin / max_color_temp_kelvin.' },
        { key: 'detailPage', label: 'Hold opens a detail page', type: 'bool', when: 'dimmable' },
        { key: 'power',      label: 'Toggle strip',    type: 'select', options: POWER_POS },
        { key: 'powerSize',  label: 'Strip thickness', type: 'number', min: TOUCH_MIN, max: 260, step: 2, when: 'powerNotNone' },
        { key: 'accent',     label: 'Fill colour',     type: 'color',  themeKey: 'accent',
          hint: 'Ignored when colour temperature is on — the fill then follows the real Kelvin value.' }
      ],
      defaults: {
        dimmable: true, fill: 'auto', colorTemp: false, kMin: 2202, kMax: 6535,
        detailPage: true, power: 'right', powerSize: 152, accent: null
      }
    },

    /* ---------------------------------------------------------------- */
    toggle: {
      name: 'Toggle',
      short: 'On / off button',
      blurb: 'One big button for anything that is on or off. Changes colour with the real state.',
      domains: ['switch', 'light', 'input_boolean', 'fan', 'automation', 'siren', 'humidifier'],
      size: { w: 300, h: 220 },
      min:  { w: TOUCH_MIN, h: TOUCH_MIN },
      needsEntity: true,
      fields: [
        { key: 'title',    label: 'Label',       type: 'text', placeholder: 'KETTLE' },
        { key: 'symbol',   label: 'Symbol',      type: 'symbol' },
        { key: 'showState',label: 'Show ON / OFF text', type: 'bool' },
        { key: 'onText',   label: 'On word',     type: 'text', when: 'showState', placeholder: 'ON' },
        { key: 'offText',  label: 'Off word',    type: 'text', when: 'showState', placeholder: 'OFF' },
        { key: 'onColor',  label: 'On colour',   type: 'color', themeKey: 'accent' },
        { key: 'offColor', label: 'Off colour',  type: 'color', themeKey: 'strip' }
      ],
      defaults: {
        symbol: 'power', showState: true, onText: 'ON', offText: 'OFF',
        onColor: null, offColor: null
      }
    },

    /* ---------------------------------------------------------------- */
    fan: {
      name: 'Fan',
      short: 'Speed dial',
      blurb: 'Speed arc you can drag, live percentage, and a toggle strip.',
      domains: ['fan'],
      size: { w: 420, h: 440 },
      min:  { w: 240, h: 260 },
      needsEntity: true,
      fields: [
        { key: 'title',     label: 'Label',        type: 'text', placeholder: 'CEILING FAN' },
        { key: 'arc',       label: 'Speed arc',    type: 'bool',
          hint: 'Off leaves just the percentage and the toggle — right for a fan with no speed control.' },
        { key: 'blades',    label: 'Spinning blades', type: 'bool',
          hint: 'A 12-frame sprite that speeds up with the fan. Ships in the download; costs about 140 kB of flash.' },
        { key: 'power',     label: 'Toggle strip', type: 'select', options: POWER_POS },
        { key: 'powerSize', label: 'Strip thickness', type: 'number', min: TOUCH_MIN, max: 260, step: 2, when: 'powerNotNone' },
        { key: 'accent',    label: 'Arc colour',   type: 'color', themeKey: 'accent2' }
      ],
      defaults: { arc: true, blades: true, power: 'right', powerSize: 152, accent: null }
    },

    /* ---------------------------------------------------------------- */
    sensor: {
      name: 'Sensor',
      short: 'One big number',
      blurb: 'One number, read from across the room. Temperature, humidity, power, anything numeric.',
      domains: ['sensor', 'number', 'input_number'],
      size: { w: 252, h: 210 },
      min:  { w: 120, h: 90 },
      needsEntity: true,
      fields: [
        { key: 'title',     label: 'Label',      type: 'text', placeholder: 'TEMPERATURE' },
        { key: 'attribute', label: 'Attribute',  type: 'text', placeholder: '(the state itself)',
          hint: 'Leave empty for the entity state. Fill it in to read an attribute instead, e.g. current_temperature.' },
        { key: 'decimals',  label: 'Decimals',   type: 'number', min: 0, max: 3, step: 1 },
        { key: 'unit',      label: 'Unit shown', type: 'text', placeholder: '°' },
        { key: 'color',     label: 'Number colour', type: 'color', themeKey: 'ink' }
      ],
      defaults: { attribute: '', decimals: 1, unit: '°', color: null }
    },

    /* ---------------------------------------------------------------- */
    text_sensor: {
      name: 'Text sensor',
      short: 'State in words',
      blurb: 'For states that are words, not numbers — door open/closed, washing machine running, who is home.',
      domains: ['binary_sensor', 'sensor', 'person', 'device_tracker', 'input_select', 'select'],
      size: { w: 252, h: 180 },
      min:  { w: 120, h: 90 },
      needsEntity: true,
      fields: [
        { key: 'title',     label: 'Label',      type: 'text', placeholder: 'FRONT DOOR' },
        { key: 'attribute', label: 'Attribute',  type: 'text', placeholder: '(the state itself)' },
        { key: 'upper',     label: 'Force upper case', type: 'bool' },
        { key: 'color',     label: 'Text colour',type: 'color', themeKey: 'ink' }
      ],
      defaults: { attribute: '', upper: true, color: null }
    },

    /* ---------------------------------------------------------------- */
    cover: {
      name: 'Cover',
      short: 'Up / stop / down',
      blurb: 'Up, stop, down for blinds, curtains, a garage door or a skylight.',
      domains: ['cover'],
      size: { w: 300, h: 430 },
      min:  { w: 140, h: 300 },
      needsEntity: true,
      fields: [
        { key: 'title',        label: 'Label',        type: 'text', placeholder: 'BLINDS' },
        { key: 'layout',       label: 'Buttons',      type: 'select',
          options: [{ id: 'column', name: 'Stacked' }, { id: 'row', name: 'In a row' }] },
        { key: 'showPosition', label: 'Show position %', type: 'bool' },
        { key: 'accent',       label: 'Button colour', type: 'color', themeKey: 'strip' }
      ],
      defaults: { layout: 'column', showPosition: true, accent: null }
    },

    /* ---------------------------------------------------------------- */
    button: {
      name: 'Action button',
      short: 'Runs a scene',
      blurb: 'Fires a scene, a script, or any service call. No state, just a press.',
      domains: ['scene', 'script', 'button', 'input_button', 'automation'],
      size: { w: 300, h: 160 },
      min:  { w: TOUCH_MIN, h: TOUCH_MIN },
      needsEntity: true,
      fields: [
        { key: 'title',   label: 'Label',   type: 'text', placeholder: 'GOODNIGHT' },
        { key: 'action',  label: 'Service', type: 'text', placeholder: 'scene.turn_on',
          hint: 'Left empty it is guessed from the entity: scene.turn_on, script.turn_on, button.press.' },
        { key: 'symbol',  label: 'Symbol',  type: 'symbol' },
        { key: 'color',   label: 'Colour',  type: 'color', themeKey: 'strip' }
      ],
      defaults: { action: '', symbol: 'none', color: null }
    },

    /* ---------------------------------------------------------------- */
    climate: {
      name: 'Thermostat',
      short: 'Setpoint and mode',
      blurb: 'Setpoint with plus and minus, current temperature underneath, mode along the bottom.',
      domains: ['climate'],
      size: { w: 380, h: 430 },
      min:  { w: 260, h: 300 },
      needsEntity: true,
      fields: [
        { key: 'title',   label: 'Label',       type: 'text', placeholder: 'HEATING' },
        { key: 'step',    label: 'Step',        type: 'select',
          options: [{ id: '0.5', name: '0.5 °' }, { id: '1', name: '1 °' }] },
        { key: 'tMin',    label: 'Lowest',      type: 'number', min: 4, max: 30, step: 1 },
        { key: 'tMax',    label: 'Highest',     type: 'number', min: 10, max: 40, step: 1 },
        { key: 'showMode',label: 'Show mode',   type: 'bool' },
        { key: 'accent',  label: 'Accent',      type: 'color', themeKey: 'accent' }
      ],
      defaults: { step: '0.5', tMin: 7, tMax: 28, showMode: true, accent: null }
    },

    /* ---------------------------------------------------------------- */
    gauge: {
      name: 'Gauge',
      short: 'Dial + good zone',
      blurb: 'A dial for a number that has a range you care about — pH, pressure, power, a tank.',
      domains: ['sensor', 'number', 'input_number'],
      size: { w: 340, h: 340 },
      /* a dial is only readable while the ticks are distinguishable; below
       * this the scale turns into a smudge and a Sensor card is better */
      min:  { w: 200, h: 200 },
      needsEntity: true,
      fields: [
        { key: 'title',    label: 'Label',      type: 'text', placeholder: 'POOL pH' },
        { key: 'min',      label: 'Scale from', type: 'number', min: -1000, max: 100000, step: 1 },
        { key: 'max',      label: 'Scale to',   type: 'number', min: -1000, max: 100000, step: 1 },
        { key: 'unit',     label: 'Unit shown', type: 'text', placeholder: '' },
        { key: 'decimals', label: 'Decimals',   type: 'number', min: 0, max: 3, step: 1 },
        { key: 'style',    label: 'Indicator',  type: 'select',
          options: [{ id: 'arc', name: 'Filling arc' }, { id: 'needle', name: 'Needle' }],
          hint: 'The arc reads better across a room. The needle reads better when the ' +
                'good zone matters more than the number.' },
        { key: 'ticks',    label: 'Show the scale', type: 'bool' },
        { key: 'band',     label: 'Mark a good zone', type: 'bool',
          hint: 'Draws a band on the scale, so "is this OK" is answerable without reading ' +
                'the number. This is the whole reason to use a dial instead of a Sensor card.' },
        { key: 'bandFrom', label: 'Zone from',  type: 'number', min: -1000, max: 100000, step: 1, when: 'band' },
        { key: 'bandTo',   label: 'Zone to',    type: 'number', min: -1000, max: 100000, step: 1, when: 'band' },
        { key: 'bandColor',label: 'Zone colour',type: 'color', themeKey: 'accent2', when: 'band' },
        { key: 'accent',   label: 'Indicator colour', type: 'color', themeKey: 'accent' }
      ],
      defaults: {
        min: 0, max: 100, unit: '', decimals: 1, style: 'arc', ticks: true,
        band: false, bandFrom: 40, bandTo: 70, bandColor: null, accent: null
      }
    },

    /* ---------------------------------------------------------------- */
    media: {
      name: 'Media player',
      short: "What's playing",
      blurb: 'What is playing in this room, and the buttons to change it.',
      domains: ['media_player'],
      size: { w: 480, h: 300 },
      /* 240 rather than the ~210 two text lines and a button row technically
       * need: with the artist AND the volume slider on, a shorter card starves
       * the track name down to about 14 px, which is unreadable across a room.
       * store.issues() warns when it happens anyway, since a card can still be
       * dragged smaller than is sensible for what is switched on. */
      min:  { w: 300, h: 240 },
      needsEntity: true,
      fields: [
        { key: 'title',      label: 'Label',       type: 'text', placeholder: 'KITCHEN' },
        { key: 'showArtist', label: 'Show the artist', type: 'bool' },
        { key: 'scroll',     label: 'Scroll a long title', type: 'bool',
          hint: 'Off ends it in an ellipsis, which is free. Scrolling is an animation, so that ' +
                'strip of the card repaints continuously for as long as the track plays — on a ' +
                'panel whose 2D accelerators are both switched off.' },
        { key: 'showVolume', label: 'Volume slider', type: 'bool',
          hint: 'Drag to set the volume. Reads the real level back, so it follows changes made ' +
                'anywhere else.' },
        { key: 'accent',     label: 'Button colour', type: 'color', themeKey: 'strip' }
      ],
      defaults: { showArtist: true, scroll: false, showVolume: true, accent: null }
    },

    /* ---------------------------------------------------------------- */
    clock: {
      name: 'Clock',
      short: 'Time and date',
      blurb: 'Time from the on-board RTC, so it stays right through a reboot or a WiFi outage.',
      domains: [],
      size: { w: 252, h: 220 },
      min:  { w: 160, h: 90 },
      needsEntity: false,
      fields: [
        { key: 'title',     label: 'Label above',  type: 'text', placeholder: 'MASTER BEDROOM' },
        { key: 'format',    label: 'Format',       type: 'select',
          options: [{ id: '24', name: '24 hour (18:40)' }, { id: '12', name: '12 hour (6:40 PM)' }] },
        { key: 'showDate',  label: 'Show the date',type: 'bool' },
        { key: 'color',     label: 'Colour',       type: 'color', themeKey: 'ink' }
      ],
      defaults: { format: '24', showDate: false, color: null }
    },

    /* ---------------------------------------------------------------- */
    text: {
      name: 'Text',
      short: 'A fixed label',
      blurb: 'A fixed label. Room names, a divider heading, a note to yourself.',
      domains: [],
      size: { w: 300, h: 90 },
      min:  { w: 60, h: 40 },
      needsEntity: false,
      fields: [
        { key: 'body',      label: 'Text',   type: 'text', placeholder: 'GROUND FLOOR' },
        { key: 'align',     label: 'Align',  type: 'select',
          options: [{ id: 'left', name: 'Left' }, { id: 'center', name: 'Centre' }, { id: 'right', name: 'Right' }] },
        { key: 'card',      label: 'Draw the card behind it', type: 'bool' },
        { key: 'color',     label: 'Colour', type: 'color', themeKey: 'inkDim' }
      ],
      defaults: { body: 'GROUND FLOOR', align: 'left', card: false, color: null }
    }
  };

  /* Give every type its size fields and the matching defaults. Done here
   * rather than by hand in each entry so a new slot cannot be forgotten. */
  Object.keys(TYPES).forEach(function (t) {
    TYPES[t].fields = (TYPES[t].fields || []).concat(sizeFields(t));
    TYPES[t].defaults = Object.assign({}, TYPES[t].defaults, sizeDefaults(t));
  });

  /* ------------------------------------------------------------------
   * ENTITY CAPABILITIES -> CARD OPTIONS.
   *
   * Home Assistant already knows a bulb's colour-temperature range and a
   * thermostat's limits; they sit in the entity's attributes. Every one of
   * these was previously a field the user had to go and look up by hand in
   * Settings → Tools, then type in — which is a good way to end up with a
   * tile tinting to a range the bulb does not actually have.
   *
   * `caps` is whatever the import template managed to read. Anything missing
   * is simply left alone, so a plain "entity id, one per line" paste still
   * works and nothing gets clobbered with a guess.
   * ------------------------------------------------------------------ */
  function fromEntity(type, caps) {
    if (!caps) return null;
    var o = {}, n = 0;
    function num(k) { var v = parseFloat(caps[k]); return isFinite(v) ? v : null; }

    if (type === 'light') {
      /* supported_color_modes is the only honest test for "can this dim".
       * A bulb that reports ONLY onoff has no brightness at all, and giving
       * it a slider means dragging does nothing. */
      var modes = String(caps.modes || '').split('+').filter(Boolean);
      if (modes.length) {
        o.dimmable = modes.some(function (m) { return m !== 'onoff' && m !== 'unknown'; });
        o.colorTemp = o.dimmable && modes.indexOf('color_temp') >= 0;
        n++;
      }
      var kmin = num('kmin'), kmax = num('kmax');
      if (kmin !== null && kmax !== null && kmax > kmin) {
        o.kMin = Math.round(kmin); o.kMax = Math.round(kmax); n++;
      }
    } else if (type === 'climate') {
      var tmin = num('tmin'), tmax = num('tmax');
      if (tmin !== null && tmax !== null && tmax > tmin) {
        o.tMin = Math.round(tmin); o.tMax = Math.round(tmax); n++;
      }
      var st = num('tstep');
      if (st !== null && st > 0) { o.step = st <= 0.5 ? '0.5' : '1'; n++; }
    } else if (type === 'sensor') {
      if (caps.unit) { o.unit = caps.unit; n++; }
    } else if (type === 'cover') {
      /* a cover with no position support has no current_position attribute,
       * and a "42%" that never moves off 0 is worse than no readout */
      if (caps.pos !== undefined) { o.showPosition = caps.pos === '1'; n++; }
    }
    return n ? o : null;
  }

  /* Order they appear in the palette. */
  var ORDER = ['light', 'toggle', 'fan', 'sensor', 'gauge', 'text_sensor', 'cover', 'climate', 'media', 'button', 'clock', 'text'];

  /* Twelve tiles in one grid made you read all twelve to find the one you
   * wanted. The first thing you actually decide is whether this card DOES
   * something or SHOWS something, so the palette says that out loud. */
  var GROUPS = [
    { name: 'Controls', types: ['light', 'toggle', 'fan', 'cover', 'climate', 'media', 'button'] },
    { name: 'Readouts', types: ['sensor', 'gauge', 'text_sensor', 'clock', 'text'] }
  ];

  /* px sizes behind the font ids the generator emits. */
  var FONT_PX = { sm: 18, md: 30, lg: 52, xl: 72 };

  /* 'auto' picks the biggest step that still fits the card. */
  function autoFont(w, h) {
    if (h >= 200 && w >= 220) return 'xl';
    if (h >= 130 && w >= 150) return 'lg';
    if (h >= 70) return 'md';
    return 'sm';
  }

  function fontPx(sizeId, w, h) {
    var id = sizeId === 'auto' ? autoFont(w, h) : sizeId;
    return FONT_PX[id] || FONT_PX.md;
  }

  function fontId(sizeId, w, h) {
    return sizeId === 'auto' ? autoFont(w, h) : sizeId;
  }

  PF.catalog = {
    TOUCH_MIN: TOUCH_MIN,
    slots: slots,
    types: TYPES,
    order: ORDER,
    groups: GROUPS,
    symbols: SYMBOLS,
    symbol: symbol,
    isMdi: isMdi,
    mdiName: mdiName,
    mdiPx: mdiPx,
    mdiBytes: mdiBytes,
    sizes: SIZES,
    fromEntity: fromEntity,
    fontPx: fontPx,
    fontId: fontId,
    FONT_PX: FONT_PX
  };
})(window.PF = window.PF || {});
