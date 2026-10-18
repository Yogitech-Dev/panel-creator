#!/usr/bin/env node
/* =====================================================================
 * generate.js — run the generator outside the browser.
 *
 * Same code the page runs; only the DOM-free modules are loaded. Exists so
 * a generated config can be pushed straight through `esphome config` /
 * `esphome compile` instead of being eyeballed.
 *
 *   node tools/generate.js path/to/project.panelcreator.json outdir
 *   node tools/generate.js --selftest outdir
 *
 * --selftest builds a set of projects that between them use every card
 * type, both speaker modes and both typefaces.
 * ===================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
/* fanframes.js is here so a generated project with spinning blades can be
 * validated as-is. Without the sprite next to the YAML, `esphome config` stops
 * at "Could not find file fanframes/fan00.png" and never reaches the config. */
const MODULES = ['theme.js', 'catalog.js', 'fonts.js', 'mdi.js', 'store.js', 'layout.js', 'gen-header.js', 'gen-yaml.js', 'gen-docs.js', 'fanframes.js'];

function loadPF() {
  const sandbox = {
    console,
    /* gen-docs asks for a key; a fixed one is fine for a compile check and
     * keeps the output diffable between runs. */
    crypto: { getRandomValues: (a) => { for (let i = 0; i < a.length; i++) a[i] = (i * 37 + 11) & 255; return a; } },
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    Date, Math, JSON, Object, Array, String, Number, parseInt, parseFloat, isNaN, isFinite,
    setTimeout, clearTimeout, TextEncoder
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const m of MODULES) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', m), 'utf8'), sandbox, { filename: m });
  }
  return sandbox.PF;
}

const PF = loadPF();

function emit(project, outdir, tag) {
  PF.store.replace(project);
  const p = PF.store.get();
  const issues = PF.store.issues();
  const yaml = PF.gen.yaml(p);
  const header = PF.genHeader.build(p, { ink: PF.store.theme().ink });
  const readme = PF.docs.readme(p, PF.docs.newKey());
  fs.mkdirSync(outdir, { recursive: true });
  fs.writeFileSync(path.join(outdir, p.device.name + '.yaml'), yaml);
  fs.writeFileSync(path.join(outdir, PF.genHeader.fileName(p)), header);
  if (p.cards.some((c) => c.type === 'fan' && c.opts.blades)) {
    const dir = path.join(outdir, 'fanframes');
    fs.mkdirSync(dir, { recursive: true });
    for (const [file, b64] of Object.entries(PF.fanFrames)) {
      fs.writeFileSync(path.join(dir, file), Buffer.from(b64, 'base64'));
    }
  }
  fs.writeFileSync(path.join(outdir, 'README.md'), readme);
  /* the project file too, so a generated case can be loaded back into the
   * editor and looked at rather than only compiled */
  const proj = JSON.parse(JSON.stringify(p));
  delete proj.selected;
  fs.writeFileSync(path.join(outdir, p.device.name + '.panelcreator.json'), JSON.stringify(proj, null, 2));
  const bad = issues.filter((i) => i.level === 'error');
  console.log(`${tag || p.device.name}: ${p.cards.length} cards, ${yaml.split('\n').length} lines` +
    (bad.length ? `  ** ${bad.length} errors: ${bad.map((b) => b.text).join('; ')}` : ''));
  return { yaml, header, readme, issues };
}

/* ---- self-test projects ------------------------------------------- */
function card(type, o) {
  const t = PF.catalog.types[type];
  return {
    id: o.id, type, title: o.title || '', entity: o.entity || '',
    x: o.x, y: o.y, w: o.w, h: o.h,
    opts: Object.assign({}, t.defaults, o.opts || {})
  };
}

