# F.A.T. Radar — import administrateur et procédure Plesk

Ce document décrit la fondation d’import Radar livrée avec la migration
`database/migrations/006_radar_import_foundation.sql`. Les commandes de
production ci-dessous sont préparées pour une future fenêtre supervisée : elles
n’ont pas été exécutées pendant cette livraison.

## Garanties du flux

Le fichier JSON est la seule source machine de l’import. Le classeur XLSX reste
un support de relecture humaine. L’importeur :

- accepte uniquement un fichier `fat-radar-events-seed-AAAA-MM-JJ.json` situé
  dans `docs/fat-radar/` ;
- exige `--preview=admin` et ne possède aucune option de publication ;
- résout un unique compte administrateur actif depuis
  `FAT_RADAR_SEED_OWNER_EMAIL`, puis ne conserve que son UUID ;
- valide les clés, types, dates ISO 8601, URL HTTPS, montants, capacité et
  précision de localisation avant la première écriture ;
- crée ou met à jour par `external_key`, sans doublon ;
- impose `draft`, `admin_preview_only`, `unclaimed`,
  `requires_pre_publication_check=1` et `is_fixture=0` ;
- ne journalise ni l’adresse email du compte, ni une adresse personnelle, ni
  un secret ;
- ignore une fiche qui a déjà été relue, publiée ou sortie du flux d’import.

Le lot fourni contient 46 brouillons : 15 sources primaires et 31 secondaires.
Une source primaire n’est pas davantage publiée automatiquement qu’une source
secondaire.

## Schéma

La migration `006_radar_import_foundation.sql` complète `radar_events` avec :

- la clé externe idempotente, l’organisateur, les types de partie et de terrain ;
- les prix minimum/maximum et la capacité facultative ;
- la visibilité de fiche (`public`, `admin_preview_only`, `private`) ;
- la précision `street`, `locality`, `city` ou `undisclosed` et le statut du
  géocodage ;
- la relecture préalable, l’auteur/date du contrôle et le lot d’import ;
- le marqueur `is_fixture`.

Elle ajoute `radar_event_sources` et le squelette non exposé
`radar_event_claims`. Les actions utilisent le journal `audit_log` existant.
Les coordonnées validées sont des WGS84 `DECIMAL(9,6)`.

Les endpoints publics exigent `published + public + is_fixture=0`. Ils
n’exposent ni clé interne, ni source de travail, ni adresse exacte, ni email.
Une position `city` validée est rendue comme approximative. Une position
`undisclosed` ne possède aucune coordonnée et aucun marqueur.

## Commandes locales

Utiliser explicitement PHP 8.3 :

```bash
export FAT_CONFIG_FILE="$PWD/config/.env.local"
PHP83=/opt/homebrew/opt/php@8.3/bin/php

"$PHP83" bin/reset-local-database.php --yes
"$PHP83" bin/create-local-test-admin.php
"$PHP83" bin/migrate.php
```

Simulation sans aucune écriture :

```bash
FAT_RADAR_SEED_OWNER_EMAIL='…' "$PHP83" bin/import-radar-events.php \
  docs/fat-radar/fat-radar-events-seed-2026-07-24.json \
  --dry-run \
  --owner-email-env=FAT_RADAR_SEED_OWNER_EMAIL \
  --preview=admin
```

Import privé sans géocodage :

```bash
FAT_RADAR_SEED_OWNER_EMAIL='…' "$PHP83" bin/import-radar-events.php \
  docs/fat-radar/fat-radar-events-seed-2026-07-24.json \
  --owner-email-env=FAT_RADAR_SEED_OWNER_EMAIL \
  --preview=admin
```

Ajouter `--geocode` pour interroger l’API IGN côté serveur. Le géocodeur
compare strictement commune, code postal lorsqu’il existe, et département. Une
réponse absente, incohérente ou ambiguë devient `needs_review` sans coordonnée
publique.

État de la recette locale du 24 juillet 2026 :

- 8 correspondances strictes validées : 6 `street`, 1 `locality`, 1 `city` ;
- 38 à revoir : 6 `street`, 1 `locality`, 30 `city`, 1 `undisclosed` ;
- 38 fiches sans marqueur ; l’unique point `city` validé reste approximatif ;
- 46 brouillons privés, aucune publication.

## Fixtures de charge

Les fixtures sont déterministes, privées et réservées à une base locale
`*_test` ou `*_local` sur `127.0.0.1`/`localhost`. Le script refuse
`APP_ENV=production`.

```bash
"$PHP83" bin/generate-radar-fixtures.php --count=1 --replace
"$PHP83" bin/generate-radar-fixtures.php --count=10 --replace
"$PHP83" bin/generate-radar-fixtures.php --count=50 --replace
"$PHP83" bin/generate-radar-fixtures.php --count=200 --replace
```

Elles utilisent un propriétaire local dédié, `draft + private + is_fixture=1`.
Elles n’entrent ni dans l’API publique, ni dans le sitemap, ni dans le cache
PWA. L’administrateur peut les afficher avec le filtre « Fixtures privées ».

## Relecture et publication

Dans « Mon compte → Mes parties », l’administrateur peut filtrer par source,
contrôle, géocodage, statut et type de données. Pour un brouillon importé :

