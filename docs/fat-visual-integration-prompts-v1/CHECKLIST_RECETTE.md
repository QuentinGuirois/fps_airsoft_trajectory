# Checklist de recette — identité F.A.T.

## État de référence

- [ ] `git status` relevé et modifications utilisateur préservées.
- [ ] Tests de référence notés avant modification.
- [ ] Nombre de pages indexables avant/après identique, hors page explicitement validée.
- [ ] Nombre de marques, produits, températures et ancres gaz avant/après identique.
- [ ] Cas étalons ATP avant/après identiques dans les tolérances existantes.
- [ ] Aucun remplacement du dépôt par la copie `uploads/` de la maquette.

## Identité et actifs

- [ ] Option logo `1a` utilisée partout.
- [ ] Lockup lisible à 28–30 px.
- [ ] Favicon SVG valide.
- [ ] PNG 192×192 et 512×512 aux dimensions réelles.
- [ ] Icône maskable distincte et zone de sécurité vérifiée.
- [ ] Image Open Graph distincte des icônes PWA.
- [ ] Aucun lien Google Fonts, CDN ou ressource distante nécessaire au rendu.
- [ ] Licences des polices et de Three.js présentes.

## Thèmes

- [ ] `Système`, `Nuit`, `Jour` accessibles au clavier.
- [ ] Choix persistant après reload.
- [ ] Mode système réagit à un changement OS.
- [ ] Aucun flash sombre/clair au chargement.
- [ ] `color-scheme` et `theme-color` corrects.
- [ ] Canvas et 3D se recolorent sans recalcul physique.
- [ ] Aucun texte `#a8ff3f` insuffisamment contrasté en clair.
- [ ] Les guides respectent le choix global et ne forcent pas le clair.

## Loader

- [ ] N’apparaît pas pour un calcul inférieur à 300 ms.
- [ ] Plein écran uniquement au premier chargement lent.
- [ ] Overlay compact pour recalcul lent.
- [ ] Lié au `requestId` courant ; une ancienne réponse ne ferme pas le nouveau loader.
- [ ] Plafonne à 99 % avant réponse.
- [ ] 100 % uniquement sur succès réel.
- [ ] Erreur visible, interface libérée et fallback possible.
- [ ] Aucun délai artificiel.
- [ ] `aria-busy` et statut accessibles.
- [ ] Reduced motion : bille fixe, pas de clignotement ni de texte tournant.
- [ ] Fallback sans CSS Motion Path acceptable.

## Pages et composants

- [ ] Header, logo, navigation et thème présents partout.
- [ ] Footer et liens internes cohérents.
- [ ] Camo réalisé en CSS, jamais en bitmap.
- [ ] Stencil limité aux marquages.
- [ ] Acide limité aux données/CTA/surfaces ponctuelles.
- [ ] Tags textuels sur résultats et valeurs externes mises en avant.
- [ ] Bloc attribution Mackila visible et réutilisé aux endroits prévus.
- [ ] Aucun profil opérateur, mesure ou lien social fictif.
- [ ] Photo Keep réelle et correctement dimensionnée si publiée.

## Cockpit 2D

- [ ] Tous les champs et presets fonctionnent.
- [ ] Hop-up auto et réglage fin fonctionnent.
- [ ] Onglets trajectoire, écart visée, énergie, dérive, rotation fonctionnent.
- [ ] Courbe active, comparaisons et légende différenciables sans couleur seule.
- [ ] Enveloppe ±15,24 cm seulement sur la trajectoire.
- [ ] Ligne de visée, sol et marqueurs corrects.
- [ ] Exagération verticale annoncée et fidèle au facteur appliqué.
- [ ] Caption Canvas et table numérique conservées.
- [ ] Sticky ne masque ni header ni contenu.
- [ ] Clavier mobile ne bloque pas les réglages.

## Vue 3D

- [ ] Aucun téléchargement 3D avant activation.
- [ ] Points identiques au résultat du Worker/2D.
- [ ] Projection de dérive et marqueurs présents.
- [ ] Caméras Drone, Tireur et Profil fonctionnelles.
- [ ] Rejouer fonctionne et respecte reduced motion.
- [ ] WebGL absent : toggle caché, aucune erreur, 2D intacte.
- [ ] Import échoué : même fallback.
- [ ] Fullscreen mobile, sortie, tactile et safe areas fonctionnent.
- [ ] Refus du verrouillage paysage correctement géré.
- [ ] Boucle et ressources libérées à la fermeture.
- [ ] 3D disponible hors ligne après installation/cache.

## Fonctionnel et données

- [ ] Worker fonctionne.
- [ ] Fallback sans Worker fonctionne.
- [ ] Concurrence de requêtes ne rend pas un ancien résultat.
- [ ] Comparaisons ajout/suppression intactes.
- [ ] Partage natif et presse-papiers intacts.
- [ ] URL `m`, `j`, `h`, `rpm`, `z`, `w`, `wd`, `t`, `p`, `a`, `c` intactes.
- [ ] Stockage et reset du tir intacts.
- [ ] Outil gaz : marque, modèle, température, comparaison, URL et stockage intacts.
- [ ] Dataset gaz le plus récent strictement conservé.

## Responsive et accessibilité

- [ ] 360 px.
- [ ] 390 px.
- [ ] 768 px.
- [ ] 1024 px.
- [ ] 1440 px.
- [ ] Nuit et jour pour chaque format critique.
- [ ] Zoom 200 % sans perte de contenu.
- [ ] Navigation clavier complète.
- [ ] Focus visible.
- [ ] Hit targets ≥44 px sur mobile.
- [ ] Contrastes AA.
- [ ] Libellés, noms accessibles, live regions non bavardes.
- [ ] `prefers-reduced-motion` complet.

## PWA, SEO et livraison

- [ ] `CACHE` incrémenté.
- [ ] Toutes les nouvelles ressources locales mises en cache selon la stratégie choisie.
- [ ] Installation PWA réussie.
- [ ] Reload hors ligne réussi sur accueil, simulateur et outil gaz.
- [ ] Aucun 404 interne.
- [ ] H1 unique, title, description et canonique préservés.
- [ ] JSON-LD valide et non altéré involontairement.
- [ ] Sitemap limité au domaine F.A.T. et aux pages réelles.
- [ ] Aucun layout shift important dû aux polices/images/graphes.
- [ ] Poids initial mesuré ; chunk 3D mesuré et différé.
- [ ] Rapport final, captures et limites restantes fournis.
- [ ] Tous les tests passent avant déclaration de fin.
