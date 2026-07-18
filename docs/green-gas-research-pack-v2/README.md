# RETEX V2 — Pression des gaz airsoft selon la température

Collecte et consolidation : 17 juillet 2026  
Périmètre : références courantes en Europe, priorité au marché français  
Objectif : alimenter le calculateur Green Gas de F.A.T. V3 sans comparer des PSI annoncés à des températures différentes.

## Ce qui change depuis la V1

- 49 références sélectionnables au lieu de 32 ;
- 10 marques et 2 744 valeurs, de −15 à 40 °C par pas exact de 1 °C ;
- 35 courbes physiques uniques : les variantes sèches/lubrifiées et les formats partagent une courbe lorsqu’ils utilisent la même formule ;
- ajout des gammes Abbey Ultra et Brut, ASG 135 sec, ATM lubrifiés, NUPROL 1.0/3.0/4.0 et ZERO, Puff Dino 9/12/14 kg secs et lubrifiés ;
- ajout des SKU/EAN disponibles et des conditionnements NUPROL Mini, Puff Dino Easy Carry et ProTech ;
- conflits de génération conservés explicitement au lieu d’être arbitrés en silence.

Fichiers :

- `green-gas-pressure-curves.json` : source applicative complète ;
- `green-gas-pressure-curves.csv` : 2 744 points à plat ;
- `AUDIT-FABRICANTS.md` : couverture détaillée par marque et références encore bloquées ;
- `build-data.mjs` : génération reproductible ;
- `validate-data.mjs` : contrôles automatisés ;
- `PROMPT_CODEX.md` : instruction prête à copier dans Codex pour F.A.T. V3.

## Couverture par fabricant

| Marque | Références sélectionnables | Courbes uniques | Compléments V2 |
|---|---:|---:|---|
| Abbey | 3 | 3 | 144a, Ultra, Brut ; Vertex en quarantaine, Maintenance exclu du jeu |
| ASG Ultrair | 4 | 3 | 135 sec + 135 siliconé, 164 sec, 178 sec |
| ATM / Ama Tsu Maru | 11 | 6 | paires sec/lubrifié en 110, 130, 150, 165, 175 ; 203 sec |
| Nimrod Tactical | 4 | 4 | gamme Blue/Green/Red/Black complète documentée |
| NUPROL | 7 | 4 | 1.0, 2.0, 2.ZERO, 3.0, 3.ZERO, 4.0, 4.ZERO ; 2.MINI comme format |
| Powair | 4 | 4 | 116/145/175/203, toutes à 20 °C et 1 % silicone |
| ProTechGuns | 1 | 1 | même formule en 120/520/800/1000 ml |
| Puff Dino | 6 | 3 | 9/12/14 kg, versions lubrifiées et Oil Free ; Easy Carry 12 kg |
| Specna Arms | 4 | 4 | VAPOR Blue/Green/Red/Black, secs |
| Swiss Arms | 5 | 3 | 110 sec, 130 sec/lubrifié, 150 sec/lubrifié avec SKU |
| **Total** | **49** | **35** | |

Une bouteille de 250 ml et la même formule en 600 ml ne sont pas deux gaz différents. Le JSON sépare donc `products` (formule et lubrification), `curveGroupId` (courbe commune) et `packagingOptions` (conditionnement).

## Températures de référence rencontrées

| Température de l’ancre | Marques |
|---:|---|
| 20 °C | ATM, Nimrod, Powair, Swiss Arms |
| 25 °C | Abbey, ASG Ultrair, NUPROL, ProTechGuns, Specna Arms |
| 26 °C | Puff Dino 9 kg |
| 30 °C | Puff Dino 12 kg et 14 kg |

Un « 145 PSI » à 20 °C ne doit pas être présenté comme identique à un « 145 PSI » à 25 °C. Le jeu restitue toutes les bouteilles à la température choisie par le joueur avant comparaison.

## Méthode

### ASG : grille fabricant

Les points imprimés à 5/10/15/20/25/30 °C sont conservés :

| °C | 135 PSI | 164 PSI | 178 PSI |
|---:|---:|---:|---:|
| 5 | 107 | 121 | 128 |
| 10 | 114 | 128 | 135 |
| 15 | 121 | 135 | 142 |
| 20 | 130 | 142 | 157 |
| 25 | 135 | 164 | 178 |
| 30 | 156 | 171 | 185 |

Le calcul interpole linéairement entre deux points. Hors 5–30 °C, il extrapole par ratio de pression de vapeur du propane et marque le point `extrapolated_propane_ratio`.

### Autres marques : ancre fabricant/distributeur

Le calcul conserve exactement la pression publiée à sa température de référence, puis applique une variation relative issue de l’équation d’Antoine du propane du NIST :

```text
log10(P_bar) = 3.98292 − 819.296 / (T_K − 24.417)

P_est(T) = P_source(T_ref) × P_sat_propane(T) / P_sat_propane(T_ref)
```

