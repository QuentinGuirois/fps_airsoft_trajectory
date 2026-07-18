# Audit V2 des fabricants et bouteilles

Ce document répond à la question « qu’est-ce qui manquait dans la V1 ? » et indique à Codex ce qui doit apparaître dans le sélecteur.

## Abbey

Sélectionnables :

- Predator Gun Gas 144a — 6,6 bar / 95,72 PSI à 25 °C — lubrifié — 700 ml ;
- Predator Ultra — 8,5 bar / 123,28 PSI à 25 °C — lubrifié — 270 et 700 ml ;
- Brut Sniper — 8,6 bar / 124,73 PSI à 25 °C — sec — environ 700 ml / 300 g.

Catalogue seulement :

- Predator Vertex — fabricant et bouteille confirmés, mais 171 et 199 PSI se contredisent dans les sources secondaires et aucune température de référence actuelle n’est vérifiée ;
- Maintenance Gas — gaz de stockage, jamais un choix pour une partie.

## ASG Ultrair

- réf. 14571 Standard Power 135 PSI — sec — 570 ml ;
- réf. 19893 Green Power 135 PSI — siliconé — 570 ml ;
- réf. 19894 Orange Medium 164 PSI — sec — 570 ml ;
- réf. 19895 Red High 178 PSI — sec — 570 ml.

Les deux 135 utilisent la même courbe de pression ; seule la lubrification change. Les trois courbes 135/164/178 conservent les points publiés à 5/10/15/20/25/30 °C.

## ATM / Ama Tsu Maru

Ancres à 20 °C :

| Nom | Valeur source | Sec | Lubrifié |
|---|---:|:---:|:---:|
| PSI110 | 113 PSI | oui | oui |
| PSI130 | 135 PSI | oui | oui |
| PSI150 | 156 PSI | oui | oui |
| PSI165 | 165 PSI | oui | oui |
| PSI175 | 175 PSI | oui | oui |
| PSI203 | 203 PSI | oui | non retenu |

Le 203 lubrifié n’est pas ajouté : la gamme officielle confirme le niveau, mais la référence exploitable retrouvée est sèche.

Attention aux arrivages plus récents de 600 ml parfois annoncés 115 PSI pour le PSI110 : ne pas fusionner silencieusement ces générations avec la gamme 450/550 ml à 113 PSI.

## Nimrod Tactical

Gamme documentée complète, siliconée, 500 ml : Blue 116, Green 145, Red 174, Black 203 PSI à 20 °C. Aucun doublon sec officiel trouvé dans la gamme retenue.

## NUPROL

| Modèle | PSI à 25 °C | Lubrification | SKU | EAN |
|---|---:|---|---|---|
| 1.0 | 115 | silicone | 9044 | 754220671709 |
| 2.0 | 145 | silicone | 9031 | 700315573410 |
| 2.ZERO | 145 | sec | 9059 | 5056444737267 |
| 3.0 | 175 | silicone | 9035 | 700315573182 |
| 3.ZERO | 175 | sec | 9060 | 5056444744203 |
| 4.0 | 200 | silicone | 9036 | 700315573137 |
| 4.ZERO | 200 | sec | 9061 | 5056444744210 |

`2.MINI` contient 85 g de la formule 2.0 : conditionnement, pas nouvelle pression. Les formats standards contiennent 300 g dans une bouteille annoncée autour de 650 ml.

Les anciennes annonces 3.0 à 180 PSI et 4.0 à 210/215 PSI sont des conflits de génération. L’UI doit afficher SKU/EAN dans les détails quand ils existent.

## Powair

Gamme retenue complète : 116, 145, 175, 203 PSI à 20 °C, 500 ml, 1 % silicone. Aucun équivalent sec vérifié sous marque Powair.

## ProTechGuns

Une formule Green Gas siliconée, plusieurs conditionnements : Bullet 120 ml, 520 ml, 800 ml, 1000 ml. L’ancre utilisée reste environ 1 MPa / 145,04 PSI à 25 °C, issue d’un distributeur ; le fabricant ne chiffre pas la pression sur sa page actuelle. Badge de confiance « moyen » obligatoire dans les détails.

## Puff Dino

| Modèle | Ancre retenue | Lubrifié | Oil Free | Conditionnement |
|---|---:|:---:|:---:|---|
| Light Power 9 kg | 128,01 PSI à 26 °C | oui | oui | 600 ml |
| Standard Power 12 kg | 171 PSI à 30 °C | oui | oui | 600 ml ; Easy Carry 250 ml lubrifié |
| Power Up 14 kg | 199,12 PSI à 30 °C | oui | oui | 560 ml |

Le 9 kg est parfois vendu comme « 115 PSI ». La fiche la plus explicite donne 9 kgf/cm² à 26 °C ; c’est cette ancre convertie qui est utilisée. Afficher la note de conflit dans les détails.

## Specna Arms

Gamme VAPOR sèche, 600 ml / 300 g, à 25 °C :

- Blue 117 — EAN 5902543209948 ;
- Green 145 — EAN 5902543209955 ;
- Red 188 — EAN 5902543209962 ;
- Black 217 — EAN 5902543209979.

## Swiss Arms

Gamme actuelle documentée à 20 °C :

- 110 sec — SKU 603515 — 450 ml de gaz / bouteille 600 ml ;
- 130 sec — SKU 603511 — 600 ml de gaz / bouteille 760 ml ;
- 130 siliconé — SKU 603512 ;
- 150 sec — SKU 603513 ;
- 150 siliconé — SKU 603514.

Une ancienne référence Extreme autour de 170 PSI apparaît dans des tableaux historiques, sans fiche actuelle assez robuste : elle n’est pas injectée dans le sélecteur V2.

## Règle d’intégration Codex

Le sélecteur public consomme uniquement `products`. `excludedCandidates` est destiné à une section éditoriale « références repérées, données à confirmer ». Un produit n’entre dans le calculateur que si le couple `referencePsi` + `referenceTemperatureC` est vérifiable et rattaché à une génération identifiable.
