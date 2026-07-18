# Budget de performance F.A.T.

Référence du 18 juillet 2026, avant mesure Lighthouse CI :

- shell critique PWA : 281 353 octets non compressés, doublon `/` et
  `/index.html` inclus ; garde-fou automatisé à 300 000 octets ;
- portrait Keep 320 px : 33 728 octets ;
- portrait Keep 640 px : 95 388 octets ;
- image sociale À propos : 140 876 octets, hors précache ;
- aucune image raster standard sous `assets/img/` ne doit dépasser 200 Ko ;
- Three.js reste absent de l’installation initiale et rejoint le cache seulement
  après activation explicite de la 3D.

Le job qualité exécute Lighthouse CI 0.15.1 sur la home, l’outil gaz, le
simulateur 3D et la galerie, en mobile 390 × 844 puis desktop 1440 × 900. Les
premiers seuils sont des avertissements afin de calibrer les garde-fous à partir
de rapports réels, jamais de scores supposés. Les rapports HTML/JSON sont
conservés quatorze jours comme artefact GitHub Actions.

La photo source de Keep reste dans une archive privée éventuelle, jamais dans
Git, la release ou le précache.

## Mesure de référence CI

Mesure du commit `0b8f250`, Chromium Lighthouse CI 0.15.1, avant les derniers
correctifs de préchargement et de noms accessibles :

| Page | Mobile perf. | Desktop perf. | Accessibilité mobile / desktop | LCP mobile | TBT mobile | CLS mobile |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Accueil | 71 | 87 | 100 / 96 | 4 816 ms | 0 ms | 0,004 |
| Gaz / température | 72 | 98 | 100 / 96 | 4 357 ms | 0 ms | 0,097 |
| Simulateur 3D | 45 | 94 | 100 / 96 | 4 508 ms | 2 824 ms | 0,039 |
| Râtelier public | 78 | 99 | 96 / 96 | 3 907 ms | 0 ms | 0,057 |

Les scores desktop d’accessibilité étaient diminués par le nom forcé du logo ;
le score du râtelier l’était aussi par un `aria-label` placé sur un `div` sans
rôle. Ces deux écarts sont corrigés et couverts par test. Le CSS critique et la
police Saira sont désormais préchargés avant le bootstrap de thème sur les
quatre pages mesurées.

La 3D mobile reste une dette de performance identifiée : environ 604 Ko de
JavaScript étaient signalés comme inutilisés au démarrage et le rendu WebGL
occupait fortement le thread principal sous bridage mobile. La correction sûre
demande un lot dédié de découpage du module 3D ; aucune formule ATP, aucun
point du Worker et aucun résultat numérique ne doivent être modifiés pour
améliorer ce score.

Le score SEO du râtelier n’est pas un défaut de production : la page reste
volontairement `noindex,follow` tant que le volume éditorial public n’est pas
suffisant. Les erreurs API visibles dans cette mesure provenaient du serveur
statique de Lighthouse, qui ne sert pas PHP ; l’intégration API est contrôlée
séparément contre MariaDB dans le job dédié.
