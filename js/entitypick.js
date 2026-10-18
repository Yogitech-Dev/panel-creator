/* =====================================================================
 * entitypick.js — find an entity by typing roughly what it is called.
 *
 * A <datalist> was doing this job and doing it badly: the browser decides
 * how to match, you get no ranking, no way to say "lights first on a light
 * card", and on a real instance with several hundred entities the useful
 * one is rarely in the visible handful.
 *
 * THE MATCHING RULE, in one line: split what you typed on spaces, and keep
 * an entity only if EVERY piece appears somewhere in its id or its friendly
 * name. So "master lamp" finds light.master_bedroom_lamp, and the pieces do
 * not have to be in order or next to each other.
 *
 * Ranking then decides what floats to the top, because "matches" is a much
 * bigger set than "the one you meant":
 *
 *   * a piece that starts a WORD beats one buried mid-word — typing "bed"
 *     should put bedroom above unmade_bedding
 *   * the friendly name counts for slightly more than the id, because that
 *     is the name a person actually thinks in
 *   * an entity in the domain the card wants gets a large boost, so a light
 *     card lists lights first even when a sensor matched the text better
 *   * shorter ids win ties, on the grounds that light.kitchen is more likely
 *     to be meant than light.kitchen_downlight_3_effect
 *
 * If nothing matches at all, it falls back to a subsequence test over the
 * whole query, so "mstrbed" still gets somewhere rather than an empty list.
 *
 * rank() is pure and takes no DOM, so it can be tested outside the browser.
 * ===================================================================== */
