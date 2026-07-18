# Pack d’intégration de l’identité visuelle F.A.T.

Ce pack transforme la charte livrée par Claude en consignes exécutables par Codex pour la V3 de F.A.T.

## Recommandation

Utiliser `PROMPTS_SEQUENCE_CODEX.md`, un prompt à la fois, dans le même fil Codex et sur la même branche. Chaque lot doit être testé et validé avant le suivant. La vue 3D est volontairement isolée : elle touche au rendu, au chargement différé et au mode hors ligne, mais ne doit jamais toucher aux équations ATP.

`PROMPT_MAITRE_CODEX.md` est l’alternative pour un run autonome long capable de traiter toute l’intégration en une fois.

## Contenu

- `ANALYSE_IDENTITE_VISUELLE.md` : lecture critique du pack, arbitrages et risques techniques ;
- `PROMPT_MAITRE_CODEX.md` : prompt complet « tout-en-un » ;
- `PROMPTS_SEQUENCE_CODEX.md` : cinq prompts à lancer successivement ;
- `CHECKLIST_RECETTE.md` : contrôle final fonctionnel, visuel, PWA, SEO et anti-régression.

## Références analysées

- `charte-fat-codex.md` : source normative pour les règles visuelles ;
- `Identité F.A.T.dc.html` : maquette de référence, en particulier `3a`, `2a` à `2f`, `1a`, `1e`, `1f`, `1h` et `1i` ;
- la copie `uploads/fps-airsoft-trajectory-v3/` : photographie technique utile, mais jamais source à recopier par-dessus le dépôt courant ;
- `.thumbnail` : aperçu visuel uniquement ;
- `support.js` : infrastructure de prévisualisation de la maquette, interdite en production.

La photographie V3 fournie passe ses 38 tests. Elle contient toutefois le jeu gaz V1 à 32 produits. Si le dépôt courant contient la V2 enrichie, elle est prioritaire et doit rester strictement intacte.

## Arbitrages proposés

- Thème à trois états : `Système`, `Nuit`, `Jour`. Le choix est persistant, sans flash de mauvais thème. Sans préférence enregistrée, le système est suivi ; le repli est le thème nuit.
- La maquette de guide affichée en clair est une référence de rendu, pas une obligation de forcer tous les guides en clair contre le choix du visiteur.
- Les tags de confiance s’appliquent aux résultats calculés, données publiées, valeurs de profils et affirmations chiffrées. Les bornes techniques invisibles et les champs que l’utilisateur est en train de saisir ne reçoivent pas un badge à chaque ligne.
- Le loader ne ralentit jamais volontairement le site. Il apparaît après 300 ms, reflète le cycle réel du Worker et ne passe à 100 % qu’à la réception du résultat.
- La 3D réutilise exactement les points déjà produits par `physics-core.js` via le Worker. Aucun second moteur, coefficient ou calcul physique dans la couche de rendu.
- Aucun profil de joueur, résultat chrony ou lien social n’est inventé. La page « Tu joues avec quoi ? » ne doit être publiée que lorsque des données vérifiées existent ; sinon Codex prépare le composant et son schéma de données sans ajouter de contenu fictif au sitemap.

