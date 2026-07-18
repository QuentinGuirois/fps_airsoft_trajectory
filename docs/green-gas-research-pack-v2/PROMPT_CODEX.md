# Prompt prêt à copier dans Codex — calculateur Green Gas F.A.T. V3

Tu travailles dans le dépôt **F.A.T. V3 / FPS Airsoft Trajectory**. Implémente complètement la page décrite ci-dessous. Ne livre pas un HTML nu : elle doit reprendre le layout, la navigation, le footer, les composants et le CSS réel du site, être visuellement finie sur mobile et desktop, puis être testée dans un navigateur.

Commence par lire `AGENTS.md`, le README, la documentation du moteur ATP, les conventions SEO/PWA et les scripts de test. Inspecte l’architecture avant de choisir les chemins. Lance les tests existants avant modification. Préserve les changements utilisateur sans rapport avec cette tâche.

## Données fournies

Le pack contient :

- `green-gas-pressure-curves.json` — source applicative V2 ;
- `green-gas-pressure-curves.csv` — contrôle tabulaire ;
- `README.md` — méthode et limites ;
- `AUDIT-FABRICANTS.md` — couverture détaillée ;
- `build-data.mjs` et `validate-data.mjs` — génération et validation.

Le JSON contient 49 références, 10 marques, 35 courbes uniques et 2 744 points de −15 à 40 °C, par pas de 1 °C. Copie-le dans le répertoire statique approprié du projet. Ne remplace pas ces données par une recherche Web et ne recalcule pas une courbe concurrente côté navigateur.

Le schéma distingue :

- `products` : choix autorisés dans le calculateur ;
- `curveGroupId` : variantes qui partagent la même pression ;
- `packagingOptions` : taille/poids de bouteille, sans effet sur la pression ;
- `silicone` : `yes`, `no` ou `unknown` ;
- `referencePsi` + `referenceTemperatureC` : ancre de calcul ;
- `curve` : 56 valeurs déjà calculées ;
- `sourceIds` + `sources` : traçabilité ;
- `excludedCandidates` : références repérées mais interdites dans le calculateur.

## Mission

Créer une page complète à une URL française pérenne, de préférence :

```text
/outils/choisir-gaz-airsoft-pression-temperature/
```

Elle répond à la question : « Quelle pression théorique donnera ma bouteille de gaz airsoft à la température prévue demain ? »

## Parcours principal

Dans cet ordre :

1. température prévue pour la prochaine partie ;
2. marque ;
3. modèle exact de gaz ;
4. conditionnement si le produit en possède plusieurs.

La température est un entier de −15 à 40 °C par pas exact de 1 °C. Fournis un champ numérique et un slider synchronisés. Aucun pas de 5 °C.

Pour la marque, trie alphabétiquement. Pour le modèle, affiche au minimum : nom, pression commerciale, sec/lubrifié. Le conditionnement est secondaire et ne doit jamais modifier la valeur PSI.

Le résultat se met à jour sans rechargement et affiche :

- pression estimée en PSI, une décimale ;
- équivalent en bar (`psi / 14.5037738`) ;
- température choisie ;
- marque et modèle complets ;
- badge SEC ou LUBRIFIÉ ;
- pression source et température de référence ;
- type de point traduit en français ;
- conditionnement choisi ;
- niveau de confiance ;
- avertissement hors plage publiée ;
- sources cliquables du produit ;
- date de collecte.

Traductions des statuts :

- `manufacturer_test_point` → « valeur publiée » ;
- `interpolated_manufacturer_grid` → « interpolation entre mesures publiées » ;
- `manufacturer_or_distributor_anchor` → « valeur source à la température de référence » ;
- `estimated_propane_ratio` → « estimation depuis la valeur fabricant/distributeur » ;
- `extrapolated_propane_ratio` → « extrapolation hors de la plage mesurée » avec avertissement renforcé.

Utilise directement le point de `product.curve` dont `temperatureC` correspond à l’entrée. N’utilise jamais `labelPsi` pour calculer : les produits ATM prouvent que le nom commercial peut différer de l’ancre réelle.

## Cas métier à respecter

- ASG 135 sec et ASG 135 siliconé partagent une courbe mais restent deux modèles visibles.
- ATM sec/lubrifié doit rester distinct aux niveaux 110/130/150/165/175.
- NUPROL 2.0/2.ZERO, 3.0/3.ZERO et 4.0/4.ZERO partagent leur pression mais pas leur lubrification.
- NUPROL 2.MINI est un conditionnement de la formule 2.0.
- Puff Dino 9/12/14 kg existe en lubrifié et Oil Free ; Easy Carry est le format 250 ml du 12 kg lubrifié.
- ProTech 120/520/800/1000 ml partage une seule courbe.
- Abbey Vertex, Abbey Maintenance Gas, VORSK, Novritsch, Elite Force et anciennes générations NUPROL sont dans `excludedCandidates` : jamais dans les sélecteurs.
- Dans une section éditoriale « données à confirmer », on peut citer ces références avec leur motif, sans afficher de PSI calculé.

## Mention obligatoire

Sous le résultat et dans la méthodologie, afficher exactement :

> La pression affichée est une estimation théorique calculée à partir des valeurs publiées par les fabricants ou distributeurs. Elle ne garantit ni la pression réelle dans un chargeur, ni la compatibilité avec une réplique, ni la puissance obtenue.

Ajouter en langage clair : la température importante est celle de la bouteille et du chargeur ; cadence, cooldown, remplissage, valves, fuites et état mécanique changent la pression utile. Le résultat n’est pas une validation de sécurité. Recommander de suivre la documentation de la réplique et de chronographier dans les conditions réelles avec le gaz et les billes choisis.