(function (PF) {
  'use strict';

  var MAX_ROWS = 60;         /* rendered rows; the list can be far longer */

  function lc(s) { return String(s === undefined || s === null ? '' : s).toLowerCase(); }

  /* Anything that is not a letter or a digit separates words, so a query
   * piece can match across the dots and underscores in an entity id. */
  function isSep(ch) { return !(ch >= 'a' && ch <= 'z') && !(ch >= '0' && ch <= '9'); }

  /* Every place `needle` appears in `hay`, and whether each starts a word. */
  function finds(hay, needle) {
    var out = [], i = 0;
    if (!needle) return out;
    for (;;) {
      var at = hay.indexOf(needle, i);
      if (at < 0) return out;
      out.push({ at: at, wordStart: at === 0 || isSep(hay.charAt(at - 1)) });
      i = at + 1;
    }
  }

  /* Are the characters of `needle` present in `hay`, in order? The typo net:
   * catches "mstrbed" for master_bedroom without matching everything. */
  function subseq(hay, needle) {
    var i = 0;
    for (var j = 0; j < hay.length && i < needle.length; j++) {
      if (hay.charAt(j) === needle.charAt(i)) i++;
    }
    return i === needle.length;
  }

  function scoreField(field, token, weight) {
    var hits = finds(field, token);
    if (!hits.length) return 0;
    var best = 0;
    for (var i = 0; i < hits.length; i++) {
      var s = hits[i].wordStart ? 60 : 22;
      /* covering the whole field is as good as it gets */
      if (hits[i].at === 0 && token.length === field.length) s = 120;
      else if (hits[i].at === 0) s += 14;
      if (s > best) best = s;
    }
    /* a token that is most of the field it matched is a better signal than
     * two letters buried in a long one */
    return (best + Math.round(20 * token.length / Math.max(field.length, 1))) * weight;
  }

  /* One entity's score for one query token. 0 means "does not match". */
  function scoreToken(e, token) {
    var id = lc(e.id), name = lc(e.name || '');
    var slug = id.indexOf('.') >= 0 ? id.slice(id.indexOf('.') + 1) : id;
    var s = Math.max(
      scoreField(name, token, 1.1),     /* what a person thinks in */
      scoreField(slug, token, 1.0),
      scoreField(id, token, 0.9)        /* includes the domain */
    );
    return s;
  }

  /* opts: { domains: [...] } — the card's expected domains, boosted. */
  function rank(query, list, opts) {
    opts = opts || {};
    var domains = opts.domains || [];
    var q = lc(query).trim();
    var tokens = q.split(/\s+/).filter(Boolean);

    function domainBoost(e) {
      if (!domains.length) return 0;
      var d = lc(e.id).split('.')[0];
      return domains.indexOf(d) >= 0 ? 400 : 0;
    }

    var scored = [], i;

    if (!tokens.length) {
      /* nothing typed: everything, best domains first */
      for (i = 0; i < list.length; i++) {
        scored.push({ e: list[i], score: domainBoost(list[i]) });
      }
    } else {
      for (i = 0; i < list.length; i++) {
        var e = list[i], total = 0, ok = true;
        for (var t = 0; t < tokens.length; t++) {
          var s = scoreToken(e, tokens[t]);
          if (!s) { ok = false; break; }
          total += s;
        }
        if (!ok) continue;
        if (lc(e.id) === q) total += 5000;                 /* typed it exactly */
        scored.push({ e: e, score: total + domainBoost(e) });
      }

      /* nothing at all — loosen to a subsequence over the whole query */
      if (!scored.length) {
        var flat = q.replace(/[^a-z0-9]+/g, '');
        if (flat) {
          for (i = 0; i < list.length; i++) {
            var hay = lc(list[i].id + ' ' + (list[i].name || '')).replace(/[^a-z0-9]+/g, '');
            if (subseq(hay, flat)) scored.push({ e: list[i], score: domainBoost(list[i]) });
          }
        }
      }
    }

    scored.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      var la = String(a.e.id).length, lb = String(b.e.id).length;
      if (la !== lb) return la - lb;                       /* shorter id wins */
      return a.e.id < b.e.id ? -1 : a.e.id > b.e.id ? 1 : 0;
    });
    return scored.map(function (x) { return x.e; });
  }

  /* ---- highlighting -------------------------------------------------
   * Marks every query token in a string, escaping as it goes. Ranges are
   * merged first so overlapping tokens ("mast" + "master") cannot emit
   * nested or crossed <b> tags. */
  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function mark(text, query) {
    var s = String(text || '');
    var tokens = lc(query).trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) return esc(s);
    var low = lc(s), ranges = [];
    tokens.forEach(function (t) {
      finds(low, t).forEach(function (h) { ranges.push([h.at, h.at + t.length]); });
    });
    if (!ranges.length) return esc(s);
    ranges.sort(function (a, b) { return a[0] - b[0]; });
    var merged = [ranges[0]];
    for (var i = 1; i < ranges.length; i++) {
      var last = merged[merged.length - 1];
      if (ranges[i][0] <= last[1]) last[1] = Math.max(last[1], ranges[i][1]);
      else merged.push(ranges[i]);
    }
    var out = '', at = 0;
    merged.forEach(function (r) {
      out += esc(s.slice(at, r[0])) + '<b>' + esc(s.slice(r[0], r[1])) + '</b>';
      at = r[1];
    });
    return out + esc(s.slice(at));
  }

  /* ---- the widget ---------------------------------------------------
   * The panel is position: fixed and placed from the input's rect, because
   * the inspector column scrolls and an absolutely positioned child would
   * be clipped by it. */
  function attach(input, getList, onPick, opts) {
    opts = opts || {};
    var panel = document.createElement('div');
    panel.className = 'epick';
    panel.setAttribute('role', 'listbox');
    document.body.appendChild(panel);

    /* `browsing` = focused but nothing typed yet. A field that already holds
     * an entity would otherwise open filtered by its own value and show one
     * row, which is useless when the reason you clicked it is to change it.
     * So focus shows the whole list (best domains first) with the text
     * selected, and the first keystroke replaces it and starts filtering. */
    var rows = [], cur = -1, open = false, browsing = false;

    function close() {
      if (!open) return;
      open = false;
      panel.style.display = 'none';
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    }

    function place() {
      var r = input.getBoundingClientRect();
      /* flip above when there is more room up than down */
      var below = window.innerHeight - r.bottom, above = r.top;
      var h = Math.min(panel.scrollHeight || 280, Math.max(below, above) - 12);
      /* WIDER THAN THE INPUT. The inspector column is narrow, and an entity
       * id plus a friendly name does not fit in it — everything ellipsised
       * to the point where two entities from the same room looked identical.
       * A dropdown is not obliged to match its input's width, so it does not.
       * The panel then hangs off the right edge, since the inspector is on
       * it, so it shifts left to stay on screen. */
      var want = Math.max(r.width, 380);
      var left = r.left;
      if (left + want > window.innerWidth - 8) left = window.innerWidth - 8 - want;
      if (left < 8) { left = 8; want = Math.min(want, window.innerWidth - 16); }
      panel.style.left = left + 'px';
      panel.style.width = want + 'px';
      panel.style.maxHeight = h + 'px';
      if (below >= 160 || below >= above) {
        panel.style.top = (r.bottom + 2) + 'px';
        panel.style.bottom = 'auto';
      } else {
        panel.style.top = 'auto';
        panel.style.bottom = (window.innerHeight - r.top + 2) + 'px';
      }
    }

    function render() {
      var list = getList() || [];
      /* An empty pool used to close silently, which looks identical to the
       * search being broken — and it is the normal state after a reload if
       * the list was never saved. Say what is missing instead. */
      if (!list.length) {
        panel.innerHTML = '<div class="epick-none">No entities loaded yet. Use ' +
          '<b>Import entities</b> at the top of the card list, or just type the id by hand.</div>';
        if (!open) {
          open = true;
          panel.style.display = 'block';
          window.addEventListener('scroll', place, true);
          window.addEventListener('resize', place);
        }
        place();
        return;
      }
      var q = browsing ? '' : input.value.trim();
      rows = rank(q, list, { domains: opts.domains ? opts.domains() : [] });
      var shown = rows.slice(0, MAX_ROWS);
      if (!shown.length) {
        panel.innerHTML = '<div class="epick-none">Nothing matching “' + esc(q) + '”</div>';
      } else {
        panel.innerHTML = shown.map(function (e, i) {
          var dom = String(e.id).split('.')[0];
          /* title carries the untruncated pair. Widening the panel fixes most
           * of it, but ids like sensor.master_bedroom_temperature_calibrated
           * will always outrun any sane width, and two entities from one room
           * ellipsise to the same string. */
          var full = (e.name ? e.name + '\n' : '') + e.id;
          return '<div class="epick-row' + (i === cur ? ' is-on' : '') + '" data-i="' + i +
            '" role="option" title="' + esc(full) + '">' +
            '<div class="epick-name">' + (e.name ? mark(e.name, q) : '<i>no name</i>') + '</div>' +
            '<div class="epick-id">' + mark(e.id, q) + '</div>' +
            '<span class="epick-dom">' + esc(dom) + '</span></div>';
        }).join('') +
        (rows.length > shown.length
          ? '<div class="epick-none">' + (rows.length - shown.length) + ' more — keep typing</div>' : '');
      }
      if (!open) {
        open = true;
        panel.style.display = 'block';
        window.addEventListener('scroll', place, true);
        window.addEventListener('resize', place);
      }
      place();
      scrollTo();
    }

    function scrollTo() {
      if (cur < 0) return;
      var el = panel.querySelector('.epick-row[data-i="' + cur + '"]');
      if (!el) return;
      var pt = panel.scrollTop, ph = panel.clientHeight;
      if (el.offsetTop < pt) panel.scrollTop = el.offsetTop;
      else if (el.offsetTop + el.offsetHeight > pt + ph) panel.scrollTop = el.offsetTop + el.offsetHeight - ph;
    }

    function choose(i) {
      var e = rows[i];
      if (!e) return;
      close();
      input.value = e.id;
      onPick(e.id);
    }

    input.addEventListener('focus', function () {
      cur = -1; browsing = true;
      /* selected, so the first keystroke replaces rather than appends */
      try { input.select(); } catch (_) {}
      render();
    });
    input.addEventListener('input', function () { cur = -1; browsing = false; render(); });
    input.addEventListener('blur', function () {
      /* after the row's mousedown, which is what actually picks */
      setTimeout(close, 120);
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!open) { render(); return; }
        e.preventDefault();
        var n = Math.min(rows.length, MAX_ROWS);
        if (!n) return;
        cur = e.key === 'ArrowDown'
          ? (cur + 1 >= n ? 0 : cur + 1)
          : (cur - 1 < 0 ? n - 1 : cur - 1);
        render();
      } else if (e.key === 'Enter') {
        if (open && cur >= 0) { e.preventDefault(); choose(cur); }
        else close();
      } else if (e.key === 'Escape') {
        if (open) { e.preventDefault(); e.stopPropagation(); close(); }
      } else if (e.key === 'Tab') {
        if (open && cur >= 0) choose(cur); else close();
      }
    });
    /* mousedown, not click: the input blurs first and click would land after
     * the panel had already been torn down */
    panel.addEventListener('mousedown', function (e) {
      var row = e.target.closest ? e.target.closest('.epick-row') : null;
      if (!row) return;
      e.preventDefault();
      choose(parseInt(row.getAttribute('data-i'), 10));
    });

    return { destroy: function () { close(); if (panel.parentNode) panel.parentNode.removeChild(panel); } };
  }

  PF.entitypick = { rank: rank, mark: mark, attach: attach, MAX_ROWS: MAX_ROWS };
})(window.PF = window.PF || {});
