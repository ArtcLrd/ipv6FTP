-- Run this once with a PostgreSQL role-admin account before granting the app
-- database URLs to services. Set passwords with ALTER ROLE from your secret
-- manager or psql variables; do not commit credentials here.

DO $$
BEGIN
    IF to_regrole('ipv6ftp_owner') IS NULL THEN
        CREATE ROLE ipv6ftp_owner NOLOGIN;
    END IF;
    IF to_regrole('ipv6ftp_migrator') IS NULL THEN
        CREATE ROLE ipv6ftp_migrator LOGIN;
    END IF;
    IF to_regrole('ipv6ftp_api') IS NULL THEN
        CREATE ROLE ipv6ftp_api LOGIN;
    END IF;
    IF to_regrole('ipv6ftp_worker') IS NULL THEN
        CREATE ROLE ipv6ftp_worker LOGIN;
    END IF;
    IF to_regrole('ipv6ftp_readonly') IS NULL THEN
        CREATE ROLE ipv6ftp_readonly LOGIN;
    END IF;
END $$;

GRANT ipv6ftp_owner TO ipv6ftp_migrator;

ALTER DEFAULT PRIVILEGES FOR ROLE ipv6ftp_owner
    REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE ipv6ftp_owner
    REVOKE ALL ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE ipv6ftp_owner
    REVOKE ALL ON SEQUENCES FROM PUBLIC;

-- After migrations are applied, use:
-- GRANT USAGE ON SCHEMA api TO ipv6ftp_api;
-- GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA api TO ipv6ftp_api;
-- GRANT USAGE ON SCHEMA worker TO ipv6ftp_worker;
-- GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA worker TO ipv6ftp_worker;
