# Rapport de livraison — F.A.T. // Radar

Date de recette : 23 juillet 2026

État : prêt à déployer par le workflow existant, non déployé
Cible serveur validée : PHP 8.3

## Résultat

Le lot ajoute la carte publique `/parties-airsoft/`, les URL partageables
`/parties-airsoft/<slug>/`, l’espace privé `/compte/mes-parties.html`, l’API
PHP/MariaDB, le géocodage IGN côté serveur, le signalement et la modération.
Le moteur ATP, ses données et ses URL n’ont pas été modifiés.

Le Radar ne charge aucune dépendance CDN. Leaflet 1.9.4,
Leaflet.markercluster 1.5.3 et le fond des 96 départements métropolitains sont
servis localement. Les seules données de démonstration sont créées par un script
qui refuse `APP_ENV=production`.

## Fichiers et surfaces

### Base de données et maintenance

- `database/migrations/005_radar.sql`
- `bin/maintenance.php`
- `bin/reset-local-database.php`
- `bin/seed-radar-local.php`

La migration crée `radar_events`, `radar_event_rules`, `radar_event_links`,
`radar_event_reports` et `radar_geocoding_cache`, avec clés étrangères,
contraintes, index, versions optimistes et cycle de vie complet.

### API et sécurité

- `api/src/Controllers/RadarController.php`
- `api/src/Controllers/PublicRadarController.php`
- `api/src/Controllers/RadarAdminController.php`
- `api/src/Services/GeocodingService.php`
- `api/src/Services/SensitiveData.php`
- `api/src/Validation/RadarValidator.php`
- `api/src/Application.php`
- `api/src/Request.php`
- `api/src/Database.php`
- `api/src/Controllers/UserController.php`
- `assets/js/turnstile-client.js`

Les mutations utilisent la session existante, Origin, CSRF, ownership SQL,
quotas, Turnstile lorsque requis et version optimiste. L’email de contact est
chiffré en AES-256-GCM. L’API publique ne renvoie ni adresse privée, ni email,
ni coordonnées pour une localisation approximative.

### Interfaces

- `parties-airsoft/index.html`
- `compte/mes-parties.html`
- `assets/radar.css`
- `assets/js/radar-repositories.js`
- `assets/js/radar/radar-map.js`
- `assets/js/radar/radar-entry.js`
- `assets/js/radar/my-radar-events.js`
- `assets/js/radar/mes-parties-entry.js`
- `data/radar-france-departments.geojson`
- `assets/vendor/leaflet-1.9.4/`
- `assets/vendor/leaflet.markercluster-1.5.3/`

La page publique couvre les filtres de lieu, date, rayon,
débutants, location et règles. Le briefing expose les sept règles, la dernière
mise à jour, les liens externes et le signalement. Les marqueurs exacts sont
cliquables et activables avec Entrée ou Espace ; les fiches approximatives
restent consultables en liste sans faux point ni itinéraire.

### Intégration, SEO, PWA et droit

- `.htaccess`, `robots.txt`, `service-worker.js`
- `site.js`, `compte/armurerie.html`
- `bin/build-sitemap.mjs`, `sitemap.xml`
- `politique-confidentialite/index.html`, `mentions-legales/index.html`
- `config/.env.example`
- `README.md`, `docs/radar.md`, `docs/strategie-seo.md`,
  `docs/deploiement-production.md`

Le header permanent garde ses trois liens. Le Radar rejoint le menu overlay et
le footer. Seule la page principale est indexable et présente dans le sitemap ;
les URL profondes reçoivent `noindex, follow`. Le service worker contourne
entièrement `/api/` et `/compte/`.

## Migration et commandes

```bash
FAT_CONFIG_FILE="$PWD/config/.env.local" php bin/migrate.php
```

La procédure de reset est locale, volontaire et destructive uniquement pour
une base explicitement nommée `_test` ou `_local` :

```bash
FAT_CONFIG_FILE="$PWD/config/.env.local" php bin/reset-local-database.php --yes
```

La tâche Plesk à créer ultérieurement est documentée, mais n’a pas été installée
dans ce lot.

## Recette exécutée

- PHP CLI `8.3.32`.
- Lint de tous les fichiers PHP de `api/`, `bin/` et `tests/` : réussi.
- `npm test` : **200/200** tests réussis.
- `npm run test:api` sous PHP 8.3 : réussi.
- `npm run test:radar-api` sous PHP 8.3 : réussi.
- `npm run test:browser:radar` avec Chromium/Playwright : réussi.
- Géocodeur IGN réel : `Place Jean Jaurès 37000 Tours`, réponse
  `latitude 47.3893400`, `longitude 0.6891510`, source
  `IGN Géoplateforme`.
- Audit npm : aucune vulnérabilité connue au moment de la recette finale.

La recette Radar couvre notamment création, autosauvegarde, dates, règles,
liens HTTPS, CSRF, IDOR, publication, confidentialité, filtres, cache et quota
IGN, erreurs IGN 429/503, signalement, contrôle admin, masquage/restauration,
annulation, expiration, duplication, suppression, coordonnées WGS84,
ordre longitude/latitude, état vide, URL profonde, clavier, reduced motion,
desktop et mobile.

## Captures locales

Les captures sont générées dans `output/`, répertoire volontairement ignoré par
Git :

- `output/radar-desktop.png`
- `output/radar-mobile.png`
- `output/radar-mobile-briefing.png`
- `output/radar-owner-list.png`
- `output/radar-owner-editor.png`

La comparaison avec les sections 8a à 8d de la référence visuelle a contrôlé le
fond sombre sans tuile, la France vectorielle, la console flottante desktop,
les filtres horizontaux mobile, le briefing plein écran et l’éditeur en cinq
étapes.

## Limites restantes et activation ultérieure

- Aucun relais email n’est simulé : le public utilise l’inscription et les
  liens communautaires. L’email optionnel reste privé et chiffré.
- Les événements approximatifs n’ont volontairement aucun marqueur ni
  itinéraire précis.
- Les fixtures Tours, Bordeaux, Strasbourg et Haute-Savoie sont locales
  uniquement et ne doivent pas entrer dans une sauvegarde ou release de
  production.
- L’activation production exige les variables privées, les vraies clés
  Turnstile, la migration, la tâche de maintenance et la checklist Plesk de
  `docs/deploiement-production.md`.
- Aucun fichier, cron, réglage Plesk ou donnée de production n’a été modifié.
