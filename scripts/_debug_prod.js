const db = new (require('better-sqlite3'))('/app/data/volleyball.db');
const r = db.prepare(`
  SELECT mm.id, mm.match_id, mm.created_at, mm.file_type,
         p.team_id, t.display_name as team
  FROM match_media mm
  LEFT JOIN posts p ON p.id = mm.post_id
  LEFT JOIN teams t ON t.id = p.team_id
  WHERE mm.created_at >= datetime('now', '-2 days')
  ORDER BY mm.created_at
`).all();
console.log(JSON.stringify(r, null, 2));
