-- Extensions requises. uuidv7() est natif depuis PostgreSQL 18 : aucune extension nécessaire.

-- +goose Up
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS citext;

-- +goose Down
-- postgis n'est volontairement pas supprimé : l'image postgis/postgis l'installe d'office,
-- avec des extensions qui en dépendent (postgis_topology, tiger), et il peut préexister sur
-- une base managée. Le supprimer casserait d'autres objets.
DROP EXTENSION IF EXISTS citext;
