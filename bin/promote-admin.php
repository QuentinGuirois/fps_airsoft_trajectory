<?php
declare(strict_types=1);

$root = dirname(__DIR__);
require $root . '/api/src/autoload.php';

use Fat\Api\Config;
use Fat\Api\Database;
use Fat\Api\Services\AuditLogger;
use Fat\Api\Validation\Validator;
/** @param list<string> $arguments */
function emailArgument(array $arguments): string
{
    foreach ($arguments as $index => $argument) {
        if (str_starts_with($argument, '--email=')) {
            return Validator::email(substr($argument, 8));
        }
        if ($argument === '--email' && isset($arguments[$index + 1])) {
            return Validator::email($arguments[$index + 1]);
        }
    }
    fwrite(STDERR, "Usage : php bin/promote-admin.php --email adresse@example.com\n");
    exit(2);
}

/** @return array{id:string,pseudo:string} */
function eligibleUser(\PDO $db, string $email, bool $lock = false): array
{
    $suffix = $lock ? ' FOR UPDATE' : '';
    $statement = $db->prepare("SELECT id,pseudo FROM users WHERE email=? AND email_verified_at IS NOT NULL AND deletion_requested_at IS NULL AND role='user'{$suffix}");
    $statement->execute([$email]);
    $matches = $statement->fetchAll(\PDO::FETCH_ASSOC);
    if (count($matches) !== 1) {
        throw new RuntimeException('La promotion exige exactement un compte utilisateur vérifié et actif.');
    }
    return ['id' => (string) $matches[0]['id'], 'pseudo' => (string) $matches[0]['pseudo']];
}

if (!function_exists('stream_isatty') || !stream_isatty(STDIN)) {
    fwrite(STDERR, "Cette commande exige un terminal interactif.\n");
    exit(2);
}

$email = emailArgument(array_slice($argv, 1));
$config = Config::load($root);
$db = Database::connect($config);
$candidate = eligibleUser($db, $email);

fwrite(STDOUT, "Compte vérifié trouvé :\n");
fwrite(STDOUT, "  identifiant : {$candidate['id']}\n");
fwrite(STDOUT, "  pseudo      : {$candidate['pseudo']}\n");
fwrite(STDOUT, "Saisir PROMOUVOIR pour confirmer : ");
$confirmation = trim((string) fgets(STDIN));
if (!hash_equals('PROMOUVOIR', $confirmation)) {
    fwrite(STDERR, "Promotion annulée.\n");
    exit(3);
}

try {
    $db->beginTransaction();
    $locked = eligibleUser($db, $email, true);
    if (!hash_equals($candidate['id'], $locked['id'])) {
        throw new RuntimeException('Le compte ciblé a changé avant la promotion.');
    }
    $update = $db->prepare("UPDATE users SET role='admin',version=version+1 WHERE id=? AND role='user'");
    $update->execute([$locked['id']]);
    if ($update->rowCount() !== 1) {
        throw new RuntimeException('La promotion n’a modifié aucun compte.');
    }
    $db->prepare('DELETE FROM sessions WHERE user_id=?')->execute([$locked['id']]);
    (new AuditLogger($db))->write(
        bin2hex(random_bytes(12)),
        $locked['id'],
        'admin.promoted',
        'user',
        $locked['id'],
        ['sessionsRevoked' => true],
    );
    $db->commit();
    fwrite(STDOUT, "Promotion terminée. Les sessions existantes ont été révoquées.\n");
} catch (\Throwable $error) {
    if ($db->inTransaction()) {
        $db->rollBack();
    }
    fwrite(STDERR, "Promotion impossible : {$error->getMessage()}\n");
    exit(1);
}
