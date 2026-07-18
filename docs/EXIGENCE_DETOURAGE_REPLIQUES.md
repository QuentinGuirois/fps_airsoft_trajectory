# Exigence de détourage des répliques

## Garantie de publication

Le détourage automatique ne prétend pas réussir toute photographie arbitraire.
La garantie porte sur la publication : une image est soit `ready`, soit
`rejected`. Il n'existe aucun état `needs_review`, aucune validation humaine du
masque et aucun résultat « meilleur effort » publié.

## Conditions d'entrée

Le formulaire demande une photo strictement de côté, sur fond uni contrastant,
sans personne ni objet au contact, avec la réplique entière dans le cadre et une
lumière diffuse. Le serveur contrôle le MIME réel, la taille de 8 Mo maximum,
36 mégapixels maximum, une résolution exploitable et le contraste. Un MPO de
smartphone est traité comme un JPEG et seule sa première vue est décodée.

L'absence de personne doit être couverte par le contrôle d'upload avant
l'ouverture publique. Le masque de détourage généraliste ne constitue pas à lui
seul un détecteur sémantique de personnes.

## Double analyse obligatoire

La passe rapide utilise `u2netp` avec `post_process_mask=True`. Une photo qui
échoue déjà aux contrôles rapides est rejetée immédiatement. Toute candidate à
la publication est ensuite analysée par le modèle de qualité configuré,
`isnet-general-use` par défaut. Les sessions ONNX sont créées une seule fois et
réutilisées pendant toute la file.

Les masques nettoyés sont comparés par :

- intersection-over-union ;
- IoU des boîtes englobantes ;
- écart relatif de leurs quatre extrémités ;
- géométrie du composant dominant.

Un écart sous les seuils de consensus produit `rejected`.

## Nettoyage géométrique

Le masque est seuillé, puis ses composantes connexes sont mesurées. Le score du
sujet combine aire, largeur horizontale, intersection avec la zone centrale,
horizontalité et proximité du centre. Seuls le composant dominant et de petits
accessoires proches sont conservés. Les composantes isolées sont supprimées ;
seuls de très petits trous internes sont comblés. Les seuils sont relatifs à la
taille de l'image.

Le résultat est refusé s'il est vide, trop plein, principalement vertical,
excentré, collé à plusieurs bords ou encore composé de plusieurs sujets
importants. Le masque consensuel utilise l'alpha minimal accepté par les deux
modèles, puis il est contrôlé une nouvelle fois.

Une prise dont le sujet dominant est vertical à cause de l'orientation portrait
du smartphone est normalisée après la première sélection : image et masque sont
tournés ensemble, avant la seconde inférence. Le contrôle d'horizontalité porte
donc sur la card finale et ne masque jamais un échec de segmentation.

## Exploitation

- un worker maximum par file, garanti par verrou local ;
- `OMP_NUM_THREADS` dérivé de `FAT_REMBG_THREADS` et borné entre 1 et 4 ;
- timeout configurable par image, dur sous Unix ;
- cache des modèles hors `httpdocs` ;
- `--once` pour un job et `--drain` pour vider la file ;
- aucun upload, masque ou intermédiaire conservé après succès ou refus.

Les seuils doivent être revérifiés sur les trois fixtures privées à chaque
changement de modèle ou de version ONNX. La qualité visuelle des fixtures sert
au benchmark de développement, pas à une modération de production.

Le choix ISNet/BiRefNet et les mesures de référence sont consignés dans
`docs/benchmark-detourage-repliques.md`.
