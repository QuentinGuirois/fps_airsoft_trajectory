# F.A.T. Radar — enrichissement, import local et lot de production

L’enrichissement, la recette et la publication de contrôle décrits en premier
restent strictement locaux. Le lot enrichi du 24 juillet 2026 dispose en plus
d’un import de production ponctuel, explicitement borné par son empreinte et
par les critères décrits plus bas.

## Contrat et garde-fous

Le JSON est la source machine. Le classeur XLSX sert uniquement à la relecture.
Le validateur accepte :

- `1.0.0` : 40 événements, normalisés avec sept règles `NC` ;
- `1.1.0` : sept règles exactes par événement, avec preuve officielle
  obligatoire pour `allowed`, `specific` et `forbidden`.

Une règle `not_communicated` est toujours stockée avec `joules = null`,
`details = "NC"` et aucune preuve. Une règle connue exige une URL HTTPS, un
repère, un extrait, une portée et une date de contrôle. Aucune conversion FPS →
joules n’est faite sans référence explicite. Une plage en joules reste dans le
détail et n’est pas réduite à une valeur unique.

Les migrations concernées sont :

- `006_radar_import_foundation.sql` : provenance, preview admin, géocodage,
  idempotence et fixtures ;
- `007_radar_rule_evidence.sql` : preuve par règle et liens
  `organizer`/`registration`.

L’importeur :

- exige `--preview=admin` et un propriétaire admin fourni par environnement ;
- crée ou met à jour par `external_key` dans une transaction ;
- conserve les règles connues lors d’un réimport v1 contenant seulement `NC` ;
- distingue le site organisateur du lien d’inscription ;
- accepte les cinq événements sans billetterie séparée ;
- ne possède aucune option de publication.

## Commandes exécutées

Utiliser le binaire PHP 8.3, identique à la version de production :

```bash
export FAT_CONFIG_FILE="$PWD/config/.env.local"
PHP83=/opt/homebrew/opt/php@8.3/bin/php
```

Enrichissement officiel reproductible depuis le cache :

```bash
"$PHP83" bin/enrich-radar-events.php \
  docs/fat-radar/fat-radar-official-rule-enrichment-worklist-2026-07-24.json \
  --offline-cache=var/radar-source-cache \
  --output=docs/fat-radar/fat-radar-events-enriched-2026-07-24.json \
  --offline
```

Réinitialisation locale et compte de recette `admin / admin` :

```bash
"$PHP83" bin/reset-local-database.php --yes
"$PHP83" bin/create-local-test-admin.php
```

Simulation, import privé et géocodage :

```bash
FAT_RADAR_SEED_OWNER_EMAIL=admin@local.test "$PHP83" bin/import-radar-events.php \
  docs/fat-radar/fat-radar-events-enriched-2026-07-24.json \
  --owner-email-env=FAT_RADAR_SEED_OWNER_EMAIL \
  --preview=admin \
  --dry-run

FAT_RADAR_SEED_OWNER_EMAIL=admin@local.test "$PHP83" bin/import-radar-events.php \
  docs/fat-radar/fat-radar-events-enriched-2026-07-24.json \
  --owner-email-env=FAT_RADAR_SEED_OWNER_EMAIL \
  --preview=admin \
  --geocode \
  --qa-report=docs/fat-radar/fat-radar-geocoding-qa-2026-07-24.json
```

Publication locale après les contrôles automatiques :

```bash
"$PHP83" bin/publish-radar-import-local.php \
  docs/fat-radar/fat-radar-events-enriched-2026-07-24.json \
  --source-report=docs/fat-radar/fat-radar-events-enriched-2026-07-24.report.json \
  --geocode-report=docs/fat-radar/fat-radar-geocoding-qa-2026-07-24.json \
  --report=docs/fat-radar/fat-radar-local-publication-qa-2026-07-24.json
```

Cette dernière commande refuse une configuration non locale. Elle supprime les
fiches non conformes du lot importé et rend publiques uniquement les fiches
conformes dans la base locale.

## Import de production ponctuel du lot enrichi

