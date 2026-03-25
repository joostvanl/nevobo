/**
 * Mobiel hamburgermenu – navigatie naar teams, wedstrijden, etc.
 */
(function () {
  function init() {
    var btn = document.getElementById('menuToggle');
    var panel = document.getElementById('menuPanel');
    var backdrop = document.getElementById('menuBackdrop');
    if (!btn || !panel) return;

    function open() {
      panel.classList.remove('menu-closed');
      panel.setAttribute('aria-hidden', 'false');
      if (backdrop) backdrop.classList.remove('hidden');
      document.body.style.overflow = 'hidden';
    }

    function close() {
      panel.classList.add('menu-closed');
      panel.setAttribute('aria-hidden', 'true');
      if (backdrop) backdrop.classList.add('hidden');
      document.body.style.overflow = '';
    }

    function toggle() {
      if (panel.classList.contains('menu-closed')) open();
      else close();
    }

    btn.addEventListener('click', toggle);
    if (backdrop) backdrop.addEventListener('click', close);
    panel.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', close);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
