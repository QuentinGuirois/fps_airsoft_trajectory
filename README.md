# F.A.T. v3 — FPS Airsoft Trajectory

Site statique, PWA et calculateur balistique airsoft en français. Le moteur reprend les relations documentées par l’Airsoft Trajectory Project de Mackila, reconstruit les coefficients de spin decay absents à partir de ses figures de référence et exécute le vol en trois dimensions dans un Web Worker.

## Démarrage

Prérequis : Node.js 20+ et Python 3 pour le serveur local.

```bash
npm test
npm run serve
```

Ouvrir <http://localhost:8080>. Ne pas ouvrir `index.html` directement : les modules ES, le Worker et le service worker nécessitent HTTP(S).

## Structure

- `physics-core.js` : coefficients ATP, intégrateur RK4, vent, zérotage et métriques ;
- `trajectory.worker.js` : exécution du calcul hors du thread principal ;
- `app.js` : interface du banc balistique, comparaisons, graphique Canvas et partage ;
- `site.js` : navigation, PWA et convertisseurs simples ;
- `gas-pressure-tool.js` : sélection, lecture directe des courbes et conversion PSI/bar ;
- `gas-pressure-app.js` : interface, URL partageable, stockage local et partage natif ;
- `data/green-gas-pressure-curves.json` : 49 produits, 35 courbes uniques et 56 températures par produit ;
- `replica-utils.js` / `data/replica-submission.schema.json` : validations et contrat privé du futur flux de soumission ;
- `database/replicas.sql` / `docs/repliques-production.md` : préparation MariaDB et protocole de publication modérée ;
- `server/background-removal/` : worker local `rembg` optionnel, asynchrone et hors requête web ;
- `outils/choisir-gaz-airsoft-pression-temperature/` : page-outil gaz, contenu et FAQ ;
- `assets/site.css` : charte et composants responsives ;
- `service-worker.js` / `manifest.webmanifest` : installation et cache hors ligne ;
- `guides/` : contenus SEO de lancement ;
- `docs/strategie-seo.md` : arborescence et plan de croissance ;
- `docs/moteur-atp.md` : décisions techniques du moteur ;
- `tests/` : tests physiques et vérification des pages/liens.

Le calculateur gaz consomme le pack V2 validé dans `docs/green-gas-research-pack-v2/`. Les variantes sèches/lubrifiées restent des produits distincts ; `curveGroupId` identifie les 35 courbes physiques partagées et `packagingOptions` décrit les formats sans modifier la pression.

## Référence ATP

Le spin interne est exprimé en tr/min, unité employée dans les graphes de Mackila. L’interface calcule automatiquement le réglage qui maximise le trajet dans l’enveloppe tendue ATP, puis propose des corrections de ±250 tr/min. Le cas de validation principal reste une bille de 0,20 g tirée à 0,98 J avec 120 000 tr/min : après une seconde, les tests vérifient environ 30 000 tr/min, `V/U ≈ 0,421` et `Cl ≈ 0,034`, conformément aux figures III-A-02 à III-A-04.

Mackila n’a pas publié les coefficients complets de son couple modifié. La formule textuelle reste disponible dans `publishedRotationalTorque()` pour audit ; le solveur utilise la loi différentielle reconstruite et documentée dans `docs/moteur-atp.md`.

## Déploiement

Copier le contenu du dossier à la racine HTTPS de `fps-airsoft-trajectory.com`. Le serveur doit :

- servir `index.html` comme index des répertoires ;
- servir `.webmanifest` avec un type JSON/manifest ;
- éviter un cache long sur `service-worker.js` ;
- autoriser les modules JavaScript ;
- conserver les URL avec slash final ou rediriger proprement vers elles.

Après déploiement : tester le Worker, l’installation PWA, une ouverture hors ligne, le partage d’un setup, toutes les URL du sitemap et les données structurées.

## Identité graphique

La future charte peut être appliquée dans le bloc `:root` au début de `assets/site.css`. Les couleurs, rayons, ombres, largeur et typographie y sont centralisés. Le SVG `assets/img/icon.svg` et l’image sociale devront être remplacés lorsque la nouvelle identité sera livrée.

## Vie privée

La V3 publique n’envoie actuellement aucun setup, profil ou photo à un serveur et ne charge aucun CDN. Les préférences sont enregistrées localement. Les briques `replica-*` préparent un futur formulaire modéré mais aucune route communautaire ni API n’est ouverte sans profil autorisé, stockage privé et recette de sécurité. Aucun outil d’analytics n’est inclus tant que le choix de mesure et sa configuration légale ne sont pas définis.

## Attribution

F.A.T. crédite explicitement Mackila et l’Airsoft Trajectory Project. Voir la page `/modele-physique-atp/` et `docs/moteur-atp.md`.
