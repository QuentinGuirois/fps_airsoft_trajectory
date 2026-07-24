# Prompt Codex — F.A.T. Radar : schéma, import sécurisé et test de charge local

Tu interviens sur le dépôt **fps_airsoft_trajectory**. Le site est déjà en PHP/MariaDB (Plesk) avec une authentification, des rôles, des protections CSRF/Turnstile et une carte Radar en cours d’intégration. Travaille d’abord localement ; ne déploie aucune donnée publique et ne modifie pas la production avant d’avoir produit un rapport de vérification.

## Livrables fournis

- `fat-radar-events-seed-2026-07-24.json` : 46 événements publics français capturés le 24 juillet 2026.
- `fat-radar-events-review-2026-07-24.xlsx` : tableau de relecture humaine.

Le JSON est un lot de **brouillons administrateur**, pas une source à publier en masse. Les sources `primary` ont une page associative, de billetterie ou de terrain ; les sources `secondary` viennent d’un agenda communautaire et doivent impérativement être recontrôlées avant toute publication.

## Objectif

Préparer une fondation robuste pour que le compte administrateur existant puisse importer, modifier, supprimer et éventuellement publier des parties sur le Radar de France. Les futurs organisateurs pourront ensuite créer un compte, proposer une partie et revendiquer une fiche, mais ce flux ne doit pas être ouvert au public dans ce lot de travail s’il n’est pas déjà prêt et sécurisé.

Le résultat doit permettre de tester honnêtement la carte avec beaucoup de marqueurs, sans inventer de vraies parties ni mettre en ligne du contenu tiers sans contrôle.

## Règles absolues

1. Lis d’abord le dépôt, les migrations existantes, le schéma MariaDB local/production et les routes/API Radar existantes. Réutilise les conventions en place ; n’ajoute pas de tables dupliquées si l’équivalent existe déjà.
2. Ne mets jamais l’adresse e-mail administrateur dans le JSON, le dépôt, une migration, les logs, une URL ou une réponse d’API publique. L’importeur reçoit uniquement `FAT_RADAR_SEED_OWNER_EMAIL` par variable d’environnement au moment de l’exécution et résout un unique `owner_user_id` interne. Il échoue si le compte n’existe pas ou si la recherche ne renvoie pas exactement un compte.
3. Aucun e-mail, téléphone, adresse personnelle, secret ou DSN ne doit être visible dans les cards, le sitemap, le cache PWA, les logs ou les exports. Les fiches publiques exposent uniquement une URL d’inscription/contact volontairement publique.
4. Aucun événement de ce JSON ne doit être rendu public par défaut. Importer en `draft` + `admin_preview_only`, y compris les sources primaires. Une publication exige une action explicite de l’administrateur après recontrôle de la source, de la date, du lieu et des règles.
5. Ne copie ni images, ni longs textes provenant de Facebook, HelloAsso, Airsoft XP ou d’un autre site. Conserve des faits courts et une URL source.
6. Ne touche pas aux fonctions de calcul, au modèle ATP, aux comptes, à la PWA ou aux autres pages hors du besoin Radar sans raison démontrée. Conserve le design dark-only et ne rajoute pas une quatrième entrée permanente au header : le Radar reste accessible par l’overlay ou un CTA prévu.

## Schéma de données à mettre en place ou à compléter

Conçois une migration MariaDB rétrocompatible et idempotente (compatible avec la version réellement installée) et documente-la. Adapte les noms aux conventions du projet, mais couvre au minimum ces responsabilités :

