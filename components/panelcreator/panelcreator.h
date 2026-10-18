// Panel Creator: the component class, plus the colour helpers the generated
// YAML calls from its lambdas (tab5::tint_light_tile and friends).
// ESPHome puts every component header into esphome.h, which main.cpp includes,
// so the lambdas see these without an `includes:` line.
#pragma once
#include <cmath>
#include "esphome/core/defines.h"
#include "esphome/core/component.h"
#ifdef USE_LVGL_SLIDER
#include "esphome/components/lvgl/lvgl_esphome.h"
#endif

#define PANELCREATOR_VERSION "1.0.0"

namespace esphome {
namespace panelcreator {

class PanelCreator : public Component {
 public:
  void dump_config() override;
  float get_setup_priority() const override { return setup_priority::DATA; }
};

}  // namespace panelcreator
}  // namespace esphome


// =====================================================================
//  Colour helpers, for light tiles that dim.
//
//  Guarded because they call lv_slider_*, and ESPHome only compiles in
//  the LVGL widgets a config actually uses. On a panel with no slider
//  anywhere, these would fail to build in a file nothing ever calls:
//      "lv_slider_get_min_value" was not declared in this scope
//  ESPHome emits USE_LVGL_<WIDGET> for each widget in use; defines.h,
//  included above, is where they come from.
// =====================================================================
#ifdef USE_LVGL_SLIDER

namespace tab5 {

// Perceived luminance (ITU-R BT.601) -> ink that stays readable on it.
// `on_card` is the panel theme's normal text colour, passed in by the
// YAML so this file does not have to know which theme is in use.
inline lv_color_t ink_for(uint8_t r, uint8_t g, uint8_t b, lv_color_t on_card) {
  float l = 0.299f * r + 0.587f * g + 0.114f * b;
  return l > 150.0f ? lv_color_hex(0x160F08) : on_card;
}

// Colour temperature -> RGB, clamped to this bulb's own Kelvin range.
inline void kelvin_rgb(int k, int kmin, int kmax,
                       uint8_t &r, uint8_t &g, uint8_t &b) {
  float t = (float)(k - kmin) / (float)(kmax - kmin);
  if (t < 0.0f) t = 0.0f;
  if (t > 1.0f) t = 1.0f;
  r = (uint8_t)(255.0f - t * 40.0f);
  g = (uint8_t)(150.0f + t * 78.0f);
  b = (uint8_t)( 55.0f + t * 190.0f);
}

// ---------------------------------------------------------------------
// Pick each label's ink by whether the FILL ACTUALLY REACHES it, rather
// than guessing from a brightness threshold — which is what left black
// text stranded on a dark card the moment the light was dimmed.
//
// Which axis to measure along is not a guess either. LVGL's bar defaults
// to LV_BAR_ORIENTATION_AUTO, i.e. horizontal only when width >= height,
// so a TALL tile fills upwards from the bottom on its own. Measuring the
// width there would be nonsense, so ask the widget.
// ---------------------------------------------------------------------
inline bool tile_is_horizontal(lv_obj_t *fill) {
  lv_bar_orientation_t o = lv_bar_get_orientation(fill);
  if (o == LV_BAR_ORIENTATION_HORIZONTAL) return true;
  if (o == LV_BAR_ORIENTATION_VERTICAL) return false;
  return lv_obj_get_width(fill) >= lv_obj_get_height(fill);
}

inline void tile_ink(lv_obj_t *fill, lv_obj_t *lbl_name, lv_obj_t *lbl_val,
                     lv_color_t on_fill, lv_color_t on_card) {
  int32_t vmin = lv_slider_get_min_value(fill);
  int32_t vmax = lv_slider_get_max_value(fill);
  int32_t val  = lv_slider_get_value(fill);
  float frac = (vmax > vmin) ? (float)(val - vmin) / (float)(vmax - vmin) : 0.0f;
  bool hor = tile_is_horizontal(fill);
  int span    = hor ? lv_obj_get_width(fill) : lv_obj_get_height(fill);
  int fill_px = (int)(frac * span);
  // horizontal: covered once the fill passes the label's right edge.
  // vertical:   the fill grows UP from the bottom, so covered once the
  //             top of the fill has risen above the label's top.
  auto ink = [&](lv_obj_t *lbl) {
    if (!lbl) return;
    bool covered = hor
      ? (fill_px >= lv_obj_get_x(lbl) + lv_obj_get_width(lbl))
      : (span - fill_px <= lv_obj_get_y(lbl));
    lv_obj_set_style_text_color(lbl, covered ? on_fill : on_card, LV_PART_MAIN);
  };
  ink(lbl_name);
  ink(lbl_val);
}

// Tint a light tile to the bulb's real colour temperature, then re-ink.
// Call on BOTH brightness and colour-temperature changes.
inline void tint_light_tile(lv_obj_t *fill, lv_obj_t *lbl_name, lv_obj_t *lbl_val,
                            int kelvin, int kmin, int kmax, uint32_t on_card) {
  uint8_t r, g, b;
  kelvin_rgb(kelvin, kmin, kmax, r, g, b);
  lv_color_t card = lv_color_hex(on_card);
  lv_obj_set_style_bg_color(fill, lv_color_make(r, g, b), LV_PART_INDICATOR);
  tile_ink(fill, lbl_name, lbl_val, ink_for(r, g, b, card), card);
}

// Same, for a light with no colour temperature: the fill colour is fixed,
// only the ink has to follow it.
inline void plain_light_tile(lv_obj_t *fill, lv_obj_t *lbl_name, lv_obj_t *lbl_val,
                             uint32_t rgb, uint32_t on_card) {
  lv_color_t card = lv_color_hex(on_card);
  tile_ink(fill, lbl_name, lbl_val,
           ink_for((rgb >> 16) & 0xFF, (rgb >> 8) & 0xFF, rgb & 0xFF, card), card);
}

}  // namespace tab5
#endif  // USE_LVGL_SLIDER
