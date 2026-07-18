<?php
declare(strict_types=1);

spl_autoload_register(static function (string $class): void {
    $prefix = 'Fat\\Api\\';
    if (!str_starts_with($class, $prefix)) {
        return;
    }
    $relative = str_replace('\\', DIRECTORY_SEPARATOR, substr($class, strlen($prefix)));
    $path = __DIR__ . DIRECTORY_SEPARATOR . $relative . '.php';
    if (is_file($path)) {
        require $path;
        return;
    }
    if (in_array($class, [
        'Fat\\Api\\Services\\Mailer',
        'Fat\\Api\\Services\\NativeMailer',
        'Fat\\Api\\Services\\FileMailer',
        'Fat\\Api\\Services\\MailerFactory',
    ], true)) {
        require_once __DIR__ . DIRECTORY_SEPARATOR . 'Services' . DIRECTORY_SEPARATOR . 'Mailer.php';
    }
});
