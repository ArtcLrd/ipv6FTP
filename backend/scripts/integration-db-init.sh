#!/bin/sh
set -eu

# Official image creates POSTGRES_USER and POSTGRES_DB before init scripts.
[ "${POSTGRES_USER:-}" = postgres ] || {
  echo 'Refusing unexpected isolated-cluster bootstrap user' >&2
  exit 1
}
[ "${POSTGRES_DB:-}" = postgres ] || {
  echo 'Refusing unexpected integration maintenance database' >&2
  exit 1
}
: "${IPV6FTP_TEST_ROLE_PASSWORD:?missing test-role password}"
: "${IPV6FTP_TEST_FIXTURE_TOKEN:?missing independent fixture identity token}"

psql --username postgres --dbname postgres --set=ON_ERROR_STOP=1 \
  --set=test_password="$IPV6FTP_TEST_ROLE_PASSWORD" \
  --set=fixture_token="$IPV6FTP_TEST_FIXTURE_TOKEN" <<'SQL'
CREATE ROLE ipv6ftp_auto_test LOGIN CREATEDB NOSUPERUSER NOCREATEROLE NOREPLICATION PASSWORD :'test_password';
CREATE TABLE public.ipv6ftp_integration_fixture (
  fixture_token text PRIMARY KEY,
  purpose text NOT NULL CHECK (purpose = 'disposable integration cluster')
);
INSERT INTO public.ipv6ftp_integration_fixture (fixture_token, purpose)
VALUES (:'fixture_token', 'disposable integration cluster');
REVOKE ALL ON public.ipv6ftp_integration_fixture FROM PUBLIC;
GRANT CONNECT ON DATABASE postgres TO ipv6ftp_auto_test;
GRANT USAGE ON SCHEMA public TO ipv6ftp_auto_test;
GRANT SELECT ON public.ipv6ftp_integration_fixture TO ipv6ftp_auto_test;
CREATE DATABASE ipv6test_schema_source OWNER ipv6ftp_auto_test;
CREATE DATABASE ipv6test_schema_restore OWNER ipv6ftp_auto_test;
COMMENT ON DATABASE ipv6test_schema_source IS 'ipv6ftp-schema-baseline-source';
COMMENT ON DATABASE ipv6test_schema_restore IS 'ipv6ftp-schema-baseline-restore';
SQL