- `radar_events` : identifiant interne, `owner_user_id` FK, `external_key` unique/idempotent, titre, organisateur, type d’organisateur, type de partie, terrain, début/fin, prix min/max, capacité, résumé court, URL d’inscription, statut, visibilité, statut de revendication, dates de création/modification/publication/expiration.
- Localisation séparée/structurée ou colonnes équivalentes : libellé, adresse, code postal, ville, département, `location_precision` (`street`, `locality`, `city`, `undisclosed`), statut de géocodage, latitude et longitude WGS84 en `DECIMAL(9,6)` seulement lorsqu’elles sont validées. Ne jamais créer de pin public pour `undisclosed`.
- `radar_event_sources` : URL source, URL d’inscription, niveau (`primary`/`secondary`), repère de source, dernière vérification, empreinte/fingerprint utile à la déduplication, et indication `requires_pre_publication_check`.
- Journal d’audit non public : création, import, modification, publication, annulation, suppression logique, par quel `user_id`, sans données sensibles inutiles.
- Une table/structure de revendication d’organisateur peut être préparée pour la suite (`radar_event_claims`), mais son endpoint public ne doit pas être ouvert sans vérification de propriété et modération.

Ajoute les index réellement utiles : `(status, visibility, starts_at)`, `owner_user_id`, `external_key`, ville/département et éventuellement coordonnées. Vérifie les clés étrangères, encodage `utf8mb4`, contrôles applicatifs et compatibilité MariaDB plutôt que de supposer que les `CHECK` sont suffisants.

## Permissions et sécurité

- Un utilisateur ne voit/modifie/supprime que ses propres brouillons et fiches ; un administrateur a la modération globale. Toutes les écritures sont protégées par session serveur, autorisation côté serveur et CSRF.
- Ne t’appuie jamais sur un `owner_id`, `status` ou `visibility` envoyé par le navigateur : ces champs sont imposés côté serveur selon le rôle et le flux.
- Les API publiques ne retournent que des fiches `published` + `public`, jamais les brouillons, coordonnées non destinées au public, sources privées, informations de contact, logs ou identifiants internes inutiles.
- Le sitemap, les métadonnées SEO, le cache PWA et les réponses HTTP publiques excluent les brouillons/prévisualisations.
- Valide, normalise et limite toutes les entrées ; échappe le rendu HTML ; rejette les URL non `https` ou non autorisées selon la politique existante ; ajoute du rate limiting aux écritures et aux recherches de géocodage.
- Prévois la suppression logique/restauration si c’est cohérent avec l’existant ; ne supprime physiquement les données que dans une tâche d’administration explicitement documentée.

## Géolocalisation : précision obligatoire

Les coordonnées ne sont volontairement pas présentes dans le JSON. Implémente le géocodage **côté serveur uniquement** avec l’API officielle IGN Géoplateforme actuelle : `https://data.geopf.fr/geocodage/search/`.

- Cache et limite les appels ; ne géocode jamais directement depuis le navigateur.
- Compare la réponse avec la ville et le code postal attendus. Si la réponse est ambiguë, incohérente, absente ou si le lieu est `undisclosed`, définis `geocode_status=needs_review`, n’enregistre pas de coordonnée utilisable publiquement et n’affiche pas de pin précis.
- `street` / `locality` : pin exact uniquement après contrôle concordant.
- `city` : marqueur visiblement approximatif à l’échelle de la ville, jamais présenté comme l’adresse du terrain.
- Carte : Leaflet et assets locaux, GeoJSON France local, sans CDN ni API de tuiles externe. Conserve `latitude/longitude` en WGS84 et ne stocke jamais une position écran.

## Importeur de semences

Crée un outil CLI PHP sécurisé, hors de `httpdocs` ou impossible à appeler via HTTP, par exemple `server/tools/import-radar-events.php` (adapte au dépôt). Il doit :

