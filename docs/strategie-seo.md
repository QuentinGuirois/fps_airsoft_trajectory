# Stratégie SEO France — F.A.T.

Date de travail : 18 juillet 2026  
Marché principal : France / requêtes francophones  
Objectif : faire de F.A.T. la référence francophone sur la conversion Joules/FPS, la balistique extérieure et le réglage de trajectoire airsoft.

## 1. Positionnement

F.A.T. ne doit pas être présenté comme « un convertisseur de plus ». Son avantage défendable est l’association de quatre éléments :

1. un outil gratuit qui répond immédiatement à une intention pratique ;
2. un moteur de trajectoire documenté et attribué à l’Airsoft Trajectory Project de Mackila ;
3. une voix identifiable, Keep, développeur web et joueur ;
4. des contenus qui relient la physique aux problèmes rencontrés sur le terrain.

Promesse éditoriale : **mesurer, comprendre, comparer, valider sur cible**.

## 2. Faiblesses de l’ancienne version

- Une seule URL concentrait l’outil, la présentation et une très longue FAQ : peu de portes d’entrée organiques.
- Les intentions « convertir », « simuler », « choisir une bille », « régler le hop-up » et « comprendre la portée » n’avaient pas leur page propre.
- Deux implémentations du moteur coexistaient avec des coefficients empiriques différents.
- Plotly et Font Awesome dépendaient de CDN externes, ce qui limitait le vrai fonctionnement hors ligne.
- Le sitemap contenait une URL d’un autre domaine ; ce type d’URL n’a pas sa place dans le sitemap du domaine F.A.T.
- La date du sitemap était ancienne et aucune stratégie de publication n’était visible.
- La page personnelle était trop courte pour installer Keep comme auteur et visage du projet.

## 3. Arborescence publiée dans la V3

| Priorité | URL | Requête principale | Intention | CTA principal |
|---|---|---|---|---|
| P0 | `/` | calculateur airsoft | Utiliser un outil complet | Simuler un setup |
| P0 | `/convertisseur-joules-fps/` | convertisseur joules fps airsoft | Convertir immédiatement | Ouvrir le simulateur |
| P0 | `/simulateur-trajectoire-airsoft/` | simulateur trajectoire airsoft | Comprendre/utiliser l’outil | Lancer une simulation |
| P0 | `/guides/choisir-poids-bille-airsoft/` | quel poids bille airsoft choisir | Choisir un grammage | Comparer deux billes |
| P0 | `/guides/regler-hop-up-airsoft/` | régler hop up airsoft | Résoudre un problème | Tester trois spins |
| P0 | `/guides/portee-airsoft/` | portée airsoft | Comprendre/estimer | Calculer la portée utile |
| P0 | `/guides/joule-creep-airsoft/` | joule creep airsoft | Comprendre/mesurer | Comparer les mesures chrony |
| P0 | `/modele-physique-atp/` | modèle trajectoire bille airsoft | Vérifier la crédibilité | Tester le moteur ATP |
| P0 | `/faq-airsoft-balistique/` | questions balistique airsoft | Réponses longue traîne | Ouvrir le calculateur |
| P0 | `/a-propos/` | Keep F.A.T. airsoft | Identifier l’auteur | Tester/partager l’outil |

Ces pages forment un premier silo cohérent. Elles doivent être indexées avant de multiplier les articles.

## 4. Pages outils à développer ensuite

Les outils obtiennent naturellement des liens et des partages. Ils doivent produire un résultat unique et utile, pas seulement réafficher la même conversion avec un autre titre.

