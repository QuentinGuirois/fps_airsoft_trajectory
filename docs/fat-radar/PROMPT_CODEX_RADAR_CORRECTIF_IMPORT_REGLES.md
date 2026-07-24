# Mission — corriger le lot Radar, enrichir automatiquement les fiches et rendre les filtres fiables

Travaille **uniquement en local** sur le dépôt `fps_airsoft_trajectory`. Ne déploie rien, ne lance aucune migration sur Plesk, ne publie aucune page et ne mets aucun événement en ligne. L’utilisateur ne validera pas les fiches une par une : l’extraction, le recoupement et la QA doivent être faits par le code et par tes contrôles.

## Constat à prendre comme point de départ

Le problème n’est pas une simple question de quantité de données.

1. `RadarSeedValidator.php` n’accepte actuellement que `schema_version: "1.0.0"` et rejette toute clé supplémentaire.
2. Le fichier de 40 fiches fourni précédemment est en `2.0.0` et contient `card` / `source_audit` : il est donc rejeté avant l’import.
3. `bin/import-radar-events.php` ignore les données de card et crée systématiquement les 7 règles avec l’état `not_communicated`. C’est la cause directe des filtres vides ou faux.
4. L’ancien lot v1 contient seulement 11 fiches avec `source_url + registration_url + code postal`, d’où le chiffre annoncé. Ce n’est pas le bon critère métier : un lien officiel d’association est recevable même quand il n’y a pas de billetterie distincte.

Les fichiers corrigés à utiliser sont :

- `outputs/09117ad5c813/radar-remediation-2026-07-24/fat-radar-events-seed-2026-07-24.importable-v1.json`
- `outputs/09117ad5c813/radar-remediation-2026-07-24/fat-radar-official-rule-enrichment-worklist-2026-07-24.json`
- `outputs/09117ad5c813/radar-remediation-2026-07-24/fat-radar-import-coverage-audit-2026-07-24.json`

Le lot importable contient 40 événements, 40 liens sources officiels, 32 codes postaux, 22 adresses + codes postaux et 40 candidats de géocodage. Les 16 événements dont la source ne donnait qu’un jour ont été normalisés en événement « date seule » sans inventer d’horaire.

## Objectif produit non négociable

Chaque card doit afficher les informations utiles à un joueur : CQB, DMR, sniper, grenades détonantes, grenades CO₂, fumigènes et énergie lorsqu’elle est réellement publiée. Tous les libellés restent visibles. Une information absente est affichée `NC` et **ne doit jamais devenir une coche, une croix, un 0 ou une interdiction par défaut**.

L’utilisateur ne fait pas de contrôle manuel. En revanche, le système ne doit jamais inventer une règle : ce qui n’est pas retrouvé dans une source officielle devient `NC`.

## 1 — Faire évoluer le contrat d’import sans casser le v1

Garde la compatibilité de lecture avec les lots `1.0.0` existants. Ajoute un contrat versionné, par exemple `1.1.0`, pour un lot enrichi contenant pour chaque événement une matrice `rules` de **sept** entrées exactes :

```json
{
  "type": "dmr",
  "state": "specific",
  "joules": 1.9,
  "details": "Semi uniquement ; distance d’engagement 20 m.",
  "evidence": {
    "url": "https://source-officielle.example/reglement",
    "locator": "Règlement — DMR",
    "excerpt": "Résumé court et factuel de la règle publiée.",
    "scope": "event",
    "checked_at": "2026-07-24T12:00:00+02:00"
  }
}
```

Types obligatoires, sans doublon :

```text
assault, dmr, sniper, cqb, detonating_grenades, co2_grenades, smoke_grenades
```

États autorisés :

```text
allowed, specific, forbidden, not_communicated
```

Règles de validation :

- `allowed`, `specific` ou `forbidden` exigent une preuve officielle : URL HTTPS, repère, date de contrôle et résumé court.
- `joules` est `null` sauf si la valeur est explicitement publiée ; ne convertis pas des FPS en joules sans grammage de référence explicite.
- `not_communicated` a `joules: null`, `details: "NC"` et aucune déduction métier.
- Une règle générale d’association peut être utilisée seulement si elle est explicitement applicable à l’événement ; indique alors `scope: "organizer_general"`. Une règle issue de la page de l’événement est `scope: "event"`.
- Ne stocke ni e-mail ni téléphone copié depuis les sources.

Choisis une migration MariaDB propre permettant de conserver la preuve par règle (colonnes dédiées ou table d’évidence liée). Elle doit être indexée et compatible MariaDB/Plesk. Ne remplace pas une règle connue par une valeur inconnue lors d’un réimport involontaire.

## 2 — Recherche automatique et traçable pour les 40 événements

Traite les 40 entrées du worklist, sans demander de validation à l’utilisateur.

Pour chaque événement :