function selftest(outdir) {
  /* PINNED. blank() now takes the timezone from the browser (or from node's
   * host, here), which is right for a real user and wrong for a fixture: the
   * emitted YAML would differ per machine and every diff would be noise. */
  const base = () => {
    const p = JSON.parse(JSON.stringify(PF.store.blank()));
    p.device.timezone = 'Etc/UTC';
    return p;
  };

  /* 1. everything, external speaker, Roboto */
  const a = base();
  a.device.name = 'pf-test-kitchen-sink';
  a.device.friendly = 'Kitchen Sink';
  a.audio.mode = 'external';
  a.voice.enabled = true;
  a.voice.externalPlayer = 'media_player.living_room';
  a.voice.extraWakeWords = true;
  a.cards = [
    card('fan', { id: 'c1', title: 'CEILING FAN', entity: 'fan.ceiling_fan', x: 30, y: 30, w: 420, h: 440 }),
    card('light', { id: 'c2', title: 'NIGHTSTAND', entity: 'light.bedroom_lamp', x: 466, y: 30, w: 340, h: 440, opts: { colorTemp: true, kMin: 2202, kMax: 4000 } }),
    card('clock', { id: 'c3', title: 'BEDROOM', x: 822, y: 30, w: 428, h: 250, opts: { showDate: true } }),
    /* unit with a LETTER in it — the case that shipped broken: the numeric
     * glyph set had no C, so "22.4°C" drew a degree sign and a blank box.
     * Entity import fills this in from Home Assistant, so it is the norm now. */
    card('sensor', { id: 'c4', title: 'TEMPERATURE', entity: 'sensor.bedroom_temperature', x: 822, y: 296, w: 206, h: 174, opts: { unit: '°C' } }),
    card('text_sensor', { id: 'c5', title: 'FRONT DOOR', entity: 'binary_sensor.front_door', x: 1044, y: 296, w: 206, h: 174 }),
    card('light', { id: 'c6', title: 'CEILING', entity: 'light.bedroom_ceiling', x: 30, y: 486, w: 420, h: 204 }),
    /* one built-in glyph and one MDI icon, so a build exercises both paths:
     * a label with a montserrat font, and an image: entry recoloured by
     * image_recolor. They also share nothing, so a mix has to work. */
    card('toggle', { id: 'c7', title: 'HEATER', entity: 'switch.bedroom_heater', x: 466, y: 486, w: 340, h: 204, opts: { symbol: 'mdi:radiator' } }),
    card('button', { id: 'c8', title: 'GOODNIGHT', entity: 'scene.goodnight', x: 822, y: 486, w: 428, h: 204, opts: { symbol: 'bell' } })
  ];

  /* 2. the other half of the catalogue, panel speaker, Montserrat */
  const b = base();
  b.device.name = 'pf-test-hall';
  b.device.friendly = 'Hall Panel';
  b.audio.mode = 'panel';
  b.voice.enabled = true;
  b.fonts.family = 'montserrat';
  b.theme.id = 'paper';
  /* the other board on both axes: an early (rev 1.x) P4 with an ST7121 panel,
   * the guest-bedroom unit found 2026-10-17. Every other fixture is the default. */
  b.board = { chip: 'early', display: 'ST7121' };
  b.cards = [
    card('cover', { id: 'c1', title: 'BLINDS', entity: 'cover.living_room_blinds', x: 30, y: 30, w: 300, h: 430 }),
    card('cover', { id: 'c2', title: 'GARAGE', entity: 'cover.garage_door', x: 346, y: 30, w: 420, h: 190, opts: { layout: 'row', showPosition: false } }),
    card('climate', { id: 'c3', title: 'HEATING', entity: 'climate.hall', x: 782, y: 30, w: 380, h: 430, opts: { step: '1' } }),
    card('media', { id: 'c8', title: 'KITCHEN', entity: 'media_player.kitchen', x: 30, y: 476, w: 400, h: 214,
                    opts: { showArtist: false, showVolume: false, scroll: true } }),
    /* deliberately contradictory: a non-dimmable light with colour temperature
     * and a detail page still switched on. Both have to be ignored, or the
     * config references a slider and a page that were never created. */
    card('light', { id: 'c5', title: 'PORCH', entity: 'light.porch', x: 782, y: 476, w: 380, h: 100, opts: { dimmable: false, colorTemp: true, detailPage: true, power: 'none' } }),
    card('fan', { id: 'c6', title: 'EXTRACTOR', entity: 'fan.bathroom', x: 346, y: 236, w: 420, h: 170, opts: { blades: false, arc: false, power: 'bottom' } }),
    card('sensor', { id: 'c7', title: 'POWER', entity: 'sensor.house_power', x: 782, y: 592, w: 380, h: 98, opts: { unit: ' W', decimals: 0 } }),
    /* the full media card: artist AND volume, so the crowded path is built too */
    card('media', { id: 'c9', title: 'STUDY', entity: 'media_player.study', x: 446, y: 422, w: 320, h: 268,
                    opts: { showArtist: true, showVolume: true, scroll: false } })
  ];

  /* 3. minimal: silent, portrait, no clock, no lights */
  const c = base();
  c.device.name = 'pf-test-minimal';
  c.device.friendly = 'Minimal';
  c.device.rotation = 'portrait';
  c.audio.mode = 'none';
  c.screen.alwaysOnSwitch = false;
  c.api.encryption = false;
  c.theme.id = 'ink';
  c.power.monitor = true;   // the INA226 block, on the smallest project
  c.cards = [
    card('toggle', { id: 'c1', title: 'PUMP', entity: 'switch.pool_pump', x: 30, y: 30, w: 660, h: 300, opts: { showState: true } }),
    card('sensor', { id: 'c2', title: 'PH', entity: 'sensor.pool_ph', x: 30, y: 360, w: 660, h: 300, opts: { unit: '', decimals: 2 } })
  ];

  /* Each project gets its own folder. They must not share one: tab5_ui.h is
   * generated per project (the colour helpers only exist when there are light
   * cards), so a shared folder means the last project silently overwrites the
   * header the others need, and the build fails with "'tab5' has not been
   * declared" somewhere unrelated. */
  /* 4. fill direction. LVGL's bar is LV_BAR_ORIENTATION_AUTO by default, i.e.
   *    horizontal only when width >= height, so a tall tile fills upwards on
   *    its own. The forced cases go out as lv_slider_set_orientation() calls in
   *    on_boot — with the SLIDER enum, not the BAR one, which C++ will not
   *    convert. All four toggle-strip edges are exercised here too. */
  const d = base();
  d.device.name = 'pf-test-fill';
  d.device.friendly = 'Fill Directions';
  d.cards = [
    card('light', { id: 'c1', title: 'AUTO TALL', entity: 'light.a', x: 30, y: 30, w: 240, h: 660 }),
    card('light', { id: 'c2', title: 'FORCED VERT', entity: 'light.b', x: 290, y: 30, w: 460, h: 300,
                    opts: { fill: 'vertical', power: 'top', detailPage: false } }),
    card('light', { id: 'c3', title: 'FORCED HOR', entity: 'light.c', x: 290, y: 350, w: 460, h: 340,
                    opts: { fill: 'horizontal', power: 'left', detailPage: false } }),
    card('light', { id: 'c4', title: 'AUTO WIDE', entity: 'light.d', x: 770, y: 30, w: 480, h: 200,
                    opts: { colorTemp: true, power: 'bottom' } })
  ];

  /* 5. square corners and no audio. Radius 0 makes LVGL short-circuit
   *    clip_corner entirely, so no card should come out with it — and the
   *    whole audio stack should be absent from the config. */
  const e = base();
  e.theme.style = 'square';
  e.device.name = 'pf-test-square';
  e.device.friendly = 'Square Corners';
  e.audio.mode = 'none';
  e.cards = [
    card('light', { id: 'c1', title: 'NIGHTSTAND', entity: 'light.lamp', x: 30, y: 30, w: 340, h: 440,
                    opts: { colorTemp: true, kMin: 2202, kMax: 4000 } }),
    card('light', { id: 'c2', title: 'CEILING', entity: 'light.ceiling', x: 386, y: 30, w: 420, h: 204 }),
    card('fan',   { id: 'c3', title: 'FAN', entity: 'fan.ceiling', x: 386, y: 250, w: 420, h: 440 }),
    card('clock', { id: 'c4', title: 'HALL', x: 822, y: 30, w: 428, h: 250, opts: { showDate: true } }),
    card('sensor',{ id: 'c5', title: 'TEMPERATURE', entity: 'sensor.hall_temp', x: 822, y: 296, w: 428, h: 174 }),
    /* BOTH gauge styles. The band is a second indicator on the same scale, so
     * the pair has to coexist; the needle and the arc take different update
     * keys (value vs end_value) and only one of them is ever right. */
    card('gauge', { id: 'c6', title: 'POOL pH', entity: 'sensor.pool_ph', x: 30, y: 486, w: 340, h: 204,
                    opts: { min: 6, max: 9, decimals: 1, style: 'arc',
                            band: true, bandFrom: 7.2, bandTo: 7.6 } }),
    card('gauge', { id: 'c7', title: 'HOUSE POWER', entity: 'sensor.house_power', x: 822, y: 486, w: 428, h: 204,
                    opts: { min: 0, max: 6000, decimals: 0, unit: ' W', style: 'needle', ticks: true } })
  ];

  /* 6. text scaling. One big clock on 'fit' should end up hundreds of px, not
   *    stuck on the 72 px rung — and the font: block should carry exactly the
   *    sizes used, with the numeric ones glyph-restricted so a 228 px face is
   *    ~100 kB of digits instead of most of a megabyte of everything. */
  const f = base();
  f.device.name = 'pf-test-fit';
  f.device.friendly = 'Text Scaling';
  f.cards = [
    card('clock',  { id: 'c1', title: 'MASTER BEDROOM', x: 390, y: 30, w: 738, h: 340,
                     opts: { valueSize: 'fit' } }),
    card('sensor', { id: 'c2', title: 'TEMPERATURE', entity: 'sensor.t', x: 390, y: 386, w: 738, h: 300,
                     opts: { valueSize: 'fit' } }),
    card('light',  { id: 'c3', title: 'NIGHTSTAND', entity: 'light.a', x: 44, y: 30, w: 326, h: 310 }),
    card('text',   { id: 'c4', x: 44, y: 356, w: 326, h: 120,
                     opts: { body: 'CUSTOM', valueSize: 'custom', valuePx: 96, card: true } })
  ];

  [['kitchen-sink', a], ['hall', b], ['minimal', c], ['fill', d], ['square', e], ['fit', f]].forEach(([tag, proj]) =>
    emit(proj, path.join(outdir, proj.device.name), tag));
}

/* ---- main ---------------------------------------------------------- */
const args = process.argv.slice(2);
if (args[0] === '--selftest') {
  selftest(args[1] || path.join(ROOT, 'tools', 'out'));
} else if (args.length >= 1) {
  const proj = JSON.parse(fs.readFileSync(args[0], 'utf8'));
  emit(proj, args[1] || process.cwd());
} else {
  console.error('usage: node tools/generate.js <project.panelcreator.json> [outdir]');
  console.error('       node tools/generate.js --selftest [outdir]');
  process.exit(1);
}
