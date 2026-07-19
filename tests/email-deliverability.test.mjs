import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('les emails Claude restent des documents autonomes en tableaux, sans code actif ni dépendance', async () => {
  const templates = await Promise.all([
    read('api/templates/email/email-bienvenue.html'),
    read('api/templates/email/email-reset-mdp.html'),
    read('api/templates/email/email-moderation.html'),
  ]);
  for (const html of templates) {
    assert.match(html, /^<!doctype html>/i);
    assert.match(html, /<html lang="fr"/);
    assert.match(html, /<meta name="x-apple-disable-message-reformatting">/);
    assert.ok((html.match(/<table role="presentation"/g) || []).length >= 5);
    assert.match(html, /width="100%" style="width:100%;max-width:520px/);
    assert.match(html, /<!--\[if mso\]>/);
    assert.match(html, /mso-line-height-rule:exactly/);
    assert.match(html, /style="display:block[^>]+font-family:Courier New/);
    assert.match(html, /Le bouton ne fonctionne pas \?|Dans L’Armurerie/);
    assert.match(html, /https:\/\/fps-airsoft-trajectory\.com\/|{{LIEN_MODERATION}}/);
    assert.match(html, /mailto:contact@fps-airsoft-trajectory\.com/);
    assert.match(html, /src="{{LOGO_URL}}"/);
    assert.doesNotMatch(html, /<(?:script|form|video|iframe)\b/i);
    assert.doesNotMatch(html, /<link\b|@import|url\s*\(|data:image|tracking[-_]|pixel\.gif|width="1"\s+height="1"/i);
    assert.doesNotMatch(html, /REMPLACER-PAR|fat-airsoft\.fr|LIEN_DESINSCRIPTION/i);
  }
});

test('les gabarits exposent uniquement les variables transactionnelles attendues', async () => {
  const [welcome, reset, moderation] = await Promise.all([
    read('api/templates/email/email-bienvenue.html'),
    read('api/templates/email/email-reset-mdp.html'),
    read('api/templates/email/email-moderation.html'),
  ]);
  assert.deepEqual(new Set(welcome.match(/{{[A-Z_]+}}/g)), new Set(['{{PSEUDO}}', '{{LIEN_CONFIRMATION}}', '{{LOGO_URL}}']));
  assert.deepEqual(new Set(reset.match(/{{[A-Z_]+}}/g)), new Set(['{{EMAIL}}', '{{LIEN_RESET}}', '{{DATE}}', '{{HEURE}}', '{{IP_TRONQUEE}}', '{{LOGO_URL}}']));
  assert.deepEqual(new Set(moderation.match(/{{[A-Z_]+}}/g)), new Set(['{{PSEUDO}}', '{{REPLIQUE}}', '{{TYPE}}', '{{LIEN_MODERATION}}', '{{LOGO_URL}}']));
  assert.match(welcome, /LIEN VALABLE 24 H/);
  assert.match(reset, /LIEN VALABLE 30 MIN · UTILISABLE UNE SEULE FOIS/);
});

test('les gabarits transactionnels ne sont pas servis directement par Apache', async () => {
  const access = await read('api/templates/.htaccess');
  assert.match(access, /^Require all denied\s*$/);
});

test('la notification de modération cible les admins vérifiés sans bloquer la card', async () => {
  const [notifier, controller, application] = await Promise.all([
    read('api/src/Services/ModerationNotifier.php'),
    read('api/src/Controllers/ReplicaController.php'),
    read('api/src/Application.php'),
  ]);
  assert.match(notifier, /role='admin'/);
  assert.match(notifier, /email_verified_at IS NOT NULL/);
  assert.match(notifier, /deletion_requested_at IS NULL/);
  assert.match(notifier, /array_unique/);
  assert.match(notifier, /catch \(\\Throwable \$error\)/);
  assert.doesNotMatch(notifier, /quentin|guirois|gmail\.com/i);
  assert.match(controller, /replicaPending\(\$params\['id'\]\)/g);
  assert.match(application, /new ModerationNotifier\(\$this->db, \$mailer, \$emails\)/);
});

test('le rendu échappe les données, refuse les variables manquantes et tronque les IP', async () => {
  const factory = await read('api/src/Services/TransactionalEmailFactory.php');
  assert.match(factory, /htmlspecialchars\(\$value, ENT_QUOTES \| ENT_SUBSTITUTE, 'UTF-8'\)/);
  assert.match(factory, /preg_match\('\/{{\[A-Z_\]\+}}\/'/);
  assert.match(factory, /APP_ORIGIN/);
  assert.ok(factory.includes("return $parts[0] . '.' . $parts[1] . '.—.—';"));
  assert.match(factory, /FILTER_FLAG_IPV6/);
  assert.doesNotMatch(factory, /setcookie|localStorage|file_put_contents/);
});

test('le mail natif émet un multipart alternative conforme sans en-tête marketing', async () => {
  const [mailer, mime, message, config] = await Promise.all([
    read('api/src/Services/Mailer.php'),
    read('api/src/Services/MimeEncoder.php'),
    read('api/src/Services/EmailMessage.php'),
    read('config/.env.example'),
  ]);
  assert.match(mailer, /Content-Type: multipart\/alternative/);
  assert.match(mailer, /MIME-Version: 1\.0/);
  assert.match(mailer, /Reply-To:/);
  assert.match(mailer, /Message-ID:/);
  assert.match(mailer, /Auto-Submitted: auto-generated/);
  assert.match(mailer, /X-Auto-Response-Suppress: All/);
  assert.match(mailer, /FILTER_VALIDATE_EMAIL/);
  assert.match(mailer, /mb_encode_mimeheader/);
  assert.match(mailer, /mail\(\$recipient, \$subject, \$body, implode\("\\r\\n", \$headers\), '-f' \. \$from\)/);
  assert.match(mime, /Content-Type: text\/plain; charset=UTF-8/);
  assert.match(mime, /Content-Type: text\/html; charset=UTF-8/);
  assert.equal((mime.match(/Content-Transfer-Encoding: quoted-printable/g) || []).length, 2);
  assert.match(mime, /quoted_printable_encode/);
  assert.match(message, /versions texte et HTML sont obligatoires/);
  assert.match(config, /MAIL_FROM=noreply@fps-airsoft-trajectory\.com/);
  assert.match(config, /MAIL_REPLY_TO=contact@fps-airsoft-trajectory\.com/);
  assert.doesNotMatch(`${mailer}\n${mime}`, /List-Unsubscribe|Precedence:\s*bulk/i);
});
