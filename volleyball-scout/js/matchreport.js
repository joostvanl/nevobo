/**
 * matchreport.js - Analytics en rapportage van gescoutte wedstrijden
 * Laadt JSON via api.php, aggregeert statistieken, rendert Chart.js-grafieken.
 */
(function () {
  const API = 'api.php';

  function getMatchId() {
    const m = /matchId=([a-zA-Z0-9_]+)/.exec(window.location.search);
    return m ? m[1] : null;
  }

  function getUrlParam(name) {
    var m = new RegExp('[?&]' + name + '=([^&]*)').exec(window.location.search);
    return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : null;
  }

  function loadMatch() {
    const matchId = getMatchId();
    if (!matchId) {
      showError('Geen matchId in de URL. Gebruik: matchreport.php?matchId=xxx');
      return Promise.resolve(null);
    }
    var apiUrl = API;
    if (typeof window.SCOUT_API_BASE === 'string' && window.SCOUT_API_BASE.length > 0) {
      apiUrl = window.SCOUT_API_BASE.replace(/\/?$/, '/') + 'api.php';
    }
    return fetch(apiUrl + '?action=load&matchId=' + encodeURIComponent(matchId))
      .then(function (r) {
        return r.json().then(function (data) {
          if (!r.ok) {
            var msg = (data && data.error) ? data.error : ('HTTP ' + r.status + ' ' + r.statusText);
            throw new Error(msg);
          }
          return data;
        }).catch(function (parseErr) {
          if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + r.statusText);
          throw parseErr;
        });
      });
  }

  var escapeHtml = (window.scoutUtils && window.scoutUtils.escapeHtml) || function (s) {
    if (!s) return '';
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  };

  function showError(msg) {
    const el = document.getElementById('reportContent');
    if (el) el.innerHTML = '<p style="color: var(--danger);">' + escapeHtml(msg) + '</p>';
  }

  function showErrorWithRetry(msg) {
    var el = document.getElementById('reportContent');
    if (!el) return;
    el.innerHTML = '<p style="color: var(--danger);">' + escapeHtml(msg) + '</p><button type="button" class="btn btn-primary" id="retryReportBtn" style="margin-top:1rem;">Opnieuw proberen</button>';
    document.getElementById('retryReportBtn').addEventListener('click', function () {
      el.innerHTML = '<p id="reportLoading">Rapport laden…</p>';
      loadMatch().then(processData).catch(function () { showErrorWithRetry(msg); });
    });
  }

  // --- Aggregation ---
  const PASS_ZONES = ['Zone I', 'Zone II', 'Zone III', 'Overpass'];
  const SETUP_TYPES = ['5', '1', 'C', '10', 'Pipe', '30'];
  const ATTACK_TYPES = ['Smash', 'Tip'];
  const OUTCOME_ACTIVE = ['Ace']; // we score by service
  const OUTCOME_PASSIVE = ['Out', 'Drop']; // opponent error
  const OUTCOME_BLOCK = ['Block'];

  function isOurTeam(ev, teamA) {
    return ev.team === teamA;
  }

  function isPassZone(desc) {
    return PASS_ZONES.includes(desc);
  }

  function isSetupType(desc) {
    return SETUP_TYPES.includes(desc);
  }

  function isAttack(desc) {
    return ATTACK_TYPES.includes(desc);
  }

  /** Spelverdeler bepalen uit posities, rotatie en setterConfig. Spelverdeler = speler op setterPosition (5-1). */
  function getSetterFromPositions(positions, rotation, setterConfig) {
    if (!positions || !setterConfig) return null;
    var cfg = setterConfig;
    if (cfg.type === '5-1' && cfg.setterPosition) {
      var sp = Number(cfg.setterPosition) || 1;
      return positions['Position' + sp] || positions[sp] || null;
    }
    if (cfg.type === '4-2' && cfg.setterPositions && cfg.setterPositions.length >= 2) {
      var s1 = cfg.setterPositions[0];
      var s2 = cfg.setterPositions[1];
      var idx = (rotation - 1) % 2;
      var pos = idx === 0 ? s1 : s2;
      return positions['Position' + pos] || positions[pos] || null;
    }
    return null;
  }

  /** Verzamel sub-paren (playerOut, playerIn) uit rally-events, in volgorde. */
  function collectSubsFromRallies(rallies) {
    var subs = [];
    rallies.forEach(function (rally) {
      var evs = rally.events || [];
      var i = 0;
      while (i < evs.length) {
        var e = evs[i];
        var desc = (e.description || '').trim();
        var name = (e.playerName || '').trim();
        if (desc === '<- In' && name) {
          var next = evs[i + 1];
          if (next && (next.description || '').trim() === 'Out ->' && (next.playerName || '').trim()) {
            subs.push({ playerOut: (next.playerName || '').trim(), playerIn: name });
            i += 2;
            continue;
          }
        }
        if (desc === 'Out ->' && name) {
          var prev = evs[i - 1];
          if (prev && (prev.description || '').trim() === '<- In' && (prev.playerName || '').trim()) {
            subs.push({ playerOut: name, playerIn: (prev.playerName || '').trim() });
            i++;
            continue;
          }
        }
        i++;
      }
    });
    return subs;
  }

  /** Posities naar object { 1: name1, 2: name2, ... } uit set. */
  function getPositionsFromSet(set) {
    var pos = {};
    for (var i = 1; i <= 6; i++) pos[i] = (set && set['Position' + i]) || '';
    return pos;
  }

  /** Pas wissel toe: vind positie van playerOut, vervang door playerIn. */
  function applySub(positions, playerOut, playerIn) {
    for (var k = 1; k <= 6; k++) {
      if (positions[k] === playerOut) {
        positions[k] = playerIn;
        return;
      }
    }
  }

  /**
   * Aggregeer matchdata naar statistieken voor rapportage.
   * @param {Object} data - Raw match JSON (teamA, teamB, sets, teamAPlayers)
   * @returns {Object} stats - pointsByType, playerScores, passCount, setupCount, etc.
   */
  function aggregate(data) {
    const teamA = data.teamA || '';
    const teamB = data.teamB || '';
    const sets = data.sets || [];
    const players = (data.teamAPlayers || []).map(function (p) {
      return { name: p.name || 'Speler ' + p.number, number: p.number };
    });

    const stats = {
      teamA,
      teamB,
      players,
      setScores: [],
      scoreSequence: [],
      pointsByType: { teamA: { Ace: 0, Smash: 0, Tip: 0, Block: 0, Drop: 0, Out: 0 }, teamB: { Ace: 0, Smash: 0, Tip: 0, Block: 0, Drop: 0, Out: 0 } },
      playerScores: {},
      attackOutcomes: {},
      attacksFromSetup: {},
      services: {},
      passCount: {},
      passZoneToPoints: {},
      setupCount: {},
      setupToPoints: {},
      setupsBySetter: {},
      passToSetup: {},
      pointsByRotation: {},
      servicePasses: {},
      rallyLengths: []
    };

    players.forEach(function (p) {
      stats.playerScores[p.number] = { Ace: 0, Smash: 0, Tip: 0, Block: 0 };
      stats.attackOutcomes[p.number] = { point: 0, noPoint: 0, drop: 0, out: 0, block: 0 };
      stats.attacksFromSetup[p.number] = {};
      stats.services[p.number] = { ace: 0, normal: 0, out: 0, net: 0 };
      stats.servicePasses[p.number] = { zoneI: 0, zoneII: 0, zoneIII: 0, overpass: 0 };
    });
    var nameToNumber = {};
    players.forEach(function (p) {
      if (p.name) nameToNumber[p.name] = p.number;
    });
    var setterConfig = data.setterConfig || { type: 'geen' };
    PASS_ZONES.forEach(function (z) {
      stats.passCount[z] = 0;
      stats.passZoneToPoints[z] = 0;
      stats.passToSetup[z] = {};
      SETUP_TYPES.forEach(function (s) { stats.passToSetup[z][s] = 0; });
    });
    SETUP_TYPES.forEach(function (s) { stats.setupCount[s] = 0; stats.setupToPoints[s] = 0; });
    for (let r = 1; r <= 6; r++) stats.pointsByRotation[r] = 0;

    let rallyLengths = [];
    let lastHome = 0, lastAway = 0;

    sets.forEach(function (set, setIdx) {
      const rallies = set.rallies || [];
      stats.scoreSequence[setIdx] = [];
      lastHome = 0;
      lastAway = 0;

      // Bepaal initiële posities: reverse subs om van eindtoestand terug te gaan
      var finalPositions = getPositionsFromSet(set);
      var subs = collectSubsFromRallies(rallies);
      var initialPositions = {};
      for (var pi = 1; pi <= 6; pi++) initialPositions[pi] = finalPositions[pi];
      for (var si = subs.length - 1; si >= 0; si--) {
        applySub(initialPositions, subs[si].playerIn, subs[si].playerOut);
      }
      var currentPositions = {};
      for (var pj = 1; pj <= 6; pj++) currentPositions[pj] = initialPositions[pj];

      rallies.forEach(function (rally, idx) {
        const evs = rally.events || [];
        const homeScore = rally.HomeScore;
        const awayScore = rally.AwayScore;
        const rotation = rally.Rotation || 1;

        // Wissels aan het begin van de rally: update currentPositions
        for (var ei = 0; ei < evs.length; ei++) {
          var ev = evs[ei];
          var d = (ev.description || '').trim();
          var n = (ev.playerName || '').trim();
          if (d === '<- In' && n) {
            var nxt = evs[ei + 1];
            if (nxt && (nxt.description || '').trim() === 'Out ->' && (nxt.playerName || '').trim()) {
              applySub(currentPositions, (nxt.playerName || '').trim(), n);
              ei++;
            }
          } else if (d === 'Out ->' && n) {
            var prv = evs[ei - 1];
            if (prv && (prv.description || '').trim() === '<- In' && (prv.playerName || '').trim()) {
              applySub(currentPositions, n, (prv.playerName || '').trim());
            }
          }
        }

        // Rally length
        rallyLengths.push(evs.length);

        // Who won this rally?
        const weWon = homeScore > lastHome;
        const theyWon = awayScore > lastAway;

        // Spelverdeler voor deze rally (uit positie + rotatie)
        var setterName = getSetterFromPositions(currentPositions, rotation, setterConfig);
        var setterNum = setterName ? (nameToNumber[setterName] || 0) : 0;

        // Track sequence: service -> pass -> setup -> attack -> outcome
        let lastPass = null;
        let lastSetup = null;
        let lastSetupType = null;
        let lastSetter = null;
        let lastAttack = null;
        let lastAttacker = null;
        let server = null;
        let servingTeam = null;

        for (let i = 0; i < evs.length; i++) {
          const e = evs[i];
          const ours = isOurTeam(e, teamA);

          if (Number(e.panel) === 0) {
            server = e.player;
            servingTeam = ours ? 'home' : 'away';
          }

          if (e.panel === 1) {
            if (isPassZone(e.description)) {
              lastPass = e.description;
              if (ours) {
                stats.passCount[e.description] = (stats.passCount[e.description] || 0) + 1;
                if (e.player) {
                  const zoneKey = e.description === 'Zone I' ? 'zoneI' : e.description === 'Zone II' ? 'zoneII' : e.description === 'Zone III' ? 'zoneIII' : 'overpass';
                  stats.servicePasses[e.player] = stats.servicePasses[e.player] || { zoneI: 0, zoneII: 0, zoneIII: 0, overpass: 0 };
                  stats.servicePasses[e.player][zoneKey]++;
                }
              }
            } else if (isSetupType(e.description)) {
              lastSetup = e.description;
              lastSetupType = e.description;
              lastSetter = e.player;
              if (ours) {
                stats.setupCount[e.description] = (stats.setupCount[e.description] || 0) + 1;
                if (setterNum && isSetupType(e.description)) {
                  stats.setupsBySetter[setterNum] = stats.setupsBySetter[setterNum] || {};
                  if (!stats.setupsBySetter[setterNum][e.description]) stats.setupsBySetter[setterNum][e.description] = { point: 0, noPoint: 0 };
                  var key = weWon ? 'point' : 'noPoint';
                  stats.setupsBySetter[setterNum][e.description][key]++;
                }
                if (lastPass) {
                  stats.passToSetup[lastPass] = stats.passToSetup[lastPass] || {};
                  stats.passToSetup[lastPass][e.description] = (stats.passToSetup[lastPass][e.description] || 0) + 1;
                }
              }
            }
          }

          if (e.panel === 2 && isAttack(e.description)) {
            lastAttack = e.description;
            lastAttacker = e.player;
            if (ours && lastSetupType && e.player) {
              stats.attacksFromSetup[e.player] = stats.attacksFromSetup[e.player] || {};
              stats.attacksFromSetup[e.player][lastSetupType] = (stats.attacksFromSetup[e.player][lastSetupType] || 0) + 1;
            }
          }

        }

        // Service-uitkomst (alleen bij eigen service): Ace, Normale service, Uit, Net
        if (server && servingTeam === 'home') {
          stats.services[server] = stats.services[server] || { ace: 0, normal: 0, out: 0, net: 0 };
          var servOutcome = 'normal';
          if (evs.length >= 2) {
            var ev2 = evs[1];
            var desc2 = (ev2.description || '').trim();
            var ours2 = isOurTeam(ev2, teamA);
            if (desc2 === 'Ace' && weWon) servOutcome = 'ace';
            else if ((desc2 === 'Drop' || desc2 === 'In net') && ours2) servOutcome = 'net';
            else if (desc2 === 'Out' && ours2) servOutcome = 'out';
          }
          if (typeof stats.services[server][servOutcome] === 'number') stats.services[server][servOutcome]++;
        }

        // Outcome of rally + punten per type (Ace, Smash, Tip, Block, Drop, Out)
        var lastEv = evs.length ? evs[evs.length - 1] : null;
        var lastDesc = (lastEv && lastEv.description || '').trim();
        if (lastDesc === 'In net') lastDesc = 'Out';
        var homeActive = weWon && ((lastEv && lastEv.team === teamA && (lastDesc === 'Smash' || lastDesc === 'Tip' || lastDesc === 'Block')) || (lastDesc === 'Ace' && lastEv && lastEv.team === teamB));
        var awayActive = theyWon && ((lastEv && lastEv.team === teamB && (lastDesc === 'Smash' || lastDesc === 'Tip' || lastDesc === 'Block')) || (lastDesc === 'Ace' && lastEv && lastEv.team === teamA));

        if (weWon) {
          stats.pointsByRotation[rotation] = (stats.pointsByRotation[rotation] || 0) + 1;
          stats.scoreSequence[setIdx].push({ team: 'home', active: homeActive });
          if (lastPass && lastPass !== 'Overpass') stats.passZoneToPoints[lastPass] = (stats.passZoneToPoints[lastPass] || 0) + 1;
          if (lastSetupType) stats.setupToPoints[lastSetupType] = (stats.setupToPoints[lastSetupType] || 0) + 1;
          if (server && servingTeam === 'home') {
            stats.services[server] = stats.services[server] || { ace: 0, normal: 0, out: 0, net: 0 };
          }
          if (lastDesc === 'Ace' && server) {
            stats.playerScores[server] = stats.playerScores[server] || { Ace: 0, Smash: 0, Tip: 0, Block: 0 };
            stats.playerScores[server].Ace++;
          } else if (lastDesc === 'Smash' && lastAttacker) {
            stats.playerScores[lastAttacker] = stats.playerScores[lastAttacker] || { Ace: 0, Smash: 0, Tip: 0, Block: 0 };
            stats.playerScores[lastAttacker].Smash++;
          } else if (lastDesc === 'Tip' && lastAttacker) {
            stats.playerScores[lastAttacker] = stats.playerScores[lastAttacker] || { Ace: 0, Smash: 0, Tip: 0, Block: 0 };
            stats.playerScores[lastAttacker].Tip++;
          } else if (lastDesc === 'Block' && lastEv && lastEv.player) {
            var blocker = lastEv.team === teamA ? lastEv.player : null;
            if (blocker) {
              stats.playerScores[blocker] = stats.playerScores[blocker] || { Ace: 0, Smash: 0, Tip: 0, Block: 0 };
              stats.playerScores[blocker].Block++;
            }
          }
          var pt = stats.pointsByType.teamA;
          if (lastEv) {
            if ((lastEv.team === teamA && (lastDesc === 'Smash' || lastDesc === 'Tip' || lastDesc === 'Block')) || (lastDesc === 'Ace' && lastEv.team === teamB)) pt[lastDesc] = (pt[lastDesc] || 0) + 1;
            else if (lastEv.team === teamB && (lastDesc === 'Out' || lastDesc === 'Drop')) pt[lastDesc] = (pt[lastDesc] || 0) + 1;
          }
        }
        if (theyWon) {
          stats.scoreSequence[setIdx].push({ team: 'away', active: awayActive });
          var ptB = stats.pointsByType.teamB;
          if (lastEv) {
            if ((lastEv.team === teamB && (lastDesc === 'Smash' || lastDesc === 'Tip' || lastDesc === 'Block')) || (lastDesc === 'Ace' && lastEv.team === teamA)) ptB[lastDesc] = (ptB[lastDesc] || 0) + 1;
            else if (lastEv.team === teamA && (lastDesc === 'Out' || lastDesc === 'Drop')) ptB[lastDesc] = (ptB[lastDesc] || 0) + 1;
          }
        }

        if (theyWon && server && servingTeam === 'home') {
          stats.services[server] = stats.services[server] || { ace: 0, normal: 0, out: 0, net: 0 };
        }

        // Aanvalsuitkomsten: elke SETUP leidt tot een aanval. De app voegt Smash/Tip alleen toe bij scoren;
        // bij Block/Drop/Out is er geen aanval-event – we gebruiken het setup-event (bevat aanvaller).
        for (var i = 0; i < evs.length; i++) {
          var e = evs[i];
          if (Number(e.panel) !== 1 || !isSetupType(e.description) || !isOurTeam(e, teamA)) continue;
          var nextEv = i + 1 < evs.length ? evs[i + 1] : null;
          if (!nextEv) continue;
          var nextDesc = (nextEv.description || '').trim();
          if (nextDesc === 'In net') nextDesc = 'Out';
          if (nextDesc === 'Ace') continue;
          var nextOurs = isOurTeam(nextEv, teamA);
          var nextPanel = Number(nextEv.panel);
          var outcome = 'noPoint';
          var attackerKey = null;
          if (nextOurs && nextPanel === 2 && isAttack(nextDesc)) {
            outcome = 'point';
            attackerKey = nextEv.player != null && nextEv.player !== 0 ? Number(nextEv.player) : null;
          } else if (!nextOurs && nextPanel === 3 && nextDesc === 'Block') {
            outcome = 'block';
            attackerKey = e.player != null && e.player !== 0 ? Number(e.player) : null;
          } else if (nextDesc === 'Drop' || nextDesc === 'Out') {
            outcome = weWon ? 'point' : (nextDesc === 'Drop' ? 'drop' : 'out');
            attackerKey = e.player != null && e.player !== 0 ? Number(e.player) : null;
          } else {
            outcome = (nextPanel === 4 && (nextDesc === 'Out' || nextDesc === 'Drop') && nextOurs) ? 'point' : 'noPoint';
            attackerKey = e.player != null && e.player !== 0 ? Number(e.player) : null;
          }
          if (attackerKey == null || isNaN(attackerKey)) continue;
          if (!stats.attackOutcomes[attackerKey]) stats.attackOutcomes[attackerKey] = { point: 0, noPoint: 0, drop: 0, out: 0, block: 0 };
          var ao = stats.attackOutcomes[attackerKey];
          if (typeof ao[outcome] === 'number') ao[outcome]++;
        }

        lastHome = homeScore;
        lastAway = awayScore;
      });
      stats.setScores.push({ home: lastHome, away: lastAway });
    });

    stats.rallyLengths = rallyLengths;
    stats.scoreProgression = (data.sets || []).map(function (set) {
      var rallies = set.rallies || [];
      var arr = [{ x: 0, yHome: 0, yAway: 0 }];
      rallies.forEach(function (r, i) {
        arr.push({ x: i + 1, yHome: r.HomeScore || 0, yAway: r.AwayScore || 0 });
      });
      return arr;
    });
    return stats;
  }

  function buildRefinedExport(data, stats) {
    var teamA = data.teamA || 'Thuis';
    var teamB = data.teamB || 'Uit';
    var players = stats.players || [];
    var numToName = {};
    players.forEach(function (p) {
      if (p.number != null) numToName[p.number] = p.name || ('Speler ' + p.number);
    });

    function playerStats(obj, keys) {
      var out = [];
      Object.keys(obj || {}).forEach(function (num) {
        var p = players.find(function (x) { return String(x.number) === String(num); });
        var name = p ? p.name : numToName[num] || ('Speler ' + num);
        var row = { player: name, number: Number(num) };
        keys.forEach(function (k) { row[k] = (obj[num] && obj[num][k]) || 0; });
        out.push(row);
      });
      return out;
    }

    var totalRallies = (stats.rallyLengths || []).length;
    var totalPasses = Object.values(stats.passCount || {}).reduce(function (s, v) { return s + (v || 0); }, 0);
    var totalSetups = Object.values(stats.setupCount || {}).reduce(function (s, v) { return s + (v || 0); }, 0);
    var totalScoresA = stats.pointsByType && stats.pointsByType.teamA
      ? Object.values(stats.pointsByType.teamA).reduce(function (s, v) { return s + (v || 0); }, 0) : 0;

    return {
      _meta: {
        description: 'Geraffineerde wedstrijdstatistieken voor AI-analyse. Gebaseerd op dezelfde data als het visuele rapport.',
        format: 'Volleyball Scout Report Export',
        exportDate: new Date().toISOString().slice(0, 10),
        legend: {
          attackOutcomes: 'point=gescoord, noPoint=rally gaat door, block=afgeblokt, drop=in net, out=uitgeslagen',
          services: 'ace=direct punt, normal=in spel, out=uit, net=in net',
          servicePasses: 'zoneI/II/III=pass zone, overpass=pass over net',
          setupsBySetter: 'totPunt=rally gewonnen, geenPunt=rally verloren'
        }
      },
      match: {
        teamA: teamA,
        teamB: teamB,
        matchDate: data.matchDate || null,
        players: players.map(function (p) { return { name: p.name, number: p.number }; }),
        setScores: (stats.setScores || []).map(function (s, i) {
          return { set: i + 1, home: s.home || 0, away: s.away || 0 };
        })
      },
      pointsByType: {
        teamA: stats.pointsByType && stats.pointsByType.teamA ? stats.pointsByType.teamA : {},
        teamB: stats.pointsByType && stats.pointsByType.teamB ? stats.pointsByType.teamB : {}
      },
      playerScores: playerStats(stats.playerScores, ['Ace', 'Smash', 'Tip', 'Block']),
      attackOutcomes: playerStats(stats.attackOutcomes, ['point', 'noPoint', 'block', 'drop', 'out']),
      attacksFromSetup: (function () {
        var out = [];
        Object.keys(stats.attacksFromSetup || {}).forEach(function (num) {
          var by = stats.attacksFromSetup[num];
          if (!by || typeof by !== 'object') return;
          var p = players.find(function (x) { return String(x.number) === String(num); });
          var name = p ? p.name : numToName[num] || ('Speler ' + num);
          out.push({ player: name, number: Number(num), bySetupType: by });
        });
        return out;
      })(),
      services: playerStats(stats.services, ['ace', 'normal', 'out', 'net']),
      servicePasses: playerStats(stats.servicePasses, ['zoneI', 'zoneII', 'zoneIII', 'overpass']),
      setupsBySetter: (function () {
        var out = [];
        Object.keys(stats.setupsBySetter || {}).forEach(function (num) {
          var by = stats.setupsBySetter[num];
          if (!by || typeof by !== 'object') return;
          var p = players.find(function (x) { return String(x.number) === String(num); });
          var name = p ? p.name : numToName[num] || ('Speler ' + num);
          var setupTypes = {};
          ['5', '1', 'C', '10', 'Pipe', '30'].forEach(function (t) {
            var v = by[t];
            if (v && (v.point || v.noPoint)) {
              setupTypes[t] = { totPunt: v.point || 0, geenPunt: v.noPoint || 0 };
            }
          });
          if (Object.keys(setupTypes).length) out.push({ player: name, number: Number(num), setups: setupTypes });
        });
        return out;
      })(),
      passToSetup: stats.passToSetup || {},
      passCount: stats.passCount || {},
      passZoneToPoints: stats.passZoneToPoints || {},
      setupCount: stats.setupCount || {},
      setupToPoints: stats.setupToPoints || {},
      pointsByRotation: stats.pointsByRotation || {},
      conversion: {
        totalRallies: totalRallies,
        totalPasses: totalPasses,
        totalSetups: totalSetups,
        totalScoresTeamA: totalScoresA,
        passConversion: totalRallies > 0 ? Math.round((totalPasses / totalRallies) * 1000) / 10 : 0,
        setupConversion: totalPasses > 0 ? Math.round((totalSetups / totalPasses) * 1000) / 10 : 0,
        scoreConversion: totalSetups > 0 ? Math.round((totalScoresA / totalSetups) * 1000) / 10 : 0
      },
      scoreProgression: (stats.scoreProgression || []).map(function (points, i) {
        return {
          set: i + 1,
          rallies: points.map(function (p) { return { rally: p.x, home: p.yHome, away: p.yAway }; })
        };
      }),
      rallyLengths: {
        total: totalRallies,
        distribution: (function () {
          var hist = {};
          (stats.rallyLengths || []).forEach(function (l) {
            hist[l] = (hist[l] || 0) + 1;
          });
          return hist;
        })()
      }
    };
  }

  function renderReport(data, stats) {
    window.scoutReportExportData = { data: data, stats: stats };
    const teamA = data.teamA || 'Thuis';
    const teamB = data.teamB || 'Uit';
    const players = stats.players || [];
    const cont = document.getElementById('reportContent');
    const teamsEl = document.getElementById('reportTeams');
    const dateEl = document.getElementById('reportDate');
    if (teamsEl) teamsEl.textContent = teamA + ' – ' + teamB;
    if (dateEl && data.matchDate) {
      var d = data.matchDate;
      if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
        dateEl.textContent = d.slice(8, 10) + '-' + d.slice(5, 7) + '-' + d.slice(0, 4);
        dateEl.style.display = '';
      } else {
        dateEl.textContent = d;
        dateEl.style.display = '';
      }
    } else if (dateEl) dateEl.style.display = 'none';

    let html = '';

    // --- Set scores ---
    var setScores = stats.setScores || [];
    if (setScores.length) {
      html += '<div class="report-set-scores">';
      setScores.forEach(function (s, i) {
        html += '<span class="report-set-score">Set ' + (i + 1) + ': ' + (s.home || 0) + ' – ' + (s.away || 0) + '</span>';
      });
      html += '</div>';
    }

    // --- Punten per type ---
    html += '<section class="report-section">';
    html += '<h2>Punten per type</h2>';
    html += '<div class="report-grid report-grid-double">';
    html += '<div class="report-chart report-chart-center"><h3 class="chart-team-label">' + escapeHtml(teamA) + '</h3><canvas id="chartPointsByTypeA"></canvas></div>';
    html += '<div class="report-chart report-chart-center"><h3 class="chart-team-label">' + escapeHtml(teamB) + '</h3><canvas id="chartPointsByTypeB"></canvas></div>';
    html += '</div>';
    html += '</section>';

    // --- Speler scores ---
    html += '<section class="report-section">';
    html += '<h2>Speler scores</h2>';
    html += '<p class="hint">Punten per speler per type: Ace (service), Smash, Tip, Block.</p>';
    html += '<div class="report-chart report-chart-bar"><canvas id="chartPlayerScores"></canvas></div>';
    html += '</section>';

    // --- Aanvallen vanuit setup ---
    html += '<section class="report-section">';
    html += '<h2>Speler aanvallen vanuit setup</h2>';
    html += '<p class="hint">Elke setup leidt tot een aanval met 5 uitkomsten: punt gescoord, rally gaat door, afgeblokt, in het net (drop) of uitgeslagen (out).</p>';
    html += '<div class="report-chart report-chart-bar"><canvas id="chartAttacksFromSetup"></canvas></div>';
    html += '</section>';

    // --- Services ---
    html += '<section class="report-section">';
    html += '<h2>Speler Services</h2>';
    html += '<p class="hint">Uitkomst per service: Ace, Normale service, Uit of Net.</p>';
    html += '<div class="report-chart report-chart-bar"><canvas id="chartServices"></canvas></div>';
    html += '</section>';

    // --- Service passes ---
    html += '<section class="report-section">';
    html += '<h2>Service Passes</h2>';
    html += '<p class="hint">*Een overpass is een pass over het net.</p>';
    html += '<div class="report-chart report-chart-bar"><canvas id="chartServicePasses"></canvas></div>';
    html += '</section>';

    // --- Punten per rotatie ---
    html += '<section class="report-section">';
    html += '<h2>Punten per rotatie</h2>';
    html += '<div class="report-chart report-chart-bar"><canvas id="chartRotation"></canvas></div>';
    html += '</section>';

    // --- Score piramide / conversie ---
    html += '<section class="report-section">';
    html += '<h2>Score piramide en conversie</h2>';
    html += '<p class="hint">Het overzicht hierboven geeft de scoring piramide weer. Dit is een overzicht van alle ontvangen ballen en het deel daarvan dat wordt verwerkt tot Pass, Setup en uiteindelijk een punt. In de tabel staan de aantallen passes in de passing zones en de bijbehorende conversie (hoeveelheid direct hierna gescoorde punten). Hetzelfde geldt voor de setups (1, 5, C, 10 en Pipe).</p>';
    html += '<div class="report-chart report-chart-bar"><canvas id="chartConversion"></canvas></div>';
    html += '<table class="conversion-table"><thead><tr><th>Actie</th><th>Aantal</th><th>Conversie</th></tr></thead><tbody id="conversionBody"></tbody></table>';
    html += '</section>';

    // --- Passing en Setup verdeling ---
    html += '<section class="report-section">';
    html += '<h2>Passing en Setup verdeling</h2>';
    html += '<div class="report-grid report-grid-double">';
    html += '<div class="report-chart"><canvas id="chartPassing"></canvas></div>';
    html += '<div class="report-chart"><canvas id="chartSetup"></canvas></div>';
    html += '</div></section>';

    // --- Pass - Setup matrix ---
    html += '<section class="report-section">';
    html += '<h2>Pass - Setup matrix</h2>';
    html += '<div class="report-chart report-chart-bar"><canvas id="chartPassSetupMatrix"></canvas></div>';
    html += '</section>';

    // --- Setups per spelverdeler ---
    html += '<section class="report-section">';
    html += '<h2>Setups per spelverdeler</h2>';
    html += '<div class="report-chart report-chart-bar"><canvas id="chartSetters"></canvas></div>';
    html += '</section>';

    // --- Lengte rallies ---
    html += '<section class="report-section">';
    html += '<h2>Lengte van gespeelde rallies</h2>';
    html += '<div class="report-chart report-chart-bar"><canvas id="chartRallyLength"></canvas></div>';
    html += '</section>';

    // --- Score-progressie (lijn grafieken per set, onderaan) ---
    var scoreProg = stats.scoreProgression || [];
    if (scoreProg.length) {
      html += '<section class="report-section score-progression">';
      html += '<h2>Score-progressie</h2>';
      scoreProg.forEach(function (_, setIdx) {
        html += '<div class="report-chart report-chart-line"><h3 class="chart-title">Score Progression - Set ' + (setIdx + 1) + '</h3><canvas id="chartScoreProgression' + setIdx + '"></canvas></div>';
      });
      html += '</section>';
    }

    cont.innerHTML = html;

    // Chart.js – donker thema, mobiel-optimized
    var isMobile = window.innerWidth < 768;
    const textColor = '#e8e8ed';
    const gridColor = 'rgba(255,255,255,0.08)';
    const surfaceColor = '#1a1a2e';
    Chart.defaults.color = textColor;
    Chart.defaults.font.family = "'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, sans-serif";
    Chart.defaults.font.size = isMobile ? 16 : 14;
    Chart.defaults.plugins.legend.labels.usePointStyle = true;
    Chart.defaults.plugins.legend.labels.padding = isMobile ? 12 : 20;
    Chart.defaults.plugins.legend.labels.font = { size: isMobile ? 15 : 13 };

    const colors = {
      active: 'rgba(34, 197, 94, 0.9)',
      passive: 'rgba(148, 163, 184, 0.7)',
      accent: 'rgba(59, 130, 246, 0.85)',
      pie: [
        '#22c55e', '#3b82f6', '#f59e0b', '#a855f7', '#ef4444', '#06b6d4',
        '#84cc16', '#ec4899'
      ]
    };

    const barOpts = {
      borderRadius: 6,
      barPercentage: isMobile ? 0.6 : 0.75,
      categoryPercentage: isMobile ? 0.7 : 0.85,
      maxBarThickness: isMobile ? 36 : undefined
    };

    const scaleDefaults = {
      grid: { color: gridColor, drawBorder: false },
      ticks: { color: textColor, maxRotation: isMobile ? 45 : undefined, minRotation: isMobile ? 0 : undefined, font: { size: isMobile ? 14 : 12 } }
    };


    const pointTypeColors = {
      Ace: '#7dd3fc',
      Smash: '#86efac',
      Tip: '#fde047',
      Block: '#c4b5fd',
      Drop: '#94a3b8',
      Out: '#64748b'
    };
    const pointTypeOrder = ['Ace', 'Smash', 'Tip', 'Block', 'Drop', 'Out'];

    var doughnutCenterPlugin = {
      id: 'doughnutCenterText',
      afterDraw: function (chart) {
        var text = chart.options.plugins.doughnutCenterText;
        if (!text || chart.data.datasets.length === 0) return;
        var meta = chart.getDatasetMeta(0);
        if (!meta || meta.data.length === 0) return;
        var centerX = (chart.chartArea.left + chart.chartArea.right) / 2;
        var centerY = (chart.chartArea.top + chart.chartArea.bottom) / 2;
        var ctx = chart.ctx;
        ctx.save();
        ctx.font = 'bold 28px "Segoe UI", sans-serif';
        ctx.fillStyle = textColor;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(text), centerX, centerY);
        ctx.restore();
      }
    };
    function renderPointsByTypeChart(canvasId, teamKey, teamLabel) {
      var pt = stats.pointsByType[teamKey] || {};
      var labels = [];
      var data = [];
      var bgColors = [];
      pointTypeOrder.forEach(function (k) {
        var v = pt[k] || 0;
        if (v > 0) {
          labels.push(k);
          data.push(v);
          bgColors.push(pointTypeColors[k]);
        }
      });
      var total = data.reduce(function (s, d) { return s + d; }, 0);
      var cnv = document.getElementById(canvasId);
      if (labels.length === 0) {
        if (cnv && cnv.parentNode) { cnv.style.display = 'none'; cnv.parentNode.insertAdjacentHTML('beforeend', '<p class="chart-empty">Geen punten</p>'); }
        return;
      }
      new Chart(cnv, {
        type: 'doughnut',
        plugins: [doughnutCenterPlugin],
        data: {
          labels: labels,
          datasets: [{
            data: data,
            backgroundColor: bgColors,
            borderWidth: 2,
            borderColor: surfaceColor,
            hoverOffset: 8
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: !isMobile,
          aspectRatio: 1,
          cutout: '65%',
          layout: { padding: isMobile ? 4 : 8 },
          plugins: {
            legend: { position: 'top', labels: { boxWidth: 10, font: { size: isMobile ? 12 : 11 } } },
            doughnutCenterText: total
          }
        }
      });
    }
    renderPointsByTypeChart('chartPointsByTypeA', 'teamA', teamA);
    renderPointsByTypeChart('chartPointsByTypeB', 'teamB', teamB);

    const playerNames = players.map(function (p) { return p.name; });
    const playerNums = players.map(function (p) { return p.number; });

    // Speler scores: Ace, Smash, Tip, Block (gestapelde balken per speler)
    const scoreTypes = ['Ace', 'Smash', 'Tip', 'Block'];
    const scoreDatasets = scoreTypes.map(function (k) {
      const arr = playerNums.map(function (n) {
        return (stats.playerScores[n] && stats.playerScores[n][k]) || 0;
      });
      return { label: k, data: arr, backgroundColor: pointTypeColors[k], ...barOpts };
    });
    new Chart(document.getElementById('chartPlayerScores'), {
      type: 'bar',
      data: {
        labels: playerNames,
        datasets: scoreDatasets
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: !isMobile,
        layout: { padding: { top: 8, right: isMobile ? 8 : 16, bottom: 8, left: isMobile ? 4 : 8 } },
        scales: {
          x: { stacked: true, ...scaleDefaults },
          y: { stacked: true, ...scaleDefaults }
        },
        plugins: { legend: { position: 'top' } }
      }
    });

    // Aanvallen vanuit setup: verticale gestapelde bar – uitkomst per speler (punt, geen punt, drop, out)
    const attackOutcomeOrder = ['point', 'noPoint', 'block', 'drop', 'out'];
    const attackOutcomeLabels = { point: 'Punt gescoord', noPoint: 'Rally gaat door', block: 'Afgeblokt', drop: 'In het net (drop)', out: 'Uitgeslagen (out)' };
    const attackOutcomeColors = { point: colors.active, noPoint: colors.passive, block: '#a78bfa', drop: '#f59e0b', out: '#ef4444' };
    const attackPlayerNums = playerNums.slice();
    const attackPlayerNames = players.map(function (p) { return p.name; });
    Object.keys(stats.attackOutcomes).forEach(function (k) {
      var num = Number(k);
      if (!isNaN(num) && attackPlayerNums.indexOf(num) === -1) {
        var name = players.find(function (p) { return Number(p.number) === num; });
        attackPlayerNums.push(num);
        attackPlayerNames.push(name ? name.name : 'Speler ' + num);
      }
    });
    var getOutcome = function (playerNum, key) {
      var ao = stats.attackOutcomes[playerNum] || stats.attackOutcomes[String(playerNum)];
      return (ao && ao[key]) || 0;
    };
    const attackOutcomeDatasets = attackOutcomeOrder.map(function (k) {
      const arr = attackPlayerNums.map(function (n) { return getOutcome(n, k); });
      return { label: attackOutcomeLabels[k], data: arr, backgroundColor: attackOutcomeColors[k], ...barOpts };
    });
    new Chart(document.getElementById('chartAttacksFromSetup'), {
      type: 'bar',
      data: { labels: attackPlayerNames, datasets: attackOutcomeDatasets },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: !isMobile,
        layout: { padding: { top: 8, right: isMobile ? 8 : 16, bottom: 8, left: isMobile ? 4 : 8 } },
        scales: {
          x: { stacked: true, beginAtZero: true, ...scaleDefaults },
          y: { stacked: true, ...scaleDefaults }
        },
        plugins: { legend: { position: 'top' } }
      }
    });

    // Services: Ace, Normale service, Uit, Net
    const serviceTypes = ['ace', 'normal', 'out', 'net'];
    const serviceLabels = { ace: 'Ace', normal: 'Normale service', out: 'Uit', net: 'Net' };
    const serviceColors = { ace: '#7dd3fc', normal: '#86efac', out: '#ef4444', net: '#f59e0b' };
    const serviceDatasets = serviceTypes.map(function (k) {
      const arr = playerNums.map(function (n) { return (stats.services[n] && stats.services[n][k]) || 0; });
      return { label: serviceLabels[k], data: arr, backgroundColor: serviceColors[k], ...barOpts };
    });
    new Chart(document.getElementById('chartServices'), {
      type: 'bar',
      data: {
        labels: playerNames,
        datasets: serviceDatasets
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: !isMobile,
        layout: { padding: { top: 8, right: isMobile ? 8 : 16, bottom: 8, left: isMobile ? 4 : 8 } },
        scales: {
          x: { stacked: true, ...scaleDefaults },
          y: { stacked: true, ...scaleDefaults }
        },
        plugins: { legend: { position: 'top' } }
      }
    });

    // Service passes (Zone I, Zone II, Zone III, Overpass)
    const passZoneKeys = ['zoneI', 'zoneII', 'zoneIII', 'overpass'];
    const passZoneLabels = ['Zone I', 'Zone II', 'Zone III', 'Overpass'];
    const passZoneColors = ['#3b82f6', '#22c55e', '#f59e0b', '#a855f7']; // blauw, groen, amber, paars
    const passZoneDatasets = passZoneKeys.map(function (k, i) {
      const arr = playerNums.map(function (n) { return (stats.servicePasses[n] && stats.servicePasses[n][k]) || 0; });
      return { label: passZoneLabels[i], data: arr, backgroundColor: passZoneColors[i], ...barOpts };
    });
    new Chart(document.getElementById('chartServicePasses'), {
      type: 'bar',
      data: {
        labels: playerNames,
        datasets: passZoneDatasets
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: !isMobile,
        layout: { padding: { top: 8, right: isMobile ? 8 : 16, bottom: 8, left: isMobile ? 4 : 8 } },
        scales: { x: { stacked: true, ...scaleDefaults }, y: { stacked: true, ...scaleDefaults } },
        plugins: { legend: { position: 'top' } }
      }
    });

    // Points per rotation
    const rotLabels = ['Rot 1', 'Rot 2', 'Rot 3', 'Rot 4', 'Rot 5', 'Rot 6'];
    const rotData = [1, 2, 3, 4, 5, 6].map(function (r) { return stats.pointsByRotation[r] || 0; });
    new Chart(document.getElementById('chartRotation'), {
      type: 'bar',
      data: {
        labels: rotLabels,
        datasets: [{ label: 'Punten', data: rotData, backgroundColor: colors.accent, ...barOpts }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: !isMobile,
        layout: { padding: { top: 8, right: isMobile ? 8 : 16, bottom: 8, left: isMobile ? 4 : 8 } },
        plugins: { legend: { display: false } },
        scales: { x: scaleDefaults, y: { beginAtZero: true, ...scaleDefaults } }
      }
    });

    // Score piramide: Totaal (basis) -> Passes -> Setups -> Scores (top) = echte piramide
    const totalPasses = Object.values(stats.passCount || {}).reduce(function (s, v) { return s + (v || 0); }, 0);
    const totalSetups = Object.values(stats.setupCount || {}).reduce(function (s, v) { return s + (v || 0); }, 0);
    const totalScores = stats.pointsByType && stats.pointsByType.teamA
      ? Object.values(stats.pointsByType.teamA).reduce(function (s, v) { return s + (v || 0); }, 0)
      : 0;
    const totalRallies = (stats.rallyLengths || []).length;
    const pyramidBase = Math.max(totalRallies, totalPasses, totalSetups, totalScores, 1);
    const convPass = pyramidBase > 0 ? ((totalPasses / pyramidBase) * 100).toFixed(1) : '0';
    const convSetup = totalPasses > 0 ? ((totalSetups / totalPasses) * 100).toFixed(1) : '0';
    const convScore = totalSetups > 0 ? ((totalScores / totalSetups) * 100).toFixed(1) : '0';
    const pyramidLabels = [
      'Scores: ' + convScore + '%',
      'Setups: ' + convSetup + '%',
      'Passes: ' + convPass + '%',
      'Totaal: 100%'
    ];
    const pyramidData = [totalScores, totalSetups, totalPasses, pyramidBase];
    const pyramidColors = ['#22c55e', '#3b82f6', '#06b6d4', '#64748b'];
    new Chart(document.getElementById('chartConversion'), {
      type: 'bar',
      data: {
        labels: pyramidLabels,
        datasets: [{
          label: '',
          data: pyramidData,
          backgroundColor: pyramidColors,
          barPercentage: 0.9,
          categoryPercentage: 0.8
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: !isMobile,
        layout: { padding: { top: 8, right: isMobile ? 8 : 16, bottom: 8, left: isMobile ? 4 : 8 } },
        plugins: { legend: { display: false } },
        scales: {
          x: { ...scaleDefaults, beginAtZero: true },
          y: { ...scaleDefaults }
        }
      }
    });

    // Conversion table: pass zones + setups met conversie naar punten
    const convBody = document.getElementById('conversionBody');
    if (convBody) {
      var rows = [];
      ['Zone I', 'Zone II', 'Zone III', 'Overpass'].forEach(function (z) {
        var n = stats.passCount[z] || 0;
        if (n === 0) return;
        var pts = stats.passZoneToPoints[z] || 0;
        var conv = n > 0 ? pts + ' (' + ((pts / n) * 100).toFixed(0) + '%)' : '-';
        rows.push('<tr><td>' + escapeHtml(z) + '</td><td>' + n + '</td><td>' + escapeHtml(conv) + '</td></tr>');
      });
      ['5', '1', 'C', '10', 'Pipe', '30'].forEach(function (s) {
        var n = stats.setupCount[s] || 0;
        if (n === 0) return;
        var pts = stats.setupToPoints[s] || 0;
        var conv = n > 0 ? pts + ' (' + ((pts / n) * 100).toFixed(0) + '%)' : '-';
        rows.push('<tr><td>Setup ' + escapeHtml(s) + '</td><td>' + n + '</td><td>' + escapeHtml(conv) + '</td></tr>');
      });
      convBody.innerHTML = rows.length ? rows.join('') : '<tr><td colspan="3">Geen data</td></tr>';
    }

    // Passing distribution (pie)
    const passValues = Object.values(stats.passCount).filter(function (v) { return v > 0; });
    const passKeys = Object.keys(stats.passCount).filter(function (k) { return stats.passCount[k] > 0; });
    if (passValues.length) {
      new Chart(document.getElementById('chartPassing'), {
        type: 'doughnut',
        data: {
          labels: passKeys,
          datasets: [{
            data: passValues,
            backgroundColor: colors.pie.slice(0, passKeys.length),
            borderWidth: 2,
            borderColor: surfaceColor,
            hoverOffset: 8
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: !isMobile,
          cutout: '55%',
          layout: { padding: isMobile ? 12 : 20 },
          plugins: { legend: { position: isMobile ? 'bottom' : 'right' } }
        }
      });
    } else {
      var el = document.getElementById('chartPassing');
      if (el && el.parentNode) { el.style.display = 'none'; el.parentNode.insertAdjacentHTML('beforeend', '<p class="chart-empty">Geen pass-data</p>'); }
    }

    // Setup distribution (doughnut)
    const setupKeys = Object.keys(stats.setupCount).filter(function (k) { return stats.setupCount[k] > 0; });
    const setupValues = setupKeys.map(function (k) { return stats.setupCount[k]; });
    if (setupValues.length) {
      new Chart(document.getElementById('chartSetup'), {
        type: 'doughnut',
        data: {
          labels: setupKeys,
          datasets: [{
            data: setupValues,
            backgroundColor: colors.pie.slice(0, setupKeys.length),
            borderWidth: 2,
            borderColor: surfaceColor,
            hoverOffset: 8
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: !isMobile,
          cutout: '55%',
          layout: { padding: isMobile ? 12 : 20 },
          plugins: { legend: { position: isMobile ? 'bottom' : 'right' } }
        }
      });
    } else {
      var el = document.getElementById('chartSetup');
      if (el && el.parentNode) { el.style.display = 'none'; el.parentNode.insertAdjacentHTML('beforeend', '<p class="chart-empty">Geen setup-data</p>'); }
    }

    // Pass-Setup matrix (grouped bar)
    const matrixLabels = Object.keys(stats.passToSetup).filter(function (k) {
      return Object.values(stats.passToSetup[k]).some(function (v) { return v > 0; });
    });
    const matrixSetupTypes = ['5', '1', 'C', '10', 'Pipe', '30'];
    const matrixDatasets = matrixSetupTypes.filter(function (s) {
      return setupKeys.includes(s);
    }).map(function (s, i) {
      const arr = matrixLabels.map(function (p) { return stats.passToSetup[p][s] || 0; });
      return { label: s, data: arr, backgroundColor: colors.pie[i % colors.pie.length], ...barOpts };
    });
    if (matrixLabels.length && matrixDatasets.length) {
      new Chart(document.getElementById('chartPassSetupMatrix'), {
        type: 'bar',
        data: { labels: matrixLabels, datasets: matrixDatasets },
        options: {
          responsive: true,
          maintainAspectRatio: !isMobile,
          layout: { padding: { top: 8, right: isMobile ? 8 : 16, bottom: 8, left: isMobile ? 4 : 8 } },
          scales: { x: { stacked: false, ...scaleDefaults }, y: { stacked: false, beginAtZero: true, ...scaleDefaults } },
          plugins: { legend: { position: 'top' } }
        }
      });
    } else {
      var el = document.getElementById('chartPassSetupMatrix');
      if (el && el.parentNode) { el.style.display = 'none'; el.parentNode.insertAdjacentHTML('beforeend', '<p class="chart-empty">Geen pass-setup data</p>'); }
    }

    // Setups per spelverdeler: per setup-type (5, 1, C, 10, PIPE, 30) gegroepeerde balken per setter, elk gestapeld (punt/geen punt). A negeren.
    var setterNums = Object.keys(stats.setupsBySetter || {}).filter(function (k) {
      var by = stats.setupsBySetter[k];
      if (!by) return false;
      return Object.keys(by).some(function (s) {
        var v = by[s];
        return v && typeof v === 'object' && ((v.point || 0) + (v.noPoint || 0) > 0);
      });
    });
    var setterNames = setterNums.map(function (n) {
      var p = players.find(function (x) { return String(x.number) === String(n); });
      return p ? p.name : 'Speler ' + n;
    });
    var setterColors = [
      { point: '#1e40af', noPoint: '#93c5fd' },
      { point: '#15803d', noPoint: '#86efac' },
      { point: '#a16207', noPoint: '#fde047' },
      { point: '#6b21a8', noPoint: '#c4b5fd' }
    ];
    var setupLabels = ['5', '1', 'C', '10', 'PIPE', '30'];
    var setterDatasets = [];
    setterNums.forEach(function (sn, idx) {
      var c = setterColors[idx % setterColors.length];
      var pointArr = setupLabels.map(function (lbl) {
        var key = lbl === 'PIPE' ? 'Pipe' : lbl;
        var by = stats.setupsBySetter[sn] && stats.setupsBySetter[sn][key];
        return (by && by.point) || 0;
      });
      var noPointArr = setupLabels.map(function (lbl) {
        var key = lbl === 'PIPE' ? 'Pipe' : lbl;
        var by = stats.setupsBySetter[sn] && stats.setupsBySetter[sn][key];
        return (by && by.noPoint) || 0;
      });
      var setterName = setterNames[idx];
      setterDatasets.push({ label: setterName + ' (punt)', data: pointArr, stack: sn, backgroundColor: c.point, ...barOpts });
      setterDatasets.push({ label: setterName + ' (geen punt)', data: noPointArr, stack: sn, backgroundColor: c.noPoint, ...barOpts });
    });
    var hasSetupData = setterDatasets.some(function (d) { return d.data.some(function (v) { return v > 0; }); });
    if (hasSetupData) {
      new Chart(document.getElementById('chartSetters'), {
        type: 'bar',
        data: {
          labels: setupLabels,
          datasets: setterDatasets
        },
        options: {
          responsive: true,
          maintainAspectRatio: !isMobile,
          layout: { padding: { top: 8, right: isMobile ? 8 : 16, bottom: 8, left: isMobile ? 4 : 8 } },
          scales: {
            x: { stacked: true, grid: { display: false }, ...scaleDefaults },
            y: { stacked: true, beginAtZero: true, ...scaleDefaults }
          },
          plugins: { legend: { position: 'top' } }
        }
      });
    } else {
      var el = document.getElementById('chartSetters');
      if (el && el.parentNode) { el.style.display = 'none'; el.parentNode.insertAdjacentHTML('beforeend', '<p class="chart-empty">Geen setup-data</p>'); }
    }

    // Rally length histogram
    const lengths = stats.rallyLengths || [];
    const maxLen = Math.max(10, ...lengths);
    const hist = {};
    for (let i = 0; i <= maxLen; i++) hist[i] = 0;
    lengths.forEach(function (l) { hist[l] = (hist[l] || 0) + 1; });
    const histLabels = Object.keys(hist).map(Number).filter(function (n) { return n <= 20; }); // cap for readability
    const histData = histLabels.map(function (n) { return hist[n] || 0; });
    new Chart(document.getElementById('chartRallyLength'), {
      type: 'bar',
      data: {
        labels: histLabels.map(String),
        datasets: [{ label: 'Aantal rallies', data: histData, backgroundColor: colors.accent, ...barOpts }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: !isMobile,
        layout: { padding: { top: 8, right: isMobile ? 8 : 16, bottom: 8, left: isMobile ? 4 : 8 } },
        plugins: { legend: { display: false } },
        scales: {
          x: { title: { display: true, text: 'Lengte (events)', color: textColor }, ...scaleDefaults },
          y: { beginAtZero: true, ...scaleDefaults }
        }
      }
    });

    // Score-progressie lijngrafieken per set
    var scoreProg = stats.scoreProgression || [];
    scoreProg.forEach(function (points, setIdx) {
      var canvas = document.getElementById('chartScoreProgression' + setIdx);
      if (!canvas || points.length === 0) return;
      var maxRally = Math.max(1, points.length - 1);
      var homeData = points.map(function (p) { return { x: p.x, y: p.yHome }; });
      var awayData = points.map(function (p) { return { x: p.x, y: p.yAway }; });
      new Chart(canvas, {
        type: 'line',
        data: {
          datasets: [
            {
              label: teamA + ' Score',
              data: homeData,
              borderColor: '#93c5fd',
              backgroundColor: 'rgba(147, 197, 253, 0.1)',
              fill: false,
              pointRadius: 4,
              pointBackgroundColor: '#93c5fd',
              tension: 0
            },
            {
              label: teamB + ' Score',
              data: awayData,
              borderColor: '#fda4af',
              backgroundColor: 'rgba(253, 164, 175, 0.1)',
              fill: false,
              pointRadius: 4,
              pointBackgroundColor: '#fda4af',
              tension: 0
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: true,
          aspectRatio: 0.85,
          layout: { padding: { top: 8, right: isMobile ? 8 : 16, bottom: 8, left: isMobile ? 4 : 8 } },
          plugins: { legend: { position: 'top' } },
          scales: {
            x: {
              type: 'linear',
              min: 0,
              max: maxRally,
              title: { display: true, text: 'Rally Number', color: textColor },
              grid: { color: gridColor },
              ticks: { color: textColor, maxTicksLimit: 10 }
            },
            y: {
              type: 'linear',
              min: 0,
              max: 30,
              title: { display: true, text: 'Score', color: textColor },
              grid: { color: gridColor },
              ticks: { color: textColor, stepSize: 5 }
            }
          }
        }
      });
    });
  }

  function processData(data) {
    if (!data || !data.teamA) {
      showError('Geen wedstrijddata gevonden. Controleer de matchId.');
      return;
    }
    var sets = data.sets || [];
    var totalRallies = sets.reduce(function (sum, s) {
      return sum + (s.rallies ? s.rallies.length : 0);
    }, 0);
    if (totalRallies === 0) {
      showError('Geen rallies in deze wedstrijd. Start de scouting om data te verzamelen.');
      document.getElementById('reportTeams').textContent =
        (data.teamA || 'Thuis') + ' – ' + (data.teamB || 'Uit');
      return;
    }
    if (getUrlParam('format') === 'json') {
      var stats = aggregate(data);
      var json = buildRefinedExport(data, stats);
      var cont = document.getElementById('reportContent');
      var teamsEl = document.getElementById('reportTeams');
      if (teamsEl) teamsEl.textContent = (data.teamA || 'Thuis') + ' – ' + (data.teamB || 'Uit') + ' (JSON)';
      if (cont) {
        cont.innerHTML = '<pre style="white-space:pre-wrap;word-break:break-word;font-family:monospace;font-size:0.9rem;margin:0;padding:1rem;overflow-x:auto;">' + escapeHtml(JSON.stringify(json, null, 2)) + '</pre>';
      }
      return;
    }
    var stats = aggregate(data);
    renderReport(data, stats);
  }

  function init() {
    loadMatch()
      .then(function (data) {
        processData(data);
      })
      .catch(function (err) {
        var msg = 'Kon wedstrijd niet laden.';
        if (err && err.message) msg += ' (' + String(err.message) + ')';
        showErrorWithRetry(msg);
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Swipe rechts → terug naar wedstrijd
  if (window.scoutUtils && window.scoutUtils.addSwipeListener) {
    window.scoutUtils.addSwipeListener(document.body, {
      right: function () {
        var matchId = getMatchId();
        if (matchId) {
          try { localStorage.setItem('scoutCurrentMatchId', matchId); } catch (_) {}
          window.location.href = 'match.php';
        }
      },
      minDistance: 80
    });
  }
})();
