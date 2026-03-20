const db = new (require('better-sqlite3'))('data/volleyball.db');

const rows = db.prepare(`
  SELECT mm.id, mm.match_id, mm.created_at, mm.file_type,
         p.id as post_id, p.team_id, t.display_name as team_name
  FROM match_media mm
  LEFT JOIN posts p ON p.id = mm.post_id
  LEFT JOIN teams t ON t.id = p.team_id
  WHERE mm.created_at >= '2026-03-14 13:00:00'
  ORDER BY mm.created_at
`).all();
console.log(JSON.stringify(rows, null, 2));
