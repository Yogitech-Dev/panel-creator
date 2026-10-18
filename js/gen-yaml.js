/* =====================================================================
 * gen-yaml.js — turns the design into an ESPHome config.
 *
 * The device half of this file is not a template anyone should improve by
 * taste. Every line in it was paid for on real hardware:
 *   * V2 boards are ST7123 display AND touch. The official M5Stack config
 *     targets V1 and gives a black screen.
 *   * 16-bit colour only. 24-bit needs 1.92 Gbps and the DSI link has
 *     exactly that before blanking, so it never syncs — black screen, no
 *     log line.
 *   * Mic and speaker share one I2S bus, so both run at 16 kHz.
 *   * The ES8388 powers up on LINE2; the onboard speaker is on LINE1.
 *   * micro_wake_word switches itself off after each detection.
 *   * No battery in a wall panel -> charging OFF or the status pin chatters.
 *   * The heap reservation in tab5_ui.h is what stops the bootloop.
 *
 * Card geometry all comes from layout.js, which is also what the preview
 * draws from. Nothing here re-derives a coordinate.
 * ===================================================================== */
(function (PF) {
  'use strict';

  var H = PF.theme.hex;

  /* ---- tiny YAML helpers ------------------------------------------- */
  function q(s) {
    return '"' + String(s === undefined || s === null ? '' : s)
      .replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  }
  /* Push a multi-line template, re-indenting every line by `pad`. A trailing
   * empty entry in the template is kept — it is how these blocks space
   * themselves out. */
  function T(out, pad, tpl) {
    tpl.replace(/^\n/, '').split('\n').forEach(function (l) {
      out.push(l.length ? pad + l : '');
    });
  }
  /* A label in LVGL flow style. `part` comes from layout.js. */
  function label(id, part, text, color, opts) {
    var bits = [];
    if (id) bits.push('id: ' + id);
    bits.push('x: ' + Math.round(part.x), 'y: ' + Math.round(part.y));
    if (!part.autoW) {
      bits.push('width: ' + Math.round(part.w));
      bits.push('text_align: ' + (part.align === 'center' ? 'CENTER' : part.align === 'right' ? 'RIGHT' : 'LEFT'));
    }
    bits.push('text: ' + q(text));
    bits.push('text_color: ' + H(color));
    bits.push('text_font: ' + part.font);
    if (opts && opts.pad_bottom) bits.push('pad_bottom: ' + Math.round(opts.pad_bottom));
    if (!(opts && opts.clickable)) bits.push('clickable: false');
    return '- label: {' + bits.join(', ') + '}';
  }

  /* ------------------------------------------------------------------
   * THE VALUE AND ITS UNIT, as a flex row.
   *
   * Placing two labels by hand means centring on a guess at how wide the
   * reading will be, and it is hardly ever the guess: a card sized for "888"
   * showed "24" a whole digit right of centre. A flex container re-runs its
   * layout whenever a child's size changes, so LVGL re-centres the pair on
   * every update — no estimate, and it costs one `obj` per card.
   *
   * The obj has to be told to be invisible: an lv_obj defaults to a filled,
   * bordered, scrollable box, none of which is wanted inside a card.
   *
   * `flex_align_cross: END` lines up the two boxes' BOTTOMS, and flex knows
   * nothing about baselines — so the smaller label needs pad_bottom equal to
   * the difference in descender or the unit hangs below the number.
   * ------------------------------------------------------------------ */
  function valueRow(c, id, L) {
    var col = PF.store.colorOf(c, 'color', 'ink');
    var row = L.value.row;
    var main = L.value.align === 'left' ? 'START' : L.value.align === 'right' ? 'END' : 'CENTER';
    return [
      '- obj:',
      '    x: ' + Math.round(row.box.x),
      '    y: ' + Math.round(L.value.y),
      '    width: ' + Math.round(row.box.w),
      '    height: ' + Math.round(row.h),
      '    bg_opa: TRANSP',
      '    border_width: 0',
      '    pad_all: 0',
      '    radius: 0',
      '    scrollable: false',
      '    clickable: false',
      '    layout:',
      '      type: flex',
      '      flex_flow: ROW',
      '      flex_align_main: ' + main,
      '      flex_align_cross: END',
      '      pad_column: ' + row.gap,
      '    widgets:',
      '      ' + label(id, { x: 0, y: 0, autoW: true, font: L.value.font }, '--', col),
      '      ' + label(null, { x: 0, y: 0, autoW: true, font: L.unit.font }, L.unit.text, col,
                       { pad_bottom: row.unitPad })
    ].join('\n');
  }

  /* ------------------------------------------------------------------
   * A card's symbol is a LABEL when it is a montserrat glyph and an IMAGE
   * when it is an MDI icon, and the two are not interchangeable: an image
   * has no text_font and is tinted with image_recolor rather than
   * text_color. Both go through here so a caller never has to care.
   *
   * MDI icons are registered on ctx so the `image:` block can carry exactly
   * the ones used, once each — the same rule the fonts follow. Two cards
   * with the same icon at the same size share one compiled asset; at
   * different sizes they cannot, which is why layout.js snaps to a ladder.
   *
   * image_recolor_opa is REQUIRED. It defaults to TRANSP, so setting
   * image_recolor on its own does nothing at all and the icon comes out in
   * whatever grey the mask happens to be.
   * ------------------------------------------------------------------ */
  function mdiId(name, px) { return 'icn_' + name.replace(/-/g, '_') + '_' + px; }

  function symWidget(id, part, symId, color, ctx) {
    if (!part) return '';
    var mdi = PF.catalog.mdiName(symId);
    if (!mdi) {
      return label(id, part, PF.catalog.symbol(symId).ch, color);
    }
    var iid = mdiId(mdi, part.px);
    ctx.mdiIcons[iid] = { name: mdi, px: part.px };
    var bits = [];
    if (id) bits.push('id: ' + id);
    bits.push('x: ' + Math.round(part.x + (part.w - part.px) / 2));
    bits.push('y: ' + Math.round(part.y));
    bits.push('src: ' + iid);
    bits.push('image_recolor: ' + H(color));
    bits.push('image_recolor_opa: COVER');
    bits.push('clickable: false');
    return '- image: {' + bits.join(', ') + '}';
  }

  /* Recolouring on a state change: a label takes text_color, an image takes
   * image_recolor. Getting this crossed is silent — the widget simply keeps
   * the colour it booted with. */
  function symRecolor(id, symId, expr) {
    var prop = PF.catalog.isMdi(symId) ? 'image_recolor' : 'text_color';
    return ['- lvgl.widget.update:', '    id: ' + id, '    ' + prop + ': ' + expr];
  }

  /* =================================================================== */
  function build(project) {
    var th = PF.theme.byId(project.theme.id);
    var keys = PF.store.keys();
    var P = PF.store.panelSize();
    var cards = project.cards;

    var ctx = {
      globals: [], scripts: [], sensors: [], textSensors: [],
      pages: [], clockLines: [], bootLines: [],
      needFanImages: false, needSwallow: false, needTint: false,
      mdiIcons: {}          /* icn_<name>_<px> -> {name, px}, filled by symWidget */
    };

    var homeWidgets = [];

    cards.forEach(function (c) {
      var k = keys[c.id];
      emitCard(c, k, project, th, ctx, homeWidgets);
    });

    /* The clock only ticks on the minute, so without a boot call it shows
     * --:-- for up to 59 seconds after every restart. */
    if (ctx.clockLines.length) {
      ctx.scripts.unshift([
        '# Every clock label on the panel, redrawn. Called on boot, once a minute,',
        '# and again whenever Home Assistant re-syncs the time.',
        '- id: refresh_clock',
        '  then:',
        indent(ctx.clockLines, '    ')
      ].join('\n'));
      ctx.bootLines.push('- script.execute: refresh_clock');
    }

    /* ---------------- document ---------------- */
    var L = [];
    var voice = project.voice.enabled && project.audio.mode !== 'none';
    var audio = project.audio.mode !== 'none';
    var external = project.audio.mode === 'external';
    var board = Object.assign({ chip: 'production', display: 'ST7123' }, project.board || {});

    T(L, '', [
      '# ---------------------------------------------------------------------------',
      '#  ' + project.device.friendly + ' — M5Stack Tab5 wall panel',
      '#',
      '#  Generated by Panel Creator. Two files: this one and',
      '#  ' + PF.genHeader.fileName(project) + ', which has to sit NEXT TO IT in',
      '#  /config/esphome/ (includes: resolves against the config folder).'
    ].concat([
      '#',
      '#  Six things below are load-bearing on this board. Each cost somebody an',
      '#  evening; the comments say which and why. Changing them is how you get a',
      '#  black screen or a bootloop with no log to read.',
      '#',
      '#  BUILT FOR: a V2 Tab5 with an ' + board.display + ' display and ' +
        (board.chip === 'early' ? 'an EARLY (rev 1.x)' : 'a production (rev 3+)') + ' ESP32-P4.',
      '#  Wrong display = backlight on, black screen; the "Display controller"',
      '#  sensor in Home Assistant then says which one you have. Wrong chip =',
      '#  boot loop. Check the chip at espressif.github.io/esptool-js: Connect,',
      '#  and the log says "Chip is ESP32-P4 (revision v1.3)" or similar. The',
      '#  Builder\'s USB flasher prints the same line. A Tab5 with the older',
      '#  GT911 touch controller (V1) needs the official M5Stack config instead.',
      '# ---------------------------------------------------------------------------',
      ''
    ]).join('\n'));

    T(L, '', [
      'substitutions:',
      '  device_name: ' + project.device.name,
      '  friendly_name: ' + q(project.device.friendly),
      ''
    ].join('\n'));

    /* ---- esphome ---- */
    L.push('esphome:');
    L.push('  name: ${device_name}');
    L.push('  friendly_name: ${friendly_name}');
    L.push('  includes:');
    L.push('    - ' + PF.genHeader.fileName(project));
    L.push('  on_boot:');
    L.push('    priority: -100');
    L.push('    then:');
    L.push('      - rx8130.read_time:');
    if (audio) {
      L.push('      # ES8388 powers up on LINE2; the onboard speaker is on LINE1. Without');
      L.push('      # this the panel is silent and nothing looks broken.');
      L.push('      - select.set:');
      L.push('          id: sel_dac_output');
      L.push('          option: "LINE1"');
    }
    ctx.bootLines.forEach(function (l) { L.push('      ' + l); });
    /* Last on purpose: the delay must not hold up anything above it. */
    T(L, '      ', [
      '# Which display does this Tab5 really have? Ask the touch controller, the way',
      '# M5Stack\'s own firmware does: register 0x0000 reads 1 on ST7121 boards and 3',
      '# on ST7123 boards. The label on the back does not tell you. Works even when',
      '# the screen is black, because Wi-Fi and Home Assistant still come up.',
      '- delay: 3s',
      '- lambda: |-',
      '    uint8_t fw = 0;',
      '    for (int i = 0; i < 10 && fw == 0; i++) {',
      '      if (id(touch).read_register16(0x0000, &fw, 1) != i2c::ERROR_OK) fw = 0;',
      '      if (fw == 0) delay(50);',
      '    }',
      '    std::string ic = fw == 1 ? "ST7121" : fw == 3 ? "ST7123" : "unknown (" + to_string(fw) + ")";',
      '    id(tab5_display_ic).publish_state(ic);',
      '    if (ic != "' + board.display + '") {',
      '      ESP_LOGW("panel", "This Tab5 has a %s display but this firmware is built for ' + board.display +
        ', so the screen stays black. In Panel Creator set Display to %s and install again.", ic.c_str(), ic.c_str());',
      '    }'
    ].join('\n'));
    L.push('');

    var esp32Lines = [
      'esp32:',
      '  variant: esp32p4'
    ];
    if (board.chip === 'early') {
      esp32Lines = esp32Lines.concat([
        '  # Early ESP32-P4 (rev 1.x engineering sample). From ESPHome 2026.8 a P4 build',
        '  # assumes rev 3 silicon unless told otherwise, and an early chip then',
        '  # boot-loops with "Illegal instruction" before anything else starts.',
        '  # This also caps the CPU at 360 MHz, which is what these chips are rated for.',
        '  engineering_sample: true'
      ]);
    }
    T(L, '', esp32Lines.concat([
      '  flash_size: 16MB'
    ]).join('\n'));
    if (board.chip !== 'early') {
      T(L, '', [
        '  # ESPHome warns "400MHz on ESP32-P4 is experimental and may not boot".',
        '  # 400 MHz is the default on rev 3 chips, so the warning is expected rather',
        '  # than a mistake. If your board will not boot, uncomment the line below —',
        '  # and change ONLY this in that build, or you will not know which change',
        '  # fixed it.',
        '  # cpu_frequency: 360MHz'
      ].join('\n'));
    }

    T(L, '', [
      '  framework:',
      '    type: esp-idf',
      '    advanced:',
      '      enable_idf_experimental_features: true',
      '',
      '# The P4 has no radio of its own — WiFi comes from an on-board C6 over SDIO.',
      'esp32_hosted:',
      '  variant: esp32c6',
      '  active_high: true',
      '  clk_pin: GPIO12',
      '  cmd_pin: GPIO13',
      '  d0_pin: GPIO11',
      '  d1_pin: GPIO10',
      '  d2_pin: GPIO9',
      '  d3_pin: GPIO8',
      '  reset_pin: GPIO15',
      '  slot: 1',
      '',
      'psram:',
      '  mode: hex',
      '  speed: 200MHz',
      '',
      'logger:',
      '  hardware_uart: USB_SERIAL_JTAG',
      ''
    ].join('\n'));

    T(L, '', [
      'wifi:',
      '  ssid: !secret wifi_ssid',
      '  password: !secret wifi_password',
      (project.wifi.apFallback ? '  ap:\n    ssid: ' + q(project.device.friendly + ' Fallback') : ''),
      ''
    ].filter(Boolean).join('\n'));

    /* An `ap:` on its own comes up and then does nothing — you can join the
     * hotspot and there is no page on the other end. ESPHome says so itself:
     * "WiFi AP is configured but neither captive_portal nor web_server is
     * enabled. The AP will not be usable for configuration or monitoring."
     * captive_portal is the small one of the two and it is the point of a
     * fallback: join the hotspot, get the WiFi form, put the panel back on
     * the network without unmounting it from the wall. */
    if (project.wifi.apFallback) {
      T(L, '', [
        '# Without this the fallback hotspot exists but has nothing to serve.',
        'captive_portal:',
        ''
      ].join('\n'));
    }

    L.push('api:');
    if (project.api.encryption) {
      L.push('  encryption:');
      L.push('    key: !secret api_encryption_key');
    }
    L.push('');
    L.push('ota:');
    L.push('  - platform: esphome');
    if (project.ota.password) L.push('    password: !secret ota_password');
    L.push('');

    T(L, '', [
      '# Everything on the board hangs off one I2C bus: the IO expanders, the RTC,',
      '# and the audio codec.',
      'i2c:',
      '  - id: bsp_bus',
      '    sda: GPIO31',
      '    scl: GPIO32',
      '    frequency: 400kHz',
      '',
      '# 2.5 V rail the MIPI-DSI PHY needs.',
      'esp_ldo:',
      '  - voltage: 2.5V',
      '    channel: 3',
      '',
      'pi4ioe5v6408:',
      '  - id: pi4ioe1',
      '    address: 0x43',
      '  - id: pi4ioe2',
      '    address: 0x44',
      ''
    ].join('\n'));

    /* ---- audio stack ---- */
    if (audio) {
      T(L, '', [
        '# ---- AUDIO ----------------------------------------------------------------',
        '# ES7210 is the mic ADC (2-mic array), ES8388 the codec/DAC. Both sit on the',
        '# bsp I2C bus and SHARE ONE I2S BUS, which is why everything here is 16 kHz:',
        "# micro_wake_word requires it, and a shared bus running two different rates is",
        '# unsupported (esphome#16043). M5Stack\'s own config uses 48 kHz for the',
        '# speaker and gets away with it because it does not configure a mic.',
        'i2s_audio:',
        '  - id: audio_bus',
        '    i2s_lrclk_pin: GPIO29',
        '    i2s_bclk_pin: GPIO27',
        '    i2s_mclk_pin: GPIO30',
        '',
        'audio_adc:',
        '  - platform: es7210',
        '    id: es7210_adc',
        '    bits_per_sample: 16bit',
        '    sample_rate: 16000',
        '',
        'audio_dac:',
        '  - platform: es8388',
        '    id: es8388_dac',
        '',
        'microphone:',
        '  - platform: i2s_audio',
        '    id: tab5_mic',
        '    i2s_din_pin: GPIO28',
        '    adc_type: external',
        '    sample_rate: 16000',
        '    bits_per_sample: 16bit',
        '',
        'speaker:',
        '  - platform: i2s_audio',
        '    id: tab5_speaker',
        '    i2s_dout_pin: GPIO26',
        '    audio_dac: es8388_dac',
        '    dac_type: external',
        '    channel: mono',
        '    bits_per_sample: 16bit',
        '    sample_rate: 16000',
        '    buffer_duration: 100ms',
        '',
        'select:',
        '  - platform: es8388',
        '    dac_output:',
        '      name: "DAC Output"',
        '      id: sel_dac_output',
        '    adc_input_mic:',
        '      name: "ADC Input"',
        '      id: sel_adc_input',
        '',
        '# A media_player rather than a bare speaker: ESPHome only tells Home',
        '# Assistant the device can do announcements when one exists.',
        'media_player:',
        '  - platform: speaker',
        '    id: tab5_media',
        '    name: "Panel Speaker"',
        '    # ESPHome defaults this to 50%, so the panel would boot at half volume.',
        '    volume_initial: 100%',
        '    announcement_pipeline:',
        '      speaker: tab5_speaker',
        '      format: FLAC',
        '      sample_rate: 16000',
        '      num_channels: 1',
        ''
      ].join('\n'));
    }

    /* ---- voice ---- */
    if (voice) {
      var models = project.voice.extraWakeWords
        ? ['okay_nabu', 'hey_jarvis', 'alexa']
        : [project.voice.wakeWord];
      T(L, '', [
        '# ---- VOICE ----------------------------------------------------------------',
        '# On-device wake word. Nothing reaches Home Assistant until it fires.',
        '# ESPHome hard-codes max_active_wake_words = 1, so exactly ONE of the models',
        '# below is live at a time and HA picks which from the device page. Compiling',
        '# several means switching is a dropdown instead of a reflash — which matters',
        '# with more than one panel, because HA has NO nearest-satellite arbitration',
        '# (core#113690, still open) and every panel that hears the word answers.',
        'micro_wake_word:',
        '  id: mww',
        '  microphone: tab5_mic',
        '  models:'
      ].join('\n'));
      models.forEach(function (m) { L.push('    - model: ' + m); });
      T(L, '', [
        '  on_wake_word_detected:',
        '    - logger.log:',
        '        format: "WAKE WORD DETECTED: %s"',
        "        args: ['wake_word.c_str()']",
        '        level: INFO',
        '    - script.execute: wake_screen'
      ].join('\n'));
      if (project.voice.showPage) {
        T(L, '', [
          '    - lvgl.page.show: page_voice',
          '    - lvgl.label.update: {id: lbl_va_state, text: "LISTENING"}',
          '    - lvgl.label.update: {id: lbl_va_text, text: ""}',
          '    - lvgl.widget.update: {id: voice_ring, border_color: ' + H(th.accent2) + '}'
        ].join('\n'));
      }
      T(L, '', [
        '    # request_start() is a no-op unless the state is IDLE, so a follow-up',
        '    # turn that is still open has to be stopped first.',
        '    - if:',
        '        condition:',
        '          voice_assistant.is_running:',
        '        then:',
        '          - voice_assistant.stop:',
        '          - delay: 300ms',
        (project.voice.followUp ? '    - lambda: \'id(followup_count) = 0;\'' : ''),
        '    - voice_assistant.start:',
        '        wake_word: !lambda return wake_word;',
        ''
      ].filter(function (x) { return x !== ''; }).join('\n'));
      L.push('');

      T(L, '', [
        '# Streams mic audio to HA, which does speech-to-text, works out what you',
        '# meant, and sends a reply back. The panel is only a satellite, so the brain',
        '# swaps from a dropdown in HA with no reflash.',
        'voice_assistant:',
        '  id: va',
        '  microphone: tab5_mic',
        '  # Publishes the wake-word list to HA for the pipeline dropdown. It does NOT',
        '  # start or stop detection.',
        '  micro_wake_word: mww'
      ].join('\n'));

      if (!external) {
        T(L, '', [
          '  # Replies come out of the panel itself: instant, quieter, and',
          '  # assist_satellite.announce / tts.speak only exist while this line does.',
          '  media_player: tab5_media'
        ].join('\n'));
      }
      T(L, '', [
        '  noise_suppression_level: 2',
        '  auto_gain: 31dBFS',
        '  volume_multiplier: 2.0',
        ''
      ].join('\n'));

      if (external) {
        T(L, '', [
          '  # Replies come out of a speaker elsewhere in the room. Louder, about a',
          '  # second slower to start, and the mic stops fighting the speaker for the',
          '  # I2S bus. Do NOT also set media_player: above — you get every reply twice.',
          '  on_tts_end:',
          '    - homeassistant.action:',
          '        action: media_player.play_media',
          '        data:',
          '          entity_id: ' + project.voice.externalPlayer,
          '          media_content_type: music',
          '          media_content_id: !lambda return x;',
          ''
        ].join('\n'));
      }

      T(L, '', [
        '  on_client_connected:',
        '    - script.execute: start_wake_word',
        '  on_client_disconnected:',
        '    - micro_wake_word.stop:',
        ''
      ].join('\n'));

      if (project.voice.followUp) {
        T(L, '', [
          '  on_start:',
          "    - lambda: 'id(turn_had_speech) = false;'",
          '  on_stt_end:',
          "    - lambda: 'id(turn_had_speech) = true;'"
        ].join('\n'));
      } else {
        L.push('  on_stt_end:');
      }
      T(L, '', [
        '    - logger.log:',
        '        format: "HEARD: %s"',
        "        args: ['x.c_str()']",
        '        level: INFO'
      ].join('\n'));
      if (project.voice.showPage) {
        T(L, '', [
          '    - lvgl.label.update: {id: lbl_va_state, text: "THINKING"}',
          '    - lvgl.widget.update: {id: voice_ring, border_color: ' + H(th.accent) + '}',
          '    - lvgl.label.update:',
          '        id: lbl_va_text',
          '        text: !lambda return x;'
        ].join('\n'));
      }
      L.push('  on_tts_start:');
      T(L, '', [
        '    - logger.log:',
        '        format: "REPLY: %s"',
        "        args: ['x.c_str()']",
        '        level: INFO'
      ].join('\n'));
      if (project.voice.showPage) {
        T(L, '', [
          '    - lvgl.label.update: {id: lbl_va_state, text: "SPEAKING"}',
          '    - lvgl.widget.update: {id: voice_ring, border_color: ' + H(th.ok) + '}',
          '    - lvgl.label.update:',
          '        id: lbl_va_text',
          '        text: !lambda return x;'
        ].join('\n'));
      }
      L.push('  on_end:');
      L.push('    # stop_after_detection defaults true, so mww has switched itself off.');
      L.push('    # Without this the wake word works exactly ONCE per boot.');
      L.push('    - script.execute: start_wake_word');
      if (project.voice.showPage) L.push('    - script.execute: close_voice_page');
      if (project.voice.followUp) L.push('    - script.execute: followup_turn');
      L.push('  on_error:');
      T(L, '', [
        '    - logger.log:',
        '        format: "VOICE ERROR: %s / %s"',
        "        args: ['code.c_str()', 'message.c_str()']",
        '        level: ERROR'
      ].join('\n'));
      if (project.voice.showPage) {
        T(L, '', [
          '    - lvgl.label.update: {id: lbl_va_state, text: "ERROR"}',
          '    - lvgl.widget.update: {id: voice_ring, border_color: ' + H(th.warn) + '}',
          '    - lvgl.label.update:',
          '        id: lbl_va_text',
          '        text: !lambda return message;'
        ].join('\n'));
      }
      L.push('    - script.execute: start_wake_word');
      if (project.voice.showPage) L.push('    - script.execute: close_voice_page');
      L.push('');
    }

    /* ---- display / touch / backlight ---- */
    T(L, '', [
      '# ---- SCREEN ---------------------------------------------------------------',
      'display:',
      '  - platform: mipi_dsi',
      '    id: tab5_display',
      '    dimensions:',
      '      height: 1280',
      '      width: 720',
      '    # ' + board.display + ' — set in Panel Creator. ST7121 and ST7123 boards look identical',
      '    # and both say V2; the "Display controller" sensor reports the real one.',
      '    model: M5STACK-TAB5-' + board.display,
      '    # Do NOT set color_depth: 24 or pixel_mode: 24bit. The DSI link is 2 lanes',
      '    # x 960 Mbps = 1.92 Gbps, and 24-bit at this pixel clock needs 80 MHz x 24',
      '    # = 1.92 Gbps, so it is over budget once blanking is counted and never',
      '    # syncs: black screen, nothing in the log. 16-bit needs 1.28 Gbps. Which',
      '    # is also why every fill in this design is flat — RGB565 bands gradients.',
      '    reset_pin:',
      '      pi4ioe5v6408: pi4ioe1',
      '      number: 4',
      '    show_test_card: false',
      '',
      'touchscreen:',
      '  - platform: st7123',
      '    id: touch',
      '    interrupt_pin: GPIO23',
      '    # touch wakes it: resume rendering and bring the backlight straight back',
      '    on_touch:',
      '      then:',
      '        - lvgl.resume:',
      '        - light.turn_on: {id: backlight, brightness: 100%}',
      '    reset_pin:',
      '      pi4ioe5v6408: pi4ioe1',
      '      number: 5',
      '',
      'output:',
      "  # min_power is the backlight driver's useful floor — below roughly 10 % duty",
      '  # it stops regulating, so everything under that looked identical.',
      '  - platform: ledc',
      '    pin: GPIO22',
      '    id: backlight_pwm',
      '    frequency: 1000Hz',
      '    min_power: 10%',
      '    max_power: 100%',
      '    zero_means_zero: true',
      '',
      'light:',
      '  - platform: monochromatic',
      '    output: backlight_pwm',
      '    name: "Display Backlight"',
      '    id: backlight',
      '    restore_mode: RESTORE_DEFAULT_ON',
      '    default_transition_length: 250ms',
      '    # ESPHome defaults gamma_correct to 2.8, which meant half slider gave 14 %',
      '    # duty and the bottom half of the range did nothing visible.',
      '    gamma_correct: ' + project.screen.gamma,
      ''
    ].join('\n'));

    /* ---- time ---- */
    L.push('time:');
    L.push('  # The RTC is the authority once set, so the clock survives a reboot or a');
    L.push('  # WiFi outage. It ships UNSET (reads back as 2088), so Home Assistant');
    L.push('  # writes the real time into it on first sync.');
    L.push('  - platform: rx8130');
    L.push('    id: rtc_time');
    L.push('    i2c_id: bsp_bus');
    L.push('    update_interval: never');
    L.push('    timezone: ' + project.device.timezone);
    if (ctx.clockLines.length) {
      L.push('    on_time:');
      if (ctx.clockLines.length) {
        L.push('      - seconds: 0');
        L.push('        then:');
        L.push('          - script.execute: refresh_clock');
      }
    }
    L.push('  - platform: homeassistant');
    L.push('    id: ha_time');
    L.push('    timezone: ' + project.device.timezone);
    L.push('    on_time_sync:');
    L.push('      then:');
    L.push('        - rx8130.write_time:');
    if (ctx.clockLines.length) L.push('        - script.execute: refresh_clock');
    if (!ctx.clockLines.length) L.push('        - logger.log: "Clock synced from Home Assistant"');
    L.push('');

    /* ---- globals ---- */
    var globals = ctx.globals.slice();
    if (ctx.needSwallow) {
      globals.unshift(
        '  # set by on_long_press, consumed by on_click. A long press fires BOTH, so\n' +
        '  # without this holding a tile to open its page also toggles it.\n' +
        '  - id: swallow_click\n    type: bool\n    initial_value: \'false\'');
    }
    if (voice && project.voice.followUp) {
      globals.push('  - id: followup_count\n    type: int\n    initial_value: \'0\'');
      globals.push('  - id: turn_had_speech\n    type: bool\n    initial_value: \'false\'');
    }
    if (globals.length) {
      L.push('globals:');
      globals.forEach(function (g) { L.push(g); });
      L.push('');
    }

    /* ---- switches ---- */
    L.push('switch:');
    if (project.screen.alwaysOnSwitch) {
      T(L, '  ', [
        '# Pin the screen on (while filming, or during a party) without reflashing.',
        '- platform: template',
        '  id: sw_always_on',
        '  name: "Screen Always On"',
        '  optimistic: true',
        '  restore_mode: RESTORE_DEFAULT_OFF',
        ''
      ].join('\n'));
    }
    T(L, '  ', [
      '- platform: gpio',
      '  id: wifi_power',
      '  name: "WiFi Power"',
      '  pin: {pi4ioe5v6408: pi4ioe2, number: 0}',
      '  restore_mode: ALWAYS_ON',
      '',
      '# No battery in a wall panel -> charging OFF, or the status pin chatters',
      '# in the log forever.',
      '- platform: gpio',
      '  id: charge_enable',
      '  name: "Charge Enable"',
      '  pin: {pi4ioe5v6408: pi4ioe2, number: 7}',
      '  restore_mode: ALWAYS_OFF',
      ''
    ].join('\n'));
    if (audio) {
      T(L, '  ', [
        '# The onboard class-D amp. ' + (external
          ? 'Off by default here: replies go to another speaker, and\n# an amp sitting on an idle input just hisses. Turn it on before aiming\n# media_player.play_media at the panel.'
          : 'On, because this panel does its own talking.'),
        '- platform: gpio',
        '  id: speaker_enable',
        '  name: "Speaker Enable"',
        '  pin: {pi4ioe5v6408: pi4ioe1, number: 1}',
        '  restore_mode: ' + (external ? 'RESTORE_DEFAULT_OFF' : 'RESTORE_DEFAULT_ON'),
        ''
      ].join('\n'));
    }
    if (voice) {
      T(L, '  ', [
        '# Starts/stops micro_wake_word. Off means the panel is genuinely not',
        '# listening rather than listening and ignoring, which is the point in a',
        '# bedroom. Defaults ' + (project.voice.defaultOn ? 'ON' : 'OFF') + '.',
        '- platform: template',
        '  id: sw_wake_word',
        '  name: "Wake Word"',
        '  icon: mdi:microphone',
        '  optimistic: true',
        '  restore_mode: ' + (project.voice.defaultOn ? 'RESTORE_DEFAULT_ON' : 'RESTORE_DEFAULT_OFF'),
        '  turn_on_action:',
        '    - micro_wake_word.start:',
        '  turn_off_action:',
        '    - micro_wake_word.stop:',
        ''
      ].join('\n'));
    }

    /* ---- scripts ---- */
    var scripts = ctx.scripts.slice();
    if (voice) scripts = scripts.concat(voiceScripts(project));
    if (scripts.length) {
      L.push('script:');
      scripts.forEach(function (s) { T(L, '  ', s); L.push(''); });
    }

    /* ---- HA sensors, and the panel's own power meter ---- */
    if (ctx.sensors.length || project.power.monitor) {
      L.push('# ---- live values FROM Home Assistant ---------------------------------------');
      L.push('sensor:');
      ctx.sensors.forEach(function (s) { T(L, '  ', s); L.push(''); });
      if (project.power.monitor) {
        T(L, '  ', [
          '# The Tab5\'s onboard INA226, reporting what the panel itself draws.',
          '#',
          '# entity_category: diagnostic keeps these three OFF the device\'s control',
          '# list — Home Assistant files them under Diagnostics instead, which is where',
          '# something you look at twice a year belongs. 60 s because a wall panel\'s',
          '# draw does not change fast and every update is a state write to HA.',
          '#',
          '# shunt_resistance and max_current are the TAB5\'S OWN values, not ESPHome\'s',
          '# defaults (0.1 ohm / 3.2 A) — those would report roughly 20x the real',
          '# current, confidently and wrongly.',
          '- platform: ina226',
          '  address: 0x41',
          '  shunt_resistance: 0.005 ohm',
          '  max_current: 8.192 A',
          '  adc_averaging: 16',
          '  update_interval: 60s',
          '  bus_voltage:',
          '    name: Supply Voltage',
          '    entity_category: diagnostic',
          '  current:',
          '    name: Current Draw',
          '    entity_category: diagnostic',
          '  power:',
          '    name: Power Draw',
          '    entity_category: diagnostic'
        ].join('\n'));
        L.push('');
      }
    }
    /* Filled in by the boot self-check in on_boot. */
    ctx.textSensors.push([
      '- platform: template',
      '  id: tab5_display_ic',
      '  name: "Display controller"',
      '  icon: mdi:monitor',
      '  entity_category: diagnostic'
    ].join('\n'));
    if (ctx.textSensors.length || (voice && project.voice.followUp && external)) {
      L.push('# Attributes are read as TEXT on purpose: a light that is OFF reports the');
      L.push("# string 'None', which the numeric sensor platform cannot parse.");
      L.push('text_sensor:');
      if (voice && project.voice.followUp && external) {
        T(L, '  ', [
          '# The panel does not play the reply, so it has no idea how long it lasts.',
          '# Without this the follow-up turn opens the mic while the other speaker is',
          '# mid-sentence and, with no echo cancellation on this board, transcribes',
          '# the assistant\'s own words along with yours.',
          '- platform: homeassistant',
          '  id: ha_reply_player',
          '  entity_id: ' + project.voice.externalPlayer,
          ''
        ].join('\n'));
      }
      ctx.textSensors.forEach(function (s) { T(L, '  ', s); L.push(''); });
    }

    /* Every character a NUMERIC font on this panel has to be able to draw:
   * the fixed base, plus whatever the user's units actually contain. Units
   * are the only user-typed text that lands in a digits-only font, so this
   * is the whole exposure — and it is per panel, so a °C costs one glyph
   * rather than putting the alphabet into a 216 px face. */
  function numericGlyphs(cards) {
    var out = PF.fonts.NUM_GLYPHS;
    cards.forEach(function (c) {
      if (!c.opts) return;
      var extra = '';
      if (c.type === 'sensor' || c.type === 'gauge') extra += String(c.opts.unit || '');
      String(extra).split('').forEach(function (ch) {
        if (out.indexOf(ch) < 0) out += ch;
      });
    });
    return out;
  }

  /* ---- fonts: exactly the ones this panel uses, nothing spare ----
     *
     * The numeric glyph set is what makes a 216 px readout affordable, but it
     * carried a FIXED list — digits, a degree sign, and the letters of ON/OFF.
     * Any unit with another letter in it came out as a blank box on the wall:
     * "°C" rendered as a degree sign and nothing, because there is no C.
     *
     * It went unnoticed while the unit defaulted to a bare "°". Importing
     * entities now fills the unit in from Home Assistant, where it is "°C",
     * "W", "lx", "ppm" — so the fixed list stopped being enough the moment
     * that landed. Collect the characters the panel actually shows instead. */
    if (PF.fonts.family() === 'roboto') {
      var used = collectFonts(cards);
      var numGlyphs = numericGlyphs(cards);
      L.push('# bpp: 4 = anti-aliased. The default of 1 is why stock LVGL text looks thin.');
      L.push('# Downloaded at COMPILE time, so the build machine needs internet — switch the');
      L.push('# generator to Montserrat if that is a problem (it caps at 48 px).');
      L.push('#');
      L.push('# Only the sizes this panel actually uses are here. The f_num_* ones carry');
      L.push('# ONLY "' + numGlyphs + '", which is what makes a big readout');
      L.push('# affordable: the full glyph set at 200 px is most of a megabyte of flash,');
      L.push('# and a clock never needs a letter. Any letter in there is one a unit on');
      L.push('# this panel needs — a missing one is a blank box on the wall.');
      L.push('font:');
      used.forEach(function (f) {
        L.push('  - file: {type: gfonts, family: Roboto, weight: ' + PF.fonts.weightFor(f.px, f.kind) + '}');
        L.push('    id: ' + f.id);
        L.push('    size: ' + f.px);
        L.push('    bpp: 4');
        if (f.kind === 'num') L.push('    glyphs: ' + q(numGlyphs));
      });
      L.push('');
    }

    /* ---- images: the fan sprite, and any MDI icons in use ---- */
    var mdiKeys = Object.keys(ctx.mdiIcons).sort();
    if (ctx.needFanImages || mdiKeys.length) {
      L.push('image:');
      if (ctx.needFanImages) {
        L.push('  # 12 pre-rendered frames instead of rotating one bitmap: rotation');
        L.push('  # resamples every pixel each frame, a flipbook is just a blit. Five');
        L.push('  # blades means 72 degrees of rotational symmetry, so 12 x 6 loops.');
        for (var i = 0; i < 12; i++) {
          var n = ('0' + i).slice(-2);
          L.push('  - platform: file');
          L.push('    file: fanframes/fan' + n + '.png');
          L.push('    id: fanf' + n);
          L.push('    type: RGB');
          L.push('    transparency: alpha_channel');
        }
        if (mdiKeys.length) L.push('');
      }
      if (mdiKeys.length) {
        var bytes = mdiKeys.reduce(function (a, kk) {
          return a + PF.catalog.mdiBytes(ctx.mdiIcons[kk].px);
        }, 0);
        L.push('  # Material Design icons. NOTHING SHIPS WITH THIS CONFIG: ESPHome');
        L.push('  # downloads each svg from Templarian/MaterialDesign at build time and');
        L.push('  # rasterises it, the same trade the gfonts fonts above already make.');
        L.push('  # The machine running the build needs internet; the panel never does.');
        L.push('  #');
        L.push('  # type: GRAYSCALE is deliberate. An MDI glyph is one solid shape, so an');
        L.push('  # 8-bit alpha mask is all it is -- one byte per pixel, anti-aliased, and');
        L.push('  # image_recolor tints it to whatever the theme says. RGB would be three');
        L.push('  # or four bytes for the same picture and could not be recoloured.');
        L.push('  # NEVER pair GRAYSCALE with transparency: alpha_channel -- it is already');
        L.push('  # an alpha mask, and that combination is the standing crash suspect on');
        L.push('  # this board (misaligned-instruction fault, lag that grows with uptime).');
        L.push('  #');
        L.push('  # ' + mdiKeys.length + ' icon' + (mdiKeys.length > 1 ? 's' : '') +
                ', ' + (bytes / 1024).toFixed(1) + ' kB of flash.');
        mdiKeys.forEach(function (kk) {
          var ic = ctx.mdiIcons[kk];
          L.push('  - platform: file');
          L.push('    file: mdi:' + ic.name);
          L.push('    id: ' + kk);
          L.push('    type: GRAYSCALE');
          L.push('    resize: ' + ic.px + 'x' + ic.px);
        });
      }
      L.push('');
    }

    /* ---- LVGL ---- */
    L.push('# =============================================================================');
    L.push('#  UI — flat surfaces, chunky targets. At 11.6 px/mm a comfortable 8 mm finger');
    L.push('#  target is about 95 px, which is where the sizes here come from.');
    L.push('# =============================================================================');
    L.push('lvgl:');
    T(L, '  ', [
      '# ---- IF DRAGGING A SLIDER FEELS STEPPED, START HERE --------------------',
      '# ESPHome defaults buffer_size to 0, which means a FULL-SCREEN buffer:',
      '# 1280 x 720 x 2 bytes = 1.84 MB. At that size it does not even attempt',
      '# internal RAM (lvgl_esphome.cpp only tries internal when the fraction is',
      '# 1/4 or smaller), so every pixel drawn goes over the PSRAM bus. And this',
      '# panel uses rotation, which mipi_dsi cannot do in hardware, so there is a',
      '# second buffer the same size and a rotate pass per flush — PPA-accelerated',
      '# on the P4, software if the PPA client fails to register.',
      '#',
      '# 12% gives a 1/8 buffer (~230 kB) that stands a chance of living in',
      '# internal RAM. More flush calls, each much faster. Try it and watch the',
      '# "Buffer size" line in the boot log to see what you actually got.',
      '# buffer_size: 12%',
      ''
    ].join('\n'));
    T(L, '  ', [
      '# A 1280x720 IPS at full backlight 24/7 is wasted power and real panel wear.',
      '# Two stages so it fades rather than snapping to black. lvgl.pause also stops',
      '# rendering, so the CPU idles too.',
      'on_idle:',
      '  - timeout: ' + project.screen.dimAfter + 's',
      '    then:',
      '      - if:',
      (project.screen.alwaysOnSwitch
        ? '          condition: {switch.is_off: sw_always_on}\n          then:\n            - light.turn_on: {id: backlight, brightness: ' + project.screen.dimLevel + '%}'
        : '          condition:\n            lambda: \'return true;\'\n          then:\n            - light.turn_on: {id: backlight, brightness: ' + project.screen.dimLevel + '%}'),
      '  - timeout: ' + project.screen.offAfter + 's',
      '    then:',
      '      - if:',
      (project.screen.alwaysOnSwitch
        ? '          condition: {switch.is_off: sw_always_on}\n          then:\n            - light.turn_off: backlight\n            - lvgl.pause:'
        : '          condition:\n            lambda: \'return true;\'\n          then:\n            - light.turn_off: backlight\n            - lvgl.pause:'),
      '',
      'displays:',
      '  - tab5_display',
      'touchscreens:',
      '  - touch',
      (project.device.rotation === 'landscape' ? 'rotation: 270' : '# portrait: the panel is natively 720x1280, so no rotation'),
      'bg_color: ' + H(th.bg),
      '',
      'style_definitions:',
      '  - id: card                       # flat: RGB565 bands any large gradient',
      '    bg_color: ' + H(th.card),
      '    bg_opa: COVER',
      '    radius: ' + PF.store.cardRadius(),
      '    border_width: 2',
      '    border_color: ' + H(th.cardBorder),
      '    pad_all: 0',
      '    scrollbar_mode: "OFF"',
      '  - id: kicker',
      '    text_color: ' + H(th.inkDim),
      '    text_font: ' + PF.fonts.fixedFont(16).id,
      '  - id: pill',
      '    bg_color: ' + H(th.strip),
      '    bg_opa: COVER',
      '    radius: 50',
      '    border_width: 2',
      '    border_color: ' + H(th.cardBorder),
      ''
    ].join('\n'));

    L.push('  pages:');
    L.push('    # HOME. Tap a tile to act on it; hold a light tile to open its detail page.');
    L.push('    - id: page_home');
    L.push('      scrollable: false');
    L.push('      scrollbar_mode: "OFF"');
    L.push('      widgets:');
    homeWidgets.forEach(function (w) { T(L, '        ', w); });

    ctx.pages.forEach(function (p) { L.push(''); T(L, '    ', p); });

    if (voice && project.voice.showPage) {
      L.push('');
      T(L, '    ', voicePage(project, th, P));
    }

    L.push('');
    return L.join('\n');
  }

  /* =================================================================== */
  /*  CARDS                                                              */
  /* =================================================================== */
  function emitCard(c, k, project, th, ctx, out) {
    var L = PF.layout.of(c);
    var W = [];                    /* child widget lines, indent 0 */
    var pageId = 'page_' + k;

    function cardOpen(extra) {
      var s = [
        '- obj:',
        '    id: card_' + k,
        '    styles: card',
        '    scrollable: false',
        '    scrollbar_mode: "OFF"',
        /* Only where a child would actually draw over a rounded corner —
         * see needsClip() in layout.js. Everywhere else this is off, because
         * the clip path renders every child into an off-screen ARGB8888 layer
         * per corner strip, masks it and blits it (lv_refr.c:186). A sensor
         * card was paying that for two labels that never reach a corner. */
        '    clip_corner: ' + (PF.layout.needsClip(c) ? 'true' : 'false'),
        '    x: ' + c.x,
        '    y: ' + c.y,
        '    width: ' + c.w,
        '    height: ' + c.h
      ];
      if (extra) s = s.concat(extra);
      s.push('    widgets:');
      return s.join('\n');
    }

    function powerButton(id, entity, service, stripColor, symColor, longPress) {
      var g = L.power;
      var f = L.powerSym || PF.fonts.symbolFont(Math.min(48, Math.round(Math.min(g.w, g.h) * 0.34)));
      var s = [
        '- button:',
        '    id: ' + id,
        '    x: ' + g.x, '    y: ' + g.y,
        '    width: ' + g.w, '    height: ' + g.h,
        '    radius: 0',
        '    bg_color: ' + H(stripColor),
        '    border_width: 0',
        '    widgets:',
        '      - label: {align: CENTER, text: "", text_color: ' + H(symColor) + ', text_font: ' + f.id + '}',
        '    on_click:',
        '      then:'
      ];
      if (longPress) {
        ctx.needSwallow = true;
        s.push('        - if:');
        s.push("            condition: {lambda: 'return !id(swallow_click);'}");
        s.push('            then:');
        s.push('              - homeassistant.action: {action: ' + service + ', data: {entity_id: ' + entity + '}}');
        s.push("        - lambda: 'id(swallow_click) = false;'");
        s.push('    on_long_press:');
        s.push('      then:');
        s.push("        - lambda: 'id(swallow_click) = true;'");
        s.push('        - lvgl.page.show: ' + longPress);
      } else {
        s.push('        - homeassistant.action: {action: ' + service + ', data: {entity_id: ' + entity + '}}');
      }
      return s.join('\n');
    }

    switch (c.type) {

      /* ============================ LIGHT ========================== */
      case 'light': {
        ctx.needTint = true;
        /* Both of these only mean anything on a dimmable light: the Kelvin tint
         * recolours the SLIDER's indicator, and the detail page is two sliders.
         * A non-dimmable light with either switched on would emit references to
         * widgets that were never created. */
        var hasCT = c.opts.colorTemp && c.opts.dimmable;
        var detail = c.opts.detailPage && c.opts.dimmable;
        var fill = hasCT ? 0xEAB35C : PF.store.colorOf(c, 'accent', 'accent');
        var faceR = PF.layout.roundedFace(c) ? PF.store.cardRadius() : 0;
        if (c.opts.dimmable) {
          var g = L.slider;
          W.push([
            '- slider:',
            '    id: sld_' + k,
            '    x: ' + g.x, '    y: ' + g.y,
            '    width: ' + g.w, '    height: ' + g.h,
            '    min_value: 1',
            '    max_value: 100',
            '    value: 1',
            '    bg_color: ' + H(th.card),
            /* When this slider IS the card's rounded face it carries the radius
             * itself, instead of the card clipping it. The indicator has to match
             * or LVGL falls back to a layer anyway — lv_bar.c:590 takes the cheap
             * path only when indic_radius >= bg_radius. */
            '    radius: ' + faceR,
            '    indicator: {bg_color: ' + H(fill) + ', radius: ' + faceR + '}',
            '    knob: {bg_opa: TRANSP, pad_all: 0}',
            '    on_release:',
            '      then:',
            '        - homeassistant.action:',
            '            action: light.turn_on',
            '            data: {entity_id: ' + c.entity + '}',
            '            data_template: {brightness_pct: "{{ bri }}"}',
            '            variables: {bri: !lambda "return (int) x;"}'
          ].join('\n'));

          /* ESPHome's slider schema has no orientation key, so an explicit
           * direction is set once at boot in raw LVGL. Left on `auto` the
           * bar follows its own shape — a tile taller than it is wide fills
           * upwards, which is LVGL's rule, not a choice made here. */
          if (c.opts.fill === 'horizontal' || c.opts.fill === 'vertical') {
            /* LV_SLIDER_ORIENTATION_*, not LV_BAR_ORIENTATION_*. They are
             * separate enum types with identical values, and C++ will not
             * convert one to the other. */
            ctx.bootLines.push('- lambda: |-');
            ctx.bootLines.push('    lv_slider_set_orientation(id(sld_' + k + '), LV_SLIDER_ORIENTATION_' +
              c.opts.fill.toUpperCase() + ');');
          }
        } else {
          var f2 = L.face;
          W.push([
            '- button:',
            '    id: face_' + k,
            '    x: ' + f2.x, '    y: ' + f2.y,
            '    width: ' + f2.w, '    height: ' + f2.h,
            '    radius: ' + faceR,
            '    bg_color: ' + H(th.card),
            '    border_width: 0',
            '    on_click:',
            '      then:',
            '        - homeassistant.action: {action: light.toggle, data: {entity_id: ' + c.entity + '}}'
          ].join('\n'));
        }
        W.push(label('lbl_' + k + '_name', L.name, c.title, th.ink));
        W.push(label('lbl_' + k + '_val', L.value, c.opts.dimmable ? '0%' : 'OFF', th.ink));
        if (L.power) {
          W.push(powerButton('btn_' + k, c.entity, 'light.toggle', th.strip, th.accent,
            detail ? pageId : null));
        }
        out.push(cardOpen() + '\n' + indent(W, '      '));

        /* ---- state plumbing ---- */
        /* One call into tab5_ui.h, which is where the Kelvin curve and the
         * contrast-aware ink rule live. */
        var tintCall = hasCT
          /* the theme's ink goes in as an ARGUMENT. It used to be baked into
           * the header, which is what made the header per-panel and forced a
           * file upload on every change. */
          ? 'tab5::tint_light_tile(id(sld_' + k + '), id(lbl_' + k + '_name), id(lbl_' + k + '_val), k, ' + c.opts.kMin + ', ' + c.opts.kMax + ', ' + H(th.ink) + ');'
          : 'tab5::plain_light_tile(id(sld_' + k + '), id(lbl_' + k + '_name), id(lbl_' + k + '_val), ' + H(fill) + ', ' + H(th.ink) + ');';

        if (c.opts.dimmable) {
          var briActs = [
            "- lvgl.slider.update: {id: sld_" + k + ", value: !lambda 'return (x == \"None\" || x.empty()) ? 0 : (atoi(x.c_str()) / 255.0f) * 100.0f;'}",
            '- lvgl.label.update:',
            '    id: lbl_' + k + '_val',
            '    text: !lambda |-',
            '      int p = (x == "None" || x.empty()) ? 0 : (int) ((atoi(x.c_str()) / 255.0f) * 100.0f);',
            '      char buf[8];',
            '      snprintf(buf, sizeof(buf), "%d%%", p);',
            '      return std::string(buf);'
          ];
          if (hasCT) {
            briActs.push('- lambda: |-');
            briActs.push('    std::string kk = id(ha_' + k + '_k).state;');
            briActs.push('    int k = (kk == "None" || kk.empty()) ? ' + c.opts.kMin + ' : atoi(kk.c_str());');
            briActs.push('    ' + tintCall);
          } else {
            briActs.push('- lambda: |-');
            briActs.push('    ' + tintCall);
          }
          if (detail) {
            briActs.push("- lvgl.slider.update: {id: sld_" + k + "_bri, value: !lambda 'return (x == \"None\" || x.empty()) ? 0 : (atoi(x.c_str()) / 255.0f) * 100.0f;'}");
            briActs.push('- lvgl.label.update:');
            briActs.push('    id: lbl_' + k + '_big');
            briActs.push('    text: !lambda |-');
            briActs.push('      int p = (x == "None" || x.empty()) ? 0 : (int) ((atoi(x.c_str()) / 255.0f) * 100.0f);');
            briActs.push('      char buf[8];');
            briActs.push('      snprintf(buf, sizeof(buf), "%d%%", p);');
            briActs.push('      return std::string(buf);');
          }
          ctx.textSensors.push([
            '- platform: homeassistant',
            '  id: ha_' + k + '_bri',
            '  entity_id: ' + c.entity,
            '  attribute: brightness           # 0-255, or the string None when off',
            '  on_value:',
            '    then:',
            indent(briActs, '      ')
          ].join('\n'));
        } else {
          ctx.textSensors.push([
            '- platform: homeassistant',
            '  id: ha_' + k + '_state',
            '  entity_id: ' + c.entity,
            '  on_value:',
            '    then:',
            '      - lvgl.widget.update:',
            '          id: face_' + k,
            "          bg_color: !lambda 'return x == \"on\" ? lv_color_hex(" + H(fill) + ") : lv_color_hex(" + H(th.card) + ");'",
            // A ternary of two string literals is const char*, and the label wants a
            // std::string — so each arm has to be constructed explicitly or it will
            // not compile.
            '      - lvgl.label.update: {id: lbl_' + k + '_val, text: !lambda \'return x == "on" ? std::string("ON") : std::string("OFF");\'}'
          ].join('\n'));
        }

        if (hasCT) {
          ctx.textSensors.push([
            '- platform: homeassistant',
            '  id: ha_' + k + '_k',
            '  entity_id: ' + c.entity,
            '  attribute: color_temp_kelvin',
            '  on_value:',
            '    then:',
            (detail
              ? "      - lvgl.slider.update: {id: sld_" + k + "_kel, value: !lambda 'return (x == \"None\" || x.empty()) ? " + c.opts.kMin + " : atoi(x.c_str());'}"
              : ''),
            '      - lambda: |-\n' +
            '          int k = (x == "None" || x.empty()) ? ' + c.opts.kMin + ' : atoi(x.c_str());\n' +
            '          ' + tintCall
          ].filter(Boolean).join('\n'));
        }

        if (detail) {
          ctx.pages.push(lightDetailPage(c, k, th, PF.store.panelSize()));
        }
        break;
      }

      /* ============================ TOGGLE ========================= */
      case 'toggle': {
        var onC = PF.store.colorOf(c, 'onColor', 'accent');
        var offC = PF.store.colorOf(c, 'offColor', 'strip');
        var onInk = PF.theme.inkFor(onC, th);
        var dom = (c.entity || 'switch.x').split('.')[0];
        var kids = [];
        if (c.title) kids.push(label('lbl_' + k + '_name', L.name, c.title, th.inkDim));
        if (L.symbol) kids.push(symWidget('lbl_' + k + '_sym', L.symbol, c.opts.symbol, th.ink, ctx));
        if (L.value) kids.push(label('lbl_' + k + '_val', L.value, c.opts.offText || 'OFF', th.ink));
        W.push([
          '- button:',
          '    id: btn_' + k,
          '    x: 0', '    y: 0',
          '    width: ' + c.w, '    height: ' + c.h,
          /* this button IS the card face, so it carries the corners itself
           * rather than making the card clip it */
          '    radius: ' + (PF.layout.roundedFace(c) ? PF.store.cardRadius() : 0),
          '    bg_color: ' + H(offC),
          '    border_width: 0',
          '    widgets:',
          indent(kids, '      '),
          '    on_click:',
          '      then:',
          '        - homeassistant.action: {action: ' + dom + '.toggle, data: {entity_id: ' + c.entity + '}}'
        ].join('\n'));
        out.push(cardOpen() + '\n' + indent(W, '      '));

        var upd = [
          '- lvgl.widget.update:',
          '    id: btn_' + k,
          "    bg_color: !lambda 'return x == \"on\" ? lv_color_hex(" + H(onC) + ") : lv_color_hex(" + H(offC) + ");'"
        ];
        if (L.symbol) {
          symRecolor('lbl_' + k + '_sym', c.opts.symbol,
            "!lambda 'return x == \"on\" ? lv_color_hex(" + H(onInk) + ") : lv_color_hex(" + H(th.ink) + ");'")
            .forEach(function (l) { upd.push(l); });
        }
        if (L.value) {
          upd.push('- lvgl.label.update:');
          upd.push('    id: lbl_' + k + '_val');
          upd.push('    text: !lambda \'return x == "on" ? std::string(' + q(c.opts.onText || 'ON') +
            ') : std::string(' + q(c.opts.offText || 'OFF') + ');\'');
          upd.push('- lvgl.label.update:');
          upd.push('    id: lbl_' + k + '_val');
          upd.push("    text_color: !lambda 'return x == \"on\" ? lv_color_hex(" + H(onInk) + ") : lv_color_hex(" + H(th.ink) + ");'");
        }
        ctx.textSensors.push([
          '- platform: homeassistant',
          '  id: ha_' + k,
          '  entity_id: ' + c.entity,
          '  on_value:',
          '    then:',
          indent(upd, '      ')
        ].join('\n'));
        break;
      }

      /* ============================= FAN =========================== */
      case 'fan': {
        var acc = PF.store.colorOf(c, 'accent', 'accent2');
        W.push(label(null, L.name, c.title, th.inkDim));
        if (L.arc) {
          W.push([
            '- arc:',
            '    id: arc_' + k,
            '    x: ' + L.arc.x, '    y: ' + L.arc.y,
            '    width: ' + L.arc.w, '    height: ' + L.arc.h,
            '    min_value: 0',
            '    max_value: 100',
            '    value: 0',
            '    adjustable: true',
            '    arc_width: ' + L.arc.width,
            '    arc_color: ' + H(th.cardBorder),
            '    arc_rounded: true',
            /* widths and the knob pad come from layout.js, not from here: the
             * knob reaches knob_pad px outside the widget and LVGL does not
             * clip it, so the layout has to have reserved that room. Work it
             * out twice and the preview stops being true. */
            '    indicator: {arc_color: ' + H(acc) + ', arc_width: ' + L.arc.indWidth + ', arc_rounded: true}',
            '    knob: {bg_color: 0xFFFFFF, pad_all: ' + L.arc.knobPad + '}',
            '    on_release:',
            '      then:',
            '        - homeassistant.action:',
            '            action: fan.set_percentage',
            '            data: {entity_id: ' + c.entity + '}',
            '            data_template: {percentage: "{{ p }}"}',
            '            variables: {p: !lambda "return (int) x;"}'
          ].join('\n'));
        }
        if (L.blades) {
          ctx.needFanImages = true;
          W.push([
            '- animimg:',
            '    id: img_' + k,
            '    src: [fanf00, fanf01, fanf02, fanf03, fanf04, fanf05,',
            '          fanf06, fanf07, fanf08, fanf09, fanf10, fanf11]',
            '    duration: 1800ms',
            '    repeat_count: forever',
            '    auto_start: false',
            '    x: ' + L.blades.x, '    y: ' + L.blades.y,
            '    clickable: false'
          ].join('\n'));
        }
        W.push(label('lbl_' + k + '_pct', L.value, '0%', th.ink));
        if (L.power) W.push(powerButton('btn_' + k, c.entity, 'fan.toggle', th.accent2Fill, acc, null));
        out.push(cardOpen() + '\n' + indent(W, '      '));

        var pctActs = [];
        if (L.arc) pctActs.push("- lvgl.arc.update: {id: arc_" + k + ", value: !lambda 'return (x == \"None\" || x.empty()) ? 0 : atoi(x.c_str());'}");
        pctActs.push('- lvgl.label.update:');
        pctActs.push('    id: lbl_' + k + '_pct');
        pctActs.push('    text: !lambda |-');
        pctActs.push('      int p = (x == "None" || x.empty()) ? 0 : atoi(x.c_str());');
        pctActs.push('      char buf[8];');
        pctActs.push('      snprintf(buf, sizeof(buf), "%d%%", p);');
        pctActs.push('      return std::string(buf);');
        if (L.blades) {
          ctx.globals.push('  - id: ' + k + '_pct\n    type: int\n    initial_value: \'0\'');
          ctx.globals.push('  # -1 = unknown; only restart the spin when the bucket really changes\n  - id: ' + k + '_bucket\n    type: int\n    initial_value: \'-1\'');
          ctx.globals.push('  # a `return` inside a lambda only leaves the lambda, so the guard has to\n  # be a real flag rather than an early exit\n  - id: ' + k + '_changed\n    type: bool\n    initial_value: \'false\'');
          pctActs.push("- lambda: 'id(" + k + "_pct) = (x == \"None\" || x.empty()) ? 0 : atoi(x.c_str());'");
          pctActs.push('- script.execute: spin_' + k);
          ctx.scripts.push(fanSpinScript(k));
        }
        ctx.textSensors.push([
          '- platform: homeassistant',
          '  id: ha_' + k + '_pct',
          '  entity_id: ' + c.entity,
          '  attribute: percentage',
          '  on_value:',
          '    then:',
          indent(pctActs, '      ')
        ].join('\n'));

        var stActs = [];
        if (L.blades) {
          stActs.push('# On OFF -> 0. On ON -> re-read the CURRENT percentage: the attribute may');
          stActs.push('# not have changed, so waiting for its trigger would leave the animation');
          stActs.push('# stopped forever.');
          stActs.push('- lambda: |-');
          stActs.push('    if (x != "on") {');
          stActs.push('      id(' + k + '_pct) = 0;');
          stActs.push('    } else {');
          stActs.push('      std::string pc = id(ha_' + k + '_pct).state;');
          stActs.push('      int v = (pc == "None" || pc.empty()) ? 0 : atoi(pc.c_str());');
          stActs.push('      id(' + k + '_pct) = (v > 0) ? v : 100;   // \'on\' with no % = full');
          stActs.push('    }');
          stActs.push('- script.execute: spin_' + k);
          if (L.arc) stActs.push("- lvgl.arc.update: {id: arc_" + k + ", value: !lambda 'return id(" + k + "_pct);'}");
          stActs.push('- lvgl.label.update:');
          stActs.push('    id: lbl_' + k + '_pct');
          stActs.push('    text: !lambda |-');
          stActs.push('      char buf[8];');
          stActs.push('      snprintf(buf, sizeof(buf), "%d%%", id(' + k + '_pct));');
          stActs.push('      return std::string(buf);');
        } else {
          stActs.push('- lvgl.label.update: {id: lbl_' + k +
            '_pct, text: !lambda \'return x == "on" ? std::string("ON") : std::string("0%");\'}');
          if (L.arc) stActs.push("- lvgl.arc.update: {id: arc_" + k + ", value: !lambda 'return x == \"on\" ? 100 : 0;'}");
        }
        ctx.textSensors.push([
          '- platform: homeassistant',
          '  id: ha_' + k + '_state          # the entity STATE, not an attribute',
          '  entity_id: ' + c.entity,
          '  on_value:',
          '    then:',
          indent(stActs, '      ')
        ].join('\n'));
        break;
      }

      /* =========================== SENSOR ========================== */
      case 'sensor': {
        /* The unit is a SEPARATE, smaller label (layout.js UNIT_RATIO) — it
         * never changes, so there is no reason for it to be part of the
         * string being sized. Only the digits go through snprintf. */
        if (c.title) W.push(label(null, L.name, c.title, th.inkDim));
        if (L.unit) W.push(valueRow(c, 'lbl_' + k, L));
        else W.push(label('lbl_' + k, L.value, '--', PF.store.colorOf(c, 'color', 'ink')));
        out.push(cardOpen() + '\n' + indent(W, '      '));
        ctx.sensors.push([
          '- platform: homeassistant',
          '  id: ha_' + k,
          '  entity_id: ' + c.entity,
          (c.opts.attribute ? '  attribute: ' + c.opts.attribute : ''),
          '  on_value:',
          '    then:',
          '      - lvgl.label.update:',
          '          id: lbl_' + k,
          '          text: !lambda |-',
          '            char buf[24];',
          '            snprintf(buf, sizeof(buf), "%.' + (c.opts.decimals | 0) + 'f", x);',
          '            return std::string(buf);'
        ].filter(Boolean).join('\n'));
        break;
      }

      /* =========================== GAUGE ===========================
       *
       * An lvgl `meter`: one scale, optionally a static arc for the good
       * zone, and one indicator that moves. The indicator is driven with
       * lvgl.indicator.update, which is why it gets its own id.
       *
       * Read as a text_sensor like every other numeric here — an unavailable
       * entity reports the string "None", which the numeric platform cannot
       * parse and complains about forever.
       * ============================================================= */
      case 'gauge': {
        var gcol = PF.store.colorOf(c, 'accent', 'accent');
        var gd = L.dial;
        var glo = Number(c.opts.min), ghi = Number(c.opts.max);
        if (!(ghi > glo)) { glo = 0; ghi = 100; }
        var ind = [];
        if (c.opts.band) {
          /* static: drawn once and never updated, so it needs no id */
          ind.push('          - arc:');
          ind.push('              width: ' + gd.width);
          ind.push('              color: ' + H(PF.store.colorOf(c, 'bandColor', 'accent2')));
          ind.push('              start_value: ' + Number(c.opts.bandFrom));
          ind.push('              end_value: ' + Number(c.opts.bandTo));
        }
        if (c.opts.style === 'needle') {
          ind.push('          - line:');
          ind.push('              id: gi_' + k);
          ind.push('              width: ' + Math.max(3, Math.round(gd.width * 0.55)));
          ind.push('              color: ' + H(gcol));
          ind.push('              r_mod: -' + Math.round(gd.w * 0.07));
          ind.push('              value: ' + glo);
        } else {
          ind.push('          - arc:');
          ind.push('              id: gi_' + k);
          ind.push('              width: ' + gd.width);
          ind.push('              color: ' + H(gcol));
          ind.push('              start_value: ' + glo);
          ind.push('              end_value: ' + glo);
        }

        var meter = [
          '- meter:',
          '    id: mtr_' + k,
          '    x: ' + gd.x, '    y: ' + gd.y,
          '    width: ' + gd.w, '    height: ' + gd.h,
          '    bg_opa: TRANSP',
          '    border_width: 0',
          '    scales:',
          '      - range_from: ' + glo,
          '        range_to: ' + ghi,
          /* 270 from 135 puts the gap at the bottom, same geometry as the fan
           * arc so the two cards read as one family */
          '        angle_range: 270',
          '        rotation: 135'
        ];
        if (c.opts.ticks) {
          meter.push('        ticks:');
          meter.push('          count: 25');
          meter.push('          width: 2');
          meter.push('          length: ' + gd.tick);
          meter.push('          color: ' + H(th.cardBorder));
          meter.push('          major:');
          meter.push('            stride: 6');
          meter.push('            width: 3');
          meter.push('            length: ' + Math.round(gd.tick * 1.7));
          meter.push('            color: ' + H(th.inkDim));
          meter.push('            label_gap: 0');
        }
        meter.push('        indicators:');
        ind.forEach(function (l) { meter.push(l); });

        if (c.title) W.push(label(null, L.name, c.title, th.inkDim));
        W.push(meter.join('\n'));
        W.push(label('lbl_' + k, L.value, '--', gcol));
        out.push(cardOpen() + '\n' + indent(W, '      '));

        var gUnit = (c.opts.unit || '').replace(/%/g, '%%');
        ctx.textSensors.push([
          '- platform: homeassistant',
          '  id: ha_' + k,
          '  entity_id: ' + c.entity,
          (c.opts.attribute ? '  attribute: ' + c.opts.attribute : ''),
          '  on_value:',
          '    then:',
          '      - lvgl.indicator.update:',
          '          id: gi_' + k,
          (c.opts.style === 'needle'
            ? '          value: !lambda |-'
            : '          end_value: !lambda |-'),
          '            if (x == "None" || x.empty()) return ' + glo + ';',
          '            float v = atof(x.c_str());',
          '            if (v < ' + glo + ') v = ' + glo + ';',
          '            if (v > ' + ghi + ') v = ' + ghi + ';',
          '            return v;',
          '      - lvgl.label.update:',
          '          id: lbl_' + k,
          '          text: !lambda |-',
          '            if (x == "None" || x.empty()) return std::string("--");',
          '            char buf[24];',
          '            snprintf(buf, sizeof(buf), "%.' + (c.opts.decimals | 0) + 'f' + gUnit + '", atof(x.c_str()));',
          '            return std::string(buf);'
        ].filter(Boolean).join('\n'));
        break;
      }

      /* ======================== TEXT SENSOR ======================== */
      case 'text_sensor': {
        if (c.title) W.push(label(null, L.name, c.title, th.inkDim));
        W.push(label('lbl_' + k, L.value, '--', PF.store.colorOf(c, 'color', 'ink')));
        out.push(cardOpen() + '\n' + indent(W, '      '));
        var body = c.opts.upper
          ? ['            std::string s = x;',
             '            for (auto &ch : s) ch = toupper(ch);',
             '            return s;']
          : ['            return x;'];
        ctx.textSensors.push([
          '- platform: homeassistant',
          '  id: ha_' + k,
          '  entity_id: ' + c.entity,
          (c.opts.attribute ? '  attribute: ' + c.opts.attribute : ''),
          '  on_value:',
          '    then:',
          '      - lvgl.label.update:',
          '          id: lbl_' + k,
          '          text: !lambda |-',
          body.join('\n')
        ].filter(Boolean).join('\n'));
        break;
      }

      /* =========================== COVER =========================== */
      case 'cover': {
        var ccol = PF.store.colorOf(c, 'accent', 'strip');
        var cink = PF.theme.inkFor(ccol, th);
        var SVC = { up: 'cover.open_cover', stop: 'cover.stop_cover', down: 'cover.close_cover' };
        var GLY = { up: '', stop: '', down: '' };
        if (c.title) W.push(label(null, L.name, c.title, th.inkDim));
        L.buttons.forEach(function (b) {
          W.push([
            '- button:',
            '    id: btn_' + k + '_' + b.role,
            '    x: ' + b.x, '    y: ' + b.y,
            '    width: ' + b.w, '    height: ' + b.h,
            '    radius: 14',
            '    bg_color: ' + H(ccol),
            '    border_width: 0',
            '    widgets:',
            '      - label: {align: CENTER, text: "' + GLY[b.role] + '", text_color: ' + H(cink) + ', text_font: ' + L.symbol.id + '}',
            '    on_click:',
            '      then:',
            '        - homeassistant.action: {action: ' + SVC[b.role] + ', data: {entity_id: ' + c.entity + '}}'
          ].join('\n'));
        });
        if (L.position) W.push(label('lbl_' + k + '_pos', L.position, '--', th.inkDim));
        out.push(cardOpen() + '\n' + indent(W, '      '));
        if (L.position) {
          ctx.textSensors.push([
            '- platform: homeassistant',
            '  id: ha_' + k + '_pos',
            '  entity_id: ' + c.entity,
            '  attribute: current_position',
            '  on_value:',
            '    then:',
            '      - lvgl.label.update:',
            '          id: lbl_' + k + '_pos',
            '          text: !lambda |-',
            '            if (x == "None" || x.empty()) return std::string("--");',
            '            char buf[8];',
            '            snprintf(buf, sizeof(buf), "%d%%", atoi(x.c_str()));',
            '            return std::string(buf);'
          ].join('\n'));
        }
        break;
      }

      /* =========================== MEDIA ===========================
       *
       * Everything is read as a text_sensor attribute, including the volume.
       * A stopped player reports the string "None" for media_title and for
       * volume_level, which the numeric platform cannot parse and complains
       * about forever — the same reason the light tiles read brightness as
       * text. So: text in, parsed in the lambda.
       * ============================================================= */
      case 'media': {
        var mcol = PF.store.colorOf(c, 'accent', 'strip');
        var mink = PF.theme.inkFor(mcol, th);
        var MSVC = {
          prev: 'media_player.media_previous_track',
          playpause: 'media_player.media_play_pause',
          next: 'media_player.media_next_track'
        };
        /* Straight out of lv_symbol_def.h rather than typed: PREV F048,
         * PLAY F04B, PAUSE F04C, NEXT F051. All four are in the montserrat
         * fonts ESPHome ships, so the transport needs no image asset — worth
         * keeping that way for the card most likely to be on several panels. */
        var SYM_PREV  = String.fromCharCode(0xF048);
        var SYM_PLAY  = String.fromCharCode(0xF04B);
        var SYM_PAUSE = String.fromCharCode(0xF04C);
        var SYM_NEXT  = String.fromCharCode(0xF051);
        var MGLY = { prev: SYM_PREV, playpause: SYM_PLAY, next: SYM_NEXT };

        if (c.title) W.push(label(null, L.name, c.title, th.inkDim));
        /* long_mode: DOT is an ellipsis and costs nothing. SCROLL animates,
         * so that strip repaints for as long as the track plays. */
        var trackBits = [
          'id: lbl_' + k + '_track',
          'x: ' + Math.round(L.value.x), 'y: ' + Math.round(L.value.y),
          'width: ' + Math.round(L.value.w),
          'text: ' + q('Nothing playing'),
          'text_color: ' + H(th.ink),
          'text_font: ' + L.value.font,
          'long_mode: ' + (c.opts.scroll ? 'SCROLL' : 'DOT'),
          'clickable: false'
        ];
        W.push('- label: {' + trackBits.join(', ') + '}');
        if (L.artist) {
          W.push('- label: {id: lbl_' + k + '_artist' +
            ', x: ' + Math.round(L.artist.x) + ', y: ' + Math.round(L.artist.y) +
            ', width: ' + Math.round(L.artist.w) + ', text: ' + q('') +
            ', text_color: ' + H(th.inkDim) + ', text_font: ' + L.artist.font +
            ', long_mode: DOT, clickable: false}');
        }
        L.buttons.forEach(function (b) {
          W.push([
            '- button:',
            '    id: btn_' + k + '_' + b.role,
            '    x: ' + b.x, '    y: ' + b.y,
            '    width: ' + b.w, '    height: ' + b.h,
            '    radius: 14',
            '    bg_color: ' + H(mcol),
            '    border_width: 0',
            '    widgets:',
            '      - label: {' + (b.role === 'playpause' ? 'id: lbl_' + k + '_pp, ' : '') +
              'align: CENTER, text: "' + MGLY[b.role] + '", text_color: ' + H(mink) +
              ', text_font: ' + L.symbol.id + '}',
            '    on_click:',
            '      then:',
            '        - homeassistant.action: {action: ' + MSVC[b.role] + ', data: {entity_id: ' + c.entity + '}}'
          ].join('\n'));
        });
        if (L.volume) {
          W.push([
            '- slider:',
            '    id: sld_' + k + '_vol',
            '    x: ' + L.volume.x, '    y: ' + L.volume.y,
            '    width: ' + L.volume.w, '    height: ' + L.volume.h,
            '    min_value: 0',
            '    max_value: 100',
            '    value: 0',
            '    bg_color: ' + H(th.cardBorder),
            '    indicator: {bg_color: ' + H(th.accent) + '}',
            '    knob: {bg_color: 0xFFFFFF}',
            /* on_release, not on_value: a drag would otherwise fire one
             * volume_set per intermediate position */
            '    on_release:',
            '      then:',
            '        - homeassistant.action:',
            '            action: media_player.volume_set',
            '            data: {entity_id: ' + c.entity + '}',
            '            data_template: {volume_level: "{{ vol }}"}',
            '            variables: {vol: !lambda "return x / 100.0f;"}'
          ].join('\n'));
        }
        out.push(cardOpen() + '\n' + indent(W, '      '));

        /* ---- what is playing ---- */
        ctx.textSensors.push([
          '- platform: homeassistant',
          '  id: ha_' + k + '_title',
          '  entity_id: ' + c.entity,
          '  attribute: media_title        # the string "None" when stopped',
          '  on_value:',
          '    then:',
          '      - lvgl.label.update:',
          '          id: lbl_' + k + '_track',
          '          text: !lambda |-',
          '            if (x == "None" || x.empty()) return std::string("Nothing playing");',
          '            return x;'
        ].join('\n'));
        if (L.artist) {
          ctx.textSensors.push([
            '- platform: homeassistant',
            '  id: ha_' + k + '_artist',
            '  entity_id: ' + c.entity,
            '  attribute: media_artist',
            '  on_value:',
            '    then:',
            '      - lvgl.label.update:',
            '          id: lbl_' + k + '_artist',
            '          text: !lambda |-',
            '            if (x == "None" || x.empty()) return std::string("");',
            '            return x;'
          ].join('\n'));
        }
        /* ---- play / pause glyph follows the real state ---- */
        ctx.textSensors.push([
          '- platform: homeassistant',
          '  id: ha_' + k + '_state',
          '  entity_id: ' + c.entity,
          '  # The middle key shows what pressing it will DO, so a player that is',
          '  # playing shows PAUSE. Any state other than "playing" reads as paused.',
          '  on_value:',
          '    then:',
          '      - lvgl.label.update:',
          '          id: lbl_' + k + '_pp',
          '          text: !lambda |-',
          '            return x == "playing" ? std::string("' + SYM_PAUSE +
            '") : std::string("' + SYM_PLAY + '");'
        ].join('\n'));
        if (L.volume) {
          ctx.textSensors.push([
            '- platform: homeassistant',
            '  id: ha_' + k + '_vol',
            '  entity_id: ' + c.entity,
            '  attribute: volume_level       # 0.0-1.0, or "None" when the player is off',
            '  on_value:',
            '    then:',
            '      - lvgl.slider.update:',
            '          id: sld_' + k + '_vol',
            '          value: !lambda |-',
            '            if (x == "None" || x.empty()) return 0;',
            '            return (int) (atof(x.c_str()) * 100.0f);'
          ].join('\n'));
        }
        break;
      }

      /* ========================== BUTTON =========================== */
      case 'button': {
        var bcol = PF.store.colorOf(c, 'color', 'strip');
        var bink = PF.theme.inkFor(bcol, th);
        var svc = c.opts.action || guessService(c.entity);
        var bkids = [];
        if (L.symbol) bkids.push(symWidget(null, L.symbol, c.opts.symbol, bink, ctx));
        if (L.value) bkids.push(label(null, L.value, c.title, bink));
        W.push([
          '- button:',
          '    id: btn_' + k,
          '    x: 0', '    y: 0',
          '    width: ' + c.w, '    height: ' + c.h,
          '    radius: ' + (PF.layout.roundedFace(c) ? PF.store.cardRadius() : 0),
          '    bg_color: ' + H(bcol),
          '    border_width: 0',
          '    widgets:',
          indent(bkids, '      '),
          '    on_click:',
          '      then:',
          '        - homeassistant.action: {action: ' + svc + ', data: {entity_id: ' + c.entity + '}}'
        ].join('\n'));
        out.push(cardOpen() + '\n' + indent(W, '      '));
        break;
      }

      /* ========================== CLIMATE ========================== */
      case 'climate': {
        var mcol = PF.store.colorOf(c, 'accent', 'accent');
        var step = c.opts.step === '1' ? 1 : 0.5;
        ctx.globals.push('  # last setpoint we heard from HA; +/- work from this, not from the label\n  - id: ' + k + '_sp\n    type: float\n    initial_value: \'20.0\'');
        if (c.title) W.push(label(null, L.name, c.title, th.inkDim));
        [['minus', L.minus, '', '-'], ['plus', L.plus, '', '+']].forEach(function (b) {
          W.push([
            '- button:',
            '    id: btn_' + k + '_' + b[0],
            '    x: ' + b[1].x, '    y: ' + b[1].y,
            '    width: ' + b[1].w, '    height: ' + b[1].h,
            '    radius: 18',
            '    bg_color: ' + H(th.strip),
            '    border_width: 0',
            '    widgets:',
            '      - label: {align: CENTER, text: "' + b[2] + '", text_color: ' + H(mcol) + ', text_font: ' + L.symbol.id + '}',
            '    on_click:',
            '      then:',
            "        - lambda: 'id(" + k + '_sp) = ' + (b[3] === '+' ? 'std::min' : 'std::max') + '(id(' + k + '_sp) ' + b[3] + ' ' + step.toFixed(1) + 'f, ' +
              (b[3] === '+' ? c.opts.tMax : c.opts.tMin) + ".0f);'",
            '        - homeassistant.action:',
            '            action: climate.set_temperature',
            '            data: {entity_id: ' + c.entity + '}',
            '            data_template: {temperature: "{{ t }}"}',
            "            variables: {t: !lambda 'return id(" + k + "_sp);'}",
            '        - script.execute: sp_' + k
          ].join('\n'));
        });
        W.push(label('lbl_' + k + '_sp', L.setpoint, '--', mcol));
        W.push(label('lbl_' + k + '_now', L.current, 'NOW --', th.inkDim));
        if (L.mode) W.push(label('lbl_' + k + '_mode', L.mode, '--', th.inkDim));
        out.push(cardOpen() + '\n' + indent(W, '      '));

        ctx.scripts.push([
          '# Redraw the setpoint from the global. Called both when HA reports a new',
          '# one and straight after a +/- press, so the number moves under the finger',
          '# instead of waiting for the round trip.',
          '- id: sp_' + k,
          '  then:',
          '    - lvgl.label.update:',
          '        id: lbl_' + k + '_sp',
          '        text: !lambda |-',
          '          char buf[12];',
          '          snprintf(buf, sizeof(buf), "%.' + (step === 1 ? 0 : 1) + 'f°", id(' + k + '_sp));',
          '          return std::string(buf);'
        ].join('\n'));

        ctx.textSensors.push([
          '- platform: homeassistant',
          '  id: ha_' + k + '_sp',
          '  entity_id: ' + c.entity,
          '  attribute: temperature',
          '  on_value:',
          '    then:',
          "      - lambda: 'if (x != \"None\" && !x.empty()) id(" + k + "_sp) = atof(x.c_str());'",
          '      - script.execute: sp_' + k
        ].join('\n'));
        ctx.sensors.push([
          '- platform: homeassistant',
          '  id: ha_' + k + '_now',
          '  entity_id: ' + c.entity,
          '  attribute: current_temperature',
          '  on_value:',
          '    then:',
          '      - lvgl.label.update:',
          '          id: lbl_' + k + '_now',
          '          text: !lambda |-',
          '            char buf[20];',
          '            snprintf(buf, sizeof(buf), "NOW %.1f°", x);',
          '            return std::string(buf);'
        ].join('\n'));
        if (L.mode) {
          ctx.textSensors.push([
            '- platform: homeassistant',
            '  id: ha_' + k + '_mode',
            '  entity_id: ' + c.entity,
            '  on_value:',
            '    then:',
            '      - lvgl.label.update:',
            '          id: lbl_' + k + '_mode',
            '          text: !lambda |-',
            '            std::string s = x;',
            '            for (auto &ch : s) ch = toupper(ch);',
            '            return s;'
          ].join('\n'));
        }
        break;
      }

      /* =========================== CLOCK =========================== */
      case 'clock': {
        if (c.title) W.push(label(null, L.name, c.title, th.inkDim));
        W.push(label('lbl_' + k, L.value, '--:--', PF.store.colorOf(c, 'color', 'ink')));
        if (L.date) W.push(label('lbl_' + k + '_date', L.date, '', th.inkDim));
        out.push(cardOpen() + '\n' + indent(W, '      '));
        ctx.clockLines.push([
          '- lvgl.label.update:',
          '    id: lbl_' + k,
          '    text: !lambda |-',
          '      auto t = id(rtc_time).now();',
          '      if (!t.is_valid()) return std::string("--:--");',
          '      return t.strftime("' + (c.opts.format === '12' ? '%I:%M %p' : '%H:%M') + '");'
        ].join('\n'));
        if (L.date) {
          ctx.clockLines.push([
            '- lvgl.label.update:',
            '    id: lbl_' + k + '_date',
            '    text: !lambda |-',
            '      auto t = id(rtc_time).now();',
            '      if (!t.is_valid()) return std::string("");',
            '      std::string s = t.strftime("%a %d %b");',
            '      for (auto &ch : s) ch = toupper(ch);',
            '      return s;'
          ].join('\n'));
        }
        break;
      }

      /* ============================ TEXT =========================== */
      case 'text': {
        var col = PF.store.colorOf(c, 'color', 'inkDim');
        if (c.opts.card) {
          W.push(label(null, L.body, c.opts.body, col));
          out.push(cardOpen() + '\n' + indent(W, '      '));
        } else {
          var p = { x: c.x + L.body.x, y: c.y + L.body.y, w: L.body.w, px: L.body.px, font: L.body.font, align: L.body.align };
          out.push(label(null, p, c.opts.body, col));
        }
        break;
      }
    }
  }

  /* ---- helpers ------------------------------------------------------ */

  /* Walk every card's layout and gather the distinct fonts it asks for, so
   * the font: block carries exactly those and no spares. A size used by three
   * cards is emitted once — which is why fitPx() snaps to 4 px steps. */
  function collectFonts(cards) {
    var seen = {};
    var out = [];
    function note(part) {
      if (!part || !part.font || part.font.indexOf('montserrat_') === 0) return;
      if (seen[part.font]) return;
      seen[part.font] = true;
      /* read the kind off the id rather than the part: the id is what
       * PF.fonts.idFor() decided, and parts are built by hand all over
       * layout.js — one of them forgetting to copy `kind` through would
       * silently drop the glyph restriction and cost a megabyte of flash. */
      out.push({ id: part.font, px: part.px, kind: /^f_num_/.test(part.font) ? 'num' : 'ui' });
    }
    function walk(v) {
      if (!v || typeof v !== 'object') return;
      if (v.font && v.px) { note(v); return; }
      if (Array.isArray(v)) { v.forEach(walk); return; }
      Object.keys(v).forEach(function (k) { walk(v[k]); });
    }
    cards.forEach(function (c) { walk(PF.layout.of(c)); });
    /* the detail pages and the voice overlay use fixed montserrat sizes, so
     * nothing to collect there */
    out.sort(function (a, b) { return a.px - b.px; });
    return out;
  }

  function indent(arr, pad) {
    return arr.join('\n').split('\n').map(function (l) { return l.length ? pad + l : ''; }).join('\n');
  }

  function guessService(entity) {
    var d = (entity || '').split('.')[0];
    return { scene: 'scene.turn_on', script: 'script.turn_on', button: 'button.press',
             input_button: 'input_button.press', automation: 'automation.trigger' }[d] || (d + '.turn_on');
  }

  function fanSpinScript(k) {
    return [
      '# Called from BOTH the speed trigger and the on/off trigger: the percentage',
      "# attribute doesn't necessarily change when a fan is switched on or off, so",
      '# the animation has to be driven from the STATE as well or it never stops.',
      '- id: spin_' + k,
      '  mode: restart',
      '  then:',
      '    # Bucket the speed so the animation is only touched when the bucket really',
      '    # changes. HA re-sends the percentage constantly and restarting an animimg',
      '    # makes the blades visibly jump.',
      '    - lambda: |-',
      '        int p = id(' + k + '_pct);',
      '        int b = (p <= 0) ? 0 : (p < 20) ? 1 : (p < 45) ? 2 : (p < 75) ? 3 : 4;',
      '        id(' + k + '_changed) = (b != id(' + k + '_bucket));',
      '        id(' + k + '_bucket) = b;',
      '    - if:',
      "        condition: {lambda: 'return id(" + k + '_changed) && id(' + k + "_bucket) == 0;'}",
      '        then: [lvgl.animimg.stop: img_' + k + ']',
      [1, 2, 3, 4].map(function (b) {
        var dur = [0, 2600, 1800, 1100, 600][b];
        var cmp = b === 4 ? '>=' : '==';
        return [
          '    - if:',
          "        condition: {lambda: 'return id(" + k + '_changed) && id(' + k + '_bucket) ' + cmp + ' ' + b + ";'}",
          '        then:',
          '          - lvgl.animimg.update: {id: img_' + k + ', duration: ' + dur + 'ms}',
          '          - lvgl.animimg.start: img_' + k
        ].join('\n');
      }).join('\n')
    ].join('\n');
  }


  function voiceScripts(project) {
    var out = [];
    out.push([
      '- id: wake_screen',
      '  then:',
      '    - lvgl.resume:',
      '    - light.turn_on: {id: backlight, brightness: 100%}',
      '    # on_idle counts time since the last TOUCH, and talking to the panel does',
      '    # not reset it — so a conversation started near the timeout got the screen',
      '    # blanked out from under it mid-reply.',
      "    - lambda: 'lv_display_trigger_activity(nullptr);'"
    ].join('\n'));
    if (project.voice.showPage) {
      out.push([
        '# Leaves the transcript up long enough to read, then goes home. mode: restart',
        '# so a second command re-arms the timer instead of closing mid-sentence.',
        '- id: close_voice_page',
        '  mode: restart',
        '  then:',
        '    - delay: 7s',
        '    - lvgl.page.show: page_home'
      ].join('\n'));
    }
    out.push([
      '# Re-arms the wake word at the end of a run. The delay covers the tail of the',
      '# reply — there is no echo cancellation on this board, so the panel would',
      '# otherwise hear itself.',
      '- id: start_wake_word',
      '  mode: restart',
      '  then:',
      '    - delay: 1500ms',
      '    - if:',
      '        condition:',
      '          switch.is_on: sw_wake_word',
      '        then:',
      '          - micro_wake_word.start:'
    ].join('\n'));
    if (project.voice.followUp) {
      var external = project.audio.mode === 'external';
      var waits = external
        ? ['    # TWO waits, and the first is the important one. The other speaker\'s',
           '    # state lags the play_media call by a second or two, so checking "has it',
           '    # stopped" straight away finds the state still idle from BEFORE the',
           '    # reply, passes instantly, and opens the mic into the assistant\'s own',
           '    # opening words. So: wait for it to START, then wait for it to FINISH.',
           '    - wait_until:',
           '        condition:',
           "          lambda: 'return id(ha_reply_player).state == \"playing\";'",
           '        timeout: 6s',
           '    - wait_until:',
           '        condition:',
           "          lambda: 'return id(ha_reply_player).state != \"playing\";'",
           '        timeout: 30s',
           '    - delay: 900ms       # room reverb plus a little cast slack']
        : ['    # The panel plays the reply itself, so it knows when the speaker goes',
           '    # quiet. Still wait a beat for the room to stop ringing.',
           '    - wait_until:',
           '        condition:',
           '          not:',
           '            speaker.is_playing: tab5_speaker',
           '        timeout: 30s',
           '    - delay: 600ms'];
      out.push([
        '# Keeps the conversation going without the wake word. HA\'s own',
        '# continue_conversation only fires when the agent asks a question back, and',
        '# in practice it rarely does. The chain ends when a turn hears nothing, or',
        '# after 3 turns, so a room with a television in it cannot keep it running.',
        '- id: followup_turn',
        '  mode: restart',
        '  then:'
      ].join('\n') + '\n' + waits.join('\n') + '\n' + [
        '    - if:',
        '        condition:',
        '          and:',
        '            - switch.is_on: sw_wake_word',
        "            - lambda: 'return id(turn_had_speech) && id(followup_count) < 3;'",
        '        then:',
        "          - lambda: 'id(followup_count) += 1;'",
        '          - voice_assistant.start:',
        '        else:',
        "          - lambda: 'id(followup_count) = 0;'"
      ].join('\n'));
    }
    return out;
  }

  /* ---- detail page for a dimmable light ---------------------------- */
  /* ------------------------------------------------------------------
   * A light's detail page — the screen behind a hold.
   *
   * Geometry comes from layout.js (PF.layout.detail), so the editor draws
   * exactly this. It used to be magic numbers right here, which is how the
   * page went unlooked-at: nothing could render it but a real panel.
   *
   * It ADAPTS to what the bulb can do — brightness + colour temperature +
   * Kelvin presets when it has colour, brightness + quick levels when it
   * does not — rather than a fixed layout that leaves half the screen empty.
   * ------------------------------------------------------------------ */
  function lightDetailPage(c, k, th, P) {
    var d = PF.layout.detail(c, P);
    var r = PF.store.cardRadius();
    var accent = PF.store.colorOf(c, 'accent', 'accent');
    var SYM_BACK = String.fromCharCode(0xF053);
    var SYM_PWR = String.fromCharCode(0xF011);
    var W = [];

    /* Back: an arrow AND the word. An unlabelled glyph in a corner is not an
     * obvious way out of a screen you did not mean to open, and this is the
     * one control on the page everybody needs to find first. */
    W.push([
      '- button:',
      '    id: btn_' + k + '_back',
      '    x: ' + d.back.x, '    y: ' + d.back.y,
      '    width: ' + d.back.w, '    height: ' + d.back.h,
      '    radius: ' + Math.min(r, Math.round(d.back.h / 2)),
      '    bg_color: ' + H(th.strip),
      '    border_width: 0',
      '    widgets:',
      '      - label: {x: 18, align: LEFT_MID, text: "' + SYM_BACK + '", text_color: ' + H(th.ink) +
        ', text_font: ' + PF.fonts.symbolFont(34).id + '}',
      '      - label: {x: 62, align: LEFT_MID, text: "BACK", text_color: ' + H(th.ink) +
        ', text_font: ' + PF.fonts.fixedFont(24).id + '}',
      '    on_click:',
      '      then:',
      '        - lvgl.page.show: page_home'
    ].join('\n'));

    W.push('- label: {x: ' + d.title.x + ', y: ' + (d.title.y + 18) + ', width: ' + d.title.w +
      ', text: ' + q(c.title || c.entity) + ', text_color: ' + H(th.ink) +
      ', text_font: ' + PF.fonts.fixedFont(38).id + ', clickable: false}');

    W.push([
      '- button:',
      '    id: btn_' + k + '_pwr',
      '    x: ' + d.toggle.x, '    y: ' + d.toggle.y,
      '    width: ' + d.toggle.w, '    height: ' + d.toggle.h,
      '    radius: ' + Math.min(r, Math.round(d.toggle.h / 2)),
      '    bg_color: ' + H(th.strip),
      '    border_width: 0',
      '    widgets:',
      '      - label: {align: CENTER, text: "' + SYM_PWR + '", text_color: ' + H(th.ink) +
        ', text_font: ' + PF.fonts.symbolFont(40).id + '}',
      '    on_click:',
      '      then:',
      '        - homeassistant.action: {action: light.toggle, data: {entity_id: ' + c.entity + '}}'
    ].join('\n'));

    d.blocks.forEach(function (b) {
      var kids = [];
      if (b.kind === 'bri' || b.kind === 'ct') {
        var isBri = b.kind === 'bri';
        kids.push('- label: {x: ' + (b.kicker.x - b.x) + ', y: ' + (b.kicker.y - b.y) +
          ', text: ' + q(isBri ? 'BRIGHTNESS' : 'COLOUR TEMPERATURE') + ', styles: kicker}');
        kids.push('- label: {id: lbl_' + k + (isBri ? '_big' : '_kbig') + ', x: ' + (b.readout.x - b.x) +
          ', y: ' + (b.readout.y - b.y) + ', width: ' + b.readout.w + ', text_align: RIGHT, text: ' +
          q(isBri ? '0%' : '--') + ', text_color: ' + H(accent) +
          ', text_font: ' + PF.fonts.fixedFont(46).id + '}');
        var cr = Math.min(Math.round(b.control.h / 2), r);
        kids.push([
          '- slider:',
          '    id: sld_' + k + (isBri ? '_bri' : '_kel'),
          '    x: ' + (b.control.x - b.x), '    y: ' + (b.control.y - b.y),
          '    width: ' + b.control.w, '    height: ' + b.control.h,
          '    min_value: ' + (isBri ? 1 : c.opts.kMin),
          '    max_value: ' + (isBri ? 100 : c.opts.kMax),
          '    value: ' + (isBri ? 50 : Math.round((c.opts.kMin + c.opts.kMax) / 2)),
          '    bg_color: ' + H(th.strip),
          '    radius: ' + cr,
          '    indicator: {bg_color: ' + H(accent) + ', radius: ' + cr + '}',
          '    knob: {bg_opa: TRANSP, pad_all: 0}',
          '    on_release:',
          '      then:',
          '        - homeassistant.action:',
          '            action: light.turn_on',
          '            data: {entity_id: ' + c.entity + '}',
          (isBri
            ? '            data_template: {brightness_pct: "{{ v }}"}'
            : '            data_template: {kelvin: "{{ v }}"}'),
          '            variables: {v: !lambda "return (int) x;"}'
        ].join('\n'));
      } else {
        /* Preset rows. Flat fills only — RGB565 bands a gradient, so the
         * Kelvin swatches are stepped colours rather than a ramp. */
        var isCT = b.kind === 'ctpresets';
        var names = isCT ? ['WARMEST', 'WARM', 'NEUTRAL', 'COOL', 'COOLEST'] : ['25%', '50%', '75%', '100%'];
        var levels = [25, 50, 75, 100];
        for (var i = 0; i < b.count; i++) {
          var bx = b.x + b.pad + i * (b.btnW + b.gap);
          var kel = isCT ? Math.round(c.opts.kMin + (c.opts.kMax - c.opts.kMin) * (i / (b.count - 1))) : 0;
          var fill = isCT ? PF.theme.kelvinRgb(kel, c.opts.kMin, c.opts.kMax) : th.strip;
          var ink = isCT ? PF.theme.inkFor(fill, th) : th.ink;
          kids.push([
            '- button:',
            '    x: ' + (bx - b.x), '    y: ' + (b.btnY - b.y),
            '    width: ' + b.btnW, '    height: ' + b.btnH,
            '    radius: ' + Math.min(r, Math.round(b.btnH / 2)),
            '    bg_color: ' + H(fill),
            '    border_width: 0',
            '    widgets:',
            '      - label: {align: CENTER, text: ' + q(names[i]) + ', text_color: ' + H(ink) +
              ', text_font: ' + PF.fonts.fixedFont(19).id + '}',
            '    on_click:',
            '      then:',
            '        - homeassistant.action:',
            '            action: light.turn_on',
            '            data: ' + (isCT
              ? '{entity_id: ' + c.entity + ', kelvin: "' + kel + '"}'
              : '{entity_id: ' + c.entity + ', brightness_pct: "' + levels[i] + '"}')
          ].join('\n'));
        }
      }
      W.push([
        '- obj:',
        '    styles: card',
        '    scrollable: false',
        '    scrollbar_mode: "OFF"',
        '    pad_all: 0',
        '    x: ' + b.x, '    y: ' + b.y,
        '    width: ' + b.w, '    height: ' + b.h,
        '    widgets:',
        indent(kids, '      ')
      ].join('\n'));
    });

    return [
      '- id: page_' + k,
      '  bg_color: ' + H(th.bg),
      '  scrollable: false',
      '  scrollbar_mode: "OFF"',
      '  widgets:',
      indent(W, '    ')
    ].join('\n');
  }

  /* ---- voice overlay page ------------------------------------------ */
  function voicePage(project, th, P) {
    var ringW = Math.min(P.w, P.h) - 120;
    return [
      '# VOICE — opened by the wake word, closes itself 7 s after the pipeline ends.',
      '# Shapes and text only, NO IMAGES: images are the standing crash suspect on',
      '# this board and a voice overlay must never take the panel down.',
      '#',
      '# The transcript is the point. Seeing what it heard on screen tells you',
      '# instantly whether it misheard you or simply does not know that name — which',
      '# is the difference between a mic problem and a missing alias.',
      '- id: page_voice',
      '  scrollable: false',
      '  scrollbar_mode: "OFF"',
      '  bg_color: ' + H(th.bg),
      '  widgets:',
      '    - obj:',
      '        id: voice_ring',
      '        align: CENTER',
      '        width: ' + ringW,
      '        height: ' + ringW,
      '        radius: ' + Math.round(ringW / 2),
      '        bg_opa: TRANSP',
      '        border_width: 10',
      '        border_color: ' + H(th.accent2),
      '        pad_all: 0',
      '        clickable: false',
      '    - label:',
      '        id: lbl_va_state',
      '        align: CENTER',
      '        y: -70',
      '        text: "LISTENING"',
      '        text_color: ' + H(th.inkDim),
      '        text_font: ' + PF.fonts.fixedFont(18).id,
      '    - label:',
      '        id: lbl_va_text',
      '        align: CENTER',
      '        width: ' + Math.round(P.w * 0.62),
      '        text_align: CENTER',
      '        text: ""',
      '        text_color: ' + H(th.ink),
      '        text_font: ' + PF.fonts.fixedFont(30).id
    ].join('\n');
  }

  PF.gen = { yaml: build, label: label, guessService: guessService };
})(window.PF = window.PF || {});
