CREATE SCHEMA forma;
CREATE TABLE forma.drafts (revision integer PRIMARY KEY, page jsonb NOT NULL, author text NOT NULL, created timestamptz NOT NULL DEFAULT now());
CREATE TABLE forma.releases (id text PRIMARY KEY, snapshot jsonb NOT NULL, manifest jsonb NOT NULL, created timestamptz NOT NULL DEFAULT now());
CREATE TABLE forma.site (singleton boolean PRIMARY KEY CHECK(singleton), active text REFERENCES forma.releases, previous text REFERENCES forma.releases, epoch integer NOT NULL DEFAULT 0);
INSERT INTO forma.site(singleton) VALUES (true);
CREATE TABLE forma.switches (id uuid PRIMARY KEY, target text NOT NULL REFERENCES forma.releases, old_id text REFERENCES forma.releases, base_epoch integer NOT NULL, actor text NOT NULL, status text NOT NULL CHECK(status IN ('queued','checking','live','failed')), created timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX one_switch ON forma.switches ((true)) WHERE status IN ('queued','checking');
CREATE VIEW forma.live AS SELECT r.id,r.snapshot FROM forma.site s JOIN forma.releases r ON s.active=r.id;
CREATE TABLE forma.leads (id uuid PRIMARY KEY, contact text NOT NULL, message text NOT NULL, created timestamptz NOT NULL DEFAULT now());
CREATE TABLE forma.roles (name text PRIMARY KEY, activated timestamptz NOT NULL DEFAULT now());
INSERT INTO forma.roles(name) VALUES ('developer');
CREATE TABLE forma.jobs (id uuid PRIMARY KEY, block_id text NOT NULL, revision integer NOT NULL REFERENCES forma.drafts, prompt text NOT NULL, actor text NOT NULL, status text NOT NULL DEFAULT 'queued', attempt integer NOT NULL DEFAULT 0, lease_until timestamptz, result jsonb, error text, decided_by text, applied_revision integer, created timestamptz NOT NULL DEFAULT now());
CREATE TABLE forma.articles (id uuid PRIMARY KEY, title text NOT NULL, body text NOT NULL, audience text NOT NULL CHECK(audience IN ('public','internal')), valid_until timestamptz NOT NULL, revision integer NOT NULL DEFAULT 1);
CREATE INDEX article_words ON forma.articles USING gin(to_tsvector('russian', title || ' ' || body));
CREATE TABLE forma.tickets (channel text NOT NULL, event_id text NOT NULL, question text NOT NULL, created timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(channel,event_id));
-- Public credentials can read only the active release. Writes enter through bounded functions.
CREATE FUNCTION forma.submit_lead(k uuid,c text,m text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,forma AS $$
BEGIN
 IF length(trim(c)) NOT BETWEEN 1 AND 240 OR length(trim(m)) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'invalid form'; END IF;
 INSERT INTO forma.leads VALUES(k,c,m,now()) ON CONFLICT DO NOTHING;
 IF NOT EXISTS(SELECT FROM forma.leads WHERE id=k AND contact=c AND message=m) THEN RAISE EXCEPTION 'request conflict' USING ERRCODE='23505'; END IF;
 RETURN k;
END $$;
CREATE FUNCTION forma.ask(ch text,k text,q text) RETURNS TABLE(title text,body text) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,forma AS $$
BEGIN
 IF ch NOT IN ('web','telegram') OR length(k) NOT BETWEEN 1 AND 240 OR length(q) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'invalid question'; END IF;
 INSERT INTO forma.tickets(channel,event_id,question) VALUES(ch,k,q) ON CONFLICT DO NOTHING;
 IF NOT EXISTS(SELECT FROM forma.tickets WHERE channel=ch AND event_id=k AND question=q) THEN RAISE EXCEPTION 'request conflict' USING ERRCODE='23505'; END IF;
 RETURN QUERY SELECT a.title,a.body FROM forma.articles a WHERE a.audience='public' AND a.valid_until>now() AND to_tsvector('russian',a.title||' '||a.body) @@ plainto_tsquery('russian',q) ORDER BY ts_rank(to_tsvector('russian',a.title||' '||a.body),plainto_tsquery('russian',q)) DESC,a.id LIMIT 1;
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA forma FROM PUBLIC;
