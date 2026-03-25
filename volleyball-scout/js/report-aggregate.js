/**
 * report-aggregate.js - Aggregatie en geraffineerde export voor wedstrijddata.
 * Deelt logica met matchreport.js. Exposed als window.scoutReportAggregate en window.scoutBuildRefinedExport.
 */
(function () {
  var PASS_ZONES = ['Zone I', 'Zone II', 'Zone III', 'Overpass'];
  var SETUP_TYPES = ['5', '1', 'C', '10', 'Pipe', '30'];
  var ATTACK_TYPES = ['Smash', 'Tip'];

  function isOurTeam(ev, teamA) {
    return ev.team === teamA;
  }

  function isPassZone(desc) {
    return PASS_ZONES.indexOf(desc) !== -1;
  }

  function isSetupType(desc) {
    return SETUP_TYPES.indexOf(desc) !== -1;
  }

  function isAttack(desc) {
    return ATTACK_TYPES.indexOf(desc) !== -1;
  }

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

  function getPositionsFromSet(set) {
    var pos = {};
    for (var i = 1; i <= 6; i++) {
      var val = (set && set['Position' + i]) || '';
      pos[i] = val;
      pos['Position' + i] = val;
    }
    return pos;
  }

  function applySub(positions, playerOut, playerIn) {
    for (var k = 1; k <= 6; k++) {
      if (positions[k] === playerOut) {
        positions[k] = playerIn;
        return;
      }
    }
  }

  function getPlayersOnCourtForSet(set) {
    if (!set) return [];
    var positions = getPositionsFromSet(set);
    var subs = collectSubsFromRallies(set.rallies || []);
    for (var i = 0; i < subs.length; i++) {
      applySub(positions, subs[i].playerOut, subs[i].playerIn);
    }
    var out = [];
    for (var p = 1; p <= 6; p++) {
      if (positions[p]) out.push(positions[p]);
    }
    return out;
  }

  function aggregate(data) {
    var teamA = data.teamA || '';
    var teamB = data.teamB || '';
    var sets = data.sets || [];
    var players = (data.teamAPlayers || []).map(function (p) {
      return { name: p.name || 'Speler ' + p.number, number: p.number };
    });

    var stats = {
      teamA: teamA,
      teamB: teamB,
      players: players,
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
    for (var r = 1; r <= 6; r++) stats.pointsByRotation[r] = 0;

    var rallyLengths = [];
    var lastHome = 0, lastAway = 0;

    sets.forEach(function (set, setIdx) {
      var rallies = set.rallies || [];
      stats.scoreSequence[setIdx] = [];
      lastHome = 0;
      lastAway = 0;

      var finalPositions = getPositionsFromSet(set);
      var subs = collectSubsFromRallies(rallies);
      var initialPositions = {};
      for (var pi = 1; pi <= 6; pi++) initialPositions[pi] = finalPositions[pi];
      for (var si = subs.length - 1; si >= 0; si--) {
        applySub(initialPositions, subs[si].playerIn, subs[si].playerOut);
      }
      var currentPositions = {};
      for (var pj = 1; pj <= 6; pj++) currentPositions[pj] = initialPositions[pj];

      rallies.forEach(function (rally) {
        var evs = rally.events || [];
        var homeScore = rally.HomeScore;
        var awayScore = rally.AwayScore;
        var rotation = rally.Rotation || 1;

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

        rallyLengths.push(evs.length);
        var weWon = homeScore > lastHome;
        var setterName = getSetterFromPositions(currentPositions, rotation, setterConfig);
        var setterNum = setterName ? (nameToNumber[setterName] || 0) : 0;

        var lastPass = null, lastSetupType = null, lastAttacker = null, server = null, servingTeam = null;

        for (var i = 0; i < evs.length; i++) {
          var e = evs[i];
          var ours = isOurTeam(e, teamA);
          if (Number(e.panel) === 0) {
            server = e.player;
            servingTeam = ours ? 'home' : 'away';
          }
          if (e.panel === 1) {
            if (isPassZone(e.description)) {
              lastPass = e.description;
              if (ours && e.player) {
                stats.passCount[e.description] = (stats.passCount[e.description] || 0) + 1;
                var zoneKey = e.description === 'Zone I' ? 'zoneI' : e.description === 'Zone II' ? 'zoneII' : e.description === 'Zone III' ? 'zoneIII' : 'overpass';
                stats.servicePasses[e.player] = stats.servicePasses[e.player] || { zoneI: 0, zoneII: 0, zoneIII: 0, overpass: 0 };
                stats.servicePasses[e.player][zoneKey]++;
              }
            } else if (isSetupType(e.description)) {
              lastSetupType = e.description;
              if (ours) {
                stats.setupCount[e.description] = (stats.setupCount[e.description] || 0) + 1;
                if (setterNum) {
                  stats.setupsBySetter[setterNum] = stats.setupsBySetter[setterNum] || {};
                  if (!stats.setupsBySetter[setterNum][e.description]) stats.setupsBySetter[setterNum][e.description] = { point: 0, noPoint: 0 };
                  stats.setupsBySetter[setterNum][e.description][weWon ? 'point' : 'noPoint']++;
                }
                if (lastPass) {
                  stats.passToSetup[lastPass] = stats.passToSetup[lastPass] || {};
                  stats.passToSetup[lastPass][e.description] = (stats.passToSetup[lastPass][e.description] || 0) + 1;
                }
              }
            }
          }
          if (e.panel === 2 && isAttack(e.description)) {
            lastAttacker = e.player;
            if (ours && lastSetupType && e.player) {
              stats.attacksFromSetup[e.player] = stats.attacksFromSetup[e.player] || {};
              stats.attacksFromSetup[e.player][lastSetupType] = (stats.attacksFromSetup[e.player][lastSetupType] || 0) + 1;
            }
          }
        }

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
          stats.services[server][servOutcome] = (stats.services[server][servOutcome] || 0) + 1;
        }

        var lastEv = evs.length ? evs[evs.length - 1] : null;
        var lastDesc = (lastEv && lastEv.description || '').trim();
        if (lastDesc === 'In net') lastDesc = 'Out';

        if (weWon) {
          stats.pointsByRotation[rotation] = (stats.pointsByRotation[rotation] || 0) + 1;
          if (lastPass && lastPass !== 'Overpass') stats.passZoneToPoints[lastPass] = (stats.passZoneToPoints[lastPass] || 0) + 1;
          if (lastSetupType) stats.setupToPoints[lastSetupType] = (stats.setupToPoints[lastSetupType] || 0) + 1;
          if (lastDesc === 'Ace' && server) {
            stats.playerScores[server] = stats.playerScores[server] || { Ace: 0, Smash: 0, Tip: 0, Block: 0 };
            stats.playerScores[server].Ace++;
          } else if (lastDesc === 'Smash' && lastAttacker) {
            stats.playerScores[lastAttacker] = stats.playerScores[lastAttacker] || { Ace: 0, Smash: 0, Tip: 0, Block: 0 };
            stats.playerScores[lastAttacker].Smash++;
          } else if (lastDesc === 'Tip' && lastAttacker) {
            stats.playerScores[lastAttacker] = stats.playerScores[lastAttacker] || { Ace: 0, Smash: 0, Tip: 0, Block: 0 };
            stats.playerScores[lastAttacker].Tip++;
          } else if (lastDesc === 'Block' && lastEv && lastEv.player && lastEv.team === teamA) {
            stats.playerScores[lastEv.player] = stats.playerScores[lastEv.player] || { Ace: 0, Smash: 0, Tip: 0, Block: 0 };
            stats.playerScores[lastEv.player].Block++;
          }
          var pt = stats.pointsByType.teamA;
          if (lastEv && ((lastEv.team === teamA && (lastDesc === 'Smash' || lastDesc === 'Tip' || lastDesc === 'Block')) || (lastDesc === 'Ace' && lastEv.team === teamB)))
            pt[lastDesc] = (pt[lastDesc] || 0) + 1;
          else if (lastEv && lastEv.team === teamB && (lastDesc === 'Out' || lastDesc === 'Drop'))
            pt[lastDesc] = (pt[lastDesc] || 0) + 1;
        } else {
          var ptB = stats.pointsByType.teamB;
          if (lastEv && ((lastEv.team === teamB && (lastDesc === 'Smash' || lastDesc === 'Tip' || lastDesc === 'Block')) || (lastDesc === 'Ace' && lastEv.team === teamA)))
            ptB[lastDesc] = (ptB[lastDesc] || 0) + 1;
          else if (lastEv && lastEv.team === teamA && (lastDesc === 'Out' || lastDesc === 'Drop'))
            ptB[lastDesc] = (ptB[lastDesc] || 0) + 1;
        }

        for (var ii = 0; ii < evs.length; ii++) {
          var ee = evs[ii];
          if (Number(ee.panel) !== 1 || !isSetupType(ee.description) || !isOurTeam(ee, teamA)) continue;
          var nextEv = ii + 1 < evs.length ? evs[ii + 1] : null;
          if (!nextEv || (nextEv.description || '').trim() === 'Ace') continue;
          var nextDesc = (nextEv.description || '').trim();
          if (nextDesc === 'In net') nextDesc = 'Out';
          var nextOurs = isOurTeam(nextEv, teamA);
          var nextPanel = Number(nextEv.panel);
          var outcome = 'noPoint';
          var attackerKey = ee.player != null && ee.player !== 0 ? Number(ee.player) : null;
          if (nextOurs && nextPanel === 2 && isAttack(nextDesc)) {
            outcome = 'point';
            attackerKey = nextEv.player != null && nextEv.player !== 0 ? Number(nextEv.player) : null;
          } else if (!nextOurs && nextPanel === 3 && nextDesc === 'Block') {
            outcome = 'block';
          } else if (nextDesc === 'Drop' || nextDesc === 'Out') {
            outcome = weWon ? 'point' : (nextDesc === 'Drop' ? 'drop' : 'out');
          } else {
            outcome = (nextPanel === 4 && (nextDesc === 'Out' || nextDesc === 'Drop') && nextOurs) ? 'point' : 'noPoint';
          }
          if (attackerKey != null && !isNaN(attackerKey)) {
            stats.attackOutcomes[attackerKey] = stats.attackOutcomes[attackerKey] || { point: 0, noPoint: 0, drop: 0, out: 0, block: 0 };
            if (typeof stats.attackOutcomes[attackerKey][outcome] === 'number') stats.attackOutcomes[attackerKey][outcome]++;
          }
        }

        lastHome = homeScore;
        lastAway = awayScore;
      });
      stats.setScores.push({ home: lastHome, away: lastAway });
    });

    stats.rallyLengths = rallyLengths;
    stats.scoreProgression = sets.map(function (set) {
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

    var sets = data.sets || [];
    var currentSetIdx = Math.max(0, Math.min(data.currentSetIndex ?? sets.length - 1, sets.length - 1));
    var currentSet = sets[currentSetIdx] || null;
    var playersOnCourt = getPlayersOnCourtForSet(currentSet);

    var out = {
      _meta: {
        description: 'Geraffineerde wedstrijdstatistieken voor AI-analyse (Timeout advies).',
        format: 'Volleyball Scout Report Export',
        exportDate: new Date().toISOString().slice(0, 10)
      },
      match: {
        teamA: teamA,
        teamB: teamB,
        matchDate: data.matchDate || null,
        players: players.map(function (p) { return { name: p.name, number: p.number }; }),
        setScores: (stats.setScores || []).map(function (s, i) {
          return { set: i + 1, home: s.home || 0, away: s.away || 0 };
        }),
        currentSet: currentSetIdx + 1,
        playersOnCourt: playersOnCourt
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
          out.push({ player: p ? p.name : numToName[num], number: Number(num), bySetupType: by });
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
          var setupTypes = {};
          ['5', '1', 'C', '10', 'Pipe', '30'].forEach(function (t) {
            var v = by[t];
            if (v && (v.point || v.noPoint)) setupTypes[t] = { totPunt: v.point || 0, geenPunt: v.noPoint || 0 };
          });
          if (Object.keys(setupTypes).length) out.push({ player: p ? p.name : numToName[num], number: Number(num), setups: setupTypes });
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
      rallyLengths: { total: totalRallies }
    };
    if (data.lastTimeoutAdvice) out.previousTimeoutAdvice = data.lastTimeoutAdvice;
    return out;
  }

  window.scoutReportAggregate = aggregate;
  window.scoutBuildRefinedExport = buildRefinedExport;
})();