Ce choix donne une courbe comparable et reproductible ; il ne reconstitue pas la composition propriétaire des mélanges propane/butane/additifs.

## Points de vigilance importants

- `labelPsi` peut être un nom commercial différent de `referencePsi` : ATM PSI110 vaut 113 PSI à 20 °C dans la gamme documentée.
- Les variantes sèches et lubrifiées sont des choix distincts, même avec la même pression.
- Le volume ou le poids de la bouteille ne modifie pas la pression calculée.
- Pour Puff Dino 9 kg, l’ancre retenue est 9 kgf/cm² à 26 °C, soit 128,01 PSI. L’appellation « 115 PSI » trouvée chez certains revendeurs sans protocole reste une note, pas une ancre.
- NUPROL a connu plusieurs fiches 3.0/4.0 à 180/200/210/215 PSI. La V2 retient la gamme actuelle 115/145/175/200 PSI à 25 °C et stocke SKU/EAN pour distinguer les générations.
- ProTech est moins robuste : le fabricant documente la formule et les formats, mais l’ancre chiffrée de 1 MPa à 25 °C provient d’un distributeur.
- Abbey Vertex n’entre pas dans le calculateur : les sources secondaires divergent de 171 à 199 PSI sans couple pression/température actuel vérifiable.
- Abbey Maintenance Gas est un gaz de stockage ; le fabricant demande de ne pas tirer avec.

## Mention obligatoire sur le site

> La pression affichée est une estimation théorique calculée à partir des valeurs publiées par les fabricants ou distributeurs. Elle ne garantit ni la pression réelle dans un chargeur, ni la compatibilité avec une réplique, ni la puissance obtenue.

La température pertinente est celle de la bouteille et du chargeur. Cooldown, cadence, niveau de remplissage, valves, fuites et état mécanique modifient la pression utile. Une estimation ne remplace jamais les préconisations de la réplique ni un passage au chronographe avec le gaz et les billes réellement utilisés.

## Références en quarantaine

- VORSK V6/V8/V12 : température de référence absente ;
- Novritsch Low/Medium/High/Super High : données pression/température incomplètes ;
- Elite Force / Umarex 110/130/150 : plages d’usage trouvées, température de référence non publiée ;
- Abbey Vertex : référence réelle, mais valeur et température de référence conflictuelles ;
- Abbey Maintenance Gas : documenté, mais interdit de jeu/tir par le fabricant ;
- anciennes générations NUPROL : conservées comme conflits, non proposées dans le sélecteur.

Elles figurent dans `excludedCandidates`. Codex ne doit jamais les injecter dans le calculateur.

## Sources structurantes

- [NIST — propane, équation d’Antoine](https://webbook.nist.gov/cgi/cbook.cgi?ID=C74986&Mask=4&Type=ANTOINE&Plot=on)
- [Abbey — guide officiel de gamme](https://www.abbeysupply.com/resources/which-airsoft-gas-is-best)
- [Abbey Ultra — 8,5 bar à 25 °C](https://www.mclinterglobal.com/en/abbey-predator-ultra-gun-gas-700ml)
- [ASG Ultrair 135 — fabricant](https://actionsportgames.com/ultrair-power-propellent-gas-with-silicone-570-ml-19893)
- [ATM — gamme sèche/lubrifiée](https://amatsumaru.com/it/gaz-atm/)
- [Nimrod — gamme complète à 20 °C](https://www.armasairsoft.es/producto/botella-gas-nimrod-500ml/)
- [NUPROL — gamme officielle et ZERO](https://nuprol.com/nuprol-2-0-gas.html)
- [NUPROL — tableau 115/145/175/200](https://www.anareus.cz/gb/red-gas/6127-nuprol-premium-red-gas-30-650-ml-red-700315573182.html)
- [Powair — gamme complète à 20 °C](https://as-df.fr/bouteille-de-gaz/32132-powair-gaz-500ml-2123456.html)
- [ProTech — formats officiels](https://protechguns.com/produkt/protechgas-750-1000ml/)
- [Puff Dino — gamme officielle 9/12/14 kg](https://www.puffdino.com/en/product/PUFF-DINO-Green-Gas-Powerup-14KG/e0104.html)
- [Specna Arms VAPOR — tableau à 25 °C](https://www.anareus.cz/gb/red-gas/19287-sa-vapor-red-airsoft-green-gas-188-psi-600-ml-red-5902543209962.html)
- [Swiss Arms — gamme et SKU](https://www.armiantichesanmarino.eu/green-gas-110-psi-sec-600ml-c12-swiss-arms-603515.html)

Toutes les sources, dates de consultation et affirmations soutenues sont embarquées dans `green-gas-pressure-curves.json`.

## Régénération

```bash
node build-data.mjs
node validate-data.mjs
```

Ajouter une bouteille seulement si une pression et une température de référence sont reliées à une génération identifiable. Sinon : `excludedCandidates`, avec le conflit écrit noir sur blanc.
