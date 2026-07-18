# Prompt à donner à Codex — outil Green Gas F.A.T. V3

Tu travailles dans le projet **F.A.T. V3 — FPS Airsoft Trajectory**. Commence par lire `AGENTS.md`, `README.md`, `docs/moteur-atp.md` et `docs/strategie-seo.md`, puis lance `npm test` avant toute modification.

## Mission

Construis une page complète, responsive, accessible, SEO et PWA à l’URL :

```text
/outils/choisir-gaz-airsoft-pression-temperature/
```

Cette page doit permettre à un joueur de connaître la **pression théorique estimée** d’une bouteille de gaz airsoft à la température prévue pour sa prochaine partie.

Le dossier de travail fourni contient :

- `green-gas-pressure-curves.json` : jeu de données public prêt à intégrer ;
- `green-gas-pressure-curves.csv` : version tabulaire de contrôle ;
- `README.md` : RETEX, méthode, limites et sources ;
- `build-data.mjs` et `validate-data.mjs` : génération et validation reproductibles.

Ne refais pas les calculs à partir de valeurs trouvées au hasard sur le Web. Le JSON est la source applicative. Si tu constates une anomalie, documente-la avant de modifier les données.

## Parcours utilisateur obligatoire

L’outil doit demander, dans cet ordre :

1. la température prévue pour la partie de demain ou la prochaine partie ;
2. la marque de la bouteille ;
3. le modèle précis de la bouteille, filtré selon la marque.

Le résultat principal affiche immédiatement :

- la pression théorique estimée en PSI à la température choisie ;
- l’équivalent en bar ;
- le nom complet de la bouteille ;
- sa pression commerciale d’origine ;
- la température de référence de cette pression : 20, 25 ou 30 °C ;
- le type du point : mesure fabricant, interpolation, estimation par modèle ou extrapolation ;
- un avertissement si la température est hors de la plage d’utilisation publiée ;
- les liens vers les sources attachées au produit ;
- la date de collecte du jeu de données.

La température doit être un entier avec un pas de **1 °C**, de −15 à 40 °C. Ne limite pas l’interface à des pas de 5 °C. Utilise un champ numérique accessible accompagné d’un slider, synchronisés dans les deux sens.

Les sélections doivent être partageables dans l’URL, par exemple :

```text
?t=12&brand=Nimrod%20Tactical&gas=nimrod-green-145
```

Conserve également le dernier choix dans `localStorage`, sans empêcher l’URL de rester prioritaire.

## Règles de calcul et de données

- Copie le JSON dans un emplacement statique clair, par exemple `/data/green-gas-pressure-curves.json`.
- N’affiche dans les sélecteurs que `products`, jamais `excludedCandidates`.
- Pour une température entière, utilise directement le point correspondant dans `curve` ; ne recalcule pas une deuxième courbe en JavaScript.
- Affiche `estimatedPsi` avec une décimale dans le résultat principal et garde deux décimales dans les détails.
- Conversion bar : `bar = psi / 14.5037738`.
- N’invente aucun produit, aucune compatibilité et aucune plage de température.
- Ne transforme pas `labelPsi` en valeur de calcul lorsque `referencePsi` est différente : ATM PSI110, PSI130 et PSI150 sont des cas volontaires.
- Affiche la provenance via `sourceIds` et le tableau `sources`.
- Les points `manufacturer_test_point` doivent être présentés comme « valeur publiée ».
- Les points `interpolated_manufacturer_grid` doivent être présentés comme « interpolation entre mesures publiées ».
- Les points `estimated_propane_ratio` doivent être présentés comme « estimation depuis la valeur fabricant ».
- Les points `extrapolated_propane_ratio` exigent un avertissement visuel renforcé.

## Mention obligatoire

Place cette mention sous le résultat et dans la section méthodologie :

> La pression affichée est une estimation théorique calculée à partir des valeurs publiées par les fabricants ou distributeurs. Elle ne garantit ni la pression réelle dans un chargeur, ni la compatibilité avec une réplique, ni la puissance obtenue.

Ajoute également une explication claire : la température réelle de la bouteille et du chargeur compte davantage que la seule température météo ; les tirs successifs provoquent du cooldown ; formulation, remplissage, valves, fuites et mécanique modifient la pression utile.

Ne présente jamais le résultat comme une validation de sécurité. Invite le joueur à vérifier les limites de sa réplique et à la chronographier dans ses conditions réelles d’utilisation.

## Contenu éditorial et SEO

La page ne doit pas être un outil nu. Rédige un contenu original, utile et lisible comprenant :

