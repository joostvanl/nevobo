/**
 * Rotatielogica 5-1 en 4-2 (en geen systeem).
 * Posities 1-6: 1 = rechtsachter (service), 2 = rechtsvoor, 3 = midvoor, 4 = linksvoor, 5 = linksachter, 6 = midachter.
 * Bij winnen van punt op ontvangst: rotatie wijzer (1→6→5→4→3→2→1).
 */

function getPlayerInZone(names, rotation, zone) {
  // names = [pos1, pos2, ..., pos6], rotation 1-6, zone 1-6
  // Rotatie 1→6→5→4→3→2→1: speler in zone k komt van startpositie (k + rotation - 2) % 6 + 1
  const idx = ((zone - 1 + (rotation - 1)) % 6);
  return names[idx] || '';
}

function getZoneAtRotation(positions, rotation) {
  const names = [
    positions.Position1,
    positions.Position2,
    positions.Position3,
    positions.Position4,
    positions.Position5,
    positions.Position6
  ];
  return {
    1: getPlayerInZone(names, rotation, 1),
    2: getPlayerInZone(names, rotation, 2),
    3: getPlayerInZone(names, rotation, 3),
    4: getPlayerInZone(names, rotation, 4),
    5: getPlayerInZone(names, rotation, 5),
    6: getPlayerInZone(names, rotation, 6)
  };
}

/** 5-1: één setter. setterPosition = 1-6 waar de setter staat bij rotatie 1. */
function getSetter51(positions, rotation, setterPosition) {
  const names = [
    positions.Position1,
    positions.Position2,
    positions.Position3,
    positions.Position4,
    positions.Position5,
    positions.Position6
  ];
  const setterIdx = (setterPosition - 1 + (rotation - 1)) % 6;
  return names[setterIdx] || '';
}

/** 4-2: twee setters tegenover elkaar. setterPositions = [pos1, pos2] (bijv. 2 en 5). */
function getSetters42(positions, rotation, setterPositions) {
  const names = [
    positions.Position1,
    positions.Position2,
    positions.Position3,
    positions.Position4,
    positions.Position5,
    positions.Position6
  ];
  const s1 = (setterPositions[0] - 1 + (rotation - 1)) % 6;
  const s2 = (setterPositions[1] - 1 + (rotation - 1)) % 6;
  return [names[s1] || '', names[s2] || ''];
}

window.getPlayerInZone = getPlayerInZone;
window.getZoneAtRotation = getZoneAtRotation;
window.getSetter51 = getSetter51;
window.getSetters42 = getSetters42;
