CREATE TABLE forma.team_tasks (
 id uuid PRIMARY KEY, parent uuid REFERENCES forma.team_tasks, role text NOT NULL REFERENCES forma.roles,
 brief text NOT NULL, actor text NOT NULL, depth integer NOT NULL CHECK(depth BETWEEN 0 AND 3),
 created timestamptz NOT NULL DEFAULT now(), deadline timestamptz NOT NULL,
 state text NOT NULL DEFAULT 'queued', lease_until timestamptz, attempt integer NOT NULL DEFAULT 0,
 result text
);
CREATE UNIQUE INDEX one_handoff ON forma.team_tasks(parent) WHERE parent IS NOT NULL;
CREATE VIEW forma.weekly_totals AS SELECT now()-interval '7 days' AS since, now() AS until,
 (SELECT count(*) FROM forma.leads WHERE created>=now()-interval '7 days') AS leads,
 (SELECT count(*) FROM forma.tickets WHERE created>=now()-interval '7 days') AS questions;
CREATE VIEW forma.public_knowledge AS SELECT id,title,body,revision FROM forma.articles WHERE audience='public' AND valid_until>now();
GRANT SELECT,INSERT ON forma.team_tasks TO forma_studio;
GRANT SELECT ON forma.roles,forma.team_tasks,forma.weekly_totals,forma.public_knowledge TO forma_worker;
GRANT UPDATE(state,lease_until,attempt,result) ON forma.team_tasks TO forma_worker;
ALTER TABLE forma.tickets ADD COLUMN response text, ADD COLUMN reviewer text;
GRANT UPDATE(response,reviewer) ON forma.tickets TO forma_studio;
ALTER TABLE forma.telegram_events ADD COLUMN chat_id text;
GRANT INSERT(chat_id) ON forma.telegram_events TO forma_telegram;
CREATE VIEW forma.telegram_replies AS SELECT e.id,e.chat_id,t.response FROM forma.telegram_events e
 JOIN forma.tickets t ON t.channel='telegram' AND t.event_id=e.id::text
 WHERE e.state='recorded' AND e.chat_id IS NOT NULL AND t.response IS NOT NULL;
GRANT SELECT ON forma.telegram_replies TO forma_telegram;
CREATE FUNCTION forma.web_reply(k uuid) RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,forma AS $$
 SELECT response FROM forma.tickets WHERE channel='web' AND event_id=k::text
$$;
REVOKE ALL ON FUNCTION forma.web_reply(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION forma.web_reply(uuid) TO forma_web;
