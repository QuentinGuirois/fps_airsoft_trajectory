<?php
declare(strict_types=1);

$root = dirname(__DIR__);
$localConfig = $root . '/config/.env.local';
if (getenv('FAT_CONFIG_FILE') === false && is_file($localConfig)) {
    putenv('FAT_CONFIG_FILE=' . $localConfig);
}

$path = parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH) ?: '/';
if (str_starts_with($path, '/api/v1')) {
    require $root . '/api/v1/index.php';
    return true;
}
if (preg_match('#^/parties-airsoft/[a-z0-9-]+/?$#D', $path)) {
    header('X-Robots-Tag: noindex, follow');
    header('Cache-Control: public, max-age=60');
    readfile($root . '/parties-airsoft/index.html');
    return true;
}
return false;
