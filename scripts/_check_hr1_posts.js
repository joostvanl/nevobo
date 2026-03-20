const db = new (require('better-sqlite3'))('/app/data/volleyball.db');
const posts = db.prepare(`
  SELECT p.id, p.match_id, p.team_id, t.display_name as team, u.name as uploader,
         mm.created_at, mm.file_type
  FROM posts p
  LEFT JOIN teams t ON t.id = p.team_id
  LEFT JOIN users u ON u.id = p.user_id
  LEFT JOIN match_media mm ON mm.post_id = p.id
  WHERE p.team_id = 1196
  ORDER BY mm.created_at
`).all();
console.log(JSON.stringify(posts, null, 2));
