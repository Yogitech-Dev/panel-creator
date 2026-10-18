# Panel Creator: how it works

A layout editor and firmware generator for **M5Stack Tab5** wall panels running ESPHome.

Drag cards around a real-size 1280×720 preview, type in your own Home Assistant entity ids,
choose how sound and voice should work, and download a config that compiles. It exists because
the interesting part of this build is the layout, and the boring part — 1300 lines of YAML with
a dozen hardware landmines in it — is the same every time.

Double-click **`Panel Creator.bat`** in the repo root. It opens the page in your browser. There is no server, no
build step and no install; nothing is left running when you close the tab.

---

## What it generates

| File | What it is |
|---|---|
| `<name>.yaml` | the ESPHome config |
| `panelcreator_ui.h` | C++ helpers. Identical for every panel — **upload it once, ever**. The YAML will not compile without it |
| `README.md` | install steps written for whoever downloads it |
| `fanframes/` | only when a fan card has spinning blades on |

**Panel power monitoring** is a Panel-tab option, off by default. It reads the Tab5's onboard
INA226 and publishes supply voltage, current and power as **`entity_category: diagnostic`** on a
60 s interval — so Home Assistant files them under Diagnostics rather than adding three rows to a
device page that already has plenty. The shunt values are the Tab5's own (`0.005 ohm`, `8.192 A`);
ESPHome's defaults of `0.1 ohm` / `3.2 A` would report roughly twenty times the real current.

`Save` also writes a `.panelcreator.json` project file. Load it back with `Open` to keep editing.

**Everything goes in `/config/esphome/` together.** There used to be a single-file mode that
inlined the helpers so there was nothing to upload beside the YAML, and it was dropped in
August 2026. Its one real benefit was skipping that upload for someone without the File editor
or Samba add-on. Against that it could not do voice, could not do the fan sprite, and could not
have carried any of the asset-backed features since — so half its feature list was going to be
switched off, on a second code path through the same 1,800-line generator.

The voice half of that was never a policy choice, and the reason is worth keeping: a voice build
boot-loops on the ESP32-P4 unless an 8 kB region is kept out of the heap, and the line that does
it — `SOC_RESERVE_MEMORY_REGION(...)` — expands to a `static` with a linker-section attribute,
which has to sit at file scope. An ESPHome lambda is a function body, `includes:` only takes file
paths (`core/config.py: valid_include`), and there is **no sdkconfig option** for it: the region
is registered in `heap/port/esp32p4/memory_layout.c:115` with no `#ifdef` around it. So a config
with no header beside it cannot carry the one line that keeps the panel bootable.

## What it knows that a blank YAML file does not

Every one of these is baked in because getting it wrong looks like broken hardware rather than a
mistake. Each one was found on real Tab5s, most of them the hard way.

* **The SPM heap reservation** in the generated header. The P4 registers an 8 kB region at `0x30100000` as
  heap, but `spi_flash`'s sanity check only accepts real DRAM — so a task stack that lands there
  asserts before `app_main`. No log, no screen, no WiFi, no OTA to roll back with. Reserving the
  region makes it impossible instead of unlikely.
* **V2 boards are ST7123 for display *and* touch.** The official M5Stack config targets V1 and
  gives a black screen on a V2.
* **16-bit colour only.** 24-bit needs 1.92 Gbps and the DSI link has exactly that before
  blanking, so it never syncs. This is also why every fill in the design is flat — RGB565 bands
  large gradients, so the preview quantises colours to show you what you will actually get.
* **Mic and speaker share one I2S bus**, so both run at 16 kHz.
* **The ES8388 powers up on LINE2**; the onboard speaker is on LINE1.
* **`micro_wake_word` switches itself off after each detection** — without a restart in `on_end`
  the wake word works exactly once per boot.
* **No battery in a wall panel**, so charging is disabled or the status pin chatters forever.
* **Symbols only exist in Montserrat.** The LVGL symbol glyphs live in the F0xx range and the
  Google-Fonts Roboto build has no such glyph, so any label carrying one is forced to a
  `montserrat_NN` font. Getting that wrong is a blank box on the wall.
