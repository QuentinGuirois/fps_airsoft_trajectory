<?php
declare(strict_types=1);

$root = dirname(__DIR__);
require $root . '/api/src/autoload.php';

use Fat\Api\Config;
use Fat\Api\Database;
use Fat\Api\Support;
use Fat\Api\Validation\Validator;

if (!function_exists('posix_isatty') || !posix_isatty(STDIN)) {
    fwrite(STDERR, "Cette commande exige un terminal interactif.\n");
    exit(2);
}
fwrite(STDOUT, "Email admin : ");
$email = Validator::email(trim((string) fgets(STDIN)));
fwrite(STDOUT, "Pseudo admin : ");
$pseudo = Validator::text(trim((string) fgets(STDIN)), 'Le pseudo', 2, 32);
fwrite(STDOUT, "Mot de passe admin (saisie masquée) : ");
shell_exec('stty -echo');
$password = trim((string) fgets(STDIN));
shell_exec('stty echo');
fwrite(STDOUT, "\n");
$password = Validator::password($password);
$config = Config::load($root);
$db = Database::connect($config);
$algorithm = defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_BCRYPT;
$statement = $db->prepare("INSERT INTO users (id,email,pseudo,password_hash,role,email_verified_at) VALUES (?,?,?,?, 'admin', UTC_TIMESTAMP())");
$statement->execute([Support::uuid(), $email, $pseudo, password_hash($password, $algorithm)]);
fwrite(STDOUT, "Compte admin créé.\n");
