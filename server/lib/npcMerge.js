/**
 * NPC (placeholder) user ↔ real user merge + optional NPC restore from merge snapshot.
 */

const bcrypt = require('bcryptjs');
const {
  hasSuperAdmin,
  hasClubAdmin,
  hasTeamAdmin,
  hasTeamCoachOrTrainer,
} = require('../middleware/auth');

/**
 * Caller may merge NPC → real only if for every team the NPC is in, the requester is
 * club_admin (that club), team_admin, or coach/trainer on that team.
 * Multi-club NPCs: only super_admin.
 */
function canMergeNpcAccount(requesterId, npcUserId) {
  const db = require('../db/db');
  const rows = db.prepare('SELECT team_id FROM team_memberships WHERE user_id = ?').all(npcUserId);
  if (!rows.length) return hasSuperAdmin(requesterId);

  const teamIds = [...new Set(rows.map((r) => r.team_id))];
  const clubRows = db.prepare(
    `SELECT DISTINCT club_id FROM teams WHERE id IN (${teamIds.map(() => '?').join(',')})`
  ).all(...teamIds);
  if (clubRows.length !== 1) return hasSuperAdmin(requesterId);
  const clubId = clubRows[0].club_id;

  if (hasSuperAdmin(requesterId)) return true;
  if (hasClubAdmin(requesterId, clubId)) return true;

  for (const tid of teamIds) {
    const ok =
      hasTeamAdmin(requesterId, tid) || hasTeamCoachOrTrainer(requesterId, tid);
    if (!ok) return false;
  }
  return true;
}

function recalcLevel(db, userId) {
  const row = db.prepare(
    'SELECT level FROM xp_levels WHERE xp_required <= (SELECT xp FROM users WHERE id = ?) ORDER BY xp_required DESC LIMIT 1'
  ).get(userId);
  if (row) db.prepare('UPDATE users SET level = ? WHERE id = ?').run(row.level, userId);
}

function buildNpcSnapshot(db, npcRow, memberships) {
  return {
    name: npcRow.name,
    email: npcRow.email,
    xp: npcRow.xp,
    level: npcRow.level,
    club_id: npcRow.club_id,
    team_id: npcRow.team_id,
    avatar_url: npcRow.avatar_url,
    anonymous_mode: npcRow.anonymous_mode,
    team_memberships: memberships.map((m) => ({
      team_id: m.team_id,
      membership_type: m.membership_type,
      shirt_number: m.shirt_number,
      position: m.position,
      added_by: m.added_by,
    })),
  };
}

/**
 * Merge all data from NPC user into real user, delete NPC row, record history for optional restore.
 */