| Priorité | Slug proposé | Requête cible | Fonction utile | Notes anti-cannibalisation |
|---|---|---|---|---|
| P1 | `/outils/tableau-joules-fps-airsoft/` | tableau joules fps airsoft | Tableau interactif multi-grammages exportable | Une seule URL pour tous les grammages ; sections ancrées |
| P1 | `/outils/comparateur-poids-billes-airsoft/` | comparateur poids bille airsoft | Courbes de 2 à 4 masses à énergie égale/réelle | Centré sur la comparaison, pas sur le guide de choix |
| P1 | `/outils/calculateur-energie-distance-airsoft/` | énergie bille airsoft à distance | Énergie, vitesse et temps à une distance choisie | Résultat dédié à la distance |
| P1 | `/outils/calculateur-derive-vent-airsoft/` | dérive vent bille airsoft | Comparaison de dérive par grammage et vent | Landing spécifique vent + outil |
| P1 | `/outils/calculateur-zero-airsoft/` | zérotage airsoft calcul | Angle canon, premier/deuxième zéro, contre-visée | Dédié aux optiques |
| P1 | `/outils/analyse-serie-chrony/` | calcul moyenne chrony airsoft | Coller une série, moyenne, écart-type, amplitude | Très partageable par associations et techs |
| P1 | `/outils/detecteur-joule-creep/` | calcul joule creep | Comparer plusieurs masses et quantifier le creep | Complète le guide sans le remplacer |
| Publié | `/outils/choisir-gaz-airsoft-pression-temperature/` | quel gaz airsoft choisir température | Sélection d’une bouteille, température d’usage et restitution de la pression théorique | Pack V2 validé le 18 juillet 2026 |
| P2 | `/outils/fiche-controle-chrony/` | fiche passage chrony airsoft | Générer/imprimer une fiche de contrôle | Acquisition associations/organisateurs |
| P2 | `/outils/generateur-carte-setup-airsoft/` | fiche setup airsoft | Carte partageable avec paramètres et QR code | Boucle sociale et backlinks |
| P2 | `/outils/calculateur-mrad-moa-airsoft/` | correction mrad airsoft | Écart cm ↔ mrad/MOA selon distance | Intention optique distincte |
| P2 | `/outils/temps-vol-bille-airsoft/` | temps de vol bille airsoft | Comparer masses et distance | Peut devenir un module du comparateur si volume faible |

### Page-outil publiée : pression des gaz selon la température

Statut au 18 juillet 2026 : pack V2 validé, 49 produits publiables, 35 courbes uniques et conditionnements intégrés. L’URL figure dans le sitemap et le cache PWA. Les références ambiguës restent en quarantaine et ne sont pas proposées dans l’interface.

URL publiée : `/outils/choisir-gaz-airsoft-pression-temperature/`  
Requêtes principales ciblées : `quel gaz airsoft choisir`, `pression gaz airsoft température`, `green gas pression psi`, `gaz airsoft hiver été`.

Fonction livrée : l’utilisateur sélectionne une température, une marque puis une bouteille. L’outil restitue la pression théorique à cette température, normalise les produits dont la pression commerciale est annoncée à 20 °C, 25 °C ou 30 °C et permet de comparer deux références sur une même base.

Le jeu de données intégré conserve notamment :

- marque ;
- nom commercial exact et variante ;
- pression annoncée ;
- unité d’origine et unité normalisée ;
- température de référence associée à la pression ;
- plage de température recommandée si elle est publiée ;
- composition ou famille de gaz uniquement lorsqu’elle est documentée ;
- URL et type de source : fabricant, distributeur officiel ou revendeur ;
- date de collecte et date de dernière vérification ;
- pays/marché, car une même appellation peut couvrir des produits différents ;
- niveau de confiance et éventuelles contradictions entre sources.

Garde-fous fonctionnels :

- ne jamais comparer directement deux pressions annoncées à des températures de référence différentes sans normalisation visible ;
- afficher la valeur source et la température source à côté de la valeur calculée ;
- distinguer donnée fabricant, donnée distributeur et estimation ;
- ne pas extrapoler silencieusement au-delà d’une plage validée ;
- conserver l’URL et la date de chaque donnée pour audit ;
- présenter le résultat comme une pression théorique, pas comme une garantie de fonctionnement ou une recommandation universelle pour une réplique ;
- prévoir une procédure de signalement et de correction des données.

