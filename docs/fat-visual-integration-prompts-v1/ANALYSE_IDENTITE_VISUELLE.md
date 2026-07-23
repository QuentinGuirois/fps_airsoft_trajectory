# Analyse de l’identité visuelle F.A.T.

## Verdict

La direction est forte, cohérente avec le produit et suffisamment distinctive pour devenir reconnaissable dans la communauté airsoft. Elle ne se contente pas d’ajouter une peau « militaire » : elle crée une grammaire de preuve. L’olive structure, l’acide signale une action ou une mesure, les couleurs secondaires distinguent les comparaisons et les badges rendent visible la provenance d’une valeur.

Le meilleur élément est la convergence entre marque et fonction : la bille, la courbe ATP et le sol pointillé racontent immédiatement ce que fait F.A.T. Le loader reprend le même signe sans introduire un univers graphique parallèle. Le cockpit, les cartes opérateur et les guides partagent eux aussi les mêmes codes.

## Ce qui est déjà très bien défini

1. Une palette sémantique, pas seulement décorative.
2. Une hiérarchie typographique claire : Saira pour l’impact, Inter pour lire, IBM Plex Mono pour les données, Saira Stencil One pour le marquage.
3. Un logo simple, compressible en favicon et réutilisable dans le loader.
4. Un principe responsive adapté au vrai produit : graphe panoramique, métriques visibles et réglages au-dessous.
5. Une distinction éditoriale utile entre `MESURÉ`, `INTERPOLÉ`, `ESTIMÉ`, `EXTRAPOLÉ` et `DÉCLARÉ`.
6. Un template d’outil SEO suffisamment générique pour les futurs calculateurs.
7. Une attribution Mackila pensée comme un composant visible, pas comme une note perdue dans le footer.

## Écarts entre la maquette et la V3 fournie

### Thème

La V3 est uniquement sombre et fixe `color-scheme: dark`. Elle ne propose aucun sélecteur ni préférence locale de thème.

Le rendu sombre doit rester cohérent dans le Canvas de trajectoire, les SVG, les `meta theme-color`, le manifeste et les scènes 3D.

Arbitrage : conserver le thème sombre unique sans aucune logique de sélection.

### Loader

Le rendu `3a` est une excellente spécification visuelle, mais son code n’est pas du code de production : les interpolations `{{ ... }}` et la classe `DCLogic` dépendent de `support.js`. Ce fichier ne doit jamais entrer dans F.A.T.

L’animation CSS peut être reprise en vanilla (`offset-path`, trait SVG, bille, point clignotant), avec un repli si le motion path n’est pas disponible. La progression doit être raccordée à la vraie requête : délai d’apparition de 300 ms, plafond à 99 %, 100 % uniquement à la réponse du Worker, puis fermeture propre. Aucun délai artificiel ne doit être ajouté pour « montrer » le loader.

### Polices

Seule Inter est actuellement embarquée. La maquette charge les autres familles depuis Google Fonts, alors que la PWA interdit les CDN.

Il faut récupérer des fichiers WOFF2 officiels, les auto-héberger, conserver les licences OFL, déclarer uniquement les graisses réellement utilisées et ajouter les fichiers au cache de l’application. Un repli système doit conserver une mise en page correcte avant le chargement.

### Logo et PWA

Le logo actuel n’est pas l’option `1a`. Le manifeste utilise un SVG comme icône `any maskable` et une image sociale carrée comme seconde icône. L’intégration doit produire des actifs dédiés : SVG principal, favicon, PNG 192 et 512, et une vraie icône maskable avec zone de sécurité. L’image Open Graph doit aussi adopter la nouvelle identité sans devenir l’icône d’application.

### Graphe 2D

Le Canvas actuel fonctionne et est testé, mais il emploie l’ancienne palette et le même traitement de trait pour toutes les séries. La maquette demande notamment :

- courbe active acide plus épaisse ;
- comparaisons fines et pointillées ;
- ligne de visée distincte ;
- enveloppe ATP ±15,24 cm ;
- marqueurs portée utile et impact ;
- exagération verticale annoncée ;
- format réellement panoramique.

Ces ajouts doivent rester une transformation de rendu des résultats existants. Les autres onglets — énergie, dérive, rotation, écart de visée — doivent continuer à fonctionner et ne pas recevoir artificiellement l’enveloppe ATP.

### Vue 3D

La maquette est conceptuelle : aucun module Three.js n’est fourni. L’implémentation doit donc être un lot séparé, chargé uniquement à la demande, auto-hébergé avec sa licence et ajouté au service worker. Elle doit consommer les points du dernier résultat du Worker, jamais recalculer une trajectoire.

Le plein écran paysage mobile est une intention, pas une garantie de plateforme : l’API d’orientation peut être refusée. Il faut demander le verrouillage après entrée en plein écran, accepter l’échec et proposer une interface encore utilisable en portrait.

### Répétition du HTML

Les headers et footers sont dupliqués dans les pages statiques. Cela rend la migration de logo, navigation et thème sujette aux oublis. Une génération statique pourrait résoudre le problème plus tard, mais l’intégration ne doit pas introduire un framework uniquement pour cela. À court terme, un test de cohérence des fragments communs est préférable.

### Données gaz

La copie incluse dans le pack visuel correspond à une photographie V1 de 32 produits. Elle ne doit jamais remplacer un jeu de données plus récent. L’intégration graphique doit relever avant modification le nombre de marques, produits et points, puis prouver qu’ils sont identiques après modification.

## Sources à ne pas copier en production

- `support.js` ;
- `.thumbnail` ;
- les liens Google Fonts de la démo ;
- les styles inline de la maquette tels quels ;
- la copie complète du projet placée sous `uploads/` ;
- les noms, statistiques et citations de profils opérateur lorsqu’ils ne correspondent pas à des personnes et mesures vérifiées.

## Architecture d’intégration recommandée

### Couche 1 — fondations

Tokens, polices, thèmes, initialisation sans flash, logo, actifs PWA, composants de base et loader.

### Couche 2 — pages

Header, hero, strips, cartes, guides, page outil gaz, page À propos et bloc d’attribution réutilisable.

### Couche 3 — cockpit 2D

Disposition sticky, Canvas thémable, enveloppe ATP, marqueurs, comparaisons et responsive.

### Couche 4 — vue drone 3D

Chargement différé, partage du même état, WebGL progressif, plein écran mobile et réduction des animations.

### Couche 5 — recette

Tests, captures multi-formats, navigation clavier, PWA hors ligne, audit SEO et contrôle des données.

## Critères qui empêchent une fausse réussite

- Le thème change aussi le Canvas, les SVG, la barre du navigateur et les composants chargés après coup.
- La page ne clignote pas en sombre avant de devenir claire.
- Le loader n’affiche jamais 100 % avant une vraie réponse et ne masque pas une erreur.
- Le fallback sans Worker continue de fonctionner.
- Le fallback sans WebGL conserve tout le simulateur 2D.
- Le choix du thème, les paramètres de tir et les paramètres URL restent indépendants.
- Les anciennes URL `m`, `j`, `h`, `rpm`, `z`, `w`, `wd`, `t`, `p`, `a`, `c` restent lisibles.
- Le jeu de données gaz, les tests ATP, le contenu SEO et les données structurées ne régressent pas.
- Aucun appel de police, script, texture ou module externe n’est nécessaire en production.