function mergeNpcIntoUser(npcId, realId) {
  const db = require('../db/db');

  const npc = db.prepare('SELECT * FROM users WHERE id = ?').get(npcId);
  const real = db.prepare('SELECT * FROM users WHERE id = ?').get(realId);
  if (!npc || !real) throw new Error('USER_NOT_FOUND');
  if (!npc.is_npc) throw new Error('SOURCE_NOT_NPC');
  if (real.is_npc) throw new Error('TARGET_IS_NPC');
  if (npcId === realId) throw new Error('SAME_USER');

  const memberships = db.prepare('SELECT * FROM team_memberships WHERE user_id = ?').all(npcId);
  const snapshot = buildNpcSnapshot(db, npc, memberships);

  const run = db.transaction(() => {
    // ─── team_memberships: move or merge ─────────────────────────────────
    for (const nm of memberships) {
      const existing = db
        .prepare('SELECT * FROM team_memberships WHERE user_id = ? AND team_id = ?')
        .get(realId, nm.team_id);
      if (existing) {
        const shirt =
          existing.shirt_number != null ? existing.shirt_number : nm.shirt_number;
        const pos = existing.position || nm.position;
        db.prepare(
          'UPDATE team_memberships SET shirt_number = ?, position = ? WHERE id = ?'
        ).run(shirt, pos, existing.id);
        db.prepare('DELETE FROM team_memberships WHERE id = ?').run(nm.id);
      } else {
        db.prepare('UPDATE team_memberships SET user_id = ? WHERE id = ?').run(realId, nm.id);
      }
    }

    // ─── user_follows (follower + followee user) ──────────────────────────
    db.prepare(
      `DELETE FROM user_follows WHERE follower_id = ? AND EXISTS (
        SELECT 1 FROM user_follows uf2
        WHERE uf2.follower_id = ? AND uf2.followee_type = user_follows.followee_type AND uf2.followee_id = user_follows.followee_id
      )`
    ).run(npcId, realId);
    db.prepare('UPDATE user_follows SET follower_id = ? WHERE follower_id = ?').run(realId, npcId);

    db.prepare(
      `DELETE FROM user_follows WHERE followee_type = 'user' AND followee_id = ? AND EXISTS (
        SELECT 1 FROM user_follows uf2
        WHERE uf2.followee_type = 'user' AND uf2.followee_id = ? AND uf2.follower_id = user_follows.follower_id
      )`
    ).run(npcId, realId);
    db.prepare(`UPDATE user_follows SET followee_id = ? WHERE followee_type = 'user' AND followee_id = ?`).run(
      realId,
      npcId
    );

    // ─── posts, match_media ─────────────────────────────────────────────
    db.prepare('UPDATE posts SET user_id = ? WHERE user_id = ?').run(realId, npcId);
    db.prepare('UPDATE match_media SET user_id = ? WHERE user_id = ?').run(realId, npcId);

    // ─── carpool (offer unique per match+user; bookings unique per offer+user) ─
    db.prepare(
      `DELETE FROM carpool_bookings WHERE user_id = ? AND offer_id IN (
        SELECT offer_id FROM carpool_bookings WHERE user_id = ?
      )`
    ).run(npcId, realId);
    db.prepare('UPDATE carpool_bookings SET user_id = ? WHERE user_id = ?').run(realId, npcId);
    db.prepare(
      `DELETE FROM carpool_offers WHERE user_id = ? AND match_id IN (
        SELECT match_id FROM carpool_offers WHERE user_id = ?
      )`
    ).run(npcId, realId);
    db.prepare('UPDATE carpool_offers SET user_id = ? WHERE user_id = ?').run(realId, npcId);

    // ─── media engagement ───────────────────────────────────────────────
    db.prepare(
      `DELETE FROM media_likes WHERE user_id = ? AND EXISTS (
        SELECT 1 FROM media_likes ml2 WHERE ml2.media_id = media_likes.media_id AND ml2.user_id = ?
      )`
    ).run(npcId, realId);
    db.prepare('UPDATE media_likes SET user_id = ? WHERE user_id = ?').run(realId, npcId);
    db.prepare('UPDATE media_views SET user_id = ? WHERE user_id = ?').run(realId, npcId);
    db.prepare('UPDATE media_comments SET user_id = ? WHERE user_id = ?').run(realId, npcId);

    // ─── badges ─────────────────────────────────────────────────────────
    const npcBadges = db.prepare('SELECT badge_id, earned_at FROM user_badges WHERE user_id = ?').all(npcId);
    for (const b of npcBadges) {
      db.prepare('INSERT OR IGNORE INTO user_badges (user_id, badge_id, earned_at) VALUES (?, ?, ?)').run(
        realId,
        b.badge_id,
        b.earned_at
      );
    }
    db.prepare('DELETE FROM user_badges WHERE user_id = ?').run(npcId);

    // ─── goals ───────────────────────────────────────────────────────────
    const npcGoals = db.prepare('SELECT * FROM user_goals WHERE user_id = ?').all(npcId);
    for (const g of npcGoals) {
      const realG = db.prepare('SELECT * FROM user_goals WHERE user_id = ? AND goal_id = ?').get(realId, g.goal_id);
      if (realG) {
        const progress = Math.max(realG.progress, g.progress);
        const completed = realG.completed_at || g.completed_at;
        db.prepare('UPDATE user_goals SET progress = ?, completed_at = ? WHERE id = ?').run(
          progress,
          completed,
          realG.id
        );
      } else {
        db.prepare(
          'INSERT INTO user_goals (user_id, goal_id, progress, completed_at) VALUES (?, ?, ?, ?)'
        ).run(realId, g.goal_id, g.progress, g.completed_at);
      }
    }
    db.prepare('DELETE FROM user_goals WHERE user_id = ?').run(npcId);

    // ─── roles: merge, skip duplicates ─────────────────────────────────
    const npcRoles = db.prepare('SELECT * FROM user_roles WHERE user_id = ?').all(npcId);
    const insRole = db.prepare(
      'INSERT OR IGNORE INTO user_roles (user_id, role, club_id, team_id, granted_by) VALUES (?, ?, ?, ?, ?)'
    );
    for (const r of npcRoles) {
      if (r.role === 'super_admin') continue;
      insRole.run(realId, r.role, r.club_id, r.team_id, r.granted_by === npcId ? realId : r.granted_by);
    }
    db.prepare('DELETE FROM user_roles WHERE user_id = ?').run(npcId);
    db.prepare('UPDATE user_roles SET granted_by = ? WHERE granted_by = ?').run(realId, npcId);

    db.prepare('UPDATE team_social_links SET added_by = ? WHERE added_by = ?').run(realId, npcId);

    // ─── carpool coach stats ─────────────────────────────────────────────
    const stats = db.prepare('SELECT * FROM carpool_coach_drive_stats WHERE user_id IN (?, ?)').all(npcId, realId);
    const byTeam = new Map();
    for (const s of stats) {
      const k = s.team_id;
      if (!byTeam.has(k)) byTeam.set(k, { npc: 0, real: 0 });
      const b = byTeam.get(k);
      if (s.user_id === npcId) b.npc = s.drive_count;
      else b.real = s.drive_count;
    }
    for (const [team_id, counts] of byTeam) {
      const sum = counts.npc + counts.real;
      db.prepare('DELETE FROM carpool_coach_drive_stats WHERE team_id = ? AND user_id IN (?, ?)').run(
        team_id,
        npcId,
        realId
      );
      db.prepare(
        'INSERT INTO carpool_coach_drive_stats (team_id, user_id, drive_count) VALUES (?, ?, ?)'
      ).run(team_id, realId, sum);
    }

    // ─── face references ─────────────────────────────────────────────────
    db.prepare(
      `DELETE FROM face_references WHERE user_id = ? AND file_path IN (SELECT file_path FROM face_references WHERE user_id = ?)`
    ).run(npcId, realId);
    db.prepare('UPDATE face_references SET user_id = ? WHERE user_id = ?').run(realId, npcId);

    // ─── training ───────────────────────────────────────────────────────
    db.prepare(
      `DELETE FROM training_attendance WHERE user_id = ? AND session_id IN (
        SELECT session_id FROM training_attendance WHERE user_id = ?
      )`
    ).run(npcId, realId);
    db.prepare('UPDATE training_attendance SET user_id = ? WHERE user_id = ?').run(realId, npcId);

    db.prepare('UPDATE training_exercises SET created_by_user_id = ? WHERE created_by_user_id = ?').run(
      realId,
      npcId
    );

    // ─── XP / profile fields on real user ────────────────────────────────
    const newXp = real.xp + (npc.xp || 0);
    db.prepare(
      `UPDATE users SET
        xp = ?,
        club_id = COALESCE(club_id, ?),
        team_id = COALESCE(team_id, ?),
        avatar_url = COALESCE(avatar_url, ?)
      WHERE id = ?`
    ).run(newXp, npc.club_id, npc.team_id, npc.avatar_url, realId);
    recalcLevel(db, realId);

    db.prepare(
      'INSERT INTO npc_merge_history (merged_to_user_id, npc_snapshot_json) VALUES (?, ?)'
    ).run(realId, JSON.stringify(snapshot));

    db.prepare('DELETE FROM users WHERE id = ?').run(npcId);
  });

  run();
}

