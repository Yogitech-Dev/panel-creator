/* =====================================================================
 * gen-docs.js — the README that ships in the download.
 *
 * Written for somebody who has never opened an ESPHome YAML file. It says
 * what to do in order, and it says which of the hardware traps they are
 * about to walk into, because every one of them looks like a dead board
 * rather than a mistake.
 * ===================================================================== */
(function (PF) {
  'use strict';

  function newKey() {
    var b = new Uint8Array(32);
    (window.crypto || window.msCrypto).getRandomValues(b);
    var s = '';
    for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s);
  }

  function readme(project, apiKey) {
    var name = project.device.name;
    var L = [];
    var p = L.push.bind(L);
    var voice = project.voice.enabled && project.audio.mode !== 'none';
    var entities = [];
    project.cards.forEach(function (c) { if (c.entity) entities.push(c.entity); });
    entities = entities.filter(function (e, i, a) { return a.indexOf(e) === i; }).sort();

    p('# ' + project.device.friendly);
    p('');
    p('An ESPHome wall panel for the M5Stack Tab5, built with Panel Creator.');
    p('');
    var blades = project.cards.some(function (c) { return c.type === 'fan' && c.opts.blades; });

    p('## What is in here');
    p('');
    var rows = [[name + '.yaml', 'the panel config']];
    if (blades) rows.push(['fanframes/', '12 PNGs, the spinning fan blades']);
    rows.push([name + '.panelcreator.json', 'the design, so you can edit it again later']);
    var col = rows.reduce(function (a, r) { return Math.max(a, r[0].length); }, 0) + 4;
    rows.forEach(function (r) { p('    ' + r[0] + ' '.repeat(col - r[0].length) + r[1]); });
    p('');
    p('All of it goes in the same folder.');
    p('');

    var updating = project.deploy && project.deploy.mode === 'update';

    p('## ' + (updating ? 'Update' : 'Install'));
    p('');
    if (updating) {
      p('This panel already exists, so do **not** add a new device.');
      p('');
      p('1. In Home Assistant, open the **ESPHome Builder** add-on.');
      p('2. Find the card for `' + name + '` and press **EDIT**.');
      p('3. Select everything in the editor and paste in `' + name + '.yaml`. **Save**.');
      p('4. **INSTALL** -> **Wirelessly**.');
      p('');
      p('**Leave `secrets.yaml` alone.** Your WiFi lines and encryption key are already');
      p('there and still correct.');
    } else {
      p('1. In Home Assistant, open the **ESPHome Builder** add-on.');
      p('2. Create a new device and name it `' + name + '`. Which board it suggests does not');
      p('   matter: you are about to replace the file it writes.');
      p('3. **EDIT** the new device, select everything, and paste in `' + name + '.yaml`. **Save**.');
      if (blades) {
        p('4. Put the `fanframes` folder next to the `.yaml`, in `/config/esphome/` on the Home');
        p('   Assistant machine (File editor or Samba add-on). It holds the fan blade animation.');
      }
      p((blades ? '5' : '4') + '. Add the encryption key below to your secrets: **three dots -> Secrets ->');
      p('   Add secret** in the Builder, or the line itself in `secrets.yaml`.');
      p((blades ? '6' : '5') + '. Plug the Tab5 into your computer: **INSTALL** -> **Plug into this computer**.');
      p('   Only the first install needs the cable. After that, **Wirelessly**.');
    }
    p('');
    p('### Nothing else to upload');
    p('');
    p('The config pulls the Panel Creator helper code (the boot-loop fix and the colour');
    p('helpers) from github.com/yogitech-dev/panel-creator when ESPHome builds it, pinned');
    p('to release `' + PF.gen.componentRef + '`. The machine running the build needs internet, which it');
    p('already does for ESPHome itself.');
    p('');

    p('### secrets.yaml');
    p('');
    p('`!secret x` is a REFERENCE, not a value. It is resolved when the config is');
    p('compiled, from `secrets.yaml` in the same folder — so this config carries no');
    p('credential of anybody, and the one you compile picks up yours.');
    p('');
    p('**`wifi_ssid` and `wifi_password` are almost certainly already there.** The');
    p('ESPHome add-on writes both into `secrets.yaml` the first time it starts, so');
    p('unless you renamed them there is nothing to do for those two.');
    p('');
    p('```yaml');
    p('# already in your secrets.yaml if you have ever set up an ESPHome device');
    p('wifi_ssid: "your network"');
    p('wifi_password: "your password"');
    if (project.api.encryption) {
      if (updating) {
        p('# KEEP THE ONE YOU ALREADY HAVE. No new key was generated for this update:');
        p('# changing it rekeys every device reading this secret, and Home Assistant');
        p('# drops the connection until you hand it the new one.');
        p('api_encryption_key: "<the key already in your secrets.yaml>"');
      } else {
        p('# Freshly generated for this panel. It is what Home Assistant uses to talk');
        p('# to the device — keep it, and do not publish it.');
        p('api_encryption_key: "' + apiKey + '"');
      }
    }
    if (project.ota.password) p('ota_password: "pick something"');
    p('```');
    p('');
    if (project.api.encryption && !updating) {
      p('No file editor handy? In ESPHome Builder open **⋮ → Secrets → Add secret**,');
      p('name it `api_encryption_key` and paste only the key itself as the value,');
      p('without the quotes or the name in front. The whole line gets rejected there');
      p('as an invalid key format.');
      p('');
    }

    p('## Flashing, and the bits that look like a dead board');
    p('');
    p('* **Use a USB-A to USB-C cable.** C-to-C is unreliable for flashing this board.');
    p('  It shows up as no serial port at all, which reads like a broken Tab5.');
    p('* **Power-cycle after the first flash.** The panel often stays dark until it has');
    p('  been fully unplugged and plugged back in once. That is normal.');
    var bd = Object.assign({ chip: 'production', display: 'ST7123' }, project.board || {});
    p('* **Built for a V2 Tab5 with an ' + bd.display + ' display and ' +
      (bd.chip === 'early' ? 'an early (rev 1.x)' : 'a rev 3 or newer') + ' ESP32-P4.**');
    p('  * **Screen stays black but the panel is in Home Assistant?** Open the device');
    p('    page and look under Diagnostics: **Display controller** says which display');
    p('    your board really has. Pick that in Panel Creator and install again. V2');
    p('    boards ship with ST7123 or ST7121 and the label does not say which.');
    p('  * **Restarting over and over, no Wi-Fi?** The chip setting is wrong. Open');
    p('    espressif.github.io/esptool-js and click Connect: the log says');
    p('    `Chip is ESP32-P4 (revision v…)`. Nothing gets written.');
    p('    Revision 1.x needs the early setting. Fixing this one takes a USB flash,');
    p('    since a panel that never boots cannot take an update over Wi-Fi.');
    p('  * A V1 Tab5 (GT911 touch controller) needs the official M5Stack config instead.');
    p('* **Do not raise the colour depth.** 24-bit needs more bandwidth than the DSI');
    p('  link has, so it never syncs: black screen, nothing in the log to explain it.');
    p('  Every fill in this design is flat for the same reason — 16-bit colour bands');
    p('  any large gradient.');
    p('');

    p('## Home Assistant side');
    p('');
    p('* On the device page, tick **Allow the device to perform Home Assistant actions**.');
    p('  Without it every button on the panel does nothing, silently.');
    if (entities.length) {
      p('* This panel expects these entities to exist:');
      p('');
      entities.forEach(function (e) { p('      ' + e); });
      p('');
      p('  Check each one in **Settings -> Tools -> States**. A typo shows up as a card');
      p('  that never leaves `--`.');
    }
    if (voice) {
      p('* **Voice matching is exact.** The assistant matches the entity name as Home');
      p('  Assistant knows it, so "ceiling fan light" works and "fan light" does not.');
      p('  Add the short names you actually say under **Settings -> Voice assistants ->');
      p('  Expose -> (entity) -> Aliases**. This is the single biggest reason a working');
      p('  panel feels broken.');
      p('* **Echo cancellation is not in use.** The Tab5 has an ES7210 AEC front-end for');
      p('  its mic array, but ESPHome drives it as a plain microphone ADC, so none of it');
      p('  is applied. In practice the panel cannot be interrupted mid-reply, and it can');
      p('  hear itself. Ask, wait, done.');
      if (project.audio.mode === 'external') {
        p('* Replies play through `' + project.voice.externalPlayer + '`. If that entity is');
        p('  renamed or removed, the panel goes quiet while still working perfectly.');
      }
      if (project.voice.extraWakeWords) {
        p('* Three wake-word models are compiled in but **only one is active at a time** —');
        p('  ESPHome allows exactly one. Pick it on the device page. Useful when you have');
        p('  more than one panel: Home Assistant has no nearest-satellite arbitration, so');
        p('  every panel that hears the same word answers at once.');
      }
    }
    p('');


    p('## Changing it later');
    p('');
    p('Keep the project file (`' + name + '.panelcreator.json`). Load it back into Panel');
    p('Creator, move things around, and re-export. Editing the YAML by hand works too —');
    p('the comments in it explain which lines are load-bearing and why.');
    p('');
    p('---');
    p('');
    p('Generated by Panel Creator — yogitech.eu');
    p('');
    return L.join('\n');
  }

  PF.docs = { readme: readme, newKey: newKey };
})(window.PF = window.PF || {});
