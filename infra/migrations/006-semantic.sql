-- Optional on a plain PostgreSQL host. The Compose database includes the extension.
CREATE ROLE forma_search NOLOGIN;
GRANT USAGE ON SCHEMA forma TO forma_search;
GRANT SELECT ON forma.public_knowledge TO forma_search;
DO $$ BEGIN
 IF EXISTS(SELECT FROM pg_available_extensions WHERE name='vector') THEN
   CREATE EXTENSION IF NOT EXISTS vector;
   CREATE TABLE forma.article_vectors (article uuid PRIMARY KEY REFERENCES forma.articles ON DELETE CASCADE, revision integer NOT NULL, profile text NOT NULL, embedding vector NOT NULL);
   GRANT SELECT,INSERT,UPDATE ON forma.article_vectors TO forma_search;
   EXECUTE $sql$CREATE FUNCTION forma.search_public_vector(v vector, p text, min_score float)
      RETURNS TABLE(id uuid,revision integer) LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,forma,public AS $fn$
        SELECT a.id,a.revision FROM forma.articles a JOIN forma.article_vectors i ON i.article=a.id AND i.revision=a.revision
        WHERE a.audience='public' AND a.valid_until>now() AND i.profile=p AND vector_dims(v)=vector_dims(i.embedding)
          AND (1-(i.embedding <=> v))>=min_score ORDER BY i.embedding <=> v LIMIT 1
      $fn$ $sql$;
   REVOKE ALL ON FUNCTION forma.search_public_vector(vector,text,float) FROM PUBLIC;
   GRANT EXECUTE ON FUNCTION forma.search_public_vector(vector,text,float) TO forma_search;
 END IF;
END $$;
CREATE FUNCTION forma.public_citation(k uuid,ver integer) RETURNS TABLE(title text,body text) LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,forma AS $$
 SELECT title,body FROM forma.articles WHERE id=k AND revision=ver AND audience='public' AND valid_until>now()
$$;
REVOKE ALL ON FUNCTION forma.public_citation(uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION forma.public_citation(uuid,integer) TO forma_web,forma_telegram;
