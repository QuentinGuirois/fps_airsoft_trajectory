# RETEX — Pression des gaz airsoft selon la température

Date de collecte : 17 juillet 2026  
Périmètre : bouteilles courantes en Europe, avec priorité au marché français  
Livrables : JSON complet, CSV au degré près, sources, méthode, validation et prompt Codex.

## Résultat exploitable

- 32 bouteilles ou variantes publiables ;
- 10 marques présentes dans le calculateur ;
- 1 792 points calculés, de −15 à 40 °C avec un pas exact de 1 °C ;
- 4 marques supplémentaires et plusieurs modèles conservés en quarantaine faute de température de référence fiable ;
- 3 courbes ASG ULTRAIR fondées sur six points publiés chacune ;
- toutes les autres courbes sont des estimations relatives ancrées sur la pression et la température annoncées.

Fichiers principaux :

- `green-gas-pressure-curves.json` : données prêtes pour le site ;
- `green-gas-pressure-curves.csv` : toutes les marques et températures à plat ;
- `build-data.mjs` : génération reproductible ;
- `validate-data.mjs` : contrôle des ancres, pas, sources et courbes ;
- `PROMPT_CODEX.md` : brief d’intégration dans F.A.T. V3.

## RETEX principal

### Une valeur « 145 PSI » n’est pas comparable sans température

Le même nombre peut désigner deux réalités commerciales différentes :

- Nimrod Green et Powair 145 sont annoncés à 20 °C ;
- Specna Arms VAPOR Green, NUPROL 2.0 et ProTechGuns sont annoncés autour de 145 PSI à 25 °C.

Avec le modèle relatif retenu, une bouteille annoncée à 145 PSI à 20 °C est estimée à **164,84 PSI à 25 °C**. Une bouteille annoncée à 145 PSI à 25 °C est estimée à **127,55 PSI à 20 °C**. Les deux étiquettes « 145 PSI » ne doivent donc pas être affichées comme équivalentes.

### Les fabricants n’utilisent pas tous la même température de référence

| Température source | Marques publiables | Valeurs sources rencontrées |
|---:|---|---|
| 20 °C | ATM / Ama Tsu Maru, Nimrod Tactical, Powair, Swiss Arms | 110 à 203 PSI |
| 25 °C | Abbey, ASG Ultrair, NUPROL 2.0, ProTechGuns, Specna Arms VAPOR | 95,72 à 217 PSI |
| 30 °C | Puff Dino | 171 et 199,12 PSI |

### Tableau brut ASG ULTRAIR

ASG indique officiellement que ses bouteilles sont testées à 5, 10, 15, 20, 25 et 30 °C. Les valeurs ci-dessous sont les transcriptions disponibles du tableau présent sur les bouteilles ; elles ne sont ni lissées ni remplacées par le modèle propane.

| Température | Green 135 | Orange 164 | Red 178 |
|---:|---:|---:|---:|
| 5 °C | 107 | 121 | 128 |
| 10 °C | 114 | 128 | 135 |
| 15 °C | 121 | 135 | 142 |
| 20 °C | 130 | 142 | 157 |
| 25 °C | 135 | 164 | 178 |
| 30 °C | 156 | 171 | 185 |

Entre ces points, le JSON utilise une interpolation linéaire au degré près. En dehors de 5–30 °C, il extrapole depuis le point limite avec le ratio de pression de vapeur du propane et marque explicitement le point comme extrapolé.

### Quelques comparaisons normalisées

| Bouteille | Annonce source | Estimation à 10 °C | à 20 °C | à 25 °C | à 30 °C |
|---|---:|---:|---:|---:|---:|
| Nimrod Green | 145 PSI à 20 °C | 110,54 | 145,00 | 164,84 | 186,53 |
| Specna VAPOR Green | 145 PSI à 25 °C | 97,24 | 127,55 | 145,00 | 164,08 |
| ASG ULTRAIR Green | 135 PSI à 25 °C | 114,00 | 130,00 | 135,00 | 156,00 |
| Puff Dino 12 kg | 171 PSI à 30 °C | 101,34 | 132,93 | 151,11 | 171,00 |

Ces nombres sont utiles pour comparer les bouteilles sur une température commune. Ils ne sont pas une mesure de la pression dans un chargeur après plusieurs tirs.

## Marques et modèles publiables

### Abbey

- Predator Gun Gas 144a : 6,6 bar à 25 °C, convertis en 95,72 PSI.

### ASG Ultrair

- Green Power Gas 135 PSI, siliconé ;
- Orange Medium Power 164 PSI, sec ;
- Red High Power 178 PSI, sec.

### ATM / Ama Tsu Maru

- PSI110 sec : nom commercial 110, valeur source 113 PSI à 20 °C ;
- PSI130 sec et lubrifié : nom commercial 130, valeur source 135 PSI à 20 °C ;
- PSI150 sec : nom commercial 150, valeur source 156 PSI à 20 °C ;
- PSI165 sec, PSI175 sec et PSI203 sec.

### Nimrod Tactical

- Blue 116, Green 145, Red 174 et Black 203 PSI à 20 °C.

### NUPROL

- Premium Green Gas 2.0, 145 PSI à 25 °C.

Les 1.0, 3.0 et 4.0 ne sont pas publiés : les sources consultées ne sont pas assez cohérentes sur leur température de référence et le 4.0 apparaît selon les vendeurs à 200, 210 ou 215 PSI.

### Powair

- Premium Quality 116, 145, 175 et 203 PSI à 20 °C.

### ProTechGuns

- ProtechGas Green Gas : environ 1 MPa à 25 °C, soit 145,04 PSI.

### Puff Dino

