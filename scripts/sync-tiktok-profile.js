#!/usr/bin/env node
/**
 * TikTok profile scraper — on demand.
 * Fetches the user profile page, extracts video IDs from embedded JSON,
 * and inserts them into team_social_links so they appear in the reel player.
 *
 * Usage:
 *   node scripts/sync-tiktok-profile.js <username> --team-id=<id>
 *   node scripts/sync-tiktok-profile.js vtcwoerdenmb2 --team-id=5
 *   node scripts/sync-tiktok-profile.js vtcwoerdenmb2 --team-id=5 --dry-run
 *
 * Username: without @ (e.g. vtcwoerdenmb2).
 * Requires: data/volleyball.db and server/db/db.js (shared DB).
 */

const path = require('path');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const teamIdArg = args.find(a => a.startsWith('--team-id='));
const username = args.find(a => !a.startsWith('--'));

if (!username || !teamIdArg) {
  console.error('Usage: node scripts/sync-tiktok-profile.js <username> --team-id=<id> [--dry-run]');
  process.exit(1);
}

const teamId = parseInt(teamIdArg.replace('--team-id=', ''), 10);
if (!Number.isInteger(teamId) || teamId <= 0) {
  console.error('Invalid --team-id (must be a positive integer).');
  process.exit(1);
}

const cleanUsername = username.replace(/^@/, '').trim();
if (!cleanUsername) {
  console.error('Invalid username.');
  process.exit(1);
}

const { fetchProfileVideoIds } = require(path.join(root, 'server/lib/tiktok-scraper.js'));

async function main() {
  console.log(`Fetching profile: https://www.tiktok.com/@${cleanUsername}`);
  let videoIds;
  try {
    const out = await fetchProfileVideoIds(cleanUsername);
    videoIds = out.videoIds;
  } catch (err) {
    console.error('Fetch failed:', err.message);
    process.exit(1);
  }

  if (videoIds.length === 0) {
    console.log('No video IDs found in page. Profile may be private, or TikTok changed the page structure.');
    process.exit(0);
  }

  console.log(`Found ${videoIds.length} video(s) on profile.`);

  if (dryRun) {
    videoIds.forEach(id => console.log(`  Would add: https://www.tiktok.com/@${cleanUsername}/video/${id}`));
    console.log('Dry run — no DB changes.');
    process.exit(0);
  }

  const db = require(path.join(root, 'server/db/db.js'));
  const insert = db.prepare(
    `INSERT OR IGNORE INTO team_social_links (team_id, platform, url, embed_id, added_by)
     VALUES (?, 'tiktok', ?, ?, NULL)`
  );

  let added = 0;
  for (const id of videoIds) {
    const url = `https://www.tiktok.com/@${cleanUsername}/video/${id}`;
    const result = insert.run(teamId, url, id);
    if (result.changes > 0) added++;
  }

  console.log(`Inserted ${added} new link(s); ${videoIds.length - added} already existed.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
