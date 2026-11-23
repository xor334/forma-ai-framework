ALTER TABLE forma.switches ADD COLUMN signature text;
CREATE TABLE forma.request_windows(subject text PRIMARY KEY, minute bigint NOT NULL, count integer NOT NULL);
CREATE FUNCTION forma.allow_request(subject_key text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,forma AS $$
DECLARE window_id bigint := floor(extract(epoch FROM now())/60);
DECLARE used integer;
BEGIN
  INSERT INTO forma.request_windows VALUES(subject_key,window_id,1)
  ON CONFLICT(subject) DO UPDATE SET minute=window_id,count=CASE WHEN request_windows.minute=window_id THEN request_windows.count+1 ELSE 1 END
  RETURNING count INTO used;
  IF used=1 THEN DELETE FROM forma.request_windows WHERE minute<window_id-5; END IF;
  RETURN used<=30;
END $$;
REVOKE ALL ON FUNCTION forma.allow_request(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION forma.allow_request(text) TO forma_web;
