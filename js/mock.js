/* =====================================================================
 * mock.js — plausible values so the preview isn't a wall of dashes.
 *
 * Three demo states. "Evening" is the useful one: some things on, some off,
 * varied brightness, so you can see whether a layout still reads when half
 * of it is lit. Values are derived from the card id, so they hold still
 * while you drag instead of flickering on every re-render.
 * ===================================================================== */
(function (PF) {
  'use strict';

  function hash(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 16777619) >>> 0; }
    return h >>> 0;
  }

  function rnd(card, salt, lo, hi) {
    var h = hash(String(card.id) + '|' + salt);
    return lo + (h % 1000) / 1000 * (hi - lo);
  }

  /* mode: 'evening' | 'on' | 'off' */
  function state(card, mode) {
    var t = card.type;
    var on = mode === 'on' ? true : mode === 'off' ? false : (hash(card.id) % 10) > 3;
    var s = { on: on };

    if (t === 'light') {
      s.pct = !on ? 0 : Math.round(mode === 'on' ? 100 : rnd(card, 'b', 25, 95));
      s.kelvin = Math.round(rnd(card, 'k', card.opts.kMin || 2202, Math.min(card.opts.kMax || 6535, 4200)));
    } else if (t === 'fan') {
      s.pct = !on ? 0 : Math.round(mode === 'on' ? 100 : [20, 40, 65, 100][hash(card.id) % 4]);
    } else if (t === 'sensor') {
      var d = card.opts.decimals | 0;
      var lo = 0, hi = 100;
      var e = (card.entity || '').toLowerCase();
      if (/temp/.test(e) || /°/.test(card.opts.unit || '')) { lo = 18; hi = 24; }
      else if (/hum/.test(e) || /%/.test(card.opts.unit || '')) { lo = 38; hi = 62; }
      else if (/power|watt|\bw\b/.test(e)) { lo = 40; hi = 900; }
      s.value = rnd(card, 'v', lo, hi).toFixed(d);
    } else if (t === 'gauge') {
      /* land inside the good zone most of the time, but not always — a dial
       * that is only ever shown mid-scale hides whether the ends read well */
      var glo = Number(card.opts.min), ghi = Number(card.opts.max);
      if (!(ghi > glo)) { glo = 0; ghi = 100; }
      s.value = rnd(card, 'g', glo + (ghi - glo) * 0.15, ghi - (ghi - glo) * 0.15)
        .toFixed(card.opts.decimals | 0);
    } else if (t === 'text_sensor') {
      var pool = ['CLOSED', 'OPEN', 'HOME', 'IDLE', 'RUNNING', 'AWAY'];
      var e2 = (card.entity || '').toLowerCase();
      if (/door|window|contact/.test(e2)) pool = ['CLOSED', 'OPEN'];
      else if (/person|tracker/.test(e2)) pool = ['HOME', 'AWAY'];
      s.value = pool[hash(card.id) % pool.length];
      if (!card.opts.upper) s.value = s.value.charAt(0) + s.value.slice(1).toLowerCase();
    } else if (t === 'cover') {
      s.pct = mode === 'on' ? 100 : mode === 'off' ? 0 : Math.round(rnd(card, 'p', 0, 100));
    } else if (t === 'climate') {
      var step = card.opts.step === '1' ? 1 : 0.5;
      var raw = rnd(card, 's', card.opts.tMin + 8, card.opts.tMax - 4);
      s.setpoint = (Math.round(raw / step) * step).toFixed(step === 1 ? 0 : 1);
      s.current = rnd(card, 'c', 18, 23).toFixed(1);
      s.mode = mode === 'off' ? 'OFF' : ['HEAT', 'AUTO', 'HEAT'][hash(card.id) % 3];
    } else if (t === 'toggle') {
      s.text = on ? (card.opts.onText || 'ON') : (card.opts.offText || 'OFF');
    } else if (t === 'media') {
      /* long enough to show whether the card copes with a real track name
       * rather than a tidy short one */
      var tracks = [
        ['Wichita Lineman', 'Glen Campbell'],
        ['A Case Of You', 'Joni Mitchell'],
        ['Everything In Its Right Place', 'Radiohead'],
        ['So What', 'Miles Davis']
      ];
      var pick = tracks[hash(card.id) % tracks.length];
      s.playing = on;
      s.track = on ? pick[0] : 'Nothing playing';
      s.artist = on ? pick[1] : '';
      s.vol = Math.round(rnd(card, 'vol', 20, 80));
    }
    return s;
  }

  function clock(project) {
    var d = new Date();
    var h = d.getHours(), m = d.getMinutes();
    if (project && project.cards) { /* real time reads better in a demo than a fixed one */ }
    var mm = ('0' + m).slice(-2);
    return {
      t24: ('0' + h).slice(-2) + ':' + mm,
      t12: ((h % 12) || 12) + ':' + mm + ' ' + (h < 12 ? 'AM' : 'PM'),
      date: d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase(),
      hour: h
    };
  }

  PF.mock = { state: state, clock: clock, hash: hash };
})(window.PF = window.PF || {});
