# Audit final F.A.T. — 18 juillet 2026

## État applicatif

- Les inscriptions restent ouvertes par défaut. Le coupe-circuit serveur `ACCOUNT_REGISTRATION_ENABLED=false` est testé séparément et refuse une création avant validation ou mutation.
- Les jetons de vérification et de réinitialisation sont transportés dans le fragment d'URL, puis supprimés de la barre d'adresse avant le premier appel réseau.
- La connexion applique des quotas distincts par adresse IP et par identité normalisée.
- `/api/v1/health` répond en `GET` et en `HEAD`.
- Les journaux d'audit et techniques ont une rétention configurable, fixée à 180 jours par défaut.
- Le cache public d'une image de card est court et révocable. Les réponses privées et l'API ne doivent jamais être mises en cache par Cloudflare.

## Messagerie et TLS

Contrôles publics effectués le 18 juillet 2026 :

- le MX de `fps-airsoft-trajectory.com` pointe vers `_dc-mx.e16eb425788f.fps-airsoft-trajectory.com`, qui résout directement vers `46.247.133.37` ;
- `contact@fps-airsoft-trajectory.com` reçoit effectivement les messages ;
- `mail.fps-airsoft-trajectory.com` et `webmail.fps-airsoft-trajectory.com` résolvent vers les adresses du proxy Cloudflare ;
- leurs accès HTTPS retournent `526` ;
- SMTP Submission répond sur le port 587 en TLS 1.3, mais présente un certificat dont le nom est uniquement `plesk.projectil-sogepress.fr`, valide du 4 juin au 2 septembre 2026 ; ce certificat ne couvre pas `mail.fps-airsoft-trajectory.com` ;
- aucun enregistrement DS public n'a été observé pour le domaine ;
- aucun enregistrement `_mta-sts` ni `_smtp._tls` n'a été observé.

Le MX direct explique que la réception fonctionne malgré les alertes Plesk. En revanche, les alias `mail` et `webmail` ne sont pas correctement utilisables sous leur propre nom. Le proxy HTTP standard de Cloudflare ne transporte pas SMTP, IMAP ou POP.

### Correction sûre dans cet ordre

1. Dans Cloudflare DNS, passer le nom utilisé par les clients de messagerie (`mail`) en **DNS only**. Vérifier avant validation que sa cible est bien l'IP/hostname fourni par 3GK Software et non une adresse Cloudflare.
2. Dans Plesk/SSL It!, émettre un certificat Let's Encrypt couvrant `mail.fps-airsoft-trajectory.com`, puis l'affecter aux services de messagerie. Tester SMTP Submission et IMAP avec validation du nom.
3. Pour `webmail`, choisir explicitement :
   - le supprimer s'il n'est pas utilisé ; ou
   - émettre un certificat couvrant `webmail.fps-airsoft-trajectory.com`, puis le passer en DNS only ou conserver le proxy seulement après validation de l'origine en mode Full (strict).
4. Garder Cloudflare en **Full (strict)**. Ne pas contourner le `526` en passant en mode Full non strict.
5. Ne pas modifier le MX, SPF, DKIM ou DMARC tant que l'envoi et la réception fonctionnent et qu'aucun contrôle dédié ne montre d'erreur.

`includeSubDomains` n'est volontairement pas activé dans HSTS avant cette correction. Il pourra être ajouté lorsque tous les sous-domaines conservés répondront correctement en HTTPS.

## Réglages Cloudflare conseillés

### À activer ou confirmer

- SSL/TLS : **Full (strict)**, TLS minimum 1.2, TLS 1.3 activé, redirection HTTPS activée.
- DNSSEC : l'activer dans Cloudflare puis publier/valider le DS chez le registrar. Contrôler le statut « actif » avant de considérer l'opération terminée.
- WAF : conserver le Free Managed Ruleset actif. Bot Fight Mode peut être essayé avec surveillance des événements et des faux positifs.
- HTTP/3 : activé.
- Compression : comportement Cloudflare par défaut (Zstandard/Brotli/Gzip selon le plan et le navigateur).
- Early Hints : activable ; son gain dépendra de la présence de vrais en-têtes `Link: rel=preload`.
- Cache Rules : contourner impérativement le cache pour `/api/*`, `/compte/*` et toute réponse portant `Cache-Control: no-store`; réserver les TTL longs aux actifs versionnés.
- Restaurer l'IP visiteur à l'origine uniquement depuis les plages Cloudflare officielles, puis vérifier les quotas d'authentification en production.

### À laisser désactivé

- 0-RTT : les requêtes mutantes de compte et de cards ne doivent pas être exposées au risque de rejeu.
- Rocket Loader : il peut perturber le bootstrap de thème, les modules, le Worker et la 3D lazy-loadée.
- Email Address Obfuscation : elle transforme le HTML et injecte du code, ce qui entre en conflit avec la CSP stricte et n'apporte rien à l'adresse de contact publiée.
- Cache Everything sur le HTML, l'API ou l'espace compte.

MTA-STS et TLS-RPT sont une amélioration ultérieure utile, mais seulement après avoir stabilisé le certificat et les noms réels du serveur MX. Commencer MTA-STS en mode `testing`; une politique erronée en `enforce` peut bloquer des messages légitimes.
