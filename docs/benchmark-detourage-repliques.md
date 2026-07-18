# Benchmark privé du détourage des répliques

## Protocole

Mesures réalisées le 18 juillet 2026 sous Windows, avec un seul thread déclaré,
sur les trois photos privées fournies. Chaque modèle est chargé dans un processus
séparé. Les photos, masques et sorties du benchmark restent hors du dépôt. Les
chiffres de RAM et de durée caractérisent cette machine de recette, pas le futur
serveur Plesk.

| Modèle | Cache ONNX | Création session | Inférence par photo | Pic mémoire du processus |
| --- | ---: | ---: | ---: | ---: |
| `u2netp` | 4 574 861 octets | 0,062 s | 1,65–1,72 s | 1 080 385 536 octets |
| `isnet-general-use` | 178 648 008 octets | 0,507 s | 3,96–4,03 s | 2 026 405 888 octets |
| `birefnet-general-lite` | 224 005 088 octets | 3,933 s | 12,83–28,12 s | 7 928 877 056 octets |

Les deux modèles qualité ont conservé canon, crosse, optiques et accessoires
fixés tout en éliminant lampe, écran, table et décor. Les trois consensus ont été
acceptés par les contrôles géométriques. Après rotation automatique des prises
portrait, les sorties sont horizontales et transparentes.

## Choix

`isnet-general-use` est retenu comme seconde analyse obligatoire. Sur ces trois
photos, sa sortie n'est pas moins complète que celle de BiRefNet Lite, tandis que
son cache est plus petit, son inférence nettement plus rapide et son pic mémoire
environ quatre fois inférieur. `birefnet-general-lite` reste une option de recette
explicite, jamais un téléchargement automatique en production.

Avec `u2netp` puis ISNet, les trois traitements complets ont duré 7,77 à 8,73 s.
Les WebP finaux mesurent respectivement 37 100, 46 496 et 56 706 octets, en
1200 × 296, 1200 × 520 et 1200 × 679 px. Ils sont décodables, portent un canal
alpha et la file d'upload est vide après traitement.

La validation visuelle reste un contrôle de développement de ces fixtures. En
production, aucune image douteuse n'est publiée : un échec de consensus ou de
géométrie produit uniquement `rejected`.
