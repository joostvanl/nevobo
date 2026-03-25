/**
 * Utils - Gedeelde hulp functies voor Volleyball Scout
 * escapeHtml, escapeAttr, generateMatchId
 */
(function () {
  'use strict';

  function escapeHtml(s) {
    if (!s) return '';
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function escapeAttr(s) {
    if (!s) return '';
    return String(s).replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  function generateMatchId() {
    var arr = new Uint8Array(16);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      crypto.getRandomValues(arr);
    } else {
      for (var i = 0; i < 16; i++) arr[i] = Math.floor(Math.random() * 256);
    }
    return Array.from(arr).map(function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }

  function nameToPlayer(name, teamAPlayers) {
    if (!name || !teamAPlayers) return { name: name, number: 0 };
    var p = teamAPlayers.find(function (x) { return x && x.name === name; });
    return p ? { name: p.name, number: p.number || 0 } : { name: name, number: 0 };
  }

  /**
   * Converteer UTC ISO-timestamp naar lokale datum en tijd (tijd afgerond op kwartier).
   * Gebruikt expliciet Date.UTC voor betrouwbare UTC-parsing in alle browsers.
   * @param {string} isoUtc - bijv. "2026-02-28T20:01:07Z" of "2026-03-01T07:36:54Z"
   * @returns {{ date: string, time: string }} dd-mm-yyyy en HH:MM in lokale tijd
   */
  function formatUtcToLocal(isoUtc) {
    if (!isoUtc || typeof isoUtc !== 'string') return { date: '', time: '' };
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(isoUtc.trim());
    if (!m) return { date: '', time: '' };
    var year = parseInt(m[1], 10);
    var month = parseInt(m[2], 10) - 1;
    var day = parseInt(m[3], 10);
    var hour = parseInt(m[4], 10);
    var min = parseInt(m[5], 10);
    var sec = parseInt(m[6] || '0', 10) || 0;
    var d = new Date(Date.UTC(year, month, day, hour, min, sec));
    if (isNaN(d.getTime())) return { date: '', time: '' };
    var pad = function (n) { return n < 10 ? '0' + n : String(n); };
    var localMin = d.getMinutes();
    var q = Math.round(localMin / 15) * 15;
    if (q >= 60) {
      d.setHours(d.getHours() + 1);
      q = 0;
    }
    return {
      date: pad(d.getDate()) + '-' + pad(d.getMonth() + 1) + '-' + d.getFullYear(),
      time: pad(d.getHours()) + ':' + pad(q)
    };
  }

  /**
   * Voeg swipe-gestures toe aan een element.
   * @param {HTMLElement} el - Element om te luisteren (of document.body)
   * @param {Object} opts - { right: fn, left: fn, minDistance: number }
   */
  function addSwipeListener(el, opts) {
    if (!el) return;
    var minDistance = opts.minDistance || 80;
    var startX, startY, startTime;
    el.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      startTime = Date.now();
    }, { passive: true });
    el.addEventListener('touchend', function (e) {
      if (!e.changedTouches || e.changedTouches.length !== 1 || startX == null) return;
      var dx = e.changedTouches[0].clientX - startX;
      var dy = e.changedTouches[0].clientY - startY;
      var dt = Date.now() - startTime;
      startX = null;
      if (dt > 500) return; // Te langzaam = geen swipe
      if (Math.abs(dx) < minDistance) return;
      if (Math.abs(dy) > Math.abs(dx) * 1.2) return; // Te verticaal = scroll, geen swipe
      if (dx > 0 && opts.right) opts.right();
      else if (dx < 0 && opts.left) opts.left();
    }, { passive: true });
  }

  window.scoutUtils = {
    escapeHtml: escapeHtml,
    escapeAttr: escapeAttr,
    generateMatchId: generateMatchId,
    nameToPlayer: nameToPlayer,
    formatUtcToLocal: formatUtcToLocal,
    addSwipeListener: addSwipeListener
  };
})();
