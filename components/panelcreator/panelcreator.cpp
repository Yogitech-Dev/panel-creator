// Panel Creator: helper code for M5Stack Tab5 wall panels, loaded by
//   external_components: [{source: github://yogitech-dev/panel-creator@<tag>}]
//   panelcreator:
// This file holds the boot-loop fix. It lives in a .cpp (one translation unit)
// on purpose: a second copy of the reservation with the same start address
// aborts the boot, and a header can end up included more than once.
#include "panelcreator.h"
#include "esphome/core/log.h"
#include "heap_memory_layout.h"

// =====================================================================
//  THE BOOTLOOP FIX — keep the SPM region out of the heap.
//
//  ESP32-P4 has an 8 kB region at 0x30100000 that ESP-IDF calls
//  spm_idram_seg. heap/port/esp32p4/memory_layout.c registers it as heap
//  UNCONDITIONALLY, as a low-priority fallback for generic
//  MALLOC_CAP_INTERNAL allocations:
//      { 0x30100000, 0x2000, SOC_MEMORY_TYPE_SPM, 0, false }
//
//  But spi_flash's own sanity check accepts ONLY real DRAM:
//      static inline bool esp_task_stack_is_sane_cache_disabled(void) {
//        return esp_ptr_in_dram(sp) ...        // 0x4ff00000-0x4ffc0000
//      }
//
//  So if an early task stack happens to land in SPM and that task then
//  does a flash operation (which disables the cache), you get:
//      assert failed: spi_flash_disable_interrupts_caches_and_other_cpu
//                     cache_utils.c:127
//  ...before app_main. No ESPHome log, no screen, no WiFi, no OTA rescue.
//  Recovery is a factory image over USB.
//
//  Reserving the region makes that impossible rather than unlikely: no
//  allocation can land there, so no task stack can. Cost is 8 kB of heap
//  that was poor memory anyway — IDF's own comment notes SPM cannot do
//  the 128-bit access SIMD needs.
//
//  START ADDRESS IS NOT 0x30100000 — that crashes. IDF already reserves
//  the statically-used part of SPM starting at exactly that address, and
//  the validator qsorts reservations and demands strictly increasing
//  starts, so a duplicate start aborts in s_prepare_reserved_regions().
//  0x30100100 sits just above it (measured _spm_data_end = 0x30100070)
//  with room for .spm.data to grow. If it ever grows past that, the
//  build aborts LOUDLY at boot with an "overlaps with" message — raise
//  the constant, do not delete the line.
// =====================================================================
SOC_RESERVE_MEMORY_REGION(0x30100100, 0x30102000, tab5_spm_never_a_task_stack);

namespace esphome {
namespace panelcreator {

static const char *const TAG = "panelcreator";

void PanelCreator::dump_config() {
  ESP_LOGCONFIG(TAG, "Panel Creator helpers %s (SPM 0x30100100-0x30102000 kept out of the heap)", PANELCREATOR_VERSION);
}

}  // namespace panelcreator
}  // namespace esphome