Structure éditoriale publiée : outil en tête de page, explication de la différence entre une référence à 20 °C et à 25 °C, lecture des unités, limites du calcul, choix selon conditions d’utilisation et méthodologie de collecte. Une seule page porte l’outil et l’intention principale afin d’éviter de séparer artificiellement « choix du gaz » et « calcul de pression ».

## 5. Cluster « FPS, Joules et chronographe »

| Priorité | Slug proposé | Requête principale | Angle éditorial |
|---|---|---|---|
| P1 | `/guides/comment-passer-replique-chrony/` | passer réplique chrony airsoft | Protocole reproductible, erreurs de masse et séries |
| P1 | `/guides/fps-ou-joules-airsoft/` | différence fps joules airsoft | Définition et cas pratiques |
| P1 | `/guides/combien-fps-pour-1-joule/` | 1 joule combien de fps airsoft | Réponse conditionnée au grammage, renvoi au tableau |
| P1 | `/guides/mesurer-regularite-replique-airsoft/` | régularité fps airsoft | Moyenne, amplitude, écart-type et interprétation |
| P1 | `/guides/puissance-airsoft-france/` | puissance airsoft france | Cadre français + distinction règles de terrain ; relecture juridique et sources officielles obligatoires |
| P2 | `/guides/fps-0-20-vs-grammage-joue/` | fps 0.20 airsoft | Pourquoi la référence 0,20 g ne suffit pas |
| P2 | `/guides/temperature-gaz-fps-airsoft/` | température gaz airsoft fps | Variation GBB/GBBR et protocole de mesure |
| P2 | `/guides/hpa-pression-joules-airsoft/` | régler pression hpa joules | Mesure, stabilité et limites ; aucune recette de contournement |
| P2 | `/guides/chronographe-airsoft-comment-choisir/` | choisir chronographe airsoft | Critères, tunnel, cadence, mémoire ; actualisation annuelle |

## 6. Cluster « Billes et grammages »

Éviter une page mince par poids. Une seule page comparative doit porter les requêtes 0,20/0,25/0,28/0,30/0,32 g grâce à des sections solides et un tableau. Créer une page séparée uniquement lorsqu’une intention de rôle est réellement différente.

| Priorité | Slug proposé | Requête principale | Angle éditorial |
|---|---|---|---|
| P1 | `/guides/tableau-poids-billes-airsoft/` | tableau poids bille airsoft | 0,20 à 0,48 g, vitesses à énergie égale, usages |
| P1 | `/guides/bille-airsoft-lourde-ou-legere/` | bille lourde ou légère airsoft | Conservation de vitesse, vent et temps de vol |
| P1 | `/guides/grammage-bille-aeg/` | grammage bille aeg | Méthode de choix pour AEG standard, sans chiffre universel |
| P1 | `/guides/grammage-bille-sniper-airsoft/` | grammage bille sniper airsoft | Capacité du hop-up, énergie réelle, vent |
| P1 | `/guides/grammage-bille-hpa/` | grammage bille hpa | Joule Creep et mesure spécifique |
| P2 | `/guides/grammage-bille-gbbr/` | grammage bille gbbr | Température, gaz, régularité |
| P2 | `/guides/diametre-bille-airsoft-5-95-6mm/` | diamètre bille airsoft | Diamètre nominal/réel et influence limitée dans ATP |
| P2 | `/guides/bille-bio-performance-trajectoire/` | bille bio précision airsoft | Tolérances, conservation et tests ; éviter les affirmations de marque non mesurées |
| P2 | `/guides/qualite-bille-airsoft-precision/` | bille airsoft précision | Sphéricité, masse, surface, lots et protocole de tri |

## 7. Cluster « Hop-up et trajectoire »

