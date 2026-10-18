/* =====================================================================
 * app.js — wiring. Palette, card list, top bar, modals, export.
 * ===================================================================== */
(function (PF) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ---- a starter panel, so the tool never opens empty --------------- */
  function starter() {
    var p = PF.store.blank();
    p.device.name = 'tab5-bedroom-panel';
    p.device.friendly = 'Bedroom Panel';
    var add = function (type, o) {
      var t = PF.catalog.types[type];
      p.cards.push({
        id: 'c' + (p.cards.length + 1), type: type,
        title: o.title || '', entity: o.entity || '',
        x: o.x, y: o.y, w: o.w, h: o.h,
        opts: Object.assign({}, t.defaults, o.opts || {})
      });
    };
    /* three columns of 420 / 340 / 428 with a 16 px gutter and a 30 px margin */
    add('fan',    { title: 'CEILING FAN', entity: 'fan.ceiling_fan',        x: 30,  y: 30,  w: 420, h: 440 });
    add('light',  { title: 'NIGHTSTAND',  entity: 'light.bedroom_lamp',     x: 466, y: 30,  w: 340, h: 440,
                    opts: { colorTemp: true, kMin: 2202, kMax: 4000 } });
    add('clock',  { title: 'BEDROOM',     x: 822, y: 30,  w: 428, h: 250, opts: { showDate: true } });
    add('sensor', { title: 'TEMPERATURE', entity: 'sensor.bedroom_temperature', x: 822,  y: 296, w: 206, h: 174 });
    add('sensor', { title: 'HUMIDITY',    entity: 'sensor.bedroom_humidity',    x: 1044, y: 296, w: 206, h: 174,
                    opts: { unit: '%', decimals: 0 } });
    add('light',  { title: 'CEILING',     entity: 'light.bedroom_ceiling',  x: 30,  y: 486, w: 420, h: 204 });
    add('toggle', { title: 'HEATER',      entity: 'switch.bedroom_heater',  x: 466, y: 486, w: 340, h: 204,
                    opts: { symbol: 'charge' } });
    add('button', { title: 'GOODNIGHT',   entity: 'scene.goodnight',        x: 822, y: 486, w: 428, h: 204,
                    opts: { symbol: 'bell' } });
    return p;
  }

  /* ---- palette ------------------------------------------------------ */
  function renderPalette() {
    var host = $('palette');
    host.innerHTML = PF.catalog.groups.map(function (g) {
      return '<div class="palgroup">' + esc(g.name) + '</div><div class="palette">' +
        g.types.map(function (id) {
          var t = PF.catalog.types[id];
          return '<button class="pal" data-type="' + id + '" title="' + esc(t.blurb) + '"><b>' +
            esc(t.name) + '</b><i>' + esc(t.short) + '</i></button>';
        }).join('') + '</div>';
    }).join('');
    host.querySelectorAll('.pal').forEach(function (b) {
      b.onclick = function () { PF.store.addCard(b.getAttribute('data-type')); };
    });
  }

  /* ---- card list ---------------------------------------------------- */
  function renderList() {
    var p = PF.store.get();
    var bad = {};
    PF.store.issues().forEach(function (i) { if (i.card && i.level === 'error') bad[i.card] = true; });
    var el = $('cardList');
    if (!p.cards.length) {
      el.innerHTML = '<li class="empty">Nothing on the panel yet.</li>';
      return;
    }
    /* last in the list draws on top, so show it top-first like a layer stack */
    el.innerHTML = p.cards.slice().reverse().map(function (c) {
      var t = PF.catalog.types[c.type];
      var name = c.title || c.entity || t.name;
      /* name first, type as a trailing tag — see .cardlist in app.css */
      return '<li data-id="' + c.id + '"' + (p.selected === c.id ? ' class="is-sel"' : '') + '>' +
        '<span class="cl-name' + (bad[c.id] ? ' cl-bad' : '') + '">' + esc(name) + '</span>' +
        '<span class="cl-type">' + esc(t.name) + '</span>' +
        '<button class="cl-x" title="Delete">✕</button></li>';
    }).join('');
    el.querySelectorAll('li[data-id]').forEach(function (li) {
      var id = li.getAttribute('data-id');
      li.onclick = function (e) {
        if (e.target.classList.contains('cl-x')) { PF.store.removeCard(id); return; }
        PF.store.select(id);
        switchTab('card');
      };
    });
  }

  /* ---- issues bar --------------------------------------------------- */
  /* ONE CHIP PER KIND OF PROBLEM, not one per card. Four cards sharing an
   * entity used to write four near-identical sentences across the bar and
   * push everything else behind "+n more" — so the bar was at its least
   * useful exactly when it had the most to say. Each chip carries the count
   * and steps through the cards it covers, one per click; the full sentence
   * is the tooltip. */
  var issueStep = {};
  function renderIssues() {
    var list = PF.store.issues();
    var el = $('issues');
    if (!list.length) {
      el.innerHTML = '<span class="ok">Ready to generate</span>';
      return;
    }
    var order = [], byKind = {};
    list.forEach(function (i) {
      var k = i.kind || i.text;
      if (!byKind[k]) { byKind[k] = []; order.push(k); }
      byKind[k].push(i);
    });
    /* errors first — they are the ones that stop a build */
    order.sort(function (a, b) {
      var ea = byKind[a][0].level === 'error' ? 0 : 1;
      var eb = byKind[b][0].level === 'error' ? 0 : 1;
      return ea - eb;
    });
    var errN = list.filter(function (i) { return i.level === 'error'; }).length;
    var head = errN
      ? '<span class="issue-head">' + errN + (errN === 1 ? ' thing' : ' things') + ' to fix</span>'
      : '<span class="ok">Ready to generate</span>';

    el.innerHTML = head + order.map(function (k) {
      var g = byKind[k], first = g[0];
      var cls = first.level === 'error' ? 'error' : 'warn';
      var label = g.length > 1 ? (first.many || first.one || first.text) : (first.one || first.text);
      var count = g.length > 1 ? '<span class="n">' + g.length + '</span>' : '';
      var tip = g.map(function (i) { return i.text; }).join(String.fromCharCode(10));
      return ' <span class="sep">·</span> <button class="' + cls + '" data-kind="' + esc(k) +
             '" title="' + esc(tip) + '">' + count + esc(label) + '</button>';
    }).join('');

    el.querySelectorAll('[data-kind]').forEach(function (b) {
      b.onclick = function () {
        var g = byKind[b.getAttribute('data-kind')].filter(function (i) { return i.card; });
        if (!g.length) { switchTab('panel'); return; }
        var k = b.getAttribute('data-kind');
        var n = (issueStep[k] || 0) % g.length;
        issueStep[k] = n + 1;
        PF.store.select(g[n].card);
        switchTab('card');
      };
    });
  }

  /* ---- top bar ------------------------------------------------------ */
  /* Which screens this panel has: the home page, plus a detail page for
   * every card that opens one. Lets the editor draw the page behind a hold
   * instead of it being invisible until a flash. */
  function renderPagePick() {
    var p = PF.store.get();
    var opts = ['<option value="">Home</option>'];
    p.cards.forEach(function (c) {
      if (!PF.layout.detail(c, PF.store.panelSize())) return;
      opts.push('<option value="' + c.id + '">' + esc(c.title || c.entity || c.id) + ' — detail</option>');
    });
    var sel = $('pagePick');
    sel.innerHTML = opts.join('');
    sel.value = p.viewPage || '';
    sel.disabled = opts.length < 2;
  }

  function syncTop() {
    var p = PF.store.get();
    renderPagePick();
    if (document.activeElement !== $('devFriendly')) $('devFriendly').value = p.device.friendly;
    $('rotPortrait').checked = p.device.rotation === 'portrait';
    var P = PF.store.panelSize();
    $('dims').textContent = P.w + ' × ' + P.h + ' px · 11.6 px/mm';
  }

  function switchTab(name) {
    document.querySelectorAll('.tab').forEach(function (t) {
      t.classList.toggle('is-on', t.getAttribute('data-tab') === name);
    });
    $('tabCard').classList.toggle('hidden', name !== 'card');
    $('tabPanel').classList.toggle('hidden', name !== 'panel');
    $('tabVoice').classList.toggle('hidden', name !== 'voice');
    PF.inspector.render(name);
  }

  /* ---- modal -------------------------------------------------------- */
  function openModal(title, html, after) {
    $('modalTitle').textContent = title;
    $('modalBody').innerHTML = html;
    $('modal').classList.remove('hidden');
    if (after) after();
  }
  function closeModal() { $('modal').classList.add('hidden'); }

  /* ---- export ------------------------------------------------------- */
  function doExport() {
    var p = PF.store.get();
    var issues = PF.store.issues();
    var errors = issues.filter(function (i) { return i.level === 'error'; });
    /* No new key on an update: it would rekey every panel reading the same
     * secret, and Home Assistant would drop them all until re-entered. */
    var updating = p.deploy.mode === 'update';
    var apiKey = (p.api.encryption && !updating) ? PF.docs.newKey() : '';
    var yaml = PF.gen.yaml(p);
    var header = PF.genHeader.build(p, { ink: PF.store.theme().ink });
    var readme = PF.docs.readme(p, apiKey);
    var proj = JSON.stringify(stripped(p), null, 2);
    var needFan = p.cards.some(function (c) { return c.type === 'fan' && c.opts.blades; });

    var files = [{ key: 'yaml', name: p.device.name + '.yaml', body: yaml }];
    files.push({ key: 'h', name: PF.genHeader.fileName(p), body: header });
    files.push({ key: 'readme', name: 'README.md', body: readme });
    files.push({ key: 'json', name: p.device.name + '.panelcreator.json', body: proj });

    var html = '';
    if (errors.length) {
      html += '<div class="problems"><b>' + errors.length + ' thing' + (errors.length > 1 ? 's' : '') +
        ' will stop this working:</b><ul>' +
        errors.map(function (e) { return '<li>' + esc(e.text) + '</li>'; }).join('') +
        '</ul></div>';
    }
    /* THE ONLY SECRET THAT IS NOT ALREADY THERE.
     *
     * `!secret x` is a reference resolved at compile time against the
     * secrets.yaml next to the config (esphome/yaml_util.py: construct_secret),
     * so a shared config carries nobody's credentials. And the ESPHome add-on
     * writes wifi_ssid / wifi_password into secrets.yaml on first start
     * (esphome/const.py: PLACEHOLDER_WIFI_*), so those two need no action at
     * all. That leaves exactly one line for a new panel — the freshly
     * generated API key — and it should not cost a zip, a README and a hunt
     * to find it. */
    var secretsBlock = apiKey
      ? '<div class="codeblock"><pre class="code" style="max-height:none">' +
        esc('api_encryption_key: "' + apiKey + '"') + '</pre>' +
        '<div class="cbtns"><button class="btn small" id="cpSecret">Copy line</button>' +
        '<button class="btn small" id="cpKey">Copy key only</button></div></div>' +
        '<p class="modal-note" style="margin-top:-6px">Goes in <code>secrets.yaml</code>, ' +
        'beside your ESPHome configs. Editing the file? Paste the whole line. Using the ' +
        'Builder\'s <b>⋮ → Secrets → Add secret</b> page? Name it <code>api_encryption_key</code> ' +
        'and paste only the key as the value, or the Builder rejects it. ' +
        '<b>Keep it and do not publish it</b>: it is what Home Assistant uses to talk to this ' +
        'panel. <code>wifi_ssid</code> and <code>wifi_password</code> are already in there; ' +
        'the add-on wrote them the first time it started.</p>'
      : '';

    /* WHAT DO I DO NOW is the only question anybody has at this point, and it
     * was being answered by a paragraph you had to read twice to count the
     * steps in. Numbered, because they are numbered. */
    html += updating
      ? '<ol class="steps">' +
        '<li>In <b>ESPHome Builder</b>, press <b>EDIT</b> on <code>' + esc(p.device.name) +
          '</code> — not <b>+ NEW DEVICE</b>.</li>' +
        '<li>Paste the YAML below over what is there.</li>' +
        '<li><b>Install → Wirelessly</b>. That is the whole job — <code>' +
          esc(PF.genHeader.fileName(p)) + '</code> is the same file for every panel, so the copy ' +
          'already next to your configs is the right one.</li>' +
        '</ol><p class="modal-note"><b>Leave <code>secrets.yaml</code> alone.</b> No new ' +
        'encryption key was generated: changing it would rekey every panel reading that secret, ' +
        'and Home Assistant would drop the connection until you handed it the new one.</p>'
      : '<ol class="steps">' +
        '<li><b>Download everything</b>, and unpack it where your ESPHome configs live. With the ' +
          'Home Assistant add-on that is <code>/config/esphome/</code> <b>on the Home Assistant ' +
          'machine</b>, not this one.' + (needFan ? ' The fan sprite frames are in the zip too.' : '') + '</li>' +
        (apiKey
          ? '<li>Add <b>one line</b> to <code>secrets.yaml</code> — the box below, ' +
            'or copy it out of README.md.</li>'
          : '<li>Nothing to add to <code>secrets.yaml</code>: this config only uses ' +
            'the WiFi keys the ESPHome add-on already put there.</li>') +
        '<li>In <b>ESPHome Builder</b>, adopt the new config and install it.</li>' +
        '</ol>' + secretsBlock +
        '<p class="modal-note">Already have this panel on the wall? Set <b>This panel is → ' +
        'Already installed</b> on the Panel tab and generate again — the steps and the key ' +
        'handling both change.</p>';
    html += '<div class="filetabs" id="ftabs">' +
      files.map(function (f, i) {
        return '<button data-k="' + f.key + '"' + (i === 0 ? ' class="is-on"' : '') + '>' + esc(f.name) + '</button>';
      }).join('') + '</div>';
    html += '<pre class="code" id="codeBox"></pre>';
    html += '<div class="modal-actions">' +
      '<button class="btn primary" id="dlZip">Download everything (.zip)</button>' +
      '<button class="btn" id="dlOne">Download this file</button>' +
      '<button class="btn ghost" id="cpOne">Copy to clipboard</button>' +
      '<span class="grow"></span><span class="hint" id="expNote"></span></div>';

    openModal('Generated firmware', html, function () {
      /* Two copies because there are two places it goes: the secrets.yaml file wants
       * the whole line, the Builder's Secrets form wants the bare key and calls the
       * whole line an "invalid key format". */
      [['cpSecret', 'api_encryption_key: "' + apiKey + '"', 'Copy line'],
       ['cpKey', apiKey, 'Copy key only']].forEach(function (c) {
        if (!$(c[0])) return;
        $(c[0]).onclick = function () {
          var b = this;
          navigator.clipboard.writeText(c[1]).then(function () {
            b.textContent = 'Copied';
            setTimeout(function () { b.textContent = c[2]; }, 1600);
          });
        };
      });
      var current = files[0];
      function show(k) {
        current = files.filter(function (f) { return f.key === k; })[0];
        $('codeBox').textContent = current.body;
        $('ftabs').querySelectorAll('button').forEach(function (b) {
          b.classList.toggle('is-on', b.getAttribute('data-k') === k);
        });
      }
      $('ftabs').querySelectorAll('button').forEach(function (b) {
        b.onclick = function () { show(b.getAttribute('data-k')); };
      });
      show(files[0].key);

      $('dlOne').onclick = function () { download(new Blob([current.body], { type: 'text/plain' }), current.name); };
      $('cpOne').onclick = function () {
        navigator.clipboard.writeText(current.body).then(function () {
          $('expNote').textContent = 'Copied ' + current.name;
        }, function () {
          $('expNote').textContent = 'Could not copy — select the text instead.';
        });
      };
      $('dlZip').onclick = function () {
        var zf = files.map(function (f) { return { name: f.name, data: f.body }; });
        if (needFan) {
          Object.keys(PF.fanFrames).forEach(function (n) {
            zf.push({ name: 'fanframes/' + n, data: PF.zip.b64(PF.fanFrames[n]) });
          });
        }
        download(PF.zip.build(zf), p.device.name + '.zip');
        $('expNote').textContent = 'Unpack it into /config/esphome/';
      };
    });
  }

  function stripped(p) {
    var c = JSON.parse(JSON.stringify(p));
    delete c.selected;
    delete c.viewPage;   /* editor view state, not design */
    return c;
  }

  function download(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  /* ---- entity import ------------------------------------------------ */
  /* Three fields per line: id | friendly name | capabilities.
   *
   * The third one is the point. Home Assistant already knows a bulb's Kelvin
   * range and a thermostat's limits, and every one of those used to be a
   * number the user had to go and look up in Tools (Developer tools before HA 2026.8) and type in by
   * hand. Reading them here costs one longer template and nothing else.
   *
   * `.get(...) is not none` rather than a truthiness test, because a climate
   * with min_temp 0 is real and `{% if 0 %}` would silently drop it. And the
   * colour modes join on "+" so no comma ever appears in a field — a bare
   * comma still separates id from name in the old paste format. */
  var TEMPLATE = [
    '{% for s in states %}{{ s.entity_id }}|{{ s.name }}|',
    "{% if s.attributes.get('unit_of_measurement') is not none %}unit={{ s.attributes.unit_of_measurement }};{% endif %}",
    "{% if s.attributes.get('supported_color_modes') is not none %}modes={{ s.attributes.supported_color_modes|join('+') }};{% endif %}",
    "{% if s.attributes.get('min_color_temp_kelvin') is not none %}kmin={{ s.attributes.min_color_temp_kelvin }};kmax={{ s.attributes.max_color_temp_kelvin }};{% endif %}",
    "{% if s.attributes.get('min_temp') is not none %}tmin={{ s.attributes.min_temp }};tmax={{ s.attributes.max_temp }};{% endif %}",
    "{% if s.attributes.get('target_temp_step') is not none %}tstep={{ s.attributes.target_temp_step }};{% endif %}",
    "{% if s.attributes.get('current_position') is not none %}pos=1;{% endif %}",
    '\n{% endfor %}'
  ].join('');

  function parseEntityLine(line) {
    var t = line.trim();
    if (!t) return null;
    /* a pipe is authoritative once present, so a friendly name containing a
     * comma ("Lamp, small") survives; comma and tab stay for the old format */
    var m = t.indexOf('|') >= 0 ? t.split('|') : t.split(/\s*[,\t]\s*/);
    var id = (m[0] || '').trim();
    if (!/^[a-z_]+\.[a-z0-9_]+$/.test(id)) return null;
    var caps = {};
    (m[2] || '').split(';').forEach(function (kv) {
      var i = kv.indexOf('=');
      if (i > 0) caps[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
    });
    return { id: id, name: (m[1] || '').trim(), caps: caps };
  }

  function doImport() {
    var html =
      '<p class="modal-note">Paste a list of your entities. One per line — an entity id on ' +
      'its own is enough, and anything extra just fills more in for you.<br><br>' +
      'For the whole list: Home Assistant → <b>Settings</b> → <b>Tools</b> → <b>Template</b>, ' +
      'clear the box, and paste this in:</p>' +
      /* the whole point of this block is to end up in somebody's clipboard, so
       * do not make them select four lines of Jinja by hand */
      '<div class="codeblock"><pre class="code" style="max-height:150px">' + esc(TEMPLATE) + '</pre>' +
      '<button class="btn small" id="cpTpl">Copy template</button></div>' +
      '<p class="modal-note">That third field is what saves you the digging: a light brings ' +
      'its own colour-temperature range and whether it can dim at all, a thermostat brings ' +
      'its limits and step, a sensor brings its unit. Those get filled in for you instead ' +
      'of being looked up by hand.</p>' +
      '<textarea class="paste" id="pasteBox" spellcheck="false" placeholder="light.kitchen|Kitchen ceiling|modes=color_temp;kmin=2202;kmax=6535;&#10;sensor.hall_temperature|Hall temperature|unit=°C;&#10;fan.study"></textarea>' +
      '<div class="modal-actions">' +
      '<button class="btn primary" id="impUse">Use for autocomplete</button>' +
      '<button class="btn" id="impAdd">…and add a card for each</button>' +
      (PF.inspector.count()
        ? '<button class="btn ghost" id="impClear">Forget the ' + PF.inspector.count() + ' loaded</button>'
        : '') +
      '<span class="grow"></span><span class="hint" id="impNote"></span></div>';

    openModal('Import entities', html, function () {
      $('cpTpl').onclick = function () {
        var b = this;
        navigator.clipboard.writeText(TEMPLATE).then(function () {
          b.textContent = 'Copied';
          setTimeout(function () { b.textContent = 'Copy template'; }, 1600);
        });
      };
      function parse() {
        return $('pasteBox').value.split('\n').map(parseEntityLine).filter(Boolean);
      }
      /* The list survives reloads now, so there has to be a way to drop one
       * that has gone stale — renamed entities, or a different instance. */
      if ($('impClear')) {
        $('impClear').onclick = function () {
          PF.inspector.setEntities([]);
          $('impNote').textContent = 'Forgotten. Paste a new list above.';
          $('impClear').remove();
        };
      }
      function filledNote(n) {
        return n ? ' ' + n + ' brought their own settings.' : '';
      }
      $('impUse').onclick = function () {
        var list = parse();
        PF.inspector.setEntities(list);
        var rich = list.filter(function (e) { return Object.keys(e.caps).length; }).length;
        $('impNote').textContent = list.length + ' entities available in every entity box.' + filledNote(rich);
        if (list.length) setTimeout(closeModal, 900);
      };
      $('impAdd').onclick = function () {
        var list = parse();
        PF.inspector.setEntities(list);
        var made = 0, filled = 0;
        list.forEach(function (e) {
          var type = typeForDomain(e.id.split('.')[0]);
          if (!type) return;
          var opts = PF.catalog.fromEntity(type, e.caps);
          if (opts) filled++;
          PF.store.addCard(type, {
            entity: e.id,
            title: (e.name || e.id.split('.')[1].replace(/_/g, ' ')).toUpperCase(),
            opts: opts || undefined
          });
          made++;
        });
        $('impNote').textContent = made + ' cards added.' + filledNote(filled);
        setTimeout(closeModal, 900);
      };
    });
  }

  function typeForDomain(d) {
    return {
      light: 'light', switch: 'toggle', input_boolean: 'toggle', fan: 'fan',
      sensor: 'sensor', binary_sensor: 'text_sensor', person: 'text_sensor',
      device_tracker: 'text_sensor', cover: 'cover', climate: 'climate',
      media_player: 'media',
      scene: 'button', script: 'button', button: 'button', input_button: 'button'
    }[d] || null;
  }

  /* ---- help --------------------------------------------------------- */
  function doHelp() {
    openModal('How this works',
      '<p class="modal-note">' +
      'This lays out the screen of an <b>M5Stack Tab5</b> running ESPHome, and writes the config ' +
      'for it. The Tab5 is a 1280×720 touch panel on an ESP32-P4; mounted on a wall it becomes a ' +
      'Home Assistant control surface that does not depend on a phone being unlocked.' +
      '</p><p class="modal-note">' +
      '<b>1.</b> Add cards on the left — one per entity.<br>' +
      '<b>2.</b> Drag and resize them. What you see is what LVGL renders, at real pixel sizes.<br>' +
      '<b>3.</b> Put your own entity ids in on the right. <b>Import entities</b> pastes them all in at once.<br>' +
      '<b>4.</b> Choose the sound and voice options.<br>' +
      '<b>5.</b> <b>Generate firmware</b>, download the zip, drop it in <code>/config/esphome/</code>, install.' +
      '</p><p class="modal-note">' +
      'The preview is honest about the things that matter: colours are quantised to the 16-bit ' +
      'the panel actually displays, and anything tappable smaller than an 8 mm finger target ' +
      '(about 95 px here) gets flagged along the bottom.' +
      '</p><p class="modal-note">' +
      'Nothing is uploaded anywhere. The design is kept in your browser, and <b>Save</b> writes a ' +
      'file you can load back later. WiFi credentials are never asked for — the generated config ' +
      'reads them from your own <code>secrets.yaml</code>.' +
      '</p><p class="modal-note" style="color:#978972">' +
      'Panel Creator · built for the YogiTech Tab5 wall panel build.' +
      '</p>');
  }

  /* ---- boot --------------------------------------------------------- */
  function boot() {
    PF.inspector.mount();
    if (!PF.store.restore()) PF.store.replace(starter());

    renderPalette();
    PF.canvas.mount($('stageWrap'));

    PF.store.on(function (p, reason) {
      renderList();
      renderIssues();
      syncTop();
      if (reason === 'select' || reason === 'add' || reason === 'remove' || reason === 'replace' || reason === 'undo' || reason === 'redo') {
        /* FORCED. render() normally skips a tab that has focus inside it, so a
         * keystroke is not eaten by a rebuild mid-word — but every reason here
         * means a DIFFERENT card is selected, and leaving the old one's fields
         * on screen is worse than any lost keystroke. Picking a card on the
         * canvas does not move focus (the drag handler calls preventDefault),
         * so without this the panel kept showing the card you left. */
        PF.inspector.render('card', true);
      } else if (reason === 'global') {
        PF.inspector.render();
      } else if (reason === 'update' || reason === 'order') {
        PF.inspector.render('card');
      }
    });

    document.querySelectorAll('.tab').forEach(function (t) {
      t.onclick = function () { switchTab(t.getAttribute('data-tab')); };
    });

    $('devFriendly').oninput = function () { PF.store.setGlobal('device.friendly', this.value); };
    $('demoPick').onchange = function () { PF.canvas.setDemo(this.value); };
    $('pagePick').onchange = function () { PF.store.showPage(this.value || null); };
    $('rotPortrait').onchange = function () {
      PF.store.setGlobal('device.rotation', this.checked ? 'portrait' : 'landscape');
    };

    $('btnExport').onclick = doExport;
    $('btnImport').onclick = doImport;
    $('btnHelp').onclick = doHelp;
    $('modalClose').onclick = closeModal;
    $('modal').onclick = function (e) { if (e.target === $('modal')) closeModal(); };
    window.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !$('modal').classList.contains('hidden')) closeModal();
    });

    $('btnSave').onclick = function () {
      var p = PF.store.get();
      download(new Blob([JSON.stringify(stripped(p), null, 2)], { type: 'application/json' }),
        p.device.name + '.panelcreator.json');
    };
    $('btnLoad').onclick = function () { $('fileInput').click(); };
    $('fileInput').onchange = function () {
      var f = this.files && this.files[0];
      if (!f) return;
      var r = new FileReader();
      r.onload = function () {
        try {
          PF.store.replace(JSON.parse(r.result));
        } catch (err) {
          alert('That file is not a Panel Creator project.');
        }
      };
      r.readAsText(f);
      this.value = '';
    };
    $('btnReset').onclick = function () {
      if (confirm('Throw away this design and start from the example panel?')) PF.store.replace(starter());
    };

    renderList();
    renderIssues();
    syncTop();
    switchTab('card');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window.PF = window.PF || {});