* **A slider's direction comes from its own shape.** LVGL's bar defaults to
  `LV_BAR_ORIENTATION_AUTO`, which is `horizontal = width >= height` — so a light tile taller than
  it is wide fills *upwards*, whether or not you meant it to. The preview draws whichever the
  panel will actually do, and **Fill direction** forces it either way with
  `lv_slider_set_orientation()` at boot, because ESPHome's slider schema has no key for it.
* **ESPHome only compiles in the LVGL widgets a config uses**, so the header may not reference a
  slider function unless the panel has a slider on it. A panel of nothing but toggles used to fail
  with `'lv_slider_get_min_value' was not declared` in a file nothing ever called.
* **An arc is not the size it looks.** Three numbers in `lv_arc.c` are not what a width and a
  height suggest, and getting any of them wrong makes the preview lie about the fan card.
  `get_center()` takes the radius as `MIN(w,h)/2` and does **not** subtract the arc width, and
  `lv_draw_arc_get_area()` uses `rout = radius`, `rin = radius - w` — so the radius is the **outer**
  edge and every stroke grows **inward** from it. The indicator is drawn at that same outer radius,
  so a thicker indicator reaches further *in*, never out: a fat fill under a thin track is the
  intended look. And the knob is centred on the indicator's centreline with a half-extent of
  `indic_width/2 + knob_pad`, so it lands `knob_pad` px **outside** the widget — which lv_arc's
  `LV_EVENT_REFR_EXT_DRAW_SIZE` handler deliberately makes room for. The card clips its children,
  the arc does not, so the layout reserves that overhang before choosing a dial size.
* **A fallback hotspot with nothing behind it.** `wifi: ap:` on its own comes up and then serves
  no page — ESPHome says so during validation. The config emits `captive_portal:` alongside it, so
  joining the hotspot actually gets you the WiFi form.

