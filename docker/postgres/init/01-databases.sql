-- Pyrite - creates the test database on fresh instances.
-- Runs only on first init of an empty postgres volume (docker-entrypoint-initdb.d).
-- Production DB 'pyrite' is created by POSTGRES_DB env.
CREATE DATABASE pyrite_test WITH OWNER = pyrite;