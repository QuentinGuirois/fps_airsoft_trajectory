# F.A.T. // Radar des parties

État de la livraison : implémentation locale complète, sans activation distante.

Le Radar ajoute deux surfaces à F.A.T. :

- `/parties-airsoft/` : carte publique des parties réellement publiées ;
- `/compte/mes-parties.html` : espace organisateur privé, en cinq étapes.

Il ne modifie ni le moteur ATP, ni ses paramètres, ni les URL existantes. Il
n’introduit aucun QR code, chronographe, OCR, upload d’affiche, faux événement
runtime ou dépendance CDN.

## Prérequis

- PHP **8.3** avec `pdo_mysql`, `mbstring`, `openssl` et `json` ;
- MariaDB compatible avec les contraintes `CHECK`, JSON et InnoDB ;
- Node.js 20+ pour les tests et la génération du sitemap ;
- HTTPS et Turnstile actif en production.

Installation locale :

```bash
npm install
FAT_CONFIG_FILE="$PWD/config/.env.local" php bin/migrate.php
npm run serve
```

`npm run serve` utilise le routeur PHP local afin de servir l’API et les URL
profondes `/parties-airsoft/<slug>/`. Le fichier `config/.env.local` est ignoré
par Git.

La réinitialisation est volontaire et très bornée :

```bash
FAT_CONFIG_FILE="$PWD/config/.env.local" npm run db:reset:local
FAT_CONFIG_FILE="$PWD/config/.env.local" npm run db:admin:local
```

La commande refuse `APP_ENV=production`, un hôte distant et une base dont le nom
ne contient pas `_test` ou `_local`. La seconde commande crée ou réinitialise le
compte de recette local `admin / admin`, vérifié et doté du rôle administrateur.
Elle révoque ses anciennes sessions et applique les mêmes garde-fous locaux.

## Modèle de données

La migration additive `database/migrations/005_radar.sql` crée :

- `radar_events` : propriétaire, slug, cycle de vie, dates UTC, fuseau
  `Europe/Paris`, capacité maximale, services, prix, WGS84, visibilité et version optimiste ;
- `radar_event_rules` : les sept familles de règles et quatre états
  (`allowed`, `specific`, `forbidden`, `not_communicated`) ;
- `radar_event_links` : inscription et liens HTTPS bornés ;
- `radar_event_reports` : signalements pseudonymisés par HMAC ;
- `radar_geocoding_cache` : cache serveur temporaire de l’IGN.

La migration `database/migrations/006_radar_import_foundation.sql` ajoute la
provenance, la clé externe idempotente, les prix min/max, la visibilité
`admin_preview_only`, la précision de localisation, les contrôles avant
publication, les fixtures privées et le squelette de revendication. La
procédure complète est décrite dans `docs/radar-import.md`.

Les événements utilisent des UUID. Les mutations propriétaire et modérateur
combinent ownership SQL, cookie HttpOnly, Origin strict, CSRF, quotas et version
optimiste. Un brouillon créé normalement par son propriétaire peut être publié
après validation serveur et Turnstile. Un brouillon importé ne suit jamais ce
chemin : il exige une relecture puis une publication administrateur explicite.

Cycle de vie :

```text
draft → published → cancelled
                  ↘ expired
draft/published/cancelled/expired → deleted → purge différée
```

Le masquage administratif est orthogonal via `moderation_state`. Une requête
publique de liste exige toujours :

```sql
state = 'published'
AND record_visibility = 'public'
AND is_fixture = 0
AND moderation_state = 'visible'
AND ends_at_utc > UTC_TIMESTAMP()
```

Le Radar reste donc exact même si la tâche de maintenance est momentanément en
retard.

## Localisation et confidentialité

L’organisateur choisit une suggestion IGN ou place manuellement un marqueur. Le
serveur exige une latitude et une longitude WGS84 valides, dans cet ordre dans
les objets applicatifs ; Leaflet reçoit explicitement `[latitude, longitude]`.
Tout déplacement invalide la confirmation et demande une nouvelle validation.

Quatre précisions de lieu existent :

