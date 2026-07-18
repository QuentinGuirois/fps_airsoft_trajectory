# Exigence de stockage des images de répliques

## Invariant

Une card possède une seule image persistante. Il s'agit d'un WebP décodable,
transparent lorsque le détourage est `ready`, dont la taille est inférieure ou
égale à 102 400 octets. Aucun JPEG, PNG ou MPO original, masque, sortie normale,
thumbnail raster ou intermédiaire du worker n'est conservé.

La courbe miniature reste un SVG sérialisé ou une donnée vectorielle.

## Encodage

Après le consensus des masques, l'image est recadrée sur la boîte alpha avec
4 à 6 % de marge, puis réduite sans agrandissement dans un cadre maximal de
1200 × 700 px. L'encodage essaie successivement les qualités WebP 82, 76, 70,
64, 58 et 52. Si nécessaire, largeur et hauteur sont réduites à 90 % avant une
nouvelle série d'essais. Le traitement est refusé si le plafond reste impossible
avant le plancher conseillé de 720 × 420 px.

Le flux WebP est relu avant et après l'écriture atomique. Format, canal alpha,
dimensions, octets et SHA-256 sont mesurés côté serveur. En cas d'erreur, le
fichier final éventuel et tous les temporaires sont supprimés.

## MariaDB et cycle de vie

La base conserve uniquement le chemin, le MIME `image/webp`, la taille bornée à
102 400 octets, largeur, hauteur, SHA-256, état et date de génération. Aucun BLOB
ou base64.

Lors d'un remplacement, la nouvelle image est entièrement validée avant le
basculement de la card. L'ancien WebP peut rester privé pendant le délai de
restauration prévu, puis il est supprimé. Cette exception transitoire doit être
comptée dans les quotas ; elle ne crée jamais deux images publiques pour une
card. Un job périodique teste et supprime les fichiers orphelins.