It also flags things the config cannot: anything tappable under an 8 mm finger target (≈95 px at
this panel's 11.6 px/mm), cards that overlap or hang off the edge, entity ids in the wrong
domain, and duplicate entities.

## Why dragging a brightness slider can feel stepped

Worth understanding, because part of it is fixable here and part of it is not. None of it is
"heavy graphics" — every widget is a stock ESPHome LVGL widget.

### The ceiling: the P4's 2D hardware is switched off

Both accelerators the chip has for this work are disabled in ESPHome 2026.7 on IDF 5.5:

* **LVGL's PPA path** — ESPHome sets `LV_USE_PPA = 0` for the ESP32-P4 with its own comment,
  *"disable use of PPA for fills until upstream bugs fixed"* (`lvgl/__init__.py:310`). Every fill
  is the software renderer, on the CPU.
* **DSI DMA2D** — `esp_lcd_dpi_panel_enable_dma2d()` is inside
  `#if ESP_IDF_VERSION >= ESP_IDF_VERSION_VAL(6, 0, 0)` (`mipi_dsi.cpp:99`), so on IDF 5.5 the
  copy into the framebuffer is not accelerated either.

LVGL is also single-buffered here (`lv_display_set_buffers(..., nullptr, ...)`), the panel is
created with `num_fbs = 1`, and each `esp_lcd_panel_draw_bitmap` is followed by
`xSemaphoreTake(io_lock_, portMAX_DELAY)` — render and flush never overlap.

The frame budget is not the problem: `LV_DEF_REFR_PERIOD` is **16 ms**, so LVGL is asking for
60 fps. How long a frame takes in software through PSRAM is. **Expect this to improve on its own**
when ESPHome re-enables PPA and moves to IDF 6.

### What is in your control

1. **Shrink what gets invalidated.** `lv_bar_set_value(..., LV_ANIM_OFF)` invalidates the *whole*
   widget, not the strip that changed (`lv_bar.c:748`). A full-card slider is ~178 000 px per step
   of a finger; a bar inside the card is about a ninth of that.
2. **`buffer_size: 12%`.** The default of `0` means a full-screen 1.84 MB buffer, and at that size
   ESPHome does not even try internal RAM — only at 1/4 or smaller (`lvgl_esphome.cpp:758`). A 1/8
   buffer stands a chance of being internal, which is much faster to render into. Every generated
   config carries this as a commented line with the reasoning beside it.
3. **Don't clip corners you don't have to** — see below. This tool now handles it for you.

### Rounded corners are cheap. CLIPPING them is not.

`clip_corner` makes LVGL render every child into an off-screen **ARGB8888** layer per corner
strip, mask it and blit it (`lv_refr.c:186`). But it is only needed when a child would actually
draw over a corner, and there are two ways to avoid that:

* **Children inside the padding never reach a corner.** A sensor, clock or text card is labels —
  it never needed clipping at all.
* **A full-bleed child can carry the card's radius itself.** A slider or button that fills the
  card gets `radius: 26`, its corners line up, and nothing pokes out.

For a slider there is one more condition, spelled out in the comment block at `lv_bar.c:568`:

```c
else if(indic_radius >= bg_radius) radius_issue = false;   /* just draw the indicator */
```

The **indicator** has to be rounded at least as much as the bar, or LVGL builds a layer for the
indicator instead. So both get the radius — the visible cost is a rounded leading edge on the fill.

Panel Creator applies all of that automatically. What is left needing a real clip is a card with a
full-bleed face **and** a toggle strip: two children meeting at a seam, where rounding both would
show notches of card behind them. Across the test set that took clipping from *every card* down to
three out of eight.

## Text sizes

**Every piece of text in every card** takes a size, not just the headline value — the label, the
value, the symbol, a thermostat's current temperature and mode, a clock's date. Each one offers
**Default**, **Fill the space**, a named rung, or an **exact size in px**.

*Default* is what that element has always been, so an existing panel is pixel-identical until you
change something. *Fill* scales to the room it has — a clock alone on a 738 × 340 card lands at
216 px rather than sitting at 72 in the middle of it.

Sizes interact the way you would want: make a sensor's label Large and its value gives up the
space, because the layout measures the label's real line height rather than assuming one. And
whatever you pick is capped to what actually fits, in **both** axes — an exact size is a
preference, not a way to push text off a card.

**Huge means huge.** The `xl` rung is **160 px**, not the 72 it used to be: on a 738 × 300 card,
where 185 px actually fits, the old value handed you under 40 % of the space while calling itself
Huge. Nothing draws at 160 unless the card can seat it.

**An explicit choice no longer steps down the ladder.** Asking for Huge on a card that could take
100 px used to trigger a rung search that dropped you to Large's 52 — a cliff. Now the asked-for
size walks down to the box in 4 px steps, so you get the biggest size that *fits* rather than the
biggest one that is *named*. Only **Default** still steps between rungs, and it reads a frozen
copy of the original ladder, so raising `xl` cannot move a single existing panel. *Exact size*
now goes to 400 px — about 340 kB of flash for a digits-only face, real but affordable, and only
if you ask.

Two overflow bugs surfaced when this was swept — every card type × every size × every alignment
pair × a range of card sizes, 560 000 text parts — and **neither was caused by the change**,
because both failed at
**Default** too. A toggle at the 88 px finger minimum ran its title + symbol + value off the
bottom by 10 px at every size; and readout cards with a large title dropped the value 1 px past
the edge, because a `Math.max(24, …)` floor promised height the card did not have. The stack now
shrinks to fit before it is placed, giving up the word before the symbol.

**The unit is its own label, and the number is measured character by character.** Both were
costing a readout most of its size. `19.7°C` and `24%` on identical cards came out at 44 px and
88 px — half the size for the temperature, and no setting could fix it, because the constraint
was the *string*: the width model charged every character 0.60 em, so `.` and `°` cost as much
as an `8`, and the unit was being sized as part of the same block. Characters now carry their
real widths (`.` 0.30, `°` 0.45, `%` 0.80, a capital 0.68), and the unit is drawn as a separate
label at **0.44×** the number, sitting on its baseline. Same two cards, same settings: **56 px
and 68 px**. The unit's size snaps to 4 px so several sensors share one font entry, and a unit
typed as `" W"` is trimmed, because the gap beside the number is placed rather than typed.

**The pair is a flex row, so it stays centred whatever the reading is.** Two labels placed by
hand have to be centred on a *guess* at how wide the number will be, and it hardly ever is:
sized for `888`, a `24` sat a whole digit right of centre with the missing digit's worth of empty
space on its left. LVGL re-runs a flex layout whenever a child changes size, so the row
re-centres the real text on every update and no estimate is involved — and `flex_align_main` is
then also what gives you Left / Centre / Right as a choice. It costs one invisible `obj` per
card. Flex lines up the two boxes' *bottoms* and knows nothing about baselines, so the unit gets
a `pad_bottom` of 0.244 × the size difference (Roboto's descender) — without it the unit hangs
below the number instead of sitting on the same line.

**How wide a number to plan for.** Fit sizing needs a sample, and guessing low is not free — a
card fitted to two digits put `681` straight through its `W`. A sensor's decimals say which kind
of number it is: with them you are reading a precise small quantity (temperature, pH, volts) and
two integer digits cover it; without them you are counting something (percent, watts, ppm) and it
reaches three. A **gauge** states its own min and max, so it measures the real widest reading
instead of guessing. Where a value can still outgrow its room it wraps, which is ugly and
*visible*, rather than being clipped into a plausible wrong number. The preview wraps the same
way LVGL does, which took a CSS `overflow-wrap: anywhere`: CSS only breaks at spaces, LVGL
breaks an over-long word.

**↔ and ↕ — where an element sits in the room it was given.** Every text slot takes a horizontal
alignment, and the headline value also takes a vertical one, so a reading can sit against the
top, the bottom or either side instead of always in the middle. *Default* is what that element
has always done, so an existing panel does not move until you change it. Vertical is offered on
the value alone on purpose: it is the one element with slack around it, and the rest are stacked
against each other, so moving one would land it on its neighbour. Positions are clamped to the
card — the sweep below runs every alignment pair, and removing the clamp makes it fail.

Sizes are **emitted on demand**: the generator walks every card, collects the distinct sizes, and
writes exactly those `font:` entries. A size used by three cards is emitted once — which is why
"fill" snaps to 4 px steps rather than landing on 217.

Big text is affordable because of one thing: the numeric fonts carry **only** the characters this
panel shows. Roboto's default glyph set at 216 px is most of a megabyte of flash; the same face
restricted to digits is a fraction of that, and a clock never needs a letter. Titles and anything
a user types get the full set, so they stay on the modest sizes.

The base is `0123456789.:%°- ONF`, **plus whatever is in your units**. That "plus" is not a nicety:
the list used to be fixed, and a sensor showing `°C` drew the degree sign followed by a blank box,
because there is no `C` in it. It survived because the unit defaulted to a bare `°` and **every
self-test project used a unit with no letter in it** — so nothing caught it until entity import
started filling the unit in from Home Assistant, where it is `°C`, `W`, `lx`. There is now a
`°C` case in the self-test. A unit costs one glyph per numeric size, per panel.

**Montserrat cannot do this** — it is built into ESPHome at even sizes up to 48 px only. Pick
Roboto if you want a big scaled readout.

## Importing entities

**Import entities** takes a pasted list, one per line. An entity id on its own is enough; the
modal gives you a Settings → Tools → Template snippet (Developer tools before HA 2026.8) that dumps the whole instance.

That template reads three fields — `id | friendly name | capabilities` — and the third is the
one that earns its keep. Home Assistant already knows a bulb's Kelvin range, whether it can dim
at all, a thermostat's limits and step, a sensor's unit, and whether a cover reports position.
Every one of those used to be a number you looked up by hand and typed in, which is a good way
to end up with a tile tinting across a range the bulb does not have. They now fill themselves
in — on import, and again whenever you type or pick a known entity in the inspector.

Two details in that template are deliberate. It tests `.get(...) is not none` rather than
truthiness, because a thermostat with `min_temp: 0` is real and `{% if 0 %}` would drop it. And
the colour modes join on `+`, so no field ever contains a comma — a bare comma still separates
id from name in the older paste format, and both still work.

### Finding one again afterwards

Once a few hundred entities are loaded, every entity box searches them as you type. The rule is:
split what you typed on spaces, and keep an entity only if **every** piece appears somewhere in
its id or its friendly name. So `master lamp` finds `light.master_bedroom_lamp`, and the pieces
need not be in order or next to each other.

Ranking then decides what floats to the top, because "matches" is a far bigger set than "the one
you meant":

* a piece that starts a **word** beats one buried mid-word — `bed` puts bedroom above bedding
* the friendly name counts slightly more than the id, because that is the name people think in
* an entity in **the domain the card wants** gets a large boost, so a light card lists lights
  first even when a sensor matched the text better
* shorter ids win ties: `light.kitchen` over `light.kitchen_downlight_3_effect`

If nothing matches at all it loosens to a subsequence test, so `mstrbed` still lands somewhere
rather than showing an empty list. Arrow keys move, Enter picks, Escape closes, and picking a row
pulls in that entity's settings the same as importing does.

Focusing a box that already holds an entity shows the **whole** list with the text selected,
rather than filtering by the value already in it — the reason you clicked it is usually to change
it. The first keystroke replaces the text and starts filtering.

The dropdown is **wider than the input** and shifts left to stay on screen. The inspector column
is about 280 px, which is not enough for a friendly name and an entity id, and four lights in one
room ellipsise to the same visible string. Every row also carries its full name and id as a
hover title, because ids like `sensor.master_bedroom_temperature_calibrated` outrun any sane
width.

This replaced a `<datalist>`, which left the matching, ordering and how many rows you could see
entirely up to the browser.

**The imported list is saved**, under its own localStorage key rather than inside the project.
It describes your Home Assistant instance, not one panel, so it survives *Start over* and is
shared by every panel you design — and, more to the point, it survives a reload. It did not at
first, which meant the act of picking up a new version of the tool silently emptied it; the
search then had nothing to search and looked broken. **Import entities** carries the count so
that state is visible, and the same dialog can forget a list that has gone stale.

## Voice options, and the one that is ours

Everything on the Voice tab is stock ESPHome behaviour except **Keep listening for a follow-up**,
which is marked *Experimental* and is **off by default**. Nothing upstream re-opens the microphone
after a reply, so that option builds it: a turn counter, a "did this turn hear anything" flag, and
a script that waits for the reply to finish before listening again. It works, but with the reply
coming out of a different speaker it has to *guess* when that speaker stopped, and this board has
no echo cancellation — open the mic a moment early and it transcribes the assistant along with
you. The default is therefore what a plain `voice_assistant` panel does: one wake word, one turn.

## Screens: the pages behind a hold

A light tile with **Hold opens a detail page** gets a second screen, and the editor can now draw
it — pick it from **Screen** in the stage footer. It could not before: its geometry lived as magic
numbers inside the generator and nothing but a real panel could render it, which is exactly how it
stayed two grey slabs for a month. It comes from `layout.js` now, like every other coordinate.

The page **adapts to what the bulb can do**, rather than a fixed layout that leaves a hole:

* **with colour temperature** — brightness, Kelvin, and five preset swatches each filled with its
  own real Kelvin colour, so you can see what you are picking. Stepped flat fills, not a ramp:
  RGB565 bands a gradient.
* **without** — brightness takes the full height and gets 25 / 50 / 75 / 100 % quick levels.

The back control is an arrow **and the word BACK**, and it is the largest target on the screen. An
unlabelled glyph in a corner is not an obvious way out of a page you did not mean to open. There
is an on/off button top-right too, since you are already looking at that light.

## Card types

Light (brightness slider tile with an optional colour-temperature detail page), Toggle, Fan
(speed arc, live percentage, optional spinning blades), Sensor, Gauge, Text sensor, Cover,
Thermostat, Media player, Action button, Clock, Text.

Light and Fan tiles take their toggle strip on **any of the four edges**, a light's fill runs
horizontally or vertically, and **Rotate 90°** swaps a card's width and height about its own
centre — which on a light tile flips the fill with it.

### The gauge card

A dial for a number with a range you care about — pH, pressure, tank level, power. An LVGL
`meter` driven by `lvgl.indicator.update`, in two styles: a **filling arc** (reads better across
a room) or a **needle** (reads better when the zone matters more than the number).

The reason to use one instead of a Sensor card is the **good zone** — a band drawn on the scale,
so "is the pool OK" is answerable without reading the value at all.

One layout rule worth knowing if you change it: **where the number sits depends on the style, and
it is not taste.** A needle pivots at the centre of the dial, which is exactly where a centred
readout goes — the needle draws through the digits. Every real gauge puts the number below the
pivot, so the needle style does too. The arc touches nothing in the middle, so there it stays.

### The media player card

Track title, artist, previous / play-pause / next, and a volume slider that reads the real level
back so it follows changes made anywhere else. The middle key shows what pressing it will **do**,
so a player that is playing shows pause.

Everything is read as a `text_sensor` attribute, volume included: a stopped player reports the
string `None` for `media_title` and for `volume_level`, and the numeric platform cannot parse
that — it just complains about it forever. Same reason the light tiles read brightness as text.

Two things it deliberately does not do:

* **No album art.** `entity_picture` is a signed URL that changes with every track, so it means a
  JPEG decode into PSRAM per track on a chip whose 2D accelerators are both switched off. The
  failure mode is a panel that gets slower the longer it plays.
* **Scrolling titles are off by default.** `long_mode: SCROLL` is an animation, so that strip of
  the card repaints continuously for as long as the track lasts. `DOT` is an ellipsis and costs
  nothing.

One layout note worth knowing if you change it: the track label is sized to a **short** sample,
unlike every other slot in the tool. Everywhere else a sample is the longest string the slot must
show, because overflow is a bug. Here the label carries `DOT` or `SCROLL` and is *supposed* to
overrun — sizing it to fit a real track name drove it down to 14 px and left the artist beneath it
looking bigger.

### Icons

Every symbol slot offers the ~28 LVGL glyphs built into the montserrat fonts, and, behind a fold,
**90 Material Design icons** across ten groups.

MDI costs a little and buys a lot. ESPHome downloads each SVG from `Templarian/MaterialDesign` at
build time and rasterises it (`components/file/image.py` → `MDI_SOURCES`), so nothing ships in the
zip — the same trade the Roboto option already makes, and the same requirement: internet on the
machine running the build, never on the panel.

They are emitted as `type: GRAYSCALE`, which is the right call rather than a compromise. An MDI
glyph is one solid shape, so an 8-bit alpha mask *is* the icon — one byte per pixel, anti-aliased,
and `image_recolor` tints it to the theme. About 2.3 kB at 48 px. RGB would be three or four bytes
for the same picture and could not be recoloured.

**Never pair `GRAYSCALE` with `transparency: alpha_channel`.** It is already an alpha mask, and
that combination is the standing suspect for this board's misaligned-instruction boot crash and
the input lag that grows with uptime. The generator cannot emit it.

Sizes snap to an 8 px ladder for the same reason font sizes do: every distinct size is its own
compiled asset, so two cards asking for 61 px and 64 px would otherwise cost two copies of the
same icon. The preview draws the real 24×24 path data from `js/mdi.js`, not a lookalike — the tool
makes no external requests, so the geometry has to be local for the preview to be honest.

## How the pieces fit

```
js/theme.js      palettes, RGB565 quantising, the Kelvin->RGB curve
js/catalog.js    one entry per card type: sizes, domains, inspector fields
js/fonts.js      the four text steps, and what they are called in YAML
js/layout.js     WHERE EVERY SUB-WIDGET SITS. read by both the preview and the generator
js/store.js      the project, undo, autosave, validation
js/canvas.js     the 1280x720 stage: draw, drag, resize, snap
js/icons.js      the LVGL symbol set redrawn as SVG, because a browser has no such glyph
js/mdi.js        90 Material Design icons as 24x24 path data, for the preview only
js/entitypick.js the entity search: ranking (pure, testable) + the dropdown
js/gen-yaml.js   the ESPHome config
js/gen-header.js panelcreator_ui.h — the same bytes for every panel
js/gen-docs.js   the README that ships in the download
js/zip.js        a 90-line store-only ZIP writer
js/inspector.js  the right-hand property panel
js/app.js        wiring
```

The rule that matters: **`layout.js` is the only place geometry is computed.** The preview and
the generator both read from it. Compute a coordinate twice and the preview quietly stops being
true, which would make the whole tool pointless.

## Checking a change

`tools/generate.js` runs the generator outside the browser, so a config can go straight through
the compiler instead of being eyeballed:

```bash
node tools/generate.js --selftest tools/out
```

That writes six projects covering every card type, both speaker modes, both typefaces, both card
corner styles, both fill orientations and a portrait panel. It writes `panelcreator_ui.h` and the
sprite frames alongside each one, so a project is validatable where it lands — and since that
header is identical everywhere, `md5sum tools/out/*/panelcreator_ui.h` collapsing to a single
hash is the check that it has stayed project-independent. Then validate them with a local
ESPHome install. `esphome config` isn't enough on its own; it passes configs that fail on the
board, so compile the richest one too:

```bash
esphome config tools/out/pf-test-hall/pf-test-hall.yaml
esphome compile tools/out/pf-test-kitchen-sink/pf-test-kitchen-sink.yaml
```

Things that will trip you up on the way:

* Each project needs its **own folder** and its own `secrets.yaml` with dummy values. A missing
  one fails as `Invalid YAML syntax`, which reads like a generator bug and isn't.
* On Windows, build from PowerShell. Git Bash cannot build: ESP-IDF refuses, and ESPHome still
  reports success.
* On Windows, keep the config path free of spaces. ESP-IDF's linker script generator fails with
  `ldgen.py: error: unrecognized arguments: ||` otherwise.

## The header is uploaded once, ever

`panelcreator_ui.h` is **byte-identical for every panel and every regeneration** — the self-test
asserts one MD5 across all six projects. So the install story is:

* **first panel ever:** paste the YAML, put this one file next to it
* **every panel and every change after that:** paste the YAML. That is the whole job.

It was not always so. The header used to be generated per project, which forced a file upload on
every single change — download a zip, get it onto the Home Assistant machine, overwrite a file,
then install. Two things made it project-specific, and both are gone:

* **The colour helpers were omitted unless the panel had a dimmable light.** Not arbitrary: they
  call `lv_slider_*`, and ESPHome only compiles in the LVGL widgets a config uses, so emitting
  them on a sliderless panel failed with `'lv_slider_get_min_value' was not declared` in a file
  nothing ever calls. That is now `#ifdef USE_LVGL_SLIDER` — ESPHome emits `USE_LVGL_<WIDGET>`
  for each widget in use (`lvgl/__init__.py:477`), and `main.cpp` includes `esphome.h`, hence
  `defines.h`, long before it includes this. Verified both ways: a panel with five sliders and a
  panel with none both compile.
* **The theme's ink colour was baked into two functions.** It is an argument now, so the YAML
  passes it and the C++ stops caring which theme you picked.

It is deliberately **not** called `tab5_ui.h`: hand-written headers of that name already exist
with different signatures, and silently overwriting one would break it.

## Where the header goes

**In the same folder as the `.yaml`** — that is the rule, and it holds however ESPHome is being
run. `includes:` resolves against the **config directory**, and the config directory is derived
from the config file's own path (`CORE.config_dir` → `config_path.absolute().parent`). So a bare
filename means "the file sitting next to me". Same for the sprite: `fanframes/fan00.png`.

Which folder that *is* depends on the setup, which is why the generated README states the rule
and then lists the cases rather than printing one path. With the Home Assistant add-on it is
`/config/esphome/` **on the Home Assistant machine** — not on the computer running this editor,
which is a genuinely easy thing to get stuck on. Standalone ESPHome has no special folder at all:
it is wherever you keep the YAML.

The ESPHome Builder only lists YAML in the **root** of `/config/esphome/` as a device, so every
panel's config shares one folder — which is exactly why the header had to stop being per-panel.
Three panels each wanting their own `tab5_ui.h` in one folder is a collision waiting to happen;
three panels sharing one `panelcreator_ui.h` is just a file.

## New panel, or updating one that is already on the wall

The Panel tab asks. It is remembered with the project, because it is a fact about the panel
rather than a choice to re-make every export, and it changes three things:

* the install steps become **EDIT the existing device → paste → Install wirelessly**, instead of
  **+ NEW DEVICE**
* **no fresh API key is generated.** Every new-panel export mints one; doing that on an update
  rekeys every device reading that secret, and Home Assistant drops them all until it is handed
  the new key. The generated `secrets.yaml` block says to keep the existing one instead.
* the **ESPHome name** field warns that it has to match the existing device exactly. A different
  one does not update anything — it gives you a second device with every entity duplicated and
  suffixed `_2`.

For a look at the editor itself, `tools/shot.html` puts it into a given state so a headless
browser can photograph it:

```bash
chrome --headless=new --window-size=1600,1000 --screenshot=out.png \
  "http://127.0.0.1:8792/tools/shot.html?p=out/pf-test-hall/pf-test-hall.panelcreator.json"
```

## The look, and the 2026-08-17 clean-up

The editor is in the site's **PLATE** language: a technical drawing sheet on squared paper, macaron
pastels, hairline rules, square corners, sage because this is the smart-home pillar. The colour
tokens are copied from the site's theme. The header carries the
real **PCB-bear mark** (`assets/img/yogitech-bear-ink.png`, the same file the site's header uses,
inked for light backgrounds), which also serves as the favicon; it used to be a box-drawing
character standing in for a logo.

**Retyped to match the site's v3.3.2.** Martian Mono was setting nearly every line in this tool,
which is the same mistake the site had: mono-as-a-display-face is the most recognisable
machine-generated "technical" look there is, and squeezing one to −.04em fights the fixed advance
width that defines the face. **Archivo** carries the structure now — labels, buttons, fields, tabs
— and the mono is kept for things that really are data: the panel's pixel dimensions, entity ids,
filenames, generated code. Newsreader sets the prose at **400, never 300**, and Quicksand still
sets the wordmark. Tracking follows the site's scale (small uppercase gets **positive** tracking;
caps have no ascenders or descenders to separate them), and **11 px is a hard floor** where this
tool had 8, 8.5 and 9 px all doing the same job.

Four things moved, all for the same reason — the tool was showing everything at once:

* **The top bar carried five controls of three kinds.** Theme was a *duplicate* of the one already
  in the Panel tab, so it went; preview state is a view control and moved down beside the screen
  picker it belongs with. What is left is identity, the panel's name, and the three things you do
  to a file.
* **The palette was a wall of twelve tiles.** The first thing you decide is whether a card DOES
  something or SHOWS something, and nothing said so. Now **Controls** and **Readouts**.
* **The issues bar wrote one sentence per card.** Four cards sharing an entity filled it with four
  near-identical sentences and pushed everything else behind "+n more" — least useful exactly when
  it had most to say. It is one chip per *kind* now, carrying a count, stepping through the cards
  it covers one click at a time, with the full sentences as its tooltip.
* **Everything was open at once.** The Panel tab ran to about 1400 px of scroll; Screen and Network
  fold shut (their defaults are right for most panels) and it fits on one screen. Alignment folds
  inside the text group, and opens by itself if the card is already using it. Every fold names
  itself, so nothing is hidden — a shut fold still says what is in it.

Also: the keyboard shortcuts left the footer for a hover-open note (worth knowing once, worth
nothing after), the install instructions in the generate dialog became **numbered steps** because
they are numbered, and the Jinja template you have to paste into Home Assistant got a **Copy**
button, since ending up in somebody's clipboard is the entire point of it.

No shadows on chrome, the same as the site. The one exception is the panel preview itself, which
is not chrome — it is a physical panel lying on the drawing sheet.

## Where it runs

It runs at [yogitech.eu/panel-creator/](https://yogitech.eu/panel-creator/). You can also run it
from a copy of this repo: open `index.html`, or double-click `Panel Creator.bat` on Windows.

It's a static folder of HTML and JS that runs as it is, with nothing to build and nothing running
on a server. Every file it loads comes from the same place, fonts and icon outlines included. The
one exception is yogitech.eu's own Umami page counter, which only loads when the page is served
from yogitech.eu, so a local copy makes no network calls.

The editor wants about 1100 px of width and owns the viewport, so link to it rather than putting it
in an `<iframe>`. Under 900 px it shows a "needs a wider screen" notice instead of a broken layout.

### What it stores about whoever uses it

Two `localStorage` keys in your own browser: `panel-creator.project.v1` (the design: device name,
time zone, and each card's entity id and geometry) and `panel-creator.entities.v1` (the entity list
you pasted, for autocomplete). Both are your own Home Assistant names, they never leave your
machine, and clearing site data removes them.

There's no field for Wi-Fi credentials. The generator always writes `!secret wifi_ssid` /
`!secret wifi_password`. The API encryption key is generated at export, handed to you, and never
stored.

## Licence

AGPL-3.0, see [`LICENSE`](../LICENSE). Fonts, icon outlines and the YogiTech logo are under their own
terms; [`NOTICE.md`](../NOTICE.md) lists them.

Made by [YogiTech](https://yogitech.eu). Bug reports and fixes are welcome as GitHub issues and
pull requests.