1. un H1 centré sur « quel gaz airsoft choisir selon la température » ;
2. une introduction courte répondant immédiatement à l’intention ;
3. l’outil au-dessus de la ligne de flottaison ;
4. « Pourquoi 145 PSI à 20 °C n’est pas 145 PSI à 25 °C » ;
5. un exemple comparant Nimrod/Powair 145 à 20 °C et Specna/NUPROL 145 à 25 °C ;
6. une explication de la méthode de normalisation ;
7. la différence entre pression de bouteille, pression dans le chargeur et puissance chronographiée ;
8. le phénomène de cooldown ;
9. silicone ou gaz sec, sans prétendre qu’un choix convient universellement ;
10. les limites et la méthodologie des sources ;
11. une FAQ répondant aux requêtes longue traîne ;
12. un CTA vers le convertisseur Joules/FPS et le simulateur de trajectoire.

Requêtes principales à couvrir naturellement :

- quel gaz airsoft choisir ;
- pression green gas température ;
- green gas PSI à 20 °C ;
- green gas PSI à 25 °C ;
- gaz airsoft hiver ;
- gaz airsoft été ;
- pression gaz airsoft 10 degrés ;
- différence green gas red gas black gas ;
- pression théorique bouteille gaz airsoft.

Ajoute :

- un `title` unique ;
- une meta description utile ;
- une canonique vers le domaine F.A.T. ;
- Open Graph et Twitter Card ;
- données structurées `SoftwareApplication` et `FAQPage` cohérentes avec le contenu visible ;
- breadcrumbs visibles et balisage `BreadcrumbList` ;
- liens internes depuis l’accueil, le simulateur, la FAQ, le guide température/gaz lorsqu’il existera ;
- l’URL dans `sitemap.xml` avec la date réelle de modification.

Ne crée pas de pages séparées par marque, pression ou température. Elles seraient minces et cannibaliseraient l’outil principal.

## Interface et direction produit

- Respecte le design system existant de `assets/site.css` et ses variables, afin que la future identité fournie par Claude reste simple à appliquer.
- Mobile first : l’outil doit être utilisable d’une main sur le terrain.
- Les labels restent visibles ; ne compte pas uniquement sur les placeholders.
- Navigation complète au clavier, focus visible, messages annoncés via une zone `aria-live`.
- Affiche une petite jauge ou échelle de pression uniquement si elle reste accessible et n’implique pas une notion trompeuse de « sûr/dangereux ».
- Propose un bouton « Copier le résultat » et le partage natif `navigator.share` avec fallback presse-papiers.
- Ajoute une comparaison facultative de deux bouteilles à la même température, sans détourner le parcours principal.
- Ne charge aucun framework, CDN ou bibliothèque graphique externe.

## PWA et fonctionnement hors ligne

- Ajoute la page et le JSON aux ressources pertinentes du service worker.
- Incrémente la constante de version de cache.
- Vérifie que l’outil fonctionne après une première visite puis hors ligne.
- N’interroge pas une API météo : la température est saisie par l’utilisateur et le site doit rester utilisable hors connexion.
- Si une future météo automatique est envisagée, laisse seulement un point d’extension documenté.

## Architecture attendue

Garde une séparation claire :

- données : `/data/green-gas-pressure-curves.json` ;
- logique de sélection et formatage : un module dédié, par exemple `/gas-pressure-tool.js` ;
- page : `/outils/choisir-gaz-airsoft-pression-temperature/index.html` ;
- styles réutilisables dans `assets/site.css` ;
- tests dans `tests/`.

Ne place pas les 1 792 valeurs directement dans le HTML ou dans un énorme bloc JavaScript inline.

## Tests obligatoires

Ajoute des tests qui vérifient au minimum :

1. JSON valide et IDs uniques ;
2. 56 températures par produit, de −15 à 40 °C ;
3. pas exact de 1 °C ;
4. conservation de chaque ancre fabricant ;
5. conservation exacte des 18 points ASG ;
6. monotonie des courbes ;
7. conversion PSI/bar ;
8. filtrage marque → modèles ;
9. restauration par paramètres d’URL ;
10. page avec H1, title, description, canonique et données structurées ;
11. absence de lien ou ressource interne cassé ;
12. disponibilité hors ligne après mise en cache.

Teste ensuite en navigateur réel sur desktop et mobile : sélection, résultat, changement de température degré par degré, partage, rechargement URL, débordement horizontal, console, Worker existant et PWA.

## Critères de fin

La mission est terminée lorsque :

- la page est intégrée à F.A.T. V3 ;
- les 32 produits publiables sont sélectionnables par marque puis modèle ;
- chaque température entière de −15 à 40 °C restitue une valeur ;
- la source, la température d’origine et la nature estimée du résultat sont visibles ;
- les références en quarantaine ne sont pas proposées ;
- les tests existants et nouveaux passent ;
- le site reste fonctionnel hors ligne ;
- un compte rendu liste les fichiers modifiés, les tests et les limites encore ouvertes.