- `street` et `locality` : le point validé est exact ;
- `city` : le centre validé est envoyé avec le badge et le marqueur visuel
  « position approximative », jamais comme une adresse de terrain ;
- `undisclosed` : aucune coordonnée et aucun marqueur public ;
- l’ancien mode propriétaire `approximate` conserve ses coordonnées côté privé
  lorsqu’il ne correspond pas à une précision `city`.

L’adresse exacte ne figure jamais dans les contrôleurs publics. L’email de
contact optionnel est chiffré en AES-256-GCM avec une clé dérivée de `APP_KEY`.
Il n’est ni journalisé, ni affiché, ni renvoyé par la fiche publique. L’export
RGPD du propriétaire le déchiffre dans sa propre réponse authentifiée.

Le lot n’active pas de relais email : les actions publiques proposées sont le
lien d’inscription et les liens communautaires HTTPS. Cette décision évite
d’écrire un message ou une adresse personnelle dans le mailer local ou les
journaux avant qu’un transport dédié et sa politique de rétention soient prêts.

## Géocodage IGN

Le navigateur ne contacte pas directement l’IGN. L’API privée
`GET /api/v1/me/radar-geocode?q=…` applique :

- quatre caractères minimum, 120 maximum ;
- quotas par compte et par IP ;
- six résultats maximum ;
- timeout, erreurs 429/503 propres et cache MariaDB ;
- URL officielle obligatoire en production.

URL actuelle :

```text
https://data.geopf.fr/geocodage/search/
```

Documentation officielle :

- <https://cartes.gouv.fr/aide/fr/guides-utilisateur/utiliser-les-services-de-la-geoplateforme/geocodage/>
- <https://cartes.gouv.fr/aide/fr/guides-utilisateur/utiliser-les-services-de-la-geoplateforme/limites-d-usage/>

L’API GeoJSON retourne les coordonnées dans l’ordre `[longitude, latitude]`.
`GeocodingService` les convertit immédiatement en propriétés nommées
`latitude`/`longitude`.

## Fond de carte et dépendances

La carte n’utilise aucune tuile distante. Elle charge uniquement :

- Leaflet `1.9.4`, BSD-2-Clause, vendored localement ;
- Leaflet.markercluster `1.5.3`, MIT, vendored localement ;
- `data/radar-france-departments.geojson`.

Le GeoJSON contient les 96 départements métropolitains, Corse comprise. Source :
IGN Géoplateforme, couche
`ADMINEXPRESS-COG-CARTO-PE.2026:departement`, service WFS 2.0 :

```text
https://data.geopf.fr/wfs
```

Emprise demandée : `-6,41,10,52,EPSG:4326`. Transformation locale :
Mapshaper `0.7.47`, simplification `8% keep-shapes`, précision `0.0001`.

Empreinte SHA-256 du fichier livré :

```text
d69eac1438eae532512e6ff5c4034e499ae08abbebdb5fcee357ca62c33d18f1
```

La mention IGN est affichée dans l’attribution Leaflet. Les licences des deux
bibliothèques sont reproduites dans leurs répertoires `assets/vendor/`.

## API

Routes publiques :

- `GET /api/v1/radar/events`
- `GET /api/v1/radar/events/{slug}`
- `POST /api/v1/radar/events/{slug}/report`

Routes propriétaire :

- `GET|POST /api/v1/me/radar-events`
- `GET|PATCH|DELETE /api/v1/me/radar-events/{id}`
- `POST .../{id}/publish`
- `POST .../{id}/cancel`
- `POST .../{id}/duplicate`
- `GET /api/v1/me/radar-geocode`

Routes administrateur :

- `GET /api/v1/admin/radar-events`
- `POST /api/v1/admin/radar-events/{id}/review`
- `POST /api/v1/admin/radar-events/{id}/publish`
- `GET /api/v1/admin/radar-reports`
- `POST /api/v1/admin/radar-events/{id}/hide`
- `POST /api/v1/admin/radar-events/{id}/restore`

