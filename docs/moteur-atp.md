# Moteur ATP — note technique

## Source et attribution

Le moteur est une implémentation indépendante des relations décrites dans l’Airsoft Trajectory Project de Mackila : <https://mackila.com/airsoft/ATP/>.

## État et axes

Le solveur suit `{x, y, z, vx, vy, vz, omega}` en unités SI :

- x : direction du tir ;
- y : verticale ;
- z : dérive latérale ;
- omega : vitesse angulaire scalaire autour de l’axe de spin, orienté par le cant.

L’impact avec le sol est interpolé entre les deux derniers pas RK4. Le dernier point vaut donc exactement `y = 0 m` et aucun échantillon de trajectoire n’est émis sous le sol.

## Paramètres de référence

- diamètre ATP : 6 mm ;
- viscosité dynamique : 17,4 × 10⁻⁶ Pa·s ;
- entrée de spin : rotation initiale en tr/min, comme dans les figures ATP ;
- ancien format compatible : V/U = 0,41 à 100 %, uniquement pour relire les anciens liens ;
- pas Runge–Kutta 4 : 0,001 s ;
- gravité : relation ATP dépendante de la latitude ;
- densité de l’air : pression / (R × température absolue).

## Forces

La traînée utilise `½ρCdAV²`. Conformément à l’écriture publiée dans ATP et à la figure III-A-05, la portance Magnus utilise `ρClAV²`, sans facteur `½`.

`publishedLiftCoefficient()` conserve exactement le polynôme imprimé, sans borne d’entrée ou de sortie. Les points de la figure III-A-04 sont cependant décalés de `+0,00934` sur V/U par rapport à cette formule. `liftCoefficient()`, utilisé par le solveur, applique ce décalage mesuré afin de reproduire la courbe réellement tracée. Le spin nul force physiquement `Cl = 0`; un faible spin conserve la zone de Reverse Magnus.

## Spin decay reconstruit

Mackila publie `Ct = 6.45 / sqrt(Reω) + 32.1 / Reω`, mais précise que ses équations de couple ont été modifiées empiriquement et qu’il ne publie pas leurs coefficients complets. La relation textuelle seule ne reproduit pas ses figures : elle conserve trop de RPM et fait exploser V/U lorsque la bille ralentit.

Le solveur reconstruit la dynamique manquante sur les figures III-A-02 et III-A-03. Leur cas étalon, bille de 0,20 g à 0,98 J et 120 000 tr/min, donne après une seconde environ 30 000 tr/min, V/U = 0,421 et Cl = 0,034. La dérivée ajustée est une logistique :

`d(V/U)/dt = 3,929 × (V/U) × (1 - (V/U) / 0,42104)`

Cette écriture laisse un spin nul à zéro, fait converger le cas de référence sans plafond artificiel et évite l’extrapolation galopante observée avec la relation de couple incomplète. `publishedRotationalTorque()` reste exportée pour auditer la formule textuelle, mais elle n’est pas confondue avec le modèle qui a produit les graphes. Cette partie est une reconstruction traçable des sorties publiées, pas une copie du code MATLAB non publié.

Le vent est un vecteur de vitesse de l’air. Convention interface : 0° de face, 90° venant de droite, 180° de dos, 270° venant de gauche.

## Angle du canon et zérotage

L’angle saisi est directement celui du canon par rapport à l’horizontale. À `0°`, les composantes initiales sont `vx = vitesse` et `vy = 0` ; aucun solveur ne modifie cet angle. Le zéro optique agit seulement sur la ligne de visée : si la bille atteint la distance demandée, la visée relie la hauteur de l’optique à ce point de trajectoire. La portée utile correspond à la première sortie de ±0,1524 m autour de cette ligne.

## Réglage automatique du hop-up

`findFlatSpin()` recherche la rotation initiale qui maintient le plus longtemps la bille dans une enveloppe de ±0,1524 m autour de la hauteur de bouche. Le cas de réglage est toujours calculé canon horizontal, sans vent ni inclinaison latérale ; il ne modifie donc pas l’angle choisi par l’utilisateur.

Une dichotomie localise la frontière entre la première sortie vers le bas (« ça plonge ») et la première sortie vers le haut (« ça décolle »). Les cinq valeurs voisines sont ensuite comparées et le meilleur résultat est arrondi au pas d’interface, actuellement 250 tr/min. La masse, l’énergie, la vitesse, la température, la pression ou le diamètre déclenchent un nouveau calcul. Les boutons moins et plus appliquent seulement un décalage autour de cette base conseillée.

## Limites connues

- La position d’une molette de hop-up ne permet pas de déduire les RPM sans mesure ou calibration propre à la réplique.
- Le spin decay ATP est une reconstruction des graphes, car les coefficients complets n’ont pas été publiés.
- Le vent est uniforme.
- La dispersion et la balistique intérieure ne sont pas simulées.
- Les polynômes ATP ne sont pas plafonnés lorsque le ratio de spin sort du domaine expérimental ; ces résultats doivent être interprétés avec prudence.

## Évolution sûre

Tout calibrage futur doit conserver séparément :

1. le mode ATP strict ;
2. le jeu de données terrain ;
3. le modèle calibré et sa version.

Ne jamais modifier les constantes ATP pour faire correspondre un seul setup sans rendre ce calibrage explicite.
