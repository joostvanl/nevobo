/**
 * match.js - Kernlogica wedstrijdscouting
 * State, event-flow, scoring, wissels, UI-updates. Gebruikt rules.js, rotation.js, dialog.js.
 */
(function () {
  const RALLY_TEMPLATE = {
    RallyNumber: 0,
    HomeScore: 0,
    AwayScore: 0,
    Rotation: 1,
    events: []
  };

  const EVENT_TEMPLATE = {
    eventType: 0,
    team: '',
    player: 0,
    playerName: '',
    timestamp: '',
    description: '',
    shortDescription: '',
    panel: 0
  };

  let matchState = {
    matchId: '',
    matchDate: '',
    completed: false,
    teamA: '',
    teamB: '',
    teamAPlayers: [],
    liberoConfig: { use: false, substituteFor: 'mid' },
    pendingSubstitutions: [],
    sets: [],
    currentRally: [],
    servingTeam: null,
    homeScore: 0,
    awayScore: 0,
    homeSets: 0,
    awaySets: 0,
    currentSetIndex: 0,
    rotation: 1,
    positions: null,
    setterConfig: null,
    selectedPlayer: null,
    timeoutAdvice: null,
    timeoutAdviceLoading: false,
    lastTimeoutAdvice: null
  };

  function getSetup() {
    try {
      return JSON.parse(sessionStorage.getItem('scoutSetup') || '{}');
    } catch (_) {
      return {};
    }
  }

  function initFromSetup() {
    const setup = getSetup();
    if (!setup.teamA) {
      if (window.navigate) window.navigate('scout-setup'); else window.location.href = '/';
      return;
    }
    matchState.matchId = setup.matchId || (window.scoutUtils && window.scoutUtils.generateMatchId ? window.scoutUtils.generateMatchId() : (function () {
      var arr = new Uint8Array(16);
      if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(arr);
      else for (var i = 0; i < 16; i++) arr[i] = Math.floor(Math.random() * 256);
      return Array.from(arr).map(function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    })());
    matchState.teamA = setup.teamA;
    matchState.teamB = setup.teamB || 'Uit';
    matchState.teamAPlayers = setup.teamAPlayers || [];
    matchState.matchDate = new Date().toISOString().slice(0, 10);
    matchState.positions = setup.positionsSet1 || {};
    matchState.setterConfig = setup.setterConfig || { type: 'geen' };
    matchState.liberoConfig = setup.liberoConfig || matchState.liberoConfig || { use: false, substituteFor: 'mid' };
    matchState.rotation = 1;
    matchState.homeScore = 0;
    matchState.awayScore = 0;
    matchState.homeSets = 0;
    matchState.awaySets = 0;
    matchState.currentSetIndex = 0;
    matchState.sets = [];
    matchState.completed = false;
    matchState.servingTeam = null;
    matchState.currentRally = [];
    startNewSetIfNeeded();
  }

  function startNewSetIfNeeded() {
    const idx = matchState.currentSetIndex;
    if (matchState.sets[idx]) return;
    const homeSets = matchState.homeSets;
    const awaySets = matchState.awaySets;
    const positions = idx === 0 && matchState.positions
      ? matchState.positions
      : (matchState.sets[idx - 1] ? { ...matchState.sets[idx - 1] } : matchState.positions);
    const posCopy = {};
    for (let i = 1; i <= 6; i++) {
      posCopy[`Position${i}`] = (positions && positions[`Position${i}`]) || '';
    }
    matchState.sets[idx] = {
      switchSetter: false,
      SetNumber: idx + 1,
      HomeSets: homeSets,
      AwaySets: awaySets,
      ...posCopy,
      rallies: [],
      substitutionCount: 0,
      playerRolesInSet: {}
    };
  }

  function currentSet() {
    startNewSetIfNeeded();
    return matchState.sets[matchState.currentSetIndex];
  }

  function renderScoreboard() {
    var el;
    if ((el = document.getElementById('matchTeamA'))) el.textContent = matchState.teamA;
    if ((el = document.getElementById('matchTeamB'))) el.textContent = matchState.teamB;
    if ((el = document.getElementById('scoreA'))) el.textContent = matchState.homeScore;
    if ((el = document.getElementById('scoreB'))) el.textContent = matchState.awayScore;
    if ((el = document.getElementById('setA'))) el.textContent = matchState.homeSets;
    if ((el = document.getElementById('setB'))) el.textContent = matchState.awaySets;
    if ((el = document.getElementById('rotationNum'))) el.textContent = matchState.rotation;
    if ((el = document.getElementById('pointHome'))) el.textContent = 'Punt ' + (matchState.teamA || 'Thuis');
    if ((el = document.getElementById('pointAway'))) el.textContent = 'Punt ' + (matchState.teamB || 'Uit');
    if ((el = document.getElementById('btnServiceHome'))) el.textContent = (matchState.teamA || 'Thuis') + ' serveert';
    if ((el = document.getElementById('btnServiceAway'))) el.textContent = (matchState.teamB || 'Uit') + ' serveert';
  }

  var ROLE_BY_START_POS = { 1: 'SV', 2: 'PL', 3: 'MID', 4: 'DIA', 5: 'PL', 6: 'MID' };
  var FRONT_ZONES = [2, 3, 4];
  var BACK_ZONES = [1, 5, 6];

  /** Setup-code → (rol(len), voor/achter). Aanvaller = speler met die rol in voor- of achterrij. */
  var SETUP_TO_ROLE_AND_ROW = {
    '5': { roles: ['PL'], front: true },      // LV: PL voorspeler
    '1': { roles: ['MID'], front: true },    // MV: Mid voorspeler
    'C': { roles: ['DIA', 'SV'], front: true }, // RV: Dia of SV voorspeler
    '30': { roles: ['PL'], front: false },   // LA: PL achterspeler
    'Pipe': { roles: ['MID'], front: false }, // MA: Mid achterspeler
    '10': { roles: ['DIA', 'SV'], front: false } // RA: Dia of SV achterspeler
  };

  function getPlayerInZoneForEvent(zoneNum) {
    if (!matchState.positions || typeof getZoneAtRotation !== 'function') return '';
    return getDisplayPlayerInZone(zoneNum, matchState.rotation);
  }

  /** Rotatie 1 + wij ontvangen: posities 2 en 4 blijven staan; gebruik zone direct. */
  function isReceiveRotation1() {
    return matchState.rotation === 1 && matchState.servingTeam === 'away';
  }

  /** Aanvaller voor setup-code: speler met de juiste rol in voor- of achterrij. Gebruikt display (incl. libero). */
  function getPlayerForSetup(setupDesc) {
    if (!matchState.positions || typeof getZoneAtRotation !== 'function') return '';
    if (isReceiveRotation1() && SETUP_TO_ZONE.hasOwnProperty(setupDesc)) {
      return getPlayerInZoneForEvent(SETUP_TO_ZONE[setupDesc]);
    }
    var cfg = SETUP_TO_ROLE_AND_ROW[setupDesc];
    if (!cfg) return '';
    var zones = cfg.front ? FRONT_ZONES : BACK_ZONES;
    for (var i = 0; i < zones.length; i++) {
      var z = zones[i];
      var role = getRoleInZone(z, matchState.rotation);
      if (cfg.roles.indexOf(role) !== -1) return getDisplayPlayerInZone(z, matchState.rotation) || '';
    }
    return '';
  }

  /** Shirt number for home team player by name; 0 if unknown. */
  function getPlayerNumber(playerName) {
    if (!playerName || !matchState.teamAPlayers || !matchState.teamAPlayers.length) return 0;
    var p = matchState.teamAPlayers.find(function (x) { return x && x.name === playerName; });
    return (p && p.number) ? Number(p.number) : 0;
  }

  /** Zone op het veld per setup-code (4=LV, 3=MV, 2=RV, 5=LA, 6=MA, 1=RA). */
  var SETUP_TO_ZONE = { '5': 4, '1': 3, 'C': 2, '10': 1, 'Pipe': 6, '30': 5 };
  var SETUP_DESCS = ['5', '1', 'C', '10', 'Pipe', '30'];

  /** Aanvaller uit laatste setup-event in rally; leeg als niet te bepalen. */
  function getAttackerFromLastSetup() {
    var r = matchState.currentRally;
    for (var i = r.length - 1; i >= 0; i--) {
      if (Number(r[i].panel) === 1 && SETUP_DESCS.indexOf(r[i].description) !== -1) {
        return r[i].playerName || '';
      }
    }
    return '';
  }

  function getZoneForLastSetupInRally() {
    var r = matchState.currentRally;
    for (var i = r.length - 1; i >= 0; i--) {
      if (Number(r[i].panel) === 1 && SETUP_TO_ZONE.hasOwnProperty(r[i].description)) {
        return SETUP_TO_ZONE[r[i].description];
      }
    }
    return null;
  }

  function getRoleInZone(zoneNum, rotation) {
    var idx = (zoneNum - 1 + (rotation - 1)) % 6;
    var startPos = idx + 1;
    return ROLE_BY_START_POS[startPos] || '';
  }

  /** Libero = eerste wisselspeler (bench positie 7 = teamAPlayers[6]). */
  function getLiberoPlayer() {
    var idx = (typeof RULES !== 'undefined' && RULES.LIBERO_BENCH_POSITION) ? RULES.LIBERO_BENCH_POSITION - 1 : 6;
    var pl = matchState.teamAPlayers && matchState.teamAPlayers[idx];
    return pl ? pl.name : '';
  }

  /** Libero: in zone 1 alleen als wij niet serveren (dan serveert de echte speler). In zones 5,6 altijd. */
  function getDisplayPlayerInZone(zoneNum, rotation) {
    var zone = typeof getZoneAtRotation === 'function'
      ? getZoneAtRotation(matchState.positions, rotation)
      : {};
    var name = zone[zoneNum] || '';
    var libCfg = matchState.liberoConfig || {};
    if (!libCfg.use) return name;
    var role = getRoleInZone(zoneNum, rotation);
    var subFor = libCfg.substituteFor || 'mid';
    var matchRole = (subFor === 'mid' && role === 'MID') || (subFor === 'pl' && role === 'PL');
    var liberoName = getLiberoPlayer();
    if (!matchRole || !liberoName) return name;
    if (zoneNum === 1 && matchState.servingTeam === 'home') return name;
    if ([1, 5, 6].indexOf(zoneNum) !== -1) return liberoName;
    return name;
  }

  /** De meest aannemelijke passers bij service: middenspeler in achterrij + twee PL-spelers. Bij 4-2 ook DIA in achterrij. */
  function getPasserZones(rotation) {
    var zones = [];
    var BACK_ZONES = [1, 5, 6];
    var cfg = matchState.setterConfig || { type: 'geen' };
    var includeDia = cfg.type === '4-2';
    for (var z = 1; z <= 6; z++) {
      var role = getRoleInZone(z, rotation);
      if (role === 'PL') zones.push(z);
      else if (role === 'MID' && BACK_ZONES.indexOf(z) !== -1) zones.push(z);
      else if (includeDia && role === 'DIA' && BACK_ZONES.indexOf(z) !== -1) zones.push(z);
    }
    return zones;
  }

  function renderRotation() {
    if (!matchState.positions) return;
    const zone = typeof getZoneAtRotation === 'function'
      ? getZoneAtRotation(matchState.positions, matchState.rotation)
      : {};
    const setterName = matchState.setterConfig && matchState.setterConfig.type === '5-1' && typeof getSetter51 === 'function'
      ? getSetter51(matchState.positions, matchState.rotation, matchState.setterConfig.setterPosition)
      : '';
    var R = matchState.rotation;
    for (var z = 1; z <= 6; z++) {
      var el = document.getElementById('player-' + z);
      var cell = document.getElementById('cell-' + z);
      var badge = document.getElementById('badge-' + z);
      if (!el || !cell) continue;
      var name = getDisplayPlayerInZone(z, R);
      var num = getPlayerNumber(name);
      var display = name || '–';
      el.textContent = display;
      cell.dataset.player = name || '';
      cell.classList.remove('role-sv', 'role-pl', 'role-mid', 'role-dia');
      var role = getRoleInZone(z, R);
      if (role) cell.classList.add('role-' + role.toLowerCase());
      cell.classList.toggle('setter', name === setterName);
      cell.classList.toggle('empty', !name);
      var isLibero = matchState.liberoConfig && matchState.liberoConfig.use && name === getLiberoPlayer();
      cell.classList.toggle('libero', !!isLibero);
      if (badge) badge.textContent = z + ' ' + role + (num ? ' #' + num : '');
      var passerZones = isServicePass() ? getPasserZones(R) : [];
      cell.classList.toggle('passer-highlight', passerZones.indexOf(z) !== -1);
    }
    /* Alleen rotation court; wissel-overlay heeft eigen handlers */
    document.querySelectorAll('#rotationCourt .court-cell').forEach(function (c) {
      c.onclick = function () {
        var p = c.dataset.player || null;
        matchState.selectedPlayer = p || null;
        document.querySelectorAll('#rotationCourt .court-cell').forEach(function (x) { x.classList.remove('selected'); });
        if (p) c.classList.add('selected');
        updateButtonVisibility();
      };
    });
  }

  function clearSelection() {
    matchState.selectedPlayer = null;
    document.querySelectorAll('.rotation-court .court-cell.selected').forEach(function (c) { c.classList.remove('selected'); });
  }

  var escapeHtml = (window.scoutUtils && window.scoutUtils.escapeHtml) || function (s) {
    if (!s) return '';
    var div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  };
  var escapeAttr = (window.scoutUtils && window.scoutUtils.escapeAttr) || function (s) {
    if (!s) return '';
    return String(s).replace(/"/g, '&quot;').replace(/</g, '&lt;');
  };

  function addEvent(description, shortDescription, panel, teamKey) {
    var subs = matchState.pendingSubstitutions || [];
    var isFirstRallyOfNewSet = (matchState.currentSetIndex > 0) && (currentSet().rallies || []).length === 0;
    if (subs.length && matchState.currentRally.length === 0 && !isFirstRallyOfNewSet) {
      var set = currentSet();
      set.substitutionCount = (set.substitutionCount || 0) + subs.length;
      var ts = new Date().toISOString().slice(0, 19) + 'Z';
      subs.forEach(function (s) {
        if (s.playerIn) {
          matchState.currentRally.push({
            eventType: 0,
            team: matchState.teamA,
            player: getPlayerNumber(s.playerIn),
            playerName: s.playerIn,
            timestamp: ts,
            description: '<- In',
            shortDescription: '',
            panel: 0
          });
        }
        if (s.playerOut) {
          matchState.currentRally.push({
            eventType: 0,
            team: matchState.teamA,
            player: getPlayerNumber(s.playerOut),
            playerName: s.playerOut,
            timestamp: ts,
            description: 'Out ->',
            shortDescription: '',
            panel: 0
          });
        }
      });
      matchState.pendingSubstitutions = [];
    }
    const teamName = teamKey === 'home' ? matchState.teamA : matchState.teamB;
    const eventType = teamKey === 'home' ? 0 : 1;
    if (panel === 0 && (teamKey === 'home' || teamKey === 'away')) {
      matchState.servingTeam = teamKey;
    }
    var playerName = '';
    var playerNum = 0;
    if (teamKey === 'home') {
      if (panel === 0) {
        playerName = getPlayerInZoneForEvent(1);
        playerNum = getPlayerNumber(playerName);
      } else if (panel === 1 && PASS_ZONE_DESCS.indexOf(description) !== -1) {
        if (isServicePass()) {
          playerName = matchState.selectedPlayer || '';
          playerNum = getPlayerNumber(playerName);
        }
      } else if (panel === 1 && SETUP_TO_ROLE_AND_ROW.hasOwnProperty(description)) {
        playerName = getPlayerForSetup(description);
        playerNum = getPlayerNumber(playerName);
      } else if (panel === 2 && (description === 'Smash' || description === 'Tip')) {
        playerName = getAttackerFromLastSetup() || matchState.selectedPlayer || '';
        playerNum = getPlayerNumber(playerName);
      } else if (panel === 2) {
        /* Overige aanval: leeg of selected */
        playerName = matchState.selectedPlayer || '';
        playerNum = getPlayerNumber(playerName);
      } else {
        playerName = matchState.selectedPlayer || '';
        playerNum = getPlayerNumber(playerName);
      }
    }
    const ev = {
      ...EVENT_TEMPLATE,
      eventType,
      team: teamName,
      player: playerNum,
      playerName: playerName,
      timestamp: new Date().toISOString().slice(0, 19) + 'Z',
      description,
      shortDescription: shortDescription || description,
      panel: Number(panel)
    };
    matchState.currentRally.push(ev);
    clearSelection();
    renderCurrentRally();
    updateButtonVisibility();
  }

  function renderCurrentRally() {
    const el = document.getElementById('currentRallyEvents');
    el.innerHTML = matchState.currentRally.map(e => {
      var namePart = e.playerName ? ' (' + (e.player && e.player > 0 ? '#' + e.player + ' ' : '') + escapeHtml(e.playerName) + ')' : '';
      return `<span class="event-chip">${escapeHtml(e.description)}${namePart}</span>`;
    }).join('');
    var prevEl = document.getElementById('previousRallyEvents');
    if (prevEl) {
      var rallies = currentSet().rallies || [];
      var lastRally = rallies.length > 0 ? rallies[rallies.length - 1] : null;
      var prevEvents = lastRally && lastRally.events ? lastRally.events : [];
      prevEl.innerHTML = prevEvents.length > 0 ? prevEvents.map(function (e) {
        var namePart = e.playerName ? ' (' + (e.player && e.player > 0 ? '#' + e.player + ' ' : '') + escapeHtml(e.playerName) + ')' : '';
        return '<span class="event-chip event-chip-prev">' + escapeHtml(e.description) + namePart + '</span>';
      }).join('') : '<span class="rally-empty">–</span>';
    }
    var undoBtn = document.getElementById('rallyUndo');
    if (undoBtn) {
      var hasRallies = currentSet().rallies && currentSet().rallies.length > 0;
      undoBtn.disabled = matchState.currentRally.length === 0 && !hasRallies;
      undoBtn.title = matchState.currentRally.length > 0 ? 'Laatste actie ongedaan maken' : (hasRallies ? 'Terug naar vorige rally' : 'Ongedaan maken');
      undoBtn.textContent = matchState.currentRally.length > 0 ? '↶ Undo' : (hasRallies ? '↶ Vorige rally' : '↶ Undo');
    }
    updateButtonVisibility();
  }

  function undoRallyEvent() {
    if (matchState.currentRally.length > 0) {
      var last = matchState.currentRally.pop();
      var prev = matchState.currentRally.length > 0 ? matchState.currentRally[matchState.currentRally.length - 1] : null;
      var isPair = last && prev && (
        (last.description === '<- In' && prev.description === 'Out ->') ||
        (last.description === 'Out ->' && prev.description === '<- In')
      );
      if (isPair) {
        matchState.currentRally.pop();
      }
      if (Number(last.panel) === 0 && last.description === 'Service') {
        var rallies = currentSet().rallies;
        if (rallies && rallies.length >= 2) {
          var prev = rallies[rallies.length - 2];
          var curr = rallies[rallies.length - 1];
          matchState.servingTeam = curr.HomeScore > prev.HomeScore ? 'home' : 'away';
        } else {
          matchState.servingTeam = null;
        }
      }
      clearSelection();
      hideOutcomeSub();
      renderCurrentRally();
      renderScoreboard();
      renderRotation();
      updateButtonVisibility();
      saveMatch();
      return;
    }
    undoLastRally();
  }

  /** Haal de laatste rally terug naar bewerkbare staat. Events komen in currentRally, zodat je event-voor-event kunt undoen of aanpassen. */
  function undoLastRally() {
    var set = currentSet();
    var rallies = set.rallies || [];
    if (rallies.length === 0) return;
    var lastRally = rallies.pop();
    var setWon = false;
    var setWinner = null;
    if (RULES.isTiebreak(matchState.currentSetIndex + 1)) {
      setWon = (lastRally.HomeScore >= 15 || lastRally.AwayScore >= 15) && Math.abs(lastRally.HomeScore - lastRally.AwayScore) >= 2;
    } else {
      setWon = (lastRally.HomeScore >= 25 || lastRally.AwayScore >= 25) && Math.abs(lastRally.HomeScore - lastRally.AwayScore) >= 2;
    }
    if (setWon) {
      setWinner = lastRally.HomeScore > lastRally.AwayScore ? 'home' : 'away';
    }
    if (rallies.length > 0) {
      var prev = rallies[rallies.length - 1];
      matchState.homeScore = prev.HomeScore;
      matchState.awayScore = prev.AwayScore;
      matchState.rotation = prev.Rotation || 1;
      var prevPrev = rallies.length >= 2 ? rallies[rallies.length - 2] : null;
      matchState.servingTeam = prev.HomeScore > (prevPrev ? prevPrev.HomeScore : 0) ? 'home' : (prev.AwayScore > (prevPrev ? prevPrev.AwayScore : 0) ? 'away' : null);
    } else {
      matchState.homeScore = 0;
      matchState.awayScore = 0;
      matchState.rotation = 1;
      matchState.servingTeam = null;
    }
    if (setWinner) {
      matchState.currentSetIndex--;
      if (setWinner === 'home') matchState.homeSets--;
      else matchState.awaySets--;
    }
    matchState.currentRally = (lastRally.events || []).map(function (e) { return { ...e }; });
    clearSelection();
    renderCurrentRally();
    renderScoreboard();
    renderRotation();
    updateButtonVisibility();
    saveMatch();
  }

  var PASS_ZONE_DESCS = ['Zone I', 'Zone II', 'Zone III'];

  function isServicePass() {
    var r = matchState.currentRally;
    var hasService = r.some(function (e) { return Number(e.panel) === 0; });
    var rallyHasPassOrOverpass = r.some(function (e) {
      return Number(e.panel) === 1 && (PASS_ZONE_DESCS.indexOf(e.description) !== -1 || e.description === 'Overpass');
    });
    return hasService && !rallyHasPassOrOverpass && matchState.servingTeam === 'away';
  }

  /**
   * Bepaal rally-status uit huidige events.
   * phaseEvents = events na laatste 'Gehouden' (indien aanwezig), anders alle events.
   * Na setup begint de cyclus opnieuw: weer pass.
   * @returns {{ hasService, hasPass, hasSetup, hasOverpass, lastEventIsSetup, lastEventIsZonePass, lastEventIsOverpass }}
   */
  function getRallyState() {
    const r = matchState.currentRally;
    const hasService = r.some(e => Number(e.panel) === 0);
    const zoneDescs = ['Zone I', 'Zone II', 'Zone III'];
    const setupDescs = ['5', '1', 'C', '10', 'Pipe', '30'];
    var phaseEvents = r;
    var lastGehouden = -1;
    for (var i = 0; i < r.length; i++) {
      if (r[i].description === 'Gehouden') lastGehouden = i;
    }
    if (lastGehouden >= 0) phaseEvents = r.slice(lastGehouden + 1);
    const hasZonePass = phaseEvents.some(e => Number(e.panel) === 1 && zoneDescs.includes(e.description));
    const hasOverpass = phaseEvents.some(e => Number(e.panel) === 1 && e.description === 'Overpass');
    const hasPass = hasZonePass || hasOverpass;
    const hasSetup = phaseEvents.some(e => Number(e.panel) === 1 && setupDescs.includes(e.description));
    const lastEv = phaseEvents.length ? phaseEvents[phaseEvents.length - 1] : null;
    const lastEventIsSetup = lastEv && Number(lastEv.panel) === 1 && setupDescs.includes(lastEv.description);
    const lastEventIsZonePass = lastEv && Number(lastEv.panel) === 1 && zoneDescs.includes(lastEv.description);
    const lastEventIsOverpass = lastEv && Number(lastEv.panel) === 1 && lastEv.description === 'Overpass';
    const weReceive = matchState.servingTeam === 'away';
    return { hasService, hasPass, hasSetup, hasOverpass, weReceive, lastEventIsSetup, lastEventIsZonePass, lastEventIsOverpass };
  }

  /** Eerste service van de set is onbekend; daarna wint de vorige puntwinner en die serveert. */
  function isFirstRallyOfSet() {
    const set = currentSet();
    return set && set.rallies && set.rallies.length === 0;
  }

  function updateButtonVisibility() {
    const s = getRallyState();
    const set = (id, visible) => {
      const el = document.getElementById(id);
      if (el) el.classList.toggle('hidden', !visible);
    };

    if (!s.hasService) {
      set('group-service', true);
      set('group-service-first', isFirstRallyOfSet());
      set('group-service-known', !isFirstRallyOfSet());
      var btnKnown = document.getElementById('btnServiceKnown');
      if (btnKnown && matchState.servingTeam) {
        var serverName = matchState.servingTeam === 'home'
          ? getPlayerInZoneForEvent(1)
          : (matchState.teamB || 'Uit');
        btnKnown.textContent = 'Service (' + (serverName || (matchState.servingTeam === 'home' ? matchState.teamA : matchState.teamB) || '') + ')';
      }
      set('group-pass', false);
      set('group-setup', false);
      set('group-outcome', false);
      set('group-point', false);
      hideOutcomeSub();
    } else {
      set('group-service', false);
      set('group-service-first', false);
      set('group-service-known', false);
      set('group-pass', true); /* altijd zichtbaar: bal kan elk moment terugkomen */
      set('group-setup', s.hasPass && !s.lastEventIsOverpass && (!s.hasSetup || s.lastEventIsZonePass));
      set('group-point', true);
    }

    var rot = matchState.rotation || 1;
    document.querySelectorAll('.btn-event[data-desc="C"]').forEach(function (btn) {
      btn.disabled = rot >= 4;
    });
    document.querySelectorAll('.btn-event[data-desc="10"]').forEach(function (btn) {
      btn.disabled = rot <= 3;
    });

    /* Pass-knoppen altijd inschakelbaar; addEvent toont alert indien passer nog geselecteerd moet worden */
    document.querySelectorAll('.btn-pass-zone, .btn-overpass').forEach(function (btn) {
      btn.disabled = false;
    });

    var rallyInProgress = matchState.currentRally.length > 0;
    var btnWissels = document.getElementById('btnWissels');
    if (btnWissels) btnWissels.disabled = rallyInProgress;

    if (matchState.positions) renderRotation();
  }

  function givePoint(toHome) {
    const set = currentSet();
    const rallyNumber = set.rallies.length;
    const homeScore = matchState.homeScore + (toHome ? 1 : 0);
    const awayScore = matchState.awayScore + (toHome ? 0 : 1);
    const isTiebreak = RULES.isTiebreak(matchState.currentSetIndex + 1);
    const setWon = RULES.isSetWon(homeScore, awayScore, isTiebreak);

    const events = matchState.currentRally.length
      ? matchState.currentRally.map(e => {
          const ev = { ...e };
          if (Number(ev.panel) === 4) {
            ev.team = toHome ? matchState.teamB : matchState.teamA;
            ev.eventType = toHome ? 1 : 0;
          } else if (Number(ev.panel) === 2 || Number(ev.panel) === 3) {
            ev.team = toHome ? matchState.teamA : matchState.teamB;
            ev.eventType = toHome ? 0 : 1;
          }
          return ev;
        })
      : [{
        ...EVENT_TEMPLATE,
        eventType: matchState.servingTeam === 'away' ? 0 : 1,
        team: matchState.servingTeam === 'home' ? matchState.teamA : matchState.teamB,
        description: 'Service',
        shortDescription: 'S',
        panel: 0
      }];
    const rally = {
      RallyNumber: rallyNumber,
      HomeScore: homeScore,
      AwayScore: awayScore,
      Rotation: matchState.rotation,
      events
    };
    set.rallies.push(rally);

    matchState.homeScore = homeScore;
    matchState.awayScore = awayScore;
    matchState.currentRally = [];
    matchState.selectedPlayer = null;
    document.querySelectorAll('.rotation-court .court-cell.selected').forEach(c => c.classList.remove('selected'));

    if (setWon === 'home') {
      matchState.homeSets++;
      matchState.currentSetIndex++;
      matchState.homeScore = 0;
      matchState.awayScore = 0;
      matchState.rotation = 1;
      if (RULES.isMatchOver(matchState.homeSets, matchState.awaySets)) {
        saveMatch(true);
        showAlert(`Wedstrijd afgelopen. ${matchState.teamA} wint ${matchState.homeSets}-${matchState.awaySets}.`);
        return;
      }
      startNewSetIfNeeded();
      saveMatch(true);
      try { sessionStorage.setItem('scoutMatchState', JSON.stringify(matchState)); } catch (_) {}
      if (typeof window._scoutPauseLock === 'function') window._scoutPauseLock();
      if (window.navigate) window.navigate('scout-setup', { mode: 'setLineup', set: matchState.currentSetIndex + 1 });
      return;
    } else if (setWon === 'away') {
      matchState.awaySets++;
      matchState.currentSetIndex++;
      matchState.homeScore = 0;
      matchState.awayScore = 0;
      matchState.rotation = 1;
      if (RULES.isMatchOver(matchState.homeSets, matchState.awaySets)) {
        saveMatch(true);
        showAlert(`Wedstrijd afgelopen. ${matchState.teamB} wint ${matchState.awaySets}-${matchState.homeSets}.`);
        return;
      }
      startNewSetIfNeeded();
      saveMatch(true);
      try { sessionStorage.setItem('scoutMatchState', JSON.stringify(matchState)); } catch (_) {}
      if (typeof window._scoutPauseLock === 'function') window._scoutPauseLock();
      if (window.navigate) window.navigate('scout-setup', { mode: 'setLineup', set: matchState.currentSetIndex + 1 });
      return;
    } else {
      if (toHome && matchState.servingTeam === 'away') {
        matchState.rotation = (matchState.rotation % 6) + 1;
      }
    }
    matchState.servingTeam = toHome ? 'home' : 'away';
    renderScoreboard();
    renderRotation();
    renderCurrentRally();
    updateButtonVisibility();
    saveMatch();
  }

  var saveMatchDebounceTimer = null;
  var SAVE_DEBOUNCE_MS = 1500;

  function saveMatch(immediate, onDone) {
    if (!matchState.matchId) return;
    try {
      sessionStorage.setItem('scoutMatchState', JSON.stringify(matchState));
      localStorage.setItem('scoutCurrentMatchId', matchState.matchId);
    } catch (_) {}
    function doSave() {
      var payload = {
        matchId: matchState.matchId,
        matchDate: matchState.matchDate,
        completed: matchState.completed === true,
        teamA: matchState.teamA,
        teamB: matchState.teamB,
        teamAPlayers: matchState.teamAPlayers || [],
        setterConfig: matchState.setterConfig || { type: 'geen' },
        liberoConfig: matchState.liberoConfig || { use: false, substituteFor: 'mid' },
        sets: matchState.sets
      };
      if (matchState.timeoutAdvice) payload.timeoutAdvice = matchState.timeoutAdvice;
      if (matchState.lastTimeoutAdvice) payload.lastTimeoutAdvice = matchState.lastTimeoutAdvice;
      var done = typeof onDone === 'function' ? onDone : function () {};
      fetch('/api/scout/match/' + encodeURIComponent(matchState.matchId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (window._scoutToken || '') },
        body: JSON.stringify(payload)
      })
        .then(function (r) {
          return r.text().then(function (text) {
            var data;
            try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }
            if (!r.ok) {
              var msg = (data && data.error) ? data.error : 'Opslaan mislukt (status ' + r.status + ')';
              if (data) {
                var parts = [msg];
                if (data.dataDirExists === false) parts.push(' data/ bestaat niet');
                if (data.dataDirWritable === false) parts.push(' data/ niet schrijfbaar');
                if (data.dataDirPath) parts.push(' pad: ' + data.dataDirPath);
                if (data.phpError) parts.push(' PHP: ' + data.phpError);
                if (data.exception) parts.push(' Fout: ' + data.exception);
                if (data.file) parts.push(' bestand: ' + data.file + ':' + (data.line || ''));
                msg = parts.join('. ');
                console.error('Save error:', data);
              }
              throw new Error(msg);
            }
            return data;
          });
        })
        .then(done)
        .catch(function (err) {
          var msg = (err && err.message) ? err.message : 'Kon wedstrijd niet opslaan.';
          if (typeof showAlert === 'function') showAlert(msg);
          else console.error('Save failed:', msg);
          done();
        });
    }
    if (saveMatchDebounceTimer) clearTimeout(saveMatchDebounceTimer);
    saveMatchDebounceTimer = null;
    if (immediate) {
      doSave();
    } else {
      saveMatchDebounceTimer = setTimeout(function () {
        saveMatchDebounceTimer = null;
        doSave();
      }, SAVE_DEBOUNCE_MS);
    }
  }

  /** Rol per positie (1-6): SV, PL, MID, DIA. Voor wissel-overlay. */
  var WISSEL_ROLE_BY_POS = { 1: 'SV', 2: 'PL', 3: 'MID', 4: 'DIA', 5: 'PL', 6: 'MID' };

  var wisselPositions = {};
  var wisselSelectedCell = null;
  var wisselSessionSubCount = 0;

  function nameToPlayerForWissel(name, teamAPlayers) {
    if (!name || !teamAPlayers) return { name: name, number: 0 };
    var p = teamAPlayers.find(function (x) { return x && x.name === name; });
    return p ? { name: p.name, number: p.number || 0 } : { name: name, number: 0 };
  }

  function openWisselOverlay() {
    saveMatch();
    wisselSessionSubCount = 0;
    wisselSelectedCell = null;
    var teamAPlayers = matchState.teamAPlayers || [];
    var setIdx = matchState.currentSetIndex;
    var setData = currentSet();
    var inField = {};
    for (var i = 1; i <= 12; i++) wisselPositions[i] = null;
    for (var i = 1; i <= 6; i++) {
      var name = setData && setData['Position' + i] ? setData['Position' + i] : '';
      wisselPositions[i] = name ? nameToPlayerForWissel(name, teamAPlayers) : null;
      if (name) inField[name] = true;
    }
    setData.playerRolesInSet = setData.playerRolesInSet || {};
    for (var r = 1; r <= 6; r++) {
      var pname = setData['Position' + r];
      if (pname) setData.playerRolesInSet[pname] = WISSEL_ROLE_BY_POS[r] || setData.playerRolesInSet[pname];
    }
    setData.substitutionCount = setData.substitutionCount || 0;
    var subIdx = 7;
    for (var k = 0; k < teamAPlayers.length && subIdx <= 12; k++) {
      var pl = teamAPlayers[k];
      if (pl && pl.name && !inField[pl.name]) {
        wisselPositions[subIdx++] = { name: pl.name, number: pl.number || 0 };
      }
    }
    renderWisselCourt();
    var overlay = document.getElementById('wisselOverlay');
    if (overlay) {
      overlay.classList.remove('hidden');
      overlay.setAttribute('aria-hidden', 'false');
    }
  }

  function closeWisselOverlay() {
    var overlay = document.getElementById('wisselOverlay');
    if (overlay) {
      overlay.classList.add('hidden');
      overlay.setAttribute('aria-hidden', 'true');
    }
  }

  function applyWisselOverlayAndClose() {
    var setIdx = matchState.currentSetIndex;
    var setData = currentSet();
    var oldPos = {};
    if (setData) {
      for (var i = 1; i <= 6; i++) oldPos['Position' + i] = setData['Position' + i] || '';
    }
    var pos = {};
    for (var i = 1; i <= 6; i++) {
      var p = wisselPositions[i];
      pos['Position' + i] = p ? p.name : '';
    }
    var subs = [];
    for (var i = 1; i <= 6; i++) {
      var op = oldPos['Position' + i] || '';
      var np = pos['Position' + i] || '';
      if (op !== np && (op || np)) subs.push({ position: i, playerOut: op, playerIn: np });
    }
    matchState.pendingSubstitutions = subs;
    for (var j = 1; j <= 6; j++) setData['Position' + j] = pos['Position' + j];
    matchState.positions = pos;
    renderRotation();
    updateButtonVisibility();
    saveMatch();
    closeWisselOverlay();
  }

  /**
   * Valideer wissel: rol-beperking en max 6 wissels per set.
   * Speler mag alleen wisselen voor toegewezen rol; nieuwe spelers max 6x per set.
   * @param {number} posA - positie 1-12
   * @param {number} posB - positie 1-12
   * @returns {Promise<boolean>} true = wissel toegestaan
   */
  async function canSwapForWisselOverlay(posA, posB) {
    var fieldPos = (posA <= 6) ? posA : (posB <= 6) ? posB : null;
    var benchPos = (posA >= 7) ? posA : (posB >= 7) ? posB : null;
    if (!fieldPos || !benchPos) return true;
    var setData = currentSet();
    if (!setData) return true;
    var subCount = (setData.substitutionCount || 0) + wisselSessionSubCount;
    var playerRoles = setData.playerRolesInSet || {};
    var role = WISSEL_ROLE_BY_POS[fieldPos] || '';
    var benchPlayer = wisselPositions[benchPos];
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

  function recordWisselSubstitution(posA, posB) {
    var fieldPos = (posA <= 6) ? posA : (posB <= 6) ? posB : null;
    if (!fieldPos) return;
    var setData = currentSet();
    if (!setData) return;
    setData.playerRolesInSet = setData.playerRolesInSet || {};
    var role = WISSEL_ROLE_BY_POS[fieldPos] || '';
    var playerEntered = wisselPositions[fieldPos];
    if (!playerEntered || !playerEntered.name) return;
    wisselSessionSubCount++;
    setData.playerRolesInSet[playerEntered.name] = role;
  }

  async function onWisselCellClick(pos, e) {
    if (wisselSelectedCell === null) {
      wisselSelectedCell = pos;
      renderWisselCourt();
      return;
    }
    if (wisselSelectedCell === pos) {
      wisselSelectedCell = null;
      renderWisselCourt();
      return;
    }
    if (!(await canSwapForWisselOverlay(wisselSelectedCell, pos))) return;
    var tmp = wisselPositions[wisselSelectedCell];
    wisselPositions[wisselSelectedCell] = wisselPositions[pos];
    wisselPositions[pos] = tmp;
    recordWisselSubstitution(wisselSelectedCell, pos);
    wisselSelectedCell = null;
    renderWisselCourt();
  }

  function renderWisselCourt() {
    for (var i = 1; i <= 12; i++) {
      var cell = document.getElementById('wissel-cell-' + i);
      if (!cell) continue;
      var p = wisselPositions[i];
      var badge = cell.querySelector('.tile-badge');
      var nameEl = cell.querySelector('.tile-name');
      if (p) {
        if (i <= 6) {
          var role = WISSEL_ROLE_BY_POS[i] || '';
          badge.textContent = role + (p.number ? ' #' + p.number : '');
        } else {
          var setData = currentSet();
          var subRole = '';
          if (setData && setData.playerRolesInSet && setData.playerRolesInSet[p.name]) subRole = setData.playerRolesInSet[p.name] + ' ';
          badge.textContent = subRole + (p.number ? '#' + p.number : '–');
        }
        nameEl.textContent = p.name;
        nameEl.classList.remove('empty');
      } else {
        if (i <= 6) {
          badge.textContent = String(i) + ' ' + (WISSEL_ROLE_BY_POS[i] || '');
        } else {
          badge.textContent = '–';
        }
        nameEl.textContent = '';
        nameEl.classList.add('empty');
      }
      cell.classList.toggle('selected', wisselSelectedCell === i);
      cell.classList.toggle('libero-highlight', i === 7 && matchState.liberoConfig && matchState.liberoConfig.use);
      cell.onclick = (function (pos) { return function (e) { onWisselCellClick(pos, e); }; })(i);
    }
    var subCountEl = document.getElementById('wisselCount');
    if (subCountEl) {
      var setData = currentSet();
      var sc = (setData && setData.substitutionCount ? setData.substitutionCount : 0) + wisselSessionSubCount;
      subCountEl.textContent = 'Wissels: ' + sc + '/6';
    }
  }

  function goToWissels() {
    openWisselOverlay();
  }

  function teamForEvent(panel, buttonTeam) {
    if (buttonTeam === 'home' || buttonTeam === 'away') return buttonTeam;
    if (panel === 0) return null;
    if (panel === 1) return 'home'; // pass/setup altijd thuisploeg (we scouten ons eigen team)
    if (panel === 2) return 'home';   // aanval = ons (thuis)
    if (panel === 3) return 'away';   // block = tegenstander
    return null;
  }

  /**
   * Bepaal wie het punt krijgt bij een rally-einde.
   * Ace = serverende partij wint. Out/In net zonder pass/aanval = ontvangende partij.
   * Na setup: laatste aanval bepaalt wie wint bij Out/Drop.
   * @param {string} description - bv. 'Ace', 'Out', 'Smash'
   * @returns {boolean} true = punt voor thuisploeg
   */
  function getPointWinnerForOutcome(description) {
    if (description === 'Ace') {
      return matchState.servingTeam === 'home';
    }
    var r = matchState.currentRally;
    var hasPassOrAttack = r.some(function (e) {
      var p = Number(e.panel);
      return p === 1 || p === 2;
    });
    if ((description === 'Out' || description === 'In net') && !hasPassOrAttack) {
      return matchState.servingTeam === 'away';
    }
    var setupDescs = ['5', '1', 'C', '10', 'Pipe', '30'];
    var hasSetup = r.some(function (e) {
      return Number(e.panel) === 1 && setupDescs.indexOf(e.description) !== -1;
    });
    if (description === 'Out' || description === 'In net') {
      if (hasSetup) return false;
      return true;
    }
    var lastAttackByHome = false;
    for (var i = r.length - 1; i >= 0; i--) {
      if (Number(r[i].panel) === 2 && r[i].team === matchState.teamA) {
        lastAttackByHome = true;
        break;
      }
      if (Number(r[i].panel) === 2 && r[i].team === matchState.teamB) {
        lastAttackByHome = false;
        break;
      }
    }
    if (lastAttackByHome) return false;
    if (hasSetup) return false;
    return true;
  }

  var pendingPointToHome = null;

  function hideOutcomeSub() {
    var el = document.getElementById('group-outcome-sub');
    if (el) el.classList.add('hidden');
    pendingPointToHome = null;
    clearSelection();
  }

  function showOutcomeSub(forHome) {
    pendingPointToHome = forHome;
    var el = document.getElementById('group-outcome-sub');
    var label = document.getElementById('outcomeSubLabel');
    if (el) el.classList.remove('hidden');
    if (label) label.textContent = forHome ? 'Punt thuis – hoe eindigde de rally?' : 'Punt uit – hoe eindigde de rally?';
  }

  /** Event delegation: werkt ook als DOM wordt vervangen (SPA-navigatie). */
  if (!window._scoutClickDelegationAttached) {
    window._scoutClickDelegationAttached = true;
    var lastActionBarHandled = { target: null, time: 0 };
    function handleActionBarClick(ev, fromTouch) {
      var actionBtn = ev.target.closest('.match-action-bar button[id^="btn"]');
      if (!actionBtn) return false;
      /* Voorkom dubbele uitvoering wanneer touch + click beide vuren */
      if (lastActionBarHandled.target === actionBtn && (Date.now() - lastActionBarHandled.time) < 500) return true;
      lastActionBarHandled.target = actionBtn;
      lastActionBarHandled.time = Date.now();
      try {
        if (actionBtn.id === 'btnWissels') goToWissels();
        else if (actionBtn.id === 'btnTimeout') requestTimeoutAdvice();
        else if (actionBtn.id === 'btnOpties') openOptions();
        else if (actionBtn.id === 'btnEind') endMatch();
        else if (actionBtn.id === 'btnDelen') shareMatch();
      } catch (err) {
        console.error('Actiebalk actie fout:', err);
        if (typeof window.showToast === 'function') window.showToast('Er ging iets mis: ' + (err.message || err), 'error');
      }
      if (ev.cancelable) {
        ev.preventDefault();
        ev.stopPropagation();
      }
      return true;
    }
    document.addEventListener('touchend', function (ev) {
      if (handleActionBarClick(ev, true) && ev.cancelable) ev.preventDefault();
    }, true);
    document.addEventListener('click', async function (ev) {
      if (handleActionBarClick(ev, false)) return;
      /* Actiebalk: altijd eerst checken (knoppen in vaste balk, los van rotationCourt) */
      var actionBtn = ev.target.closest('.match-action-bar button[id^="btn"]');
      if (actionBtn) {
        try {
          if (actionBtn.id === 'btnWissels') goToWissels();
          else if (actionBtn.id === 'btnTimeout') requestTimeoutAdvice();
          else if (actionBtn.id === 'btnOpties') openOptions();
          else if (actionBtn.id === 'btnEind') endMatch();
          else if (actionBtn.id === 'btnDelen') shareMatch();
        } catch (err) {
          console.error('Actiebalk actie fout:', err);
          if (typeof window.showToast === 'function') window.showToast('Er ging iets mis: ' + (err.message || err), 'error');
        }
        return;
      }

      if (!document.getElementById('rotationCourt')) return;

      /* Spelerselectie: tik op veldcel in rotation court (niet in wissel-overlay) */
      var courtCell = ev.target.closest('#rotationCourt .court-cell');
      if (courtCell) {
        var p = courtCell.dataset.player || null;
        if (!p) {
          var nameEl = courtCell.querySelector('.tile-name, .zone-player');
          if (nameEl && nameEl.textContent && nameEl.textContent.trim() !== '–') p = nameEl.textContent.trim();
        }
        matchState.selectedPlayer = p || null;
        document.querySelectorAll('#rotationCourt .court-cell').forEach(function (x) { x.classList.remove('selected'); });
        if (p) courtCell.classList.add('selected');
        updateButtonVisibility();
        return;
      }

      var pointBtn = ev.target.closest('#pointHome, #pointAway');
      if (pointBtn) {
        showOutcomeSub(pointBtn.id === 'pointHome');
        return;
      }
      var cancelBtn = ev.target.closest('#outcomeSubCancel');
      if (cancelBtn) {
        hideOutcomeSub();
        return;
      }

      var btn = ev.target.closest('.btn-event');
      if (!btn) return;
      if (btn.classList.contains('btn-outcome-sub')) {
        var desc = btn.getAttribute('data-desc');
        var short = btn.getAttribute('data-short') || '';
        var panel = parseInt(btn.getAttribute('data-panel'), 10) || 4;
        if (pendingPointToHome === null) return;
        var teamKey;
        if (panel === 2 || panel === 3) {
          teamKey = pendingPointToHome ? 'home' : 'away';
        } else {
          teamKey = pendingPointToHome ? 'away' : 'home';
        }
        if (panel === 2 && (desc === 'Smash' || desc === 'Tip') && teamKey === 'home') {
          var attacker = getAttackerFromLastSetup() || matchState.selectedPlayer || '';
          if (!attacker) {
            await showAlert('Selecteer eerst de aanvaller: tik op de speler in het veld die de ' + desc + ' maakte.');
            return;
          }
        }
        if (panel === 3 && desc === 'Block' && teamKey === 'home') {
          if (!matchState.selectedPlayer) {
            await showAlert('Selecteer eerst de blokkeerder: tik op de speler in het veld die het block maakte.');
            return;
          }
        }
        addEvent(desc, short, panel, teamKey);
        givePoint(pendingPointToHome);
        hideOutcomeSub();
        return;
      }
      var desc = btn.getAttribute('data-desc');
      var short = btn.getAttribute('data-short') || '';
      var panel = parseInt(btn.getAttribute('data-panel'), 10);
      var buttonTeam = btn.getAttribute('data-team');
      if (panel === 1 && PASS_ZONE_DESCS.indexOf(desc) !== -1 && desc !== 'Overpass' && isServicePass() && !matchState.selectedPlayer) {
        await showAlert('Selecteer eerst de passer: tik op de speler in het veld die de service ontvangt.');
        return;
      }
      var team = teamForEvent(panel, buttonTeam);
      if (team) addEvent(desc, short, panel, team);
      else addEvent(desc, short, panel, matchState.servingTeam === 'home' ? 'home' : 'away');
      if (btn.classList.contains('btn-attack-score')) {
        givePoint(true);
      }
    }, true);
  }

  /** Herbruikbaar: koppelt event listeners aan scout-match knoppen. Wordt na elke render aangeroepen door scout-match.js. */
  function attachMatchBindings() {
    var pointHome = document.getElementById('pointHome');
    var pointAway = document.getElementById('pointAway');
    var outcomeSubCancel = document.getElementById('outcomeSubCancel');
    if (pointHome) pointHome.addEventListener('click', function () { showOutcomeSub(true); });
    if (pointAway) pointAway.addEventListener('click', function () { showOutcomeSub(false); });
    if (outcomeSubCancel) outcomeSubCancel.addEventListener('click', hideOutcomeSub);

    var undoBtn = document.getElementById('rallyUndo');
    if (undoBtn) undoBtn.addEventListener('click', undoRallyEvent);

  /**
   * Bewerk score/sets handmatig. Verwijdert rallies bij lagere scores.
   * @param {string} field - 'scoreA'|'scoreB'|'setA'|'setB'
   * @param {string} label - weergavenaam voor prompt
   */
  async function applyScoreEdit(field, label) {
    if (matchState.currentRally.length > 0) return;
    var cur = field === 'scoreA' ? matchState.homeScore : field === 'scoreB' ? matchState.awayScore : field === 'setA' ? matchState.homeSets : matchState.awaySets;
    var raw = await showPrompt('Nieuw aantal voor ' + label + ':', String(cur));
    if (raw === null || raw === undefined) return;
    var val = parseInt(raw, 10);
    if (isNaN(val) || val < 0) return;
    var set = currentSet();
    var rallies = set.rallies || [];
    if (field === 'scoreA' || field === 'scoreB') {
      var newHome = field === 'scoreA' ? val : matchState.homeScore;
      var newAway = field === 'scoreB' ? val : matchState.awayScore;
      if (newHome < matchState.homeScore || newAway < matchState.awayScore) {
        while (rallies.length > 0 && (rallies[rallies.length - 1].HomeScore > newHome || rallies[rallies.length - 1].AwayScore > newAway)) {
          rallies.pop();
          if (rallies.length > 0) {
            var p = rallies[rallies.length - 1];
            matchState.homeScore = p.HomeScore;
            matchState.awayScore = p.AwayScore;
            matchState.rotation = p.Rotation || 1;
            var p2 = rallies.length >= 2 ? rallies[rallies.length - 2] : null;
            matchState.servingTeam = p.HomeScore > (p2 ? p2.HomeScore : 0) ? 'home' : (p.AwayScore > (p2 ? p2.AwayScore : 0) ? 'away' : null);
          } else {
            matchState.homeScore = 0;
            matchState.awayScore = 0;
            matchState.rotation = 1;
            matchState.servingTeam = null;
          }
        }
      }
      matchState.homeScore = newHome;
      matchState.awayScore = newAway;
      if (rallies.length > 0) {
        rallies[rallies.length - 1].HomeScore = newHome;
        rallies[rallies.length - 1].AwayScore = newAway;
      } else if (newHome > 0 || newAway > 0) {
        set.rallies = [{
          RallyNumber: 0,
          HomeScore: newHome,
          AwayScore: newAway,
          Rotation: matchState.rotation,
          events: []
        }];
      }
    } else {
      if (field === 'setA') matchState.homeSets = val;
      else matchState.awaySets = val;
    }
    renderScoreboard();
    renderRotation();
    renderCurrentRally();
    updateButtonVisibility();
    saveMatch();
  }

  ['scoreA', 'scoreB', 'setA', 'setB'].forEach(function (id) {
    var el = document.getElementById(id);
    if (!el) return;
    var label = id === 'scoreA' ? 'punten thuis' : id === 'scoreB' ? 'punten uit' : id === 'setA' ? 'sets thuis' : 'sets uit';
    el.addEventListener('click', function () { applyScoreEdit(id, label); });
    el.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); applyScoreEdit(id, label); } });
  });

    var rotPrev = document.getElementById('rotationPrev');
    var rotNext = document.getElementById('rotationNext');
    if (rotPrev) rotPrev.addEventListener('click', function () {
      matchState.rotation = matchState.rotation === 1 ? 6 : matchState.rotation - 1;
      renderScoreboard();
      renderRotation();
    });
    if (rotNext) rotNext.addEventListener('click', function () {
      matchState.rotation = (matchState.rotation % 6) + 1;
      renderScoreboard();
      renderRotation();
    });

    var btnWissels = document.getElementById('btnWissels');
    if (btnWissels) btnWissels.addEventListener('click', goToWissels);
    var btnTimeout = document.getElementById('btnTimeout');
    if (btnTimeout) btnTimeout.addEventListener('click', requestTimeoutAdvice);
    var btnOpties = document.getElementById('btnOpties');
    if (btnOpties) btnOpties.addEventListener('click', openOptions);
    var btnEind = document.getElementById('btnEind');
    if (btnEind) btnEind.addEventListener('click', endMatch);
    var btnDelen = document.getElementById('btnDelen');
    if (btnDelen) btnDelen.addEventListener('click', shareMatch);

    var optionsClose = document.getElementById('optionsClose');
    if (optionsClose) optionsClose.addEventListener('click', function () { applySystemFromOptions(); closeOptions(); });
    var optionsBackdrop = document.getElementById('optionsBackdrop');
    if (optionsBackdrop) optionsBackdrop.addEventListener('click', function () { applySystemFromOptions(); closeOptions(); });
    var wisselClose = document.getElementById('wisselClose');
    if (wisselClose) wisselClose.addEventListener('click', function () { applyWisselOverlayAndClose(); });
    var wisselBackdrop = document.getElementById('wisselBackdrop');
    if (wisselBackdrop) wisselBackdrop.addEventListener('click', function () { applyWisselOverlayAndClose(); });
    var wisselBackToMatch = document.getElementById('wisselBackToMatch');
    if (wisselBackToMatch) wisselBackToMatch.addEventListener('click', function () { applyWisselOverlayAndClose(); });
    var timeoutClose = document.getElementById('timeoutClose');
    if (timeoutClose) timeoutClose.addEventListener('click', closeTimeoutOverlay);
    var timeoutBackdrop = document.getElementById('timeoutBackdrop');
    if (timeoutBackdrop) timeoutBackdrop.addEventListener('click', closeTimeoutOverlay);

    document.querySelectorAll('input[name="matchSystem"]').forEach(function (radio) {
      radio.addEventListener('change', applySystemFromOptions);
    });
    var libCheck = document.getElementById('optLiberoUse');
    if (libCheck) libCheck.addEventListener('change', function () {
      var subOpts = document.getElementById('liberoSubOptions');
      if (subOpts) subOpts.classList.toggle('hidden', !libCheck.checked);
      applyLiberoFromOptions();
    });
    document.querySelectorAll('input[name="liberoSubFor"]').forEach(function (r) {
      r.addEventListener('change', applyLiberoFromOptions);
    });
  }
  window.scoutMatchInitBindings = attachMatchBindings;

  function initFromApi(data, matchId) {
    if (!data) return false;
    matchState.matchId = matchId || '';
    if (!data.teamA) return false;
    matchState.matchDate = data.matchDate || new Date().toISOString().slice(0, 10);
    matchState.teamA = data.teamA;
    matchState.teamB = data.teamB || 'Uit';
    matchState.teamAPlayers = data.teamAPlayers || [];
    matchState.sets = data.sets || [];
    matchState.setterConfig = data.setterConfig || { type: 'geen' };
    matchState.liberoConfig = data.liberoConfig || { use: false, substituteFor: 'mid' };
    if (matchState.sets.length) {
      var last = matchState.sets[matchState.sets.length - 1];
      matchState.currentSetIndex = matchState.sets.length - 1;
      matchState.homeSets = last.HomeSets || 0;
      matchState.awaySets = last.AwaySets || 0;
      var r = last.rallies;
      matchState.homeScore = r && r.length ? r[r.length - 1].HomeScore : 0;
      matchState.awayScore = r && r.length ? r[r.length - 1].AwayScore : 0;
      matchState.rotation = r && r.length ? r[r.length - 1].Rotation : 1;
      matchState.positions = {};
      for (var i = 1; i <= 6; i++) matchState.positions['Position' + i] = last['Position' + i] || '';
      /* Bepaal servingTeam: wie het laatst punt maakte heeft de service voor de volgende rally. */
      if (r && r.length >= 2) {
        var prev = r[r.length - 2];
        var curr = r[r.length - 1];
        matchState.servingTeam = curr.HomeScore > prev.HomeScore ? 'home' : (curr.AwayScore > prev.AwayScore ? 'away' : null);
      } else if (r && r.length === 1) {
        var curr = r[0];
        matchState.servingTeam = curr.HomeScore > 0 ? 'home' : (curr.AwayScore > 0 ? 'away' : null);
      } else {
        matchState.servingTeam = null;
      }
    } else {
      matchState.servingTeam = null;
    }
    matchState.currentRally = [];
    matchState.selectedPlayer = null;
    matchState.completed = data.completed === true;
    matchState.timeoutAdvice = data.timeoutAdvice || null;
    matchState.lastTimeoutAdvice = data.lastTimeoutAdvice || null;
    matchState.timeoutAdviceLoading = false;
    startNewSetIfNeeded();
    return true;
  }

  function doInit() {
    const savedState = (function () {
      try {
        var s = sessionStorage.getItem('scoutMatchState');
        return s ? JSON.parse(s) : null;
      } catch (_) { return null; }
    })();
    if (savedState && savedState.teamA && savedState.sets && savedState.sets.length) {
      matchState = savedState;
      matchState.timeoutAdviceLoading = false;
      if (matchState._fromSetLineup) {
        matchState.pendingSubstitutions = [];
        delete matchState._fromSetLineup;
      }
      if (matchState.matchId) {
        try { localStorage.setItem('scoutCurrentMatchId', matchState.matchId); } catch (_) {}
      }
      try { sessionStorage.removeItem('scoutMatchState'); } catch (_) {}
      return true;
    }
    var setup = getSetup();
    if (setup.teamA) {
      initFromSetup();
      return true;
    }
    return false;
  }

  var btnWissels = document.getElementById('btnWissels');
  if (btnWissels) btnWissels.addEventListener('click', goToWissels);

  var TIMEOUT_API_URL = (typeof window.SCOUT_API_BASE === 'string' ? window.SCOUT_API_BASE.replace(/\/?$/, '/') : '') + 'api.php?action=timeoutAdvice';

  var authLoadPromise = null;
  function whenAuthReady(cb) {
    if (!window.scoutAuth || typeof window.scoutAuth.load !== 'function') {
      if (typeof cb === 'function') cb();
      return;
    }
    if (!authLoadPromise) authLoadPromise = window.scoutAuth.load().catch(function () {});
    authLoadPromise.then(function () { if (typeof cb === 'function') cb(); });
  }

  function redirectToLoginIfActiveMatchBlocked() {
    var auth = window.scoutAuth && window.scoutAuth.getState ? window.scoutAuth.getState() : {};
    if (!auth.enabled || auth.loggedIn) return false;
    if (matchState.completed === true) return false;
    var redir = 'auth/login.php?redirect=' + encodeURIComponent('match.php');
    window.location.href = redir;
    return true;
  }

  function renderTimeoutButton() {
    var btn = document.getElementById('btnTimeout');
    if (!btn) return;
    var auth = window.scoutAuth && window.scoutAuth.getState ? window.scoutAuth.getState() : {};
    if (auth.enabled && !auth.loggedIn) {
      btn.classList.add('hidden');
      return;
    }
    btn.classList.remove('hidden');
    btn.classList.remove('action-bar-btn--loading', 'action-bar-btn--ready');
    if (matchState.timeoutAdviceLoading) {
      btn.classList.add('action-bar-btn--loading');
      btn.disabled = true;
    } else {
      btn.disabled = false;
      if (matchState.timeoutAdvice) {
        btn.classList.add('action-bar-btn--ready');
      }
    }
  }

  function openTimeoutOverlay(withContent) {
    var overlay = document.getElementById('timeoutOverlay');
    var loadingEl = document.getElementById('timeoutLoading');
    var contentEl = document.getElementById('timeoutContent');
    var errorEl = document.getElementById('timeoutError');
    var bodyEl = document.getElementById('timeoutAdviceBody');
    if (!overlay || !loadingEl || !contentEl || !errorEl || !bodyEl) return;
    loadingEl.classList.add('hidden');
    errorEl.classList.add('hidden');
    errorEl.textContent = '';
    if (withContent) {
      contentEl.classList.remove('hidden');
      showTimeoutTips(matchState.timeoutAdvice);
    } else {
      contentEl.classList.add('hidden');
      bodyEl.innerHTML = '';
    }
    overlay.classList.remove('hidden');
    overlay.setAttribute('aria-hidden', 'false');
  }

  function closeTimeoutOverlay() {
    var overlay = document.getElementById('timeoutOverlay');
    if (overlay) {
      overlay.classList.add('hidden');
      overlay.setAttribute('aria-hidden', 'true');
    }
    matchState.timeoutAdvice = null;
    matchState.timeoutAdviceLoading = false;
    renderTimeoutButton();
    saveMatch(true);
  }

  function showTimeoutError(msg) {
    var overlay = document.getElementById('timeoutOverlay');
    var loadingEl = document.getElementById('timeoutLoading');
    var contentEl = document.getElementById('timeoutContent');
    var errorEl = document.getElementById('timeoutError');
    if (loadingEl) loadingEl.classList.add('hidden');
    if (contentEl) contentEl.classList.add('hidden');
    if (errorEl) {
      errorEl.classList.remove('hidden');
      errorEl.textContent = msg || 'Er is iets misgegaan. Probeer het later opnieuw.';
      errorEl.setAttribute('title', msg || '');
    }
    if (overlay) {
      overlay.classList.remove('hidden');
      overlay.setAttribute('aria-hidden', 'false');
    }
  }

  function escapeHtml(s) {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function formatMarkdownBasic(text) {
    var escaped = escapeHtml(text);
    return escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
  }

  function showTimeoutTips(data) {
    var loadingEl = document.getElementById('timeoutLoading');
    var contentEl = document.getElementById('timeoutContent');
    var bodyEl = document.getElementById('timeoutAdviceBody');
    var errEl = document.getElementById('timeoutError');
    if (loadingEl) loadingEl.classList.add('hidden');
    if (errEl) errEl.classList.add('hidden');
    if (contentEl) contentEl.classList.remove('hidden');
    if (!bodyEl) return;
    var output = data && typeof data.output === 'string' ? data.output.trim() : '';
    if (output) {
      bodyEl.innerHTML = '<div class="timeout-output">' + formatMarkdownBasic(output) + '</div>';
      return;
    }
    var arr = Array.isArray(data) ? data : (data && (data.tips || data.advice || data.recommendations)) ? (data.tips || data.advice || data.recommendations) : [];
    if (arr.length === 0) arr = ['Geen specifieke tips beschikbaar op basis van de huidige data.'];
    bodyEl.innerHTML = '<ol class="timeout-tips">' + arr.map(function (t) {
      var text = typeof t === 'string' ? t : (t && (t.text || t.tip || t.advice)) ? (t.text || t.tip || t.advice) : String(t);
      return '<li>' + escapeHtml(text) + '</li>';
    }).join('') + '</ol>';
  }

  async function requestTimeoutAdvice() {
    if (typeof window.scoutReportAggregate !== 'function' || typeof window.scoutBuildRefinedExport !== 'function') {
      showTimeoutError('Aggregatiefunctie niet geladen. Vernieuw de pagina.');
      return;
    }
    if (matchState.timeoutAdviceLoading) return;
    if (matchState.timeoutAdvice) {
      openTimeoutOverlay(true);
      return;
    }
    matchState.timeoutAdviceLoading = true;
    renderTimeoutButton();
    var data = {
      teamA: matchState.teamA || 'Thuis',
      teamB: matchState.teamB || 'Uit',
      sets: matchState.sets || [],
      teamAPlayers: matchState.teamAPlayers || [],
      setterConfig: matchState.setterConfig || { type: 'geen' },
      matchDate: matchState.matchDate || null,
      lastTimeoutAdvice: matchState.lastTimeoutAdvice || null,
      currentSetIndex: matchState.currentSetIndex ?? 0
    };
    var stats = window.scoutReportAggregate(data);
    var refined = window.scoutBuildRefinedExport(data, stats);
    try {
      var res = await fetch(TIMEOUT_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(refined)
      });
      var json = await res.json().catch(function () { return null; });
      matchState.timeoutAdviceLoading = false;
      if (!res.ok) {
        var errMsg = (json && json.error) ? json.error : ('HTTP ' + res.status + ' ' + res.statusText);
        if (json && json.webhookUrl) {
          errMsg += '\n\n🔧 Aangeroepen webhook (' + (json.webhookEnv || '?') + '):\n' + json.webhookUrl;
        }
        if (json && json.detail) errMsg += '\n\nTechnisch: ' + json.detail;
        if (json && json.hint) errMsg += '\n\n' + json.hint;
        renderTimeoutButton();
        showTimeoutError(errMsg);
        return;
      }
      matchState.timeoutAdvice = json;
      matchState.lastTimeoutAdvice = json;
      saveMatch(true);
      renderTimeoutButton();
    } catch (err) {
      matchState.timeoutAdviceLoading = false;
      renderTimeoutButton();
      var msg = err && err.message ? err.message : String(err);
      if (msg.indexOf('Failed to fetch') !== -1 || msg.indexOf('NetworkError') !== -1) {
        msg = 'Kon geen verbinding maken met de server. Controleer je netwerk en of de app bereikbaar is.';
      }
      showTimeoutError(msg);
    }
  }

  var btnTimeout = document.getElementById('btnTimeout');
  if (btnTimeout) btnTimeout.addEventListener('click', requestTimeoutAdvice);

  function openOptions() {
    var overlay = document.getElementById('optionsOverlay');
    if (overlay) {
      overlay.classList.remove('hidden');
      overlay.setAttribute('aria-hidden', 'false');
      var reportLink = document.getElementById('matchReportLink');
      if (reportLink && matchState.matchId) {
        reportLink.href = 'matchreport.php?matchId=' + encodeURIComponent(matchState.matchId);
        reportLink.style.display = '';
      } else if (reportLink) {
        reportLink.style.display = 'none';
      }
      var cfg = matchState.setterConfig || { type: 'geen' };
      var type = (cfg.type === '5-1' || cfg.type === '4-2') ? cfg.type : 'geen';
      var radio = document.querySelector('input[name="matchSystem"][value="' + type + '"]');
      if (radio) radio.checked = true;
      var libCfg = matchState.liberoConfig || { use: false, substituteFor: 'mid' };
      var libCheck = document.getElementById('optLiberoUse');
      if (libCheck) libCheck.checked = !!libCfg.use;
      var libSub = document.querySelector('input[name="liberoSubFor"][value="' + (libCfg.substituteFor || 'mid') + '"]');
      if (libSub) libSub.checked = true;
      var subOpts = document.getElementById('liberoSubOptions');
      if (subOpts) subOpts.classList.toggle('hidden', !libCfg.use);
    }
  }

  function closeOptions() {
    var overlay = document.getElementById('optionsOverlay');
    if (overlay) {
      overlay.classList.add('hidden');
      overlay.setAttribute('aria-hidden', 'true');
    }
  }

  function applySystemFromOptions() {
    var checked = document.querySelector('input[name="matchSystem"]:checked');
    if (checked) {
      var val = checked.value;
      if (val === '5-1') {
        matchState.setterConfig = { type: '5-1', setterPosition: matchState.setterConfig && matchState.setterConfig.type === '5-1' ? matchState.setterConfig.setterPosition : 1 };
      } else if (val === '4-2') {
        var prev = matchState.setterConfig && matchState.setterConfig.type === '4-2' ? matchState.setterConfig.setterPositions : [2, 5];
        matchState.setterConfig = { type: '4-2', setterPositions: prev };
      } else {
        matchState.setterConfig = { type: 'geen' };
      }
    }
    var libCheck = document.getElementById('optLiberoUse');
    var use = libCheck ? libCheck.checked : false;
    var libSub = document.querySelector('input[name="liberoSubFor"]:checked');
    var subFor = (libSub && libSub.value === 'pl') ? 'pl' : 'mid';
    matchState.liberoConfig = { use: !!use, substituteFor: subFor };
    var subOpts = document.getElementById('liberoSubOptions');
    if (subOpts) subOpts.classList.toggle('hidden', !use);
    renderRotation();
    updateButtonVisibility();
    saveMatch();
  }

  var btnOpties = document.getElementById('btnOpties');
  if (btnOpties) btnOpties.addEventListener('click', openOptions);

  async function endMatch() {
    if (!(await showConfirm('Wedstrijd beëindigen en terug naar het startscherm?'))) return;
    matchState.completed = true;
    saveMatch(true, async function () {
      // Mark session as definitively completed on the server
      try {
        await fetch('/api/scout/match/' + encodeURIComponent(matchState.matchId) + '/complete', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + (window._scoutToken || '') },
        });
      } catch (_) {}
      if (typeof window._scoutCleanupLock === 'function') window._scoutCleanupLock();
      try {
        sessionStorage.removeItem('scoutMatchState');
        sessionStorage.removeItem('scoutSetup');
        localStorage.removeItem('scoutCurrentMatchId');
      } catch (_) {}
      if (window.navigate) window.navigate('matches'); else window.location.href = '/';
    });
  }

  function shareMatch() {
    if (!matchState.matchId) {
      showAlert('Geen wedstrijd om te delen.');
      return;
    }
    var base = window.location.origin + window.location.pathname.replace(/match\.php$/, '');
    var url = base + (base.endsWith('/') ? '' : '/') + 'matchreport.php?matchId=' + encodeURIComponent(matchState.matchId);
    var title = (matchState.teamA || 'Thuis') + ' vs ' + (matchState.teamB || 'Uit');
    var text = 'Bekijk het matchrapport: ' + title;
    var shareData = { title: title, text: text, url: url };

    function fallbackCopy() {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function () {
          showAlert('Link gekopieerd. Plak in WhatsApp, e-mail of een andere app.');
        }).catch(function () {
          showAlert('Kopieer de link handmatig:\n\n' + url);
        });
      } else {
        showAlert('Kopieer de link handmatig:\n\n' + url);
      }
    }

    if (navigator.share) {
      navigator.share(shareData)
        .then(function () { /* gedeeld */ })
        .catch(function (err) {
          if (err.name === 'AbortError') return;
          fallbackCopy();
        });
    } else {
      fallbackCopy();
    }
  }

  var btnEind = document.getElementById('btnEind');
  if (btnEind) btnEind.addEventListener('click', endMatch);
  var btnDelen = document.getElementById('btnDelen');
  if (btnDelen) btnDelen.addEventListener('click', shareMatch);

  var optionsClose = document.getElementById('optionsClose');
  if (optionsClose) optionsClose.addEventListener('click', function () { applySystemFromOptions(); closeOptions(); });

  var optionsBackdrop = document.getElementById('optionsBackdrop');
  if (optionsBackdrop) optionsBackdrop.addEventListener('click', function () { applySystemFromOptions(); closeOptions(); });

  var wisselClose = document.getElementById('wisselClose');
  if (wisselClose) wisselClose.addEventListener('click', function () { applyWisselOverlayAndClose(); });
  var wisselBackdrop = document.getElementById('wisselBackdrop');
  if (wisselBackdrop) wisselBackdrop.addEventListener('click', function () { applyWisselOverlayAndClose(); });
  var wisselBackToMatch = document.getElementById('wisselBackToMatch');
  if (wisselBackToMatch) wisselBackToMatch.addEventListener('click', function () { applyWisselOverlayAndClose(); });

  var timeoutClose = document.getElementById('timeoutClose');
  if (timeoutClose) timeoutClose.addEventListener('click', closeTimeoutOverlay);
  var timeoutBackdrop = document.getElementById('timeoutBackdrop');
  if (timeoutBackdrop) timeoutBackdrop.addEventListener('click', closeTimeoutOverlay);

  document.querySelectorAll('input[name="matchSystem"]').forEach(function (radio) {
    radio.addEventListener('change', applySystemFromOptions);
  });

  var libCheck = document.getElementById('optLiberoUse');
  if (libCheck) libCheck.addEventListener('change', function () {
    var subOpts = document.getElementById('liberoSubOptions');
    if (subOpts) subOpts.classList.toggle('hidden', !libCheck.checked);
    applyLiberoFromOptions();
  });
  document.querySelectorAll('input[name="liberoSubFor"]').forEach(function (r) {
    r.addEventListener('change', applyLiberoFromOptions);
  });

  function applyLiberoFromOptions() {
    var libCheck = document.getElementById('optLiberoUse');
    var use = libCheck ? libCheck.checked : false;
    var libSub = document.querySelector('input[name="liberoSubFor"]:checked');
    var subFor = (libSub && libSub.value === 'pl') ? 'pl' : 'mid';
    matchState.liberoConfig = { use: !!use, substituteFor: subFor };
    renderRotation();
    updateButtonVisibility();
    saveMatch();
  }

  if (doInit()) {
    whenAuthReady(function () {
      if (redirectToLoginIfActiveMatchBlocked()) return;
      renderScoreboard();
      renderRotation();
      renderCurrentRally();
      updateButtonVisibility();
      if (typeof renderTimeoutButton === 'function') renderTimeoutButton();
    });
  } else {
    var matchId = null;
    try { matchId = localStorage.getItem('scoutCurrentMatchId'); } catch (_) {}
    if (!matchId) {
      if (window.navigate) window.navigate('scout-setup'); else window.location.href = '/';
      return;
    }
    function tryLoadMatch() {
      fetch('/api/scout/match/' + encodeURIComponent(matchId), {
        headers: { 'Authorization': 'Bearer ' + (window._scoutToken || '') }
      })
        .then(function (r) {
          if (!r.ok) throw new Error('Load failed');
          return r.json();
        })
        .then(function (data) {
          var errEl = document.getElementById('matchLoadError');
          var main = document.querySelector('.main.match-main');
          if (errEl) errEl.classList.add('hidden');
          if (main) main.querySelectorAll('section').forEach(function (s) { s.style.display = ''; });
          if (initFromApi(data, matchId)) {
            whenAuthReady(function () {
              if (redirectToLoginIfActiveMatchBlocked()) return;
              renderScoreboard();
              renderRotation();
              renderCurrentRally();
              updateButtonVisibility();
              if (typeof renderTimeoutButton === 'function') renderTimeoutButton();
            });
          } else {
            if (window.navigate) window.navigate('scout-setup'); else window.location.href = '/';
          }
        })
        .catch(function () {
          var errEl = document.getElementById('matchLoadError');
          var main = document.querySelector('.main.match-main');
          if (errEl) {
            errEl.classList.remove('hidden');
            errEl.innerHTML = '<p>Kon wedstrijd niet laden.</p><button type="button" class="btn btn-primary" id="retryLoadBtn">Opnieuw proberen</button>';
            var btn = document.getElementById('retryLoadBtn');
            if (btn) btn.addEventListener('click', tryLoadMatch);
            if (main) main.querySelectorAll('section').forEach(function (s) { s.style.display = 'none'; });
          }
        });
    }
    tryLoadMatch();
  }

  // Swipe links → naar matchrapport
  if (window.scoutUtils && window.scoutUtils.addSwipeListener) {
    window.scoutUtils.addSwipeListener(document.body, {
      left: function () {
        if (matchState.matchId) {
          window.location.href = '/api/scout/match/' + encodeURIComponent(matchState.matchId); // unused, navigatie via app router
        }
      },
      minDistance: 80
    });
  }
})();
