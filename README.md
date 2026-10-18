# Panel Creator

Design a Home Assistant touch panel for the **M5Stack Tab5** in your browser, and download an
ESPHome config that compiles.

**Use it here: [yogitech.eu/panel-creator](https://yogitech.eu/panel-creator/)**

Drag cards onto a real-size 1280×720 preview, pick your Home Assistant entities, and Panel Creator
writes the YAML. The Tab5 hardware quirks that make a hand-written config boot-loop or show a black
screen are already handled.

## What you need

- An M5Stack Tab5
- Home Assistant with the ESPHome Builder add-on (ESPHome 2026.7 or newer)
- A USB-C cable for the very first install. After that, updates go over Wi-Fi.

## Before you start: check your board

Panel Creator asks for two things on the **Panel** tab, under **Your Tab5**.

- **Chip revision.** Plug the Tab5 in, open [esptool-js](https://espressif.github.io/esptool-js/)
  and press **Connect**. The log says `Chip is ESP32-P4 (revision v1.3)` or similar. It only reads
  the chip and writes nothing.
- **Display controller.** M5Stack has shipped three: ILI9881C, ST7123 and ST7121. Their
  [Tab5 page](https://docs.m5stack.com/en/core/Tab5) lists when each one changed. Not sure? The
  firmware reads it from the panel and shows it in Home Assistant as "Display controller".

## Installing

The download comes with step-by-step instructions written for your panel. In short:

1. In the ESPHome Builder, create a new device with the same name you used in Panel Creator.
2. Edit it, select everything, and paste in the generated YAML.
3. Put `panelcreator_ui.h` next to it in `/config/esphome/`, once. Every panel shares it.
4. Add the encryption key to your secrets.
5. Install over USB the first time, then wirelessly after that.

## Running it locally

It's a static page with nothing to install. Clone the repo and open `index.html`, or double-click
`Panel Creator.bat` on Windows. Your design is saved in your browser.

## How it works

Why the slider can feel stepped, how text sizes are fitted, the hardware traps in the generated
config, and how to test a change: [docs/how-it-works.md](docs/how-it-works.md).

## Licence

AGPL-3.0, see [LICENSE](LICENSE). Fonts, icon outlines and the YogiTech logo have their own terms,
listed in [NOTICE.md](NOTICE.md).

Made by [YogiTech](https://yogitech.eu). Bug reports and fixes are welcome as issues and pull
requests.