| Priorité | Slug proposé | Requête principale | Angle éditorial |
|---|---|---|---|
| P1 | `/guides/effet-magnus-airsoft/` | effet magnus airsoft | Explication visuelle accessible, lien vers ATP |
| P1 | `/guides/bille-airsoft-monte-fin-trajectoire/` | bille airsoft monte fin trajectoire | Diagnostic overhop, grammage et zérotage |
| P1 | `/guides/bille-airsoft-tombe-vite/` | bille airsoft tombe vite | Diagnostic manque de spin, énergie, joint, grammage |
| P1 | `/guides/bille-airsoft-part-a-gauche-droite/` | bille airsoft part à gauche | Cant, appui désaxé, vent, dispersion |
| P1 | `/guides/trajectoire-tendue-airsoft/` | trajectoire tendue airsoft | Définition, réglage et limites |
| P2 | `/guides/reverse-magnus-airsoft/` | reverse magnus airsoft | Sujet expert, polynôme ATP et implications |
| P2 | `/guides/r-hop-flat-hop-trajectoire/` | r hop flat hop différence | Effet attendu, protocole avant/après, sans classement marketing |
| P2 | `/guides/nettoyer-hop-up-regularite/` | nettoyer hop up airsoft | Entretien et signes d’irrégularité |
| P2 | `/guides/alignement-hop-up-derive/` | aligner hop up airsoft | Diagnostic dérive constante |

## 8. Cluster « Portée, précision et vent »

| Priorité | Slug proposé | Requête principale | Angle éditorial |
|---|---|---|---|
| P1 | `/guides/augmenter-portee-airsoft/` | augmenter portée airsoft | Régularité, hop-up, bille, mesure ; pas de promesse magique |
| P1 | `/guides/mesurer-portee-airsoft/` | mesurer portée airsoft | Protocole cibles/distances/taux d’impact |
| P1 | `/guides/portee-vs-precision-airsoft/` | portée précision airsoft | Distinguer distance finale et groupement |
| P1 | `/guides/vent-airsoft-grammage/` | vent airsoft bille | Vent longitudinal, latéral, comparaison des masses |
| P2 | `/guides/temps-vol-bille-airsoft/` | temps de vol airsoft | Anticipation de cible et compromis masse/vitesse |
| P2 | `/guides/energie-residuelle-bille-airsoft/` | énergie résiduelle airsoft | Pourquoi la bille lourde conserve mieux son énergie |
| P2 | `/guides/temperature-portee-airsoft/` | température portée airsoft | Densité de l’air vs variation mécanique de la réplique |
| P2 | `/guides/altitude-portee-airsoft/` | altitude airsoft portée | Pression/densité et effet sur Magnus |
| P2 | `/guides/zero-red-dot-airsoft/` | régler red dot airsoft distance | Hauteur optique, zérotage, holdover |
| P2 | `/guides/cant-replique-airsoft/` | inclinaison réplique airsoft | Transformation de la portance en dérive |

## 9. Cluster « Protocoles et données communautaires »

Ces contenus peuvent créer la notoriété que les guides génériques seuls ne produisent pas.

| Priorité | Slug proposé | Requête / objectif | Livrable |
|---|---|---|---|
| P1 | `/lab/protocole-test-trajectoire-airsoft/` | test portée airsoft fiable | Protocole public versionné et fiche téléchargeable |
| P1 | `/lab/protocole-test-grammage-airsoft/` | comparer billes airsoft | Série chrony + cible + météo + méthode de décision |
| P2 | `/lab/base-tests-communautaires/` | données trajectoire airsoft | Jeux de données soumis et modérés |
| P2 | `/lab/validation-modele-atp/` | fiabilité ATP airsoft | Comparaison prédiction/mesure, erreurs et corrections |
| P2 | `/lab/cas-pratique-aeg-1-5j/` | trajectoire aeg 1.5 joule | Cas mesuré complet, plusieurs grammages |
| P2 | `/lab/cas-pratique-bolt-2j/` | trajectoire sniper airsoft 2 joules | Cas mesuré complet |
| P3 | `/setups/` | setup airsoft trajectoire | Galerie filtrable de fiches partagées, modération obligatoire |
| P3 | `/associations/kit-controle-chrony/` | contrôle chrony association airsoft | Kit imprimable, outil série et QR code |

## 10. Pages à ne pas créer en série