Ne transforme pas l’outil en recommandation automatique « sûr/dangereux ». Ne promets pas de compatibilité et ne déduis pas des joules à partir des PSI.

## URL, partage et persistance

Les choix doivent être partageables, par exemple :

```text
?t=12&brand=NUPROL&gas=nuprol-3zero-175&pack=0
```

Priorité : paramètres URL, puis dernier choix `localStorage`, puis défaut raisonnable. Ajoute « Copier le résultat » et `navigator.share` avec fallback presse-papiers. Le texte partagé doit rappeler qu’il s’agit d’une estimation.

## Comparaison facultative

Ajouter un mode « Comparer une autre bouteille » à la même température. Afficher les deux valeurs sur une échelle accessible ou dans un tableau, sans couleur de danger. Ne charger aucune bibliothèque graphique externe. Éviter les 49 courbes simultanées.

## Contenu éditorial SEO

La page ne doit pas être un calculateur nu. Écrire un contenu français original comprenant :

1. H1 : « Quel gaz airsoft choisir selon la température ? » ;
2. réponse courte et outil au-dessus de la ligne de flottaison ;
3. pourquoi 145 PSI à 20 °C n’équivaut pas à 145 PSI à 25 °C ;
4. tableau des marques mesurées à 20, 25, 26 et 30 °C ;
5. différence entre Green/Red/Black Gas et entre sec/lubrifié ;
6. explication du cooldown ;
7. pression de bouteille vs pression dans le chargeur vs puissance au chronographe ;
8. méthode de calcul avec crédit aux fabricants/distributeurs et au NIST ;
9. couverture fabricants et section « données à confirmer » ;
10. FAQ longue traîne ;
11. CTA vers le convertisseur FPS/joules et le simulateur ATP.

Intentions à couvrir naturellement :

- quel gaz airsoft choisir ;
- pression green gas température ;
- gaz airsoft hiver / été ;
- green gas PSI à 20 °C / 25 °C ;
- pression gaz airsoft à 5, 10, 15 et 20 degrés ;
- différence green gas red gas black gas ;
- gaz airsoft sec ou siliconé ;
- NUPROL 1.0 2.0 3.0 4.0 pression ;
- Nimrod / Powair / Swiss Arms / Specna Vapor PSI ;
- Puff Dino 9 kg 12 kg 14 kg pression.

Ne génère pas 49 pages minces ni une page par température. Si des pages marque sont créées plus tard, elles devront avoir une intention propre, un contenu substantiel et une canonique cohérente.

SEO technique :

- `title` et meta description uniques ;
- canonique correcte ;
- Open Graph / Twitter Card ;
- breadcrumb visible + `BreadcrumbList` ;
- JSON-LD `SoftwareApplication` et `FAQPage` strictement cohérents avec le visible ;
- ajout au sitemap avec vraie date de modification ;
- liens internes depuis accueil, outils, guides gaz/température et simulateur ;
- contenu indexable sans exiger l’exécution JavaScript pour les éléments éditoriaux essentiels.

## Design et qualité front

- Réutiliser les styles et variables du projet ; créer les composants manquants dans le vrai fichier CSS, pas dans un bricolage inline.
- Mobile first, utilisable d’une main sur le terrain.
- Hiérarchie visuelle nette : formulaire, résultat principal, provenance, avertissement, détails.
- Labels visibles, focus clavier, contrastes WCAG AA, `aria-live` pour le résultat.
- Aucun débordement horizontal à 320 px.
- Prévoir le futur changement d’identité visuelle sans figer des couleurs partout.
- Tester réellement les états chargement, erreur JSON, données absentes, hors plage et partage.

## PWA et hors ligne

- Ajouter la page, son module, son CSS et le JSON à la stratégie de cache du service worker existant.
- Incrémenter proprement la version de cache.
- Après une première visite, le calculateur doit fonctionner hors ligne.
- Ne pas appeler d’API météo. L’utilisateur saisit sa prévision.

## Architecture

Adapte les chemins au dépôt, mais conserve la séparation :

- données statiques ;
- module de chargement/filtrage/formatage ;
- page HTML ou composant de route ;
- styles dans le système existant ;
- tests dédiés.

Ne colle pas les 2 744 points dans le HTML. Ne duplique pas le JSON dans plusieurs bundles.

## Tests obligatoires

Vérifier au minimum :

1. JSON valide, 49 IDs uniques, 10 marques ;
2. 56 températures par produit, −15 à 40, pas de 1 °C ;
3. conservation des ancres et des 18 points ASG ;
4. monotonie des courbes ;
5. égalité des courbes partageant `curveGroupId` ;
6. conversion PSI/bar ;
7. filtre marque → modèles et tri ;
8. conditionnement sans effet sur le PSI ;
9. exclusion stricte de `excludedCandidates` ;
10. paramètres URL et `localStorage` ;
11. title, description, canonique, H1 et JSON-LD ;
12. absence de ressources internes cassées ;
13. fonctionnement hors ligne après mise en cache.

Puis vérifier dans un navigateur réel, desktop et mobile : rendu CSS, changement degré par degré, clavier, lecteur d’écran de base, URL partageable, boutons copier/partager, comparaison, console sans erreur, service worker et absence de débordement.

## Définition de terminé

La tâche est terminée quand la page est réellement intégrée au site V3, visuellement finie, responsive, indexable, PWA, alimentée par les 49 références autorisées, sans produit de quarantaine, et que tous les tests passent. Termine par un compte rendu listant fichiers modifiés, tests exécutés, captures desktop/mobile si le dépôt le permet, et limites de données restantes — notamment Abbey Vertex et les générations NUPROL conflictuelles.
