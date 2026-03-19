/**
 * Generieke dialoog-overlay ter vervanging van alert/confirm.
 */
(function () {
  'use strict';

  var overlay = null;
  var messageEl = null;
  var buttonsContainer = null;
  var resolveCallback = null;

  function ensureOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.className = 'dialog-overlay hidden';
    overlay.id = 'dialogOverlay';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML = '<div class="dialog-backdrop"></div>' +
      '<div class="dialog-panel" role="alertdialog" aria-modal="true">' +
      '  <p class="dialog-message" id="dialogMessage"></p>' +
      '  <input type="text" class="dialog-input hidden" id="dialogInput" />' +
      '  <div class="dialog-buttons" id="dialogButtons"></div>' +
      '</div>';
    document.body.appendChild(overlay);
    messageEl = document.getElementById('dialogMessage');
    buttonsContainer = document.getElementById('dialogButtons');
    overlay.querySelector('.dialog-backdrop').addEventListener('click', function () {
      if (resolveCallback) resolveCallback(false);
    });
    return overlay;
  }

  function show(message, buttons) {
    ensureOverlay();
    messageEl.textContent = message;
    messageEl.style.display = '';
    var inp = document.getElementById('dialogInput');
    if (inp) inp.classList.add('hidden');
    buttonsContainer.innerHTML = '';
    return new Promise(function (resolve) {
      resolveCallback = resolve;
      buttons.forEach(function (btn) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn ' + (btn.primary ? 'btn-primary' : 'btn-secondary');
        b.textContent = btn.label;
        b.addEventListener('click', function () {
          resolveCallback(btn.value);
          resolveCallback = null;
          hide();
        });
        buttonsContainer.appendChild(b);
      });
      overlay.classList.remove('hidden');
      overlay.setAttribute('aria-hidden', 'false');
    });
  }

  function hide() {
    if (overlay) {
      overlay.classList.add('hidden');
      overlay.setAttribute('aria-hidden', 'true');
    }
    resolveCallback = null;
  }

  window.showAlert = function (message) {
    return show(message, [{ label: 'OK', value: true, primary: true }]);
  };

  window.showConfirm = function (message) {
    return show(message, [
      { label: 'Annuleren', value: false, primary: false },
      { label: 'OK', value: true, primary: true }
    ]);
  };

  window.showPrompt = function (message, defaultValue) {
    ensureOverlay();
    messageEl.textContent = message;
    messageEl.style.display = '';
    var inp = document.getElementById('dialogInput');
    if (!inp) return Promise.resolve(null);
    inp.value = String(defaultValue !== undefined && defaultValue !== null ? defaultValue : '');
    inp.classList.remove('hidden');
    inp.setAttribute('inputmode', 'numeric');
    return new Promise(function (resolve) {
      var done = false;
      function finish(val) {
        if (done) return;
        done = true;
        inp.classList.add('hidden');
        overlay.classList.add('hidden');
        overlay.setAttribute('aria-hidden', 'true');
        resolve(val);
      }
      buttonsContainer.innerHTML = '';
      var btnCancel = document.createElement('button');
      btnCancel.type = 'button';
      btnCancel.className = 'btn btn-secondary';
      btnCancel.textContent = 'Annuleren';
      btnCancel.addEventListener('click', function () { finish(null); });
      var btnOk = document.createElement('button');
      btnOk.type = 'button';
      btnOk.className = 'btn btn-primary';
      btnOk.textContent = 'OK';
      btnOk.addEventListener('click', function () { finish(inp.value); });
      buttonsContainer.appendChild(btnCancel);
      buttonsContainer.appendChild(btnOk);
      overlay.classList.remove('hidden');
      overlay.setAttribute('aria-hidden', 'false');
      var backdrop = overlay.querySelector('.dialog-backdrop');
      function onBackdropClick() {
        backdrop.removeEventListener('click', onBackdropClick);
        finish(null);
      }
      backdrop.addEventListener('click', onBackdropClick);
      setTimeout(function () { inp.focus(); inp.select(); }, 50);
      inp.addEventListener('keydown', function onKey(e) {
        if (e.key === 'Enter') { finish(inp.value); }
        else if (e.key === 'Escape') { finish(null); }
      });
    });
  };
})();