- Une URL par combinaison Joules/grammage (`1-joule-0-20g`, `1-joule-0-25g`, etc.) : contenu mince et cannibalisation. Utiliser un tableau interactif rendu côté serveur ou présent dans le HTML.
- Une page par valeur FPS : même problème.
- Des pages « meilleure bille [marque] » sans protocole, échantillons et mise à jour.
- Des pages de villes ou départements sans service local réel.
- Des textes générés automatiquement à partir du calculateur sans analyse humaine.
- Des pages légales ou sécurité sans source officielle, date de révision et responsable éditorial.

## 11. Ordre de production recommandé

### Phase 1 — socle et indexation (semaines 1 à 4)

- Déployer les dix pages P0 de la V3.
- Connecter Google Search Console et Bing Webmaster Tools.
- Envoyer le sitemap, demander l’indexation des pages piliers et vérifier les canoniques.
- Installer une mesure respectueuse de la vie privée : Plausible, Matomo ou GA4 selon le choix projet.
- Suivre les événements `simulation_complete`, `comparison_add`, `setup_share`, `pwa_install` et les clics internes.
- Corriger toute erreur Core Web Vitals ou donnée structurée avant d’augmenter le volume.

### Phase 2 — domination des outils (mois 2 et 3)

1. Tableau Joules/FPS interactif.
2. Analyseur de série chrony.
3. Comparateur de grammages.
4. Calculateur de dérive au vent.
5. Détecteur de Joule Creep.

Chaque outil reçoit une landing explicative, un résultat partageable et un lien vers les guides associés.

### Phase 3 — problèmes terrain (mois 3 à 6)

Publier les diagnostics forte intention : bille qui monte, tombe, part à gauche, portée insuffisante, réglage de zéro, sensibilité au vent. Deux contenus solides par mois valent mieux que huit pages répétitives.

### Phase 4 — autorité et liens (mois 6 à 12)

- Lancer le protocole de tests communautaires.
- Proposer le kit chrony aux associations et organisateurs.
- Publier des cas pratiques avec données brutes téléchargeables.
- Contacter créateurs vidéo, techniciens, boutiques et associations pour tester l’outil ou commenter la méthode.
- Faire de Mackila une attribution visible, jamais une mention décorative.

## 12. Maillage interne

- Chaque guide renvoie vers un seul outil principal au moment où l’utilisateur a assez de contexte pour agir.
- Le convertisseur renvoie vers Joule Creep et le simulateur.
- Les pages grammage renvoient vers hop-up, vent et comparateur.
- Les pages portée renvoient vers zérotage, grammage et protocole de mesure.
- Tous les contenus scientifiques renvoient vers la page ATP, qui reste la référence méthodologique.
- La page auteur est liée depuis les contenus importants et les données structurées.

Ancres recommandées : descriptives et variées, sans répéter mécaniquement la même requête exacte.

## 13. Conversion et fidélisation

Objectif principal : terminer une simulation utile.  
Objectifs secondaires : ajouter une comparaison, partager un setup, installer la PWA, consulter un guide associé.

Boucle de croissance proposée :

1. un joueur arrive par une question ou un outil ;
2. il simule son setup ;
3. il partage une URL ou une carte de résultat ;
4. le destinataire ouvre une simulation préremplie ;
5. les deux comparent une mesure terrain ;
6. un cas documenté peut alimenter le laboratoire communautaire.

## 14. Mesure SEO

Indicateurs à suivre par cluster, pas seulement au niveau du domaine :

- pages indexées et requêtes émergentes ;
- impressions, clics et CTR par intention ;
- simulations terminées depuis une entrée organique ;
- taux d’ajout d’une comparaison ;
- partages de setup et installations PWA ;
- liens reçus vers les outils et protocoles ;
- retour des utilisateurs sur la fidélité terrain ;
- requêtes où deux pages du site se concurrencent.

Les volumes de recherche doivent être validés avec Search Console après lancement, puis avec Keyword Planner, Semrush, Ahrefs ou un outil équivalent si disponible. Les priorités de ce document reposent sur l’intention et la cohérence thématique ; elles ne prétendent pas fournir un volume mensuel non mesuré.
