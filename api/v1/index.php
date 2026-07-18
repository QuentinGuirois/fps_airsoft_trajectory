<?php
declare(strict_types=1);

$projectRoot = dirname(__DIR__, 2);
require $projectRoot . '/api/src/autoload.php';

use Fat\Api\Application;
use Fat\Api\Config;
use Fat\Api\Database;
use Fat\Api\Request;

$config = Config::load($projectRoot);
(new Application($config, Database::connect($config)))->run(Request::fromGlobals());
