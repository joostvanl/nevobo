-- Markeer alle gebruikers met een @vtcwoerden.nl e-mailadres als NPC (placeholder).
--
-- Deploy: dezelfde UPDATE draait automatisch bij elke serverstart
-- (server/db/db.js); na een productie-deploy is de database dus bijgewerkt
-- zodra de container/app herstart.
--
-- Handmatig uitvoeren (lokaal/audit), bijv.:
--   sqlite3 data/volleyball.db < scripts/mark-npc-vtcwoerden-email.sql
--
-- Let op: iedereen met dit domein wordt NPC, ook echte accounts op dat adres.

PRAGMA foreign_keys = ON;

-- Optioneel: eerst tellen
-- SELECT id, name, email, is_npc FROM users WHERE LOWER(TRIM(email)) LIKE '%@vtcwoerden.nl';

UPDATE users
SET is_npc = 1
WHERE LOWER(TRIM(email)) LIKE '%@vtcwoerden.nl'
  AND COALESCE(is_npc, 0) != 1;

-- Controle na uitvoeren:
-- SELECT id, name, email, is_npc FROM users WHERE is_npc = 1 ORDER BY email;