Le déploiement transporte le contenu du JSON enrichi dans un fichier PHP sans
sortie HTTP, sous `database/seeds/`, lui-même protégé par `Require all denied`.
Le JSON brut et les rapports de travail restent exclus de l’archive.

L’import ne s’exécute qu’en l’absence du marqueur privé associé à l’empreinte
SHA-256
`a1d2d8773e032fca8c3b55506229bcdc9f53484136be44d1bb4951d1e76c52d7`.
Il applique successivement :

1. validation stricte du contrat `1.1.0` et de ses 280 règles ;
2. contrôle des doublons internes et des collisions avec toutes les fiches
   existantes, y compris les brouillons invisibles ;
3. exigence d’une ville ou d’un code postal et d’un lien source HTTPS ;
4. import transactionnel en preview admin et géocodage IGN ;
5. publication transactionnelle des seules fiches ayant un point validé, sept
   règles et un lien organisateur ;
6. contrôle HTTPS des 40 slugs attendus après activation.

La commande de publication refuse toute écriture hors
`APP_ENV=production`, exige l’empreinte exacte, ne supprime aucune fiche
existante et conserve les règles absentes à `NC`. En cas de collision ou
d’échec avant publication, aucune fiche du lot ne devient publique. Le
déploiement restaure également la release précédente.

Pour ce lot, les 40 fiches possèdent une ville et un lien HTTPS ; 32 possèdent
également un code postal. Le critère de production est donc « code postal ou
ville », et non l’ancien contrôle local plus strict qui supprimait les huit
fiches sans code postal.

## Résultats du 24 juillet 2026

Le lot d’entrée contient 40 événements et 40 liens sources officiels. Il ne
contient toutefois que 32 codes postaux explicites. La règle produit demandée
est stricte : absence de code postal = suppression.

Recherche officielle :

- 45 URL officielles uniques ;
- 57 observations HTTP : 35 réponses `200`, 21 réponses `403` protégées et une
  réponse `404` ;
- aucun contournement des protections ; les informations inaccessibles restent
  `NC` ;
- 280 règles importées, dont 3 connues avec preuve et 277 `NC`.

Géocodage IGN :

- 8 points exacts ;
- 32 points approximatifs ;
- 0 ambigu ;
- 0 rejeté.

Publication locale finale :

- 32 fiches visibles ;
- 8 fiches supprimées, toutes sans code postal explicite ;
- la réponse `404` reste signalée dans l’audit mais n’est pas un critère
  d’exclusion, conformément à la consigne de ne pas vérifier les liens ;
- 0 fixture et 0 fiche de recette visible ;
- les quatre événements conformes sans billetterie séparée conservent un lien
  « Site organisateur » ; le cinquième a été supprimé faute de code postal.

Couverture des règles sur le lot de 40 :

| Règle | Connues | NC | Autorisé | Spécifique | Interdit |
|---|---:|---:|---:|---:|---:|
| Assaut | 0 | 40 | 0 | 0 | 0 |
| DMR | 1 | 39 | 0 | 1 | 0 |
| Sniper | 2 | 38 | 0 | 2 | 0 |
| CQB | 0 | 40 | 0 | 0 | 0 |
| Grenades détonantes | 0 | 40 | 0 | 0 | 0 |
| Grenades CO₂ | 0 | 40 | 0 | 0 | 0 |
| Fumigènes | 0 | 40 | 0 | 0 | 0 |

La liste exhaustive des sources, leurs statuts HTTP et leurs rôles se trouve
dans `fat-radar-events-enriched-2026-07-24.report.md`.

## Tests

```bash
FAT_TEST_PHP="$PHP83" npm test
FAT_TEST_PHP="$PHP83" FAT_TEST_CONFIG_FILE=config/.env.local \
  npm run test:radar-import
FAT_TEST_PHP="$PHP83" FAT_TEST_CONFIG_FILE=config/.env.local \
  npm run test:radar-api
```

La recette couvre le lot v1, les 280 règles, la preuve obligatoire, la
sémantique stricte de `NC`, les liens organisateur, l’idempotence, le
géocodage, les filtres et l’absence de toute publication distante.
