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
