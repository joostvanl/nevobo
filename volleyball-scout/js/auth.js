/**
 * Auth state en UI voor login/logout.
 * Alleen relevant wanneer api.php?action=auth_status authEnabled=true teruggeeft.
 */
(function () {
  var authState = {
    enabled: false,
    loggedIn: false,
    user: null,
    teams: []
  };

  function loadAuthStatus() {
    return fetch('api.php?action=auth_status')
      .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
      .then(function (data) {
        authState.enabled = data.authEnabled === true;
        authState.loggedIn = data.loggedIn === true;
        authState.user = data.user || null;
        authState.teams = data.teams || [];
        return authState;
      })
      .catch(function () {
        authState.enabled = false;
        authState.loggedIn = false;
        authState.user = null;
        authState.teams = [];
        return authState;
      });
  }

  function renderAuthUI() {
    var authBar = document.getElementById('authBar');
    var authPromo = document.getElementById('authPromoSection');
    var authLogged = document.getElementById('authLoggedSection');
    var authUserInfo = document.getElementById('authUserInfo');
    var ongoingSection = document.getElementById('ongoingSection');
    var overviewLink = document.getElementById('overviewLink') || document.querySelector('a[href="overview.php"]');
    var authTeams = document.getElementById('authTeams');
    var menuAuthItems = document.querySelectorAll('.menu-auth-only');

    if (!authState.enabled) {
      if (authBar) authBar.classList.add('hidden');
      menuAuthItems.forEach(function (el) { el.classList.add('hidden'); });
      return;
    }

    if (authBar) authBar.classList.remove('hidden');

    if (authState.loggedIn) {
      if (authPromo) authPromo.classList.add('hidden');
      if (authLogged) authLogged.classList.remove('hidden');
      if (authUserInfo) authUserInfo.textContent = authState.user ? (authState.user.name || 'Ingelogd') : '';
      if (overviewLink) overviewLink.style.display = '';
      if (authTeams) authTeams.style.display = '';
      if (ongoingSection) ongoingSection.classList.remove('hidden');
      menuAuthItems.forEach(function (el) { el.classList.remove('hidden'); });
    } else {
      if (authPromo) authPromo.classList.remove('hidden');
      if (authLogged) authLogged.classList.add('hidden');
      if (overviewLink) overviewLink.style.display = 'none';
      if (authTeams) authTeams.style.display = 'none';
      if (ongoingSection) ongoingSection.classList.add('hidden');
      menuAuthItems.forEach(function (el) { el.classList.add('hidden'); });
    }
  }

  window.scoutAuth = {
    getState: function () { return authState; },
    load: loadAuthStatus,
    render: renderAuthUI,
    refresh: function () {
      return loadAuthStatus().then(renderAuthUI);
    }
  };
})();