1. Pars de `official_source_url`, `official_registration_url` et de leurs liens officiels directs.
2. Consulte uniquement : site de l’association/terrain, page de billetterie officielle, PDF/règlement officiel, publication ou événement Facebook **officiel** quand il est publiquement accessible. N’utilise aucun annuaire concurrent comme source ou lien de sortie.
3. Cherche explicitement les puissances et les sept règles filtrables, puis les informations de card pertinentes : prix, places, âge, location, restauration, débutants, scénario, terrain et lien de contact public.
4. Enregistre la meilleure preuve courte pour chaque valeur connue. S’il n’y a aucune preuve officielle accessible, garde `NC`.
5. Ne déduis jamais « CQB autorisé » parce que le terrain est CQB, ni une puissance DMR à partir du plafond global.

Prévois une commande locale reproductible, avec cache de sources et rapport JSON/Markdown, par exemple :

```bash
php bin/enrich-radar-events.php docs/fat-radar/fat-radar-official-rule-enrichment-worklist-2026-07-24.json --offline-cache=var/radar-source-cache --output=docs/fat-radar/fat-radar-events-enriched-2026-07-24.json
```

Le nom exact importe moins que ces propriétés : délais et User-Agent respectueux, aucune tentative de contourner un login/anti-bot, cache, reprise possible, traçabilité par URL et résultat déterministe à partir du cache.

## 3 — Corriger l’importeur

Modifie `RadarSeedValidator.php` et `bin/import-radar-events.php` pour que l’import enrichi :

- crée/met à jour les sept lignes `radar_event_rules` à partir de la matrice enrichie au lieu de les écraser en `not_communicated` ;
- importe les liens officiels dans `radar_event_links` avec le bon type ;
- conserve `source_url` comme URL organisateur/source, distincte de `registration_url` ;
- ne jette pas une fiche simplement parce qu’elle n’a pas une billetterie séparée : les 5 cas sans `registration_url` doivent au minimum exposer un lien « Site organisateur ». Ne mens jamais en l’étiquetant « Inscription » ; adapte au besoin le modèle/API/critère de publication pour accepter une URL officielle correctement libellée ;
- reste transactionnel : une erreur de matrice, d’évidence ou de géocodage ne laisse pas un événement à moitié importé ;
- importe tout en brouillon privé/admin-preview en local, jamais en public.

## 4 — Carte et géocodage : juste avant tout

La présence d’un code postal ou d’une commune doit permettre un candidat de pastille, pas une pastille inventée.

- Première tentative IGN : adresse + CP + commune ; repli : CP + commune ; dernier repli : commune + département.
- Accepte un point uniquement si la réponse IGN est unique et concorde avec commune, CP lorsqu’il est connu, et département.
- Rue validée : point exact. Commune/CP : point approximatif indiqué comme tel. Réponse ambiguë : brouillon sans pastille, dans le rapport de QA.
- Ne conditionne pas l’éligibilité à une `registration_url` : `source_url` officiel suffit pour un brouillon de carte.

## 5 — Comportement des filtres et des cards

- Les filtres `rules=...` doivent retourner exclusivement `allowed` et `specific`, comme le fait déjà le contrôleur public. `not_communicated` et `forbidden` ne correspondent jamais à un filtre « autorisé ».
- Les cards montrent l’état exact : `Autorisé`, `Spécifique — voir détail`, `Interdit`, ou `NC`.
- Toutes les catégories restent affichées, y compris quand elles sont `NC`.
- Une valeur filtrable connue doit être accompagnée de son détail, et l’interface doit pouvoir ouvrir/lier la preuve officielle sans exposer de données privées.

## 6 — Tests et livrables obligatoires

Ajoute des tests locaux couvrant au minimum :

1. le lot v1 de 40 événements passe le validateur ;
2. le lot enrichi contient exactement 280 règles (40 × 7) ;
3. toute règle connue sans preuve est rejetée ;
4. `not_communicated` devient `NC` et ne passe aucun filtre d’autorisation ;
5. l’import met effectivement à jour `radar_event_rules` et ne les écrase plus ;
6. les liens organisateur sans billetterie restent visibles comme tels ;
7. le rapport de géocodage distingue point exact, point approximatif, ambigu et rejeté ;
8. un réimport est idempotent ;
9. aucune écriture de production, aucune publication publique, aucun appel Plesk.

Termine en fournissant :

- les commandes locales exécutées et leurs résultats ;
- le nombre de fiches importées, de points exacts/approximatifs/ambiguës ;
- la couverture réelle de chacune des sept règles (`known`, `NC`, `allowed`, `specific`, `forbidden`) ;
- la liste des sources officielles associées ;
- les fichiers modifiés et les tests passés.

Ne demande pas à l’utilisateur de vérifier les 40 fiches. Les seules valeurs non complétées doivent être des `NC` sourcés comme « non communiqués », jamais des hypothèses.
