CREATE ROLE forma_telegram NOLOGIN;
GRANT USAGE ON SCHEMA forma TO forma_telegram;
GRANT EXECUTE ON FUNCTION forma.ask(text,text,text) TO forma_telegram;
CREATE TABLE forma.telegram_events (id bigint PRIMARY KEY, state text NOT NULL CHECK(state IN ('recorded','sending','sent','uncertain')), created timestamptz NOT NULL DEFAULT now());
GRANT SELECT,INSERT,UPDATE(state) ON forma.telegram_events TO forma_telegram;
GRANT SELECT ON forma.telegram_events TO forma_studio;
CREATE SCHEMA studio AUTHORIZATION forma_studio;
