/**
 * setup.js - Setup-wizard en wissel/setLineup flow
 * Stappen: teams → spelers → systeem. Mode wissel/setLineup laadt matchstate via API.
 */
(function () {
  const stepIds = ['step-teams', 'step-players', 'step-system'];
  const getTeamAField = () => document.getElementById('teamA');
  const teamBInput = document.getElementById('teamB');
  const newPlayerA = document.getElementById('newPlayerA');
  const newPlayerANumber = document.getElementById('newPlayerANumber');
  const addPlayerA = document.getElementById('addPlayerA');
  const addPlayerRow = document.getElementById('addPlayerRow');
  const systemA = document.getElementById('systemA');
  const setterFields = document.getElementById('setterFields');
  const setterSelect = document.getElementById('setterSelect');
  const btnStartMatch = document.getElementById('btnStartMatch');
  const labelTeamAPlayers = document.getElementById('labelTeamAPlayers');
  const btnPlayersNext = document.getElementById('btnPlayersNext');
  const btnBackToMatch = document.getElementById('btnBackToMatch');
  const btnStartSet = document.getElementById('btnStartSet');
  const nextSetNum = document.getElementById('nextSetNum');
  const playersHint = document.getElementById('playersHint');

  /** Posities 1-6 = veld, 7-12 = wisselspelers. Elke positie: {name, number} of null. */
  let setupPositions = {};
  for (var i = 1; i <= 12; i++) setupPositions[i] = null;

  /** Geselecteerde tegel voor wisselen (1-12 of null). */
  let selectedCell = null;

  /** Aantal wissels in deze sessie (voor display; persistente telling in match.js). */
  var sessionSubCount = 0;

  /** Rol per positie (1-6): SV, PL, MID, DIA. */
  var ROLE_BY_POS = { 1: 'SV', 2: 'PL', 3: 'MID', 4: 'DIA', 5: 'PL', 6: 'MID' };

  /** mode: 'setup' | 'wissel' | 'setLineup'. Bij wissel/setLineup: geen toevoegen/verwijderen. */
  var setupMode = 'setup';
  var setLineupSetNum = 0;
  var matchStateForReturn = null;

  function getUrlParams() {
    var params = {};
    var m = (window.location.search || '').match(/[?&]([^=]+)=([^&]*)/g);
    if (m) m.forEach(function (p) {
      var kv = p.slice(1).split('=');
      params[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || '');
    });
    return params;
  }

  function showStep(stepId) {
    stepIds.forEach(id => {
      document.getElementById(id).classList.toggle('hidden', id !== stepId);
    });
  }

  function loadMatchStateForWisselOrSetLineup() {
    var state = null;
    try {
      var s = sessionStorage.getItem('scoutMatchState');
      if (s) state = JSON.parse(s);
    } catch (_) {}
    if (!state) {
      var matchId = null;
      try { matchId = localStorage.getItem('scoutCurrentMatchId'); } catch (_) {}
      if (!matchId) return Promise.resolve(null);
      return fetch('api.php?action=load&matchId=' + encodeURIComponent(matchId)).then(function (r) { return r.json(); }).then(function (data) {
        if (!data) return null;
        var last = data.sets && data.sets.length ? data.sets[data.sets.length - 1] : null;
        return {
          matchId: matchId,
          teamA: data.teamA,
          teamB: data.teamB,
          teamAPlayers: data.teamAPlayers || [],
          sets: data.sets || [],
          currentSetIndex: data.sets ? data.sets.length - 1 : 0,
          homeSets: last ? last.HomeSets : 0,
          awaySets: last ? last.AwaySets : 0,
          homeScore: last && last.rallies && last.rallies.length ? last.rallies[last.rallies.length - 1].HomeScore : 0,
          awayScore: last && last.rallies && last.rallies.length ? last.rallies[last.rallies.length - 1].AwayScore : 0,
          rotation: last && last.rallies && last.rallies.length ? last.rallies[last.rallies.length - 1].Rotation : 1,
          matchDate: data.matchDate,
          setterConfig: data.setterConfig || { type: 'geen' },
          liberoConfig: data.liberoConfig || { use: false, substituteFor: 'mid' },
          servingTeam: null,
          currentRally: [],
          selectedPlayer: null
        };
      });
    }
    return Promise.resolve(state);
  }

  function nameToPlayer(name, teamAPlayers) {
    if (!name || !teamAPlayers) return { name: name, number: 0 };
    var p = teamAPlayers.find(function (x) { return x && x.name === name; });
    return p ? { name: p.name, number: p.number || 0 } : { name: name, number: 0 };
  }

  function loadPlayersForTeam(teamName, done) {
    if (!teamName) {
      for (var i = 1; i <= 12; i++) setupPositions[i] = null;
      if (done) done();
      return;
    }
    fetch('api.php?action=team_players&team=' + encodeURIComponent(teamName))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        var players = (data && data.players) ? data.players : [];
        for (var i = 1; i <= 12; i++) setupPositions[i] = null;
        for (var j = 0; j < players.length && j < 12; j++) {
          var p = players[j];
          if (p && p.name) setupPositions[j + 1] = { name: p.name, number: p.number || 0 };
        }
      })
      .catch(function () { for (var k = 1; k <= 12; k++) setupPositions[k] = null; })
      .finally(function () { if (done) done(); });
  }

  document.querySelectorAll('[data-next]').forEach(btn => btn.addEventListener('click', async function (e) {
    const next = (e.currentTarget || e.target).getAttribute('data-next');
    if (next) {
      if (next === 'step-players') {
        var teamAEl = getTeamAField();
        var teamA = teamAEl ? (teamAEl.value || '').trim() : '';
        var teamB = (teamBInput.value || '').trim();
        if (!teamA || !teamB) {
          await showAlert(teamAEl && teamAEl.tagName === 'SELECT' ? 'Selecteer je thuisploeg en vul de uitploeg in.' : 'Vul de naam van zowel de thuis- als de uitploeg in.');
          return;
        }
        if (teamA === teamB) {
          await showAlert('De thuis- en uitploeg kunnen niet hetzelfde team zijn.');
          return;
        }
        for (var i = 1; i <= 12; i++) setupPositions[i] = null;
        updateLabels();
        await new Promise(function (resolve) {
          loadPlayersForTeam(teamA, function () {
            renderSetupCourt();
            resolve();
          });
        });
      }
      if (next === 'step-system') {
        var filled = 0;
        for (var i = 1; i <= 6; i++) if (setupPositions[i]) filled++;
        if (filled < 6) {
          await showAlert('Zet minimaal 6 spelers in het veld (posities 1-6).');
          return;
        }
        renderSetterFields();
      }
      showStep(next);
    }
  }));

  function addPlayer() {
    const name = (newPlayerA.value || '').trim();
    if (!name) return;
    const numRaw = (newPlayerANumber.value || '').trim();
    const number = numRaw === '' ? 0 : parseInt(numRaw, 10);
    var firstEmpty = null;
    for (var i = 1; i <= 12; i++) {
      if (!setupPositions[i]) { firstEmpty = i; break; }
    }
    if (!firstEmpty) return;
    setupPositions[firstEmpty] = { name: name, number: isNaN(number) ? 0 : number };
    newPlayerA.value = '';
    newPlayerANumber.value = '';
    renderSetupCourt();
  }

  function removePlayer(pos, e) {
    if (e) e.stopPropagation();
    setupPositions[pos] = null;
    if (selectedCell === pos) selectedCell = null;
    renderSetupCourt();
  }

  function swapPositions(posA, posB) {
    var tmp = setupPositions[posA];
    setupPositions[posA] = setupPositions[posB];
    setupPositions[posB] = tmp;
    selectedCell = null;
    renderSetupCourt();
  }

  async function onCellClick(pos, e) {
    if (e.target.closest('.remove-player')) return;
    if (selectedCell === null) {
      selectedCell = pos;
      renderSetupCourt();
      return;
    }
    if (selectedCell === pos) {
      selectedCell = null;
      renderSetupCourt();
      return;
    }
    if (setupMode === 'wissel' && !(await canSwapForWissel(selectedCell, pos))) return;
    swapPositions(selectedCell, pos);
    if (setupMode === 'wissel') {
      recordSubstitution(selectedCell, pos);
      renderSetupCourt();
    }
    selectedCell = null;
  }

  /**
   * Valideer wissel: rol-beperking en max 6 wissels per set.
   * Speler mag alleen wisselen voor toegewezen rol; nieuwe spelers max 6x per set.
   * @param {number} posA - positie 1-12
   * @param {number} posB - positie 1-12
   * @returns {Promise<boolean>} true = wissel toegestaan
   */
  async function canSwapForWissel(posA, posB) {
    var fieldPos = (posA <= 6) ? posA : (posB <= 6) ? posB : null;
    var benchPos = (posA >= 7) ? posA : (posB >= 7) ? posB : null;
    if (!fieldPos || !benchPos) return true;
    var setIdx = matchStateForReturn ? matchStateForReturn.currentSetIndex : 0;
    var setData = matchStateForReturn && matchStateForReturn.sets && matchStateForReturn.sets[setIdx] ? matchStateForReturn.sets[setIdx] : null;
    if (!setData) return true;
    var subCount = (setData.substitutionCount || 0) + sessionSubCount;
    var playerRoles = setData.playerRolesInSet || {};
    var role = ROLE_BY_POS[fieldPos] || '';
    var benchPlayer = setupPositions[benchPos];
    if (!benchPlayer || !benchPlayer.name) return true;
    if (playerRoles[benchPlayer.name]) {
      if (playerRoles[benchPlayer.name] !== role) {
        await showAlert('Speler ' + benchPlayer.name + ' mag alleen wisselen voor de rol ' + playerRoles[benchPlayer.name] + ' (niet voor ' + role + ').');
        return false;
      }
    } else {
      if (subCount >= (RULES.MAX_SUBS_PER_SET || 6)) {
        await showAlert('Maximaal ' + (RULES.MAX_SUBS_PER_SET || 6) + ' wissels per set bereikt.');
        return false;
      }
    }
    return true;
  }

  /** Registreer wissel: update substitutionCount en playerRolesInSet. Na swap staat de binnengekomen speler op fieldPos. */
  function recordSubstitution(posA, posB) {
    var fieldPos = (posA <= 6) ? posA : (posB <= 6) ? posB : null;
    if (!fieldPos || !matchStateForReturn) return;
    var setIdx = matchStateForReturn.currentSetIndex;
    var setData = matchStateForReturn.sets && matchStateForReturn.sets[setIdx] ? matchStateForReturn.sets[setIdx] : null;
    if (!setData) return;
    setData.playerRolesInSet = setData.playerRolesInSet || {};
    var role = ROLE_BY_POS[fieldPos] || '';
    var playerEntered = setupPositions[fieldPos];
    if (!playerEntered || !playerEntered.name) return;
    sessionSubCount++;
    setData.playerRolesInSet[playerEntered.name] = role;
  }

  function renderSetupCourt() {
    for (var i = 1; i <= 12; i++) {
      var cell = document.getElementById('setup-cell-' + i);
      if (!cell) continue;
      var p = setupPositions[i];
      var badge = cell.querySelector('.tile-badge');
      var nameEl = cell.querySelector('.tile-name');
      var removeBtn = cell.querySelector('.remove-player');
      if (p) {
        if (i <= 6) {
          var role = ROLE_BY_POS[i] || '';
          badge.textContent = role + (p.number ? ' #' + p.number : '');
        } else {
          var subRole = '';
          if (setupMode === 'wissel' && matchStateForReturn) {
            var sd = matchStateForReturn.sets && matchStateForReturn.sets[matchStateForReturn.currentSetIndex];
            if (sd && sd.playerRolesInSet && sd.playerRolesInSet[p.name]) subRole = sd.playerRolesInSet[p.name] + ' ';
          }
          badge.textContent = subRole + (p.number ? '#' + p.number : '–');
        }
        nameEl.textContent = p.name;
        nameEl.classList.remove('empty');
        removeBtn.style.display = (setupMode === 'wissel' || setupMode === 'setLineup') ? 'none' : '';
        removeBtn.onclick = (function (pos) { return function (e) { removePlayer(pos, e); }; })(i);
      } else {
        if (i <= 6) {
          var role = ROLE_BY_POS[i] || '';
          badge.textContent = String(i) + ' ' + role;
        } else {
          badge.textContent = '–';
        }
        nameEl.textContent = '';
        nameEl.classList.add('empty');
        removeBtn.style.display = 'none';
      }
      cell.classList.toggle('selected', selectedCell === i);
      cell.classList.toggle('libero-highlight', i === 7 && matchStateForReturn && matchStateForReturn.liberoConfig && matchStateForReturn.liberoConfig.use);
      cell.onclick = (function (pos) { return function (e) { onCellClick(pos, e); }; })(i);
    }
    if (addPlayerRow) addPlayerRow.classList.toggle('hidden', setupMode === 'wissel' || setupMode === 'setLineup');
    addPlayerA.disabled = setupMode === 'wissel' || setupMode === 'setLineup';
    var count = 0;
    for (var j = 1; j <= 12; j++) if (setupPositions[j]) count++;
    if (count >= 12 && setupMode === 'setup') addPlayerA.disabled = true;
    var subCountEl = document.getElementById('wisselCount');
    if (subCountEl && setupMode === 'wissel' && matchStateForReturn) {
      var sData = matchStateForReturn.sets && matchStateForReturn.sets[matchStateForReturn.currentSetIndex];
      var sc = (sData && sData.substitutionCount ? sData.substitutionCount : 0) + sessionSubCount;
      subCountEl.textContent = 'Wissels: ' + sc + '/6';
      subCountEl.style.display = '';
    } else if (subCountEl) subCountEl.style.display = 'none';
  }

  addPlayerA.addEventListener('click', addPlayer);
  newPlayerA.addEventListener('keydown', e => { if (e.key === 'Enter') addPlayer(); });
  newPlayerANumber.addEventListener('keydown', e => { if (e.key === 'Enter') addPlayer(); });

  function updateLabels() {
    var teamAEl = getTeamAField();
    labelTeamAPlayers.textContent = (teamAEl && (teamAEl.value || '').trim()) || 'Team thuis';
  }
  window.scoutSetupUpdateLabels = updateLabels;
  var teamAInit = getTeamAField();
  if (teamAInit) {
    teamAInit.addEventListener('input', updateLabels);
    teamAInit.addEventListener('change', updateLabels);
  }

  function renderSetterFields() {
    const sys = systemA.value;
    setterFields.classList.add('hidden');
    setterSelect.innerHTML = '';
    if (sys === '5-1') {
      setterFields.classList.remove('hidden');
      const label = document.createElement('label');
      label.textContent = 'Spelverdeler (positie bij rotatie 1)';
      setterSelect.appendChild(label);
      const sel = document.createElement('select');
      sel.id = 'setterPosition';
      for (let i = 1; i <= 6; i++) {
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = 'Positie ' + i + (setupPositions[i] ? ' – ' + setupPositions[i].name : '');
        sel.appendChild(opt);
      }
      setterSelect.appendChild(sel);
    } else if (sys === '4-2') {
      setterFields.classList.remove('hidden');
      const label = document.createElement('label');
      label.textContent = 'Spelverdelers (twee posities, bijv. 2 en 5)';
      setterSelect.appendChild(label);
      const div = document.createElement('div');
      div.className = 'setter-double';
      const s1 = document.createElement('select');
      s1.id = 'setterPos1';
      const s2 = document.createElement('select');
      s2.id = 'setterPos2';
      for (let i = 1; i <= 6; i++) {
        [s1, s2].forEach(sel => {
          const opt = document.createElement('option');
          opt.value = i;
          opt.textContent = 'Pos ' + i;
          sel.appendChild(opt);
        });
      }
      div.appendChild(s1);
      div.appendChild(s2);
      setterSelect.appendChild(div);
    }
  }

  systemA.addEventListener('change', renderSetterFields);

  function positionsToMatchSet() {
    var pos = {};
    for (var i = 1; i <= 6; i++) {
      var p = setupPositions[i];
      pos['Position' + i] = p ? p.name : '';
    }
    return pos;
  }

  function saveAndReturnToMatch() {
    if (!matchStateForReturn) return;
    var setIdx = setupMode === 'setLineup' ? setLineupSetNum - 1 : matchStateForReturn.currentSetIndex;
    var setData = matchStateForReturn.sets && matchStateForReturn.sets[setIdx] ? matchStateForReturn.sets[setIdx] : null;
    var pos = positionsToMatchSet();
    if (setupMode === 'wissel') {
      var oldPos = {};
      if (setData) {
        for (var i = 1; i <= 6; i++) oldPos['Position' + i] = setData['Position' + i] || '';
      }
      var subs = [];
      for (var i = 1; i <= 6; i++) {
        var op = oldPos['Position' + i] || '';
        var np = pos['Position' + i] || '';
        if (op !== np && (op || np)) subs.push({ position: i, playerOut: op, playerIn: np });
      }
      matchStateForReturn.pendingSubstitutions = subs;
    } else {
      matchStateForReturn.pendingSubstitutions = [];
      matchStateForReturn._fromSetLineup = true;
    }
    for (var j = 1; j <= 6; j++) matchStateForReturn.sets[setIdx]['Position' + j] = pos['Position' + j];
    matchStateForReturn.positions = pos;
    try {
      sessionStorage.setItem('scoutMatchState', JSON.stringify(matchStateForReturn));
    } catch (_) {}
    window.location.href = 'match.php';
  }

  if (btnBackToMatch) btnBackToMatch.addEventListener('click', saveAndReturnToMatch);
  if (btnStartSet) btnStartSet.addEventListener('click', saveAndReturnToMatch);

  btnStartMatch.addEventListener('click', async () => {
    const teamAEl = getTeamAField();
    const teamA = teamAEl ? (teamAEl.value || '').trim() : '';
    const teamB = (teamBInput.value || '').trim();
    if (!teamA || !teamB) {
      await showAlert('Vul de naam van zowel de thuis- als de uitploeg in.');
      return;
    }
    if (teamA === teamB) {
      await showAlert('De thuis- en uitploeg kunnen niet hetzelfde team zijn.');
      return;
    }
    var filled = 0;
    for (var i = 1; i <= 6; i++) if (setupPositions[i]) filled++;
    if (filled < 6) {
      await showAlert('Zet minimaal 6 spelers in het veld.');
      return;
    }
    const positions = {};
    for (var i = 1; i <= 6; i++) {
      var p = setupPositions[i];
      positions['Position' + i] = p ? p.name : '';
    }
    let setterConfig = null;
    if (systemA.value === '5-1') {
      const sp = document.getElementById('setterPosition');
      setterConfig = { type: '5-1', setterPosition: sp ? parseInt(sp.value, 10) : 1 };
    } else if (systemA.value === '4-2') {
      const s1 = document.getElementById('setterPos1');
      const s2 = document.getElementById('setterPos2');
      setterConfig = {
        type: '4-2',
        setterPositions: [s1 ? parseInt(s1.value, 10) : 2, s2 ? parseInt(s2.value, 10) : 5]
      };
    } else {
      setterConfig = { type: 'geen' };
    }
    var teamAPlayers = [];
    for (var j = 1; j <= 12; j++) {
      var pl = setupPositions[j];
      if (pl) teamAPlayers.push({ name: pl.name, number: pl.number || 0 });
    }
    var matchId = (window.scoutUtils && window.scoutUtils.generateMatchId) ? window.scoutUtils.generateMatchId() : (function () {
      var arr = new Uint8Array(16);
      if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(arr);
      else for (var i = 0; i < 16; i++) arr[i] = Math.floor(Math.random() * 256);
      return Array.from(arr).map(function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    })();
    const state = {
      matchId: matchId,
      teamA,
      teamB,
      teamAPlayers: teamAPlayers,
      systemA: systemA.value,
      setterConfig,
      positionsSet1: positions
    };
    try {
      sessionStorage.removeItem('scoutMatchState');
      localStorage.removeItem('scoutCurrentMatchId');
    } catch (_) {}
    sessionStorage.setItem('scoutSetup', JSON.stringify(state));
    window.location.href = 'match.php';
  });

  var params = getUrlParams();
  var mode = params.mode || '';
  var setParam = parseInt(params.set || '0', 10);

  if (mode === 'wissel' || mode === 'setLineup') {
    setupMode = mode;
    setLineupSetNum = setParam || 2;
    if (btnPlayersNext) btnPlayersNext.classList.add('hidden');
    if (btnBackToMatch) btnBackToMatch.classList.toggle('hidden', mode !== 'wissel');
    if (btnStartSet) {
      btnStartSet.classList.toggle('hidden', mode !== 'setLineup');
      if (nextSetNum) nextSetNum.textContent = String(setLineupSetNum);
    }
    if (playersHint) {
      playersHint.textContent = mode === 'wissel'
        ? 'Wissel spelers: klik veld of bank, dan de andere. Max 6 wissels per set. Een speler mag alleen voor zijn/haar rol wisselen.'
        : 'Kies de opstelling voor set ' + setLineupSetNum + ': klik tegels om spelers te wisselen.';
    }
    loadMatchStateForWisselOrSetLineup().then(function (state) {
      if (!state) {
        showAlert('Geen wedstrijd gevonden.').then(function () {
          window.location.href = 'index.php';
        });
        return;
      }
      sessionSubCount = 0;
      matchStateForReturn = state;
      var teamAPlayers = state.teamAPlayers || [];
      var setIdx = mode === 'setLineup' ? setLineupSetNum - 1 : state.currentSetIndex;
      var setData = state.sets && state.sets[setIdx] ? state.sets[setIdx] : null;
      var inField = {};
      for (var i = 1; i <= 6; i++) {
        var name = setData && setData['Position' + i] ? setData['Position' + i] : '';
        setupPositions[i] = name ? nameToPlayer(name, teamAPlayers) : null;
        if (name) inField[name] = true;
      }
      if (setData && mode === 'wissel') {
        setData.playerRolesInSet = setData.playerRolesInSet || {};
        for (var r = 1; r <= 6; r++) {
          var pname = setData['Position' + r];
          if (pname) setData.playerRolesInSet[pname] = ROLE_BY_POS[r] || setData.playerRolesInSet[pname];
        }
        setData.substitutionCount = setData.substitutionCount || 0;
      }
      var subIdx = 7;
      for (var k = 0; k < teamAPlayers.length && subIdx <= 12; k++) {
        var pl = teamAPlayers[k];
        if (pl && pl.name && !inField[pl.name]) {
          setupPositions[subIdx++] = { name: pl.name, number: pl.number || 0 };
        }
      }
      for (var j = 1; j <= 12; j++) if (!setupPositions[j]) setupPositions[j] = null;
      var teamAEl = getTeamAField();
      if (teamAEl) teamAEl.value = state.teamA || '';
      if (teamBInput) teamBInput.value = state.teamB || '';
      updateLabels();
      showStep('step-players');
      renderSetupCourt();
    });
  } else {
    showStep('step-teams');
  }

  window.addEventListener('pageshow', function (ev) {
    if (ev.persisted && setupMode === 'setup') {
      for (var i = 1; i <= 12; i++) setupPositions[i] = null;
      selectedCell = null;
      showStep('step-teams');
      updateLabels();
      renderSetupCourt();
    }
  });
})();