Filtres publics disponibles : dates, commune, département, région,
débutants, location, règles, emprise et rayon. Les URLs externes
sont HTTPS uniquement et les liens rendus emploient
`noopener noreferrer ugc nofollow`.

Actions Turnstile : `radar_publish`, `radar_cancel`, `radar_delete`,
`radar_report`. Le signalement est non énumérant, contient un honeypot et ne
stocke pas l’IP brute.

Quotas applicatifs par fenêtre glissante d’une heure :

| Action | Limite |
|---|---:|
| Création de brouillons | 30 par compte et 60 par IP |
| Mise à jour / autosauvegarde | 240 par compte et 480 par IP |
| Publication | 20 par compte et 40 par IP |
| Annulation, duplication ou suppression | 30 par compte et 60 par IP, pour chaque action |
| Géocodage IGN | 120 par compte et 240 par IP |
| Signalement public | 10 par IP |
| Consultation des signalements admin | 120 par compte admin |
| Masquage ou restauration admin | 60 par compte admin |

Un compte conserve au maximum 100 fiches Radar non supprimées. Ces bornes sont
appliquées par le service de limitation existant, avec des empreintes HMAC :
aucune IP brute n’est enregistrée.

## Cache, SEO et accessibilité

Le service worker met en cache la page publique, les bibliothèques locales, le
GeoJSON et les modules de carte. Il contourne explicitement `/api/` et
`/compte/`. Les brouillons et réponses authentifiées ne rejoignent jamais le
cache.

La page principale est indexable et figure seule dans le sitemap. Les URLs
profondes servent le même shell mais reçoivent `X-Robots-Tag: noindex, follow`
via Apache ; le client met aussi à jour la balise robots. Aucun événement
dynamique n’est injecté dans le sitemap.

Les marqueurs sont activables au clavier. Le briefing restaure le focus à sa
fermeture, accepte Échap et piège le focus sur mobile plein écran. La carte
réagit aux redimensionnements et respecte `prefers-reduced-motion`.

## Maintenance et Plesk

`php bin/maintenance.php` :

- expire les parties terminées ;
- purge le cache IGN expiré ;
- purge les signalements après `RADAR_REPORT_RETENTION_DAYS` (365 par défaut) ;
- purge les fiches supprimées après `RADAR_DELETED_RETENTION_DAYS` (30 jours
  par défaut).

Dans Plesk, créer une tâche planifiée toutes les dix minutes, sous l’utilisateur
du vhost :

```bash
/opt/plesk/php/8.3/bin/php /chemin/fat/current/bin/maintenance.php
```

Vérifier le chemin PHP réel dans Plesk et fournir `FAT_CONFIG_FILE` si le fichier
privé n’est pas à l’emplacement par défaut attendu par `Config`.

Avant activation distante :

1. sauvegarder MariaDB ;
2. confirmer PHP 8.3 et les extensions requises ;
3. ajouter les variables `RADAR_*` au fichier privé ;
4. appliquer `php current/bin/migrate.php` ;
5. tester health, auth, création, géocodage, publication et masquage ;
6. vérifier le rewrite profond et `X-Robots-Tag` ;
7. vérifier CSP, Turnstile et absence de données privées dans les réponses ;
8. configurer la tâche de maintenance ;
9. contrôler la restauration de la release précédente.

Le script de seed `bin/seed-radar-local.php` refuse la production et exige
`--owner-email` vers un compte local vérifié. Il sert seulement à la recette de
Tours, Bordeaux, Strasbourg et Haute-Savoie.

## Recette

```bash
FAT_TEST_PHP=/chemin/php-8.3 npm test
FAT_TEST_PHP=/chemin/php-8.3 npm run test:api
FAT_TEST_PHP=/chemin/php-8.3 npm run test:radar-api
FAT_TEST_PHP=/chemin/php-8.3 npm run test:radar-import
npm run test:browser:radar
npm audit
```

La recette Radar vérifie notamment publication, confidentialité, filtres,
ordre des coordonnées, cache IGN, IDOR, modération, annulation, expiration,
duplication, suppression, desktop, mobile, carte redimensionnée et absence
d’erreur console/réseau.
