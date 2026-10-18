"""Panel Creator helpers for M5Stack Tab5 wall panels.

Add to a Panel Creator config:

    external_components:
      - source: github://yogitech-dev/panel-creator@<tag>
        components: [panelcreator]
    panelcreator:

It keeps the ESP32-P4's SPM memory out of the heap (a voice build boot-loops
without it) and provides the colour helpers the generated YAML calls.
"""
import esphome.codegen as cg
import esphome.config_validation as cv
from esphome.const import CONF_ID

CODEOWNERS = ["@yogitech-dev"]

panelcreator_ns = cg.esphome_ns.namespace("panelcreator")
PanelCreator = panelcreator_ns.class_("PanelCreator", cg.Component)

CONFIG_SCHEMA = cv.Schema({cv.GenerateID(): cv.declare_id(PanelCreator)}).extend(
    cv.COMPONENT_SCHEMA
)


async def to_code(config):
    var = cg.new_Pvariable(config[CONF_ID])
    await cg.register_component(var, config)