1. ouvrir la source et contrôler sa fraîcheur ;
2. confirmer la date et l’éventuelle précision date-seule ;
3. contrôler le lieu ; une ville reste explicitement approximative ;
4. contrôler les règles ; « non communiqué » est acceptable s’il est exact ;
5. enregistrer les corrections dans la fiche propriétaire ;
6. confirmer les quatre contrôles ;
7. saisir `PUBLIER` dans l’action distincte de publication.

La publication reste refusée si la source n’est pas vérifiée, si la date est
échue, si l’URL publique manque, si un lieu géocodable n’a pas de position
validée, ou si la fiche est une fixture. Une fiche `undisclosed` peut être
publiée sans marqueur uniquement après contrôle explicite et sans coordonnées.

## Recette automatisée

```bash
FAT_TEST_PHP=/chemin/vers/php-8.3 npm test
FAT_TEST_PHP=/chemin/vers/php-8.3 npm run test:radar-import
FAT_TEST_PHP=/chemin/vers/php-8.3 npm run test:radar-api
FAT_TEST_PHP=/chemin/vers/php-8.3 \
  FAT_TEST_CONFIG_FILE="$PWD/config/.env.local" \
  npm run test:browser:radar
```

La recette couvre notamment migration fraîche, validation des 46 lignes,
simulation, idempotence, propriétaire absent, non-publication, RBAC, CSRF,
confidentialité des réponses, géocodage strict, 1/10/50/200 fixtures,
clustering, clavier, console et absence de CDN.

## Préparation Plesk — ne pas exécuter sans fenêtre approuvée

### 1. Inspection en lecture seule

Cette livraison n’a pas inspecté la production. Lors d’une future fenêtre,
confirmer la version réelle et l’état des migrations sans afficher de données
utilisateur :

```bash
mariadb --defaults-extra-file=/chemin/prive/mariadb-client.cnf \
  --execute="SELECT VERSION(); SELECT version,checksum_sha256 FROM schema_migrations ORDER BY version;"
```

Vérifier que `005_radar.sql` est appliquée et que `006_radar_import_foundation.sql`
ne l’est pas encore. Comparer le checksum du fichier de la release à celui qui
sera enregistré.

### 2. Sauvegarde vérifiable

Créer la sauvegarde hors document root avec un fichier d’options MariaDB privé :

```bash
install -d -m 700 /chemin/prive/backups/fat-radar-AAAAMMJJ-HHMM
mariadb-dump --defaults-extra-file=/chemin/prive/mariadb-backup.cnf \
  --single-transaction --routines --triggers --events \
  NOM_BASE | gzip -9 > /chemin/prive/backups/fat-radar-AAAAMMJJ-HHMM/database.sql.gz
sha256sum /chemin/prive/backups/fat-radar-AAAAMMJJ-HHMM/database.sql.gz \
  > /chemin/prive/backups/fat-radar-AAAAMMJJ-HHMM/SHA256SUMS
gzip -t /chemin/prive/backups/fat-radar-AAAAMMJJ-HHMM/database.sql.gz
```

Copier également la release et le fichier de configuration privé dans la
sauvegarde avec leurs permissions, sans les placer sous la racine web.

### 3. Migration

Après validation du backup et pendant la fenêtre :

```bash
FAT_CONFIG_FILE=/chemin/prive/config/fat.env \
  /opt/plesk/php/8.3/bin/php /chemin/fat/current/bin/migrate.php
```

Le résultat attendu est `appliquée 006_radar_import_foundation.sql`. Réexécuter
la commande doit afficher `déjà appliquée` grâce à `schema_migrations`.

Contrôler ensuite uniquement les agrégats :

```sql
SELECT version FROM schema_migrations WHERE version='006_radar_import_foundation.sql';
SELECT COUNT(*) FROM radar_events WHERE record_visibility='admin_preview_only';
SELECT COUNT(*) FROM radar_events WHERE is_fixture=1;
```

Le dernier résultat doit être zéro en production.

### 4. Dry-run uniquement

Avant tout import réel :

```bash
FAT_CONFIG_FILE=/chemin/prive/config/fat.env \
FAT_RADAR_SEED_OWNER_EMAIL='…' \
  /opt/plesk/php/8.3/bin/php /chemin/fat/current/bin/import-radar-events.php \
  /chemin/fat/current/docs/fat-radar/fat-radar-events-seed-2026-07-24.json \
  --dry-run \
  --owner-email-env=FAT_RADAR_SEED_OWNER_EMAIL \
  --preview=admin
```

Ne pas lancer l’import réel ni publier de fiche sans une validation
administrative distincte.

## Retour arrière

La migration est additive et le code de la release précédente ignore les
nouvelles colonnes/tables. Le retour arrière privilégié consiste donc à :

1. remettre la release précédente avec `bin/rollback-release.sh` ;
2. conserver le schéma 006 en place ;
3. confirmer que les endpoints et la santé répondent ;
4. analyser la cause hors ligne.

Ne pas supprimer les tables/colonnes 006 à chaud : elles peuvent déjà contenir
des sources, audits ou décisions de relecture. Si un retour complet de base est
indispensable, activer la maintenance, restaurer d’abord le dump dans une base
temporaire, vérifier son checksum et ses tables, puis effectuer la restauration
supervisée depuis le backup validé. Le dump est le seul retour arrière complet
supporté ; aucune commande destructive générique n’est fournie.
