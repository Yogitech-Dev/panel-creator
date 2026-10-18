/* =====================================================================
 * gen-header.js — emits tab5_ui.h
 *
 * Two jobs, and the first one is the reason this file exists at all:
 *
 *  1. Reserve the ESP32-P4's 8 kB SPM region out of the heap. Without it a
 *     voice build boot-loops before app_main with no log, no screen and no
 *     OTA to roll back with. The comment in the generated file carries the
 *     full explanation because whoever hits it will be reading the file,
 *     not this generator.
 *  2. Compute colours. YAML can pick a colour but it cannot work one out,
 *     so the Kelvin tint and the "is this label sitting on the fill or on
 *     the card" ink rule have to be C++.
 * ===================================================================== */
(function (PF) {
  'use strict';

  /* ------------------------------------------------------------------
   * THIS FILE IS THE SAME FOR EVERY PANEL. On purpose, and it is the whole
   * reason installing is not a chore: upload it ONCE and every panel you
   * ever generate afterwards is a paste of the YAML and nothing else.
   *
   * It used to be generated per project, which forced a file upload on every
   * change. Two things made it project-specific and both are gone:
   *
   *   * the colour helpers were omitted unless the panel had a dimmable
   *     light, because they call lv_slider_* and ESPHome only compiles in
   *     the LVGL widgets a config uses — emit them for a panel with no
   *     slider and the build dies on 'lv_slider_get_min_value' was not
   *     declared, in a file nothing ever calls. That is now an
   *     `#ifdef USE_LVGL_SLIDER`: ESPHome defines USE_LVGL_<WIDGET> for
   *     every widget in use (lvgl/__init__.py:477), and main.cpp includes
   *     esphome.h — hence defines.h — long before it includes this.
   *   * the theme's ink colour was baked into two functions. It is now an
   *     argument, so the YAML passes it and the C++ stops caring.
   *
   * `project` and `opts` are therefore unused. They stay in the signature
   * because every caller passes them and because the day something genuinely
   * has to vary per panel, it belongs here rather than in a new file.
   * ------------------------------------------------------------------ */
  function build(project, opts) {
    var L = [];
    var P = L.push.bind(L);

    P('// =====================================================================');
    P('//  ' + FILE_NAME + ' — helper code for Panel Creator wall panels.');
    P('//  Pulled in via  esphome: includes: [' + FILE_NAME + ']');
    P('//');
    P('//  THE SAME FILE FOR EVERY PANEL. Upload it once, next to your configs,');
    P('//  and never think about it again: every panel you generate afterwards');
    P('//  is a paste of the YAML and nothing more. Nothing in here is specific');
    P('//  to one panel, so a newer copy is always safe to overwrite an older.');
    P('//');
    P('//  Keep it next to the YAML — `includes:` resolves against the folder');
    P('//  the config is in. The YAML will not compile without this file, and');
    P('//  the board will not boot reliably without the reservation below.');
    P('// =====================================================================');
    P('#pragma once');
    P('#include <cmath>');
    P('');
    P('// =====================================================================');
    P('//  THE BOOTLOOP FIX — keep the SPM region out of the heap.');
    P('//');
    P('//  ESP32-P4 has an 8 kB region at 0x30100000 that ESP-IDF calls');
    P('//  spm_idram_seg. heap/port/esp32p4/memory_layout.c registers it as heap');
    P('//  UNCONDITIONALLY, as a low-priority fallback for generic');
    P('//  MALLOC_CAP_INTERNAL allocations:');
    P('//      { 0x30100000, 0x2000, SOC_MEMORY_TYPE_SPM, 0, false }');
    P('//');
    P('//  But spi_flash\'s own sanity check accepts ONLY real DRAM:');
    P('//      static inline bool esp_task_stack_is_sane_cache_disabled(void) {');
    P('//        return esp_ptr_in_dram(sp) ...        // 0x4ff00000-0x4ffc0000');
    P('//      }');
    P('//');
    P('//  So if an early task stack happens to land in SPM and that task then');
    P('//  does a flash operation (which disables the cache), you get:');
    P('//      assert failed: spi_flash_disable_interrupts_caches_and_other_cpu');
    P('//                     cache_utils.c:127');
    P('//  ...before app_main. No ESPHome log, no screen, no WiFi, no OTA rescue.');
    P('//  Recovery is a factory image over USB.');
    P('//');
    P('//  Reserving the region makes that impossible rather than unlikely: no');
    P('//  allocation can land there, so no task stack can. Cost is 8 kB of heap');
    P('//  that was poor memory anyway — IDF\'s own comment notes SPM cannot do');
    P('//  the 128-bit access SIMD needs.');
    P('//');
    P('//  START ADDRESS IS NOT 0x30100000 — that crashes. IDF already reserves');
    P('//  the statically-used part of SPM starting at exactly that address, and');
    P('//  the validator qsorts reservations and demands strictly increasing');
    P('//  starts, so a duplicate start aborts in s_prepare_reserved_regions().');
    P('//  0x30100100 sits just above it (measured _spm_data_end = 0x30100070)');
    P('//  with room for .spm.data to grow. If it ever grows past that, the');
    P('//  build aborts LOUDLY at boot with an "overlaps with" message — raise');
    P('//  the constant, do not delete the line.');
    P('// =====================================================================');
    P('#include "heap_memory_layout.h"');
    P('SOC_RESERVE_MEMORY_REGION(0x30100100, 0x30102000, tab5_spm_never_a_task_stack);');

    P('');
    P('// =====================================================================');
    P('//  Colour helpers, for light tiles that dim.');
    P('//');
    P('//  Guarded because they call lv_slider_*, and ESPHome only compiles in');
    P('//  the LVGL widgets a config actually uses. On a panel with no slider');
    P('//  anywhere, these would fail to build in a file nothing ever calls:');
    P('//      "lv_slider_get_min_value" was not declared in this scope');
    P('//  ESPHome emits USE_LVGL_<WIDGET> for each widget in use, and main.cpp');
    P('//  includes esphome.h (so, defines.h) before it includes this file.');
    P('// =====================================================================');
    P('#ifdef USE_LVGL_SLIDER');
    {
      P('');
      P('namespace tab5 {');
      P('');
      P('// Perceived luminance (ITU-R BT.601) -> ink that stays readable on it.');
      P('// `on_card` is the panel theme\'s normal text colour, passed in by the');
      P('// YAML so this file does not have to know which theme is in use.');
      P('inline lv_color_t ink_for(uint8_t r, uint8_t g, uint8_t b, lv_color_t on_card) {');
      P('  float l = 0.299f * r + 0.587f * g + 0.114f * b;');
      P('  return l > 150.0f ? lv_color_hex(0x160F08) : on_card;');
      P('}');
      P('');
      P('// Colour temperature -> RGB, clamped to this bulb\'s own Kelvin range.');
      P('inline void kelvin_rgb(int k, int kmin, int kmax,');
      P('                       uint8_t &r, uint8_t &g, uint8_t &b) {');
      P('  float t = (float)(k - kmin) / (float)(kmax - kmin);');
      P('  if (t < 0.0f) t = 0.0f;');
      P('  if (t > 1.0f) t = 1.0f;');
      P('  r = (uint8_t)(255.0f - t * 40.0f);');
      P('  g = (uint8_t)(150.0f + t * 78.0f);');
      P('  b = (uint8_t)( 55.0f + t * 190.0f);');
      P('}');
      P('');
      P('// ---------------------------------------------------------------------');
      P('// Pick each label\'s ink by whether the FILL ACTUALLY REACHES it, rather');
      P('// than guessing from a brightness threshold — which is what left black');
      P('// text stranded on a dark card the moment the light was dimmed.');
      P('//');
      P('// Which axis to measure along is not a guess either. LVGL\'s bar defaults');
      P('// to LV_BAR_ORIENTATION_AUTO, i.e. horizontal only when width >= height,');
      P('// so a TALL tile fills upwards from the bottom on its own. Measuring the');
      P('// width there would be nonsense, so ask the widget.');
      P('// ---------------------------------------------------------------------');
      P('inline bool tile_is_horizontal(lv_obj_t *fill) {');
      P('  lv_bar_orientation_t o = lv_bar_get_orientation(fill);');
      P('  if (o == LV_BAR_ORIENTATION_HORIZONTAL) return true;');
      P('  if (o == LV_BAR_ORIENTATION_VERTICAL) return false;');
      P('  return lv_obj_get_width(fill) >= lv_obj_get_height(fill);');
      P('}');
      P('');
      P('inline void tile_ink(lv_obj_t *fill, lv_obj_t *lbl_name, lv_obj_t *lbl_val,');
      P('                     lv_color_t on_fill, lv_color_t on_card) {');
      P('  int32_t vmin = lv_slider_get_min_value(fill);');
      P('  int32_t vmax = lv_slider_get_max_value(fill);');
      P('  int32_t val  = lv_slider_get_value(fill);');
      P('  float frac = (vmax > vmin) ? (float)(val - vmin) / (float)(vmax - vmin) : 0.0f;');
      P('  bool hor = tile_is_horizontal(fill);');
      P('  int span    = hor ? lv_obj_get_width(fill) : lv_obj_get_height(fill);');
      P('  int fill_px = (int)(frac * span);');
      P('  // horizontal: covered once the fill passes the label\'s right edge.');
      P('  // vertical:   the fill grows UP from the bottom, so covered once the');
      P('  //             top of the fill has risen above the label\'s top.');
      P('  auto ink = [&](lv_obj_t *lbl) {');
      P('    if (!lbl) return;');
      P('    bool covered = hor');
      P('      ? (fill_px >= lv_obj_get_x(lbl) + lv_obj_get_width(lbl))');
      P('      : (span - fill_px <= lv_obj_get_y(lbl));');
      P('    lv_obj_set_style_text_color(lbl, covered ? on_fill : on_card, LV_PART_MAIN);');
      P('  };');
      P('  ink(lbl_name);');
      P('  ink(lbl_val);');
      P('}');
      P('');
      P('// Tint a light tile to the bulb\'s real colour temperature, then re-ink.');
      P('// Call on BOTH brightness and colour-temperature changes.');
      P('inline void tint_light_tile(lv_obj_t *fill, lv_obj_t *lbl_name, lv_obj_t *lbl_val,');
      P('                            int kelvin, int kmin, int kmax, uint32_t on_card) {');
      P('  uint8_t r, g, b;');
      P('  kelvin_rgb(kelvin, kmin, kmax, r, g, b);');
      P('  lv_color_t card = lv_color_hex(on_card);');
      P('  lv_obj_set_style_bg_color(fill, lv_color_make(r, g, b), LV_PART_INDICATOR);');
      P('  tile_ink(fill, lbl_name, lbl_val, ink_for(r, g, b, card), card);');
      P('}');
      P('');
      P('// Same, for a light with no colour temperature: the fill colour is fixed,');
      P('// only the ink has to follow it.');
      P('inline void plain_light_tile(lv_obj_t *fill, lv_obj_t *lbl_name, lv_obj_t *lbl_val,');
      P('                             uint32_t rgb, uint32_t on_card) {');
      P('  lv_color_t card = lv_color_hex(on_card);');
      P('  tile_ink(fill, lbl_name, lbl_val,');
      P('           ink_for((rgb >> 16) & 0xFF, (rgb >> 8) & 0xFF, rgb & 0xFF, card), card);');
      P('}');
      P('');
      P('}  // namespace tab5');
    }
    P('#endif  // USE_LVGL_SLIDER');
    P('');
    return L.join('\n');
  }

  /* ONE fixed name, because the file is now identical for every panel — see
   * build(). Deliberately NOT "tab5_ui.h": a hand-written header of that name
   * already exists in some configs, with different function signatures, and
   * silently overwriting it would break them. */
  var FILE_NAME = 'panelcreator_ui.h';
  function fileName() { return FILE_NAME; }

  PF.genHeader = { build: build, fileName: fileName };
})(window.PF = window.PF || {});