/**
 * Recreate an NPC user from a merge snapshot (before deleting the real user).
 * Returns new NPC user id.
 */
async function recreateNpcFromSnapshot(snapshotJson) {
  const db = require('../db/db');
  const snap = typeof snapshotJson === 'string' ? JSON.parse(snapshotJson) : snapshotJson;
  const dummyHash = await bcrypt.hash(`npc-restore-${Date.now()}-${Math.random()}`, 10);

  const result = db
    .prepare(
      `INSERT INTO users (
        name, email, password_hash, club_id, team_id, xp, level, role, is_npc,
        avatar_url, anonymous_mode
      ) VALUES (?, ?, ?, ?, ?, 0, 1, 'player', 1, ?, 0)`
    )
    .run(
      snap.name,
      snap.email,
      dummyHash,
      snap.club_id ?? null,
      snap.team_id ?? null,
      snap.avatar_url || null
    );
  const newId = result.lastInsertRowid;

  for (const m of snap.team_memberships || []) {
    db.prepare(
      `INSERT INTO team_memberships (team_id, user_id, membership_type, shirt_number, position, added_by)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      m.team_id,
      newId,
      m.membership_type || 'player',
      m.shirt_number ?? null,
      m.position || null,
      m.added_by || null
    );
  }

  return newId;
}

module.exports = {
  canMergeNpcAccount,
  mergeNpcIntoUser,
  recreateNpcFromSnapshot,
};