1. Accepter un chemin de JSON connu, `--dry-run`, `--owner-email-env=FAT_RADAR_SEED_OWNER_EMAIL`, `--geocode`, et un mode explicite de prévisualisation ; ne jamais accepter de publication automatique.
2. Valider le schéma avant toute écriture, rejeter les champs inconnus dangereux, vérifier les types/dates/URLs, et consigner un rapport par ligne sans secret.
3. Résoudre le compte propriétaire avec la variable d’environnement, obtenir son `user_id`, puis ne stocker que cet identifiant.
4. Être idempotent : réexécution sans créer de doublon via `external_key` + source ou la stratégie équivalente validée dans le schéma.
5. Importer tous les enregistrements avec `status=draft`, `visibility=admin_preview_only`, `requires_pre_publication_check=1` et une provenance/audit d’import.
6. Géocoder uniquement les entrées ayant une requête autorisée ; appliquer strictement la règle de précision ci-dessus.
7. Afficher un bilan : créations, mises à jour, ignorés, erreurs de validation, géocodages validés, géocodages à revoir, et événements sans pin public. En `--dry-run`, aucune écriture n’est permise.

Documente les commandes en employant un placeholder (`FAT_RADAR_SEED_OWNER_EMAIL=…`) sans donner ni consigner de valeur réelle.

## Back-office Radar

Dans l’espace personnel, crée ou complète une section « Mes parties » :

- liste filtrable de ses fiches avec statut, source, date, précision du point, dernier contrôle et lien de prévisualisation ;
- création/édition/suppression de ses propres fiches ;
- carte de prévisualisation avec badge clair « position approximative » lorsque nécessaire ;
- pour l’administrateur : filtres par source primaire/secondaire, état de vérification, géocodage, statut, action de publication explicite et éventuellement une action groupée qui exige confirmation ;
- jamais de “0 €”, “0 J”, fausse capacité ou règle inventée : un champ absent reste absent de la card.

À ce stade, ne crée ni QR de chrony, ni OCR, ni module « préparer ma réplique » : ils sont hors périmètre.

## Test de charge local, sans faux contenu en production

Ajoute un générateur de **200 fixtures déterministes locales** pour tester clustering, navigation clavier, mobile et fluidité de la carte. Exigences :

- `is_fixture=1`, propriétaire fictif/dev, visibilité privée, pas de sitemap/PWA/cache public ;
- les migrations ou scripts de production doivent refuser ces fixtures et échouer s’ils détectent une tentative d’import en production ;
- tests avec 1, 10, 50 et 200 marqueurs ; vérifie que les popups/cards restent accessibles et que la carte n’émet aucun appel vers un service de tuiles/CDN ;
- les 46 vrais brouillons restent distincts des fixtures.

## Tests à écrire/exécuter

Ajoute des tests automatisés adaptés au stack existant et exécute-les localement :

- migration sur une base MariaDB de test ;
- validation du JSON, `--dry-run`, idempotence, échec sans propriétaire unique ;
- interdiction de publication automatique des sources secondaires et primaires ;
- contrôle de la précision de localisation et absence de pin pour un lieu non communiqué ;
- RBAC : accès propriétaire, refus d’accès d’un autre compte, accès admin ;
- CSRF, validation des URL et absence d’e-mail dans la réponse API publique ;
- exclusion des brouillons/fixtures du sitemap, du cache PWA et des endpoints publics ;
- rendu de la carte à 200 fixtures sans erreur console ni appel CDN.

## Production : préparer, ne pas brûler les étapes

Après succès local seulement :

1. Rédige `docs/radar-import.md` et une procédure Plesk/MariaDB de migration/retour arrière.
2. Inspecte le schéma de production en lecture seule et compare-le aux migrations locales.
3. Prépare une sauvegarde vérifiable de la base et des fichiers concernés hors de la racine web.
4. Propose la commande de migration et la commande `--dry-run` à exécuter sur le serveur, mais n’importe pas et ne publie aucune partie tierce sans validation explicite de l’administrateur.
5. À la fin, fournis un rapport concis : fichiers changés, migration exacte, résultats des tests, état du géocodage, nombre de brouillons et instructions d’import/revue.

Commence par un état des lieux du dépôt puis implémente progressivement. Ne remplace ni ne casse les changements existants.