- 12 kg Classic : 171 PSI à 30 °C ;
- 14 kg Power Up : 199,12 PSI à 30 °C.

### Specna Arms

- VAPOR Blue 117, Green 145, Red 188 et Black 217 PSI à 25 °C.

### Swiss Arms

- Light 110 sec ;
- Green 130 sec et siliconé ;
- Heavy 150 sec et siliconé ;
- toutes les ancres sont données à 20 °C.

## Méthode de calcul

### Cas 1 — plusieurs mesures publiées

Pour ASG ULTRAIR :

1. conservation exacte des mesures à 5, 10, 15, 20, 25 et 30 °C ;
2. interpolation linéaire entre deux mesures ;
3. extrapolation hors de cette plage par ratio de pression de vapeur du propane ;
4. statut de chaque point enregistré dans le JSON.

### Cas 2 — une seule pression à une température connue

La pression commerciale sert d’ancre. La variation relative suit l’équation d’Antoine du propane publiée par le NIST :

```text
log10(P_bar) = A − B / (T_K + C)
A = 3.98292
B = 819.296
C = −24.417
```

Puis :

```text
P_est(T) = P_source(T_ref) × P_sat_propane(T) / P_sat_propane(T_ref)
```

Cette normalisation conserve exactement la valeur fabricant à sa température de référence. Elle ne prétend pas connaître la composition propriétaire de la bouteille.

Source scientifique : [NIST Chemistry WebBook — Propane](https://webbook.nist.gov/cgi/cbook.cgi?ID=C74986&Mask=4&Type=ANTOINE&Plot=on).

## Limites à afficher sur le site

Texte minimal obligatoire :

> La pression affichée est une estimation théorique calculée à partir des valeurs publiées par les fabricants ou distributeurs. Elle ne garantit ni la pression réelle dans un chargeur, ni la compatibilité avec une réplique, ni la puissance obtenue.

La page doit aussi expliquer que :

- la composition précise des mélanges est généralement propriétaire ;
- l’unité commerciale « PSI » n’indique pas toujours clairement pression absolue, manométrique ou protocole interne ;
- la température importante est celle de la bouteille et du chargeur, pas seulement la prévision météo ;
- les tirs successifs refroidissent le chargeur et provoquent le cooldown ;
- le niveau de remplissage, les fuites, les valves et la mécanique modifient la pression utile ;
- une estimation de pression ne constitue jamais une validation de compatibilité ou de sécurité ;
- une réplique doit être chronographiée avec le gaz, la bille et les conditions réellement utilisés.

## Références mises en quarantaine

| Marque | Modèles | Motif |
|---|---|---|
| VORSK | V6 175, V8 190, V12 220 | Température de référence non confirmée |
| Novritsch | Low, Medium, High, Super High | Pressions partielles ou approximatives, références thermiques incomplètes |
| Elite Force / Umarex | 110, 130, 150 | Plages d’emploi trouvées, mais pas de température de référence explicite dans les sources retenues |
| NUPROL | 1.0, 3.0, 4.0 | Températures incomplètes et contradiction 200/210/215 PSI pour le 4.0 |
| Puff Dino | 9 kg / 115 PSI | Température de référence absente |

Ces produits figurent dans `excludedCandidates` afin que Codex ne les perde pas, mais ils ne doivent pas apparaître dans le sélecteur public tant que l’ancre n’est pas vérifiée sur une source fabricante ou une photographie nette de bouteille.

## Sources les plus structurantes

- [ASG ULTRAIR 135 — fabricant](https://actionsportgames.com/ultrair-power-propellent-gas-with-silicone-570-ml-19893)
- [ASG ULTRAIR 164 — fabricant](https://actionsportgames.com/ultrair-medium-power-propellent-gas-570-ml-19894)
- [ASG ULTRAIR 178 — fabricant](https://actionsportgames.com/ultrair-high-power-propellent-gas-570-ml-19895)
- [Nimrod — gamme à 20 °C](https://www.armasairsoft.es/producto/botella-gas-nimrod-500ml/)
- [Powair — gamme à 20 °C](https://as-df.fr/bouteille-de-gaz/32132-powair-gaz-500ml-2123456.html)
- [Specna Arms VAPOR — tableau à 25 °C](https://www.anareus.cz/gb/red-gas/19287-sa-vapor-red-airsoft-green-gas-188-psi-600-ml-red-5902543209962.html)
- [Swiss Arms 110 à 20 °C](https://www.emgarms.com/110229/)
- [Swiss Arms 130 à 20 °C](https://www.emgarms.com/110228/)
- [Swiss Arms 150 à 20 °C](https://www.emgarms.com/110227/)
- [ATM — présentation de gamme](https://amatsumaru.com/it/gaz-atm/)
- [NUPROL 2.0 à 25 °C](https://www.anareus.cz/gb/gas-co2/6126-green-gas-nuprol-20-700315573410.html)
- [Puff Dino 12 kg à 30 °C](https://www.kdkairsoft.com/product-page/puff-dino-green-gas)
- [Puff Dino 14 kg à 30 °C](https://airsoftzone.com.mx/productos-de-airsoft/green-gas-puff-dino14kg/)

Toutes les sources, leurs types, leurs dates de consultation et les affirmations qu’elles soutiennent sont enregistrées dans le JSON.

## Mise à jour future

1. Ajouter ou corriger le produit dans `build-data.mjs`.
2. Ne publier une courbe que si pression **et** température de référence sont sourcées.
3. Préférer fabricant, fiche technique ou photographie lisible de la bouteille.
4. Conserver les contradictions dans les notes au lieu de choisir silencieusement.
5. Exécuter :

```bash
node build-data.mjs
node validate-data.mjs
```

6. Incrémenter `schemaVersion` si la structure change.

