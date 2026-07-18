<?php
declare(strict_types=1);

namespace Fat\Api\Validation;

use Fat\Api\Config;
use Fat\Api\HttpException;

final class SimulationUrl
{
    /** @return array{url:string,massG:float,energyJ:float} */
    public static function parse(mixed $value, Config $config): array
    {
        $url = trim((string) $value);
        if ($url === '' || strlen($url) > 2048) {
            throw new HttpException(422, 'simulation_url', 'Le lien de simulation est obligatoire.');
        }
        $parts = parse_url($url);
        $originParts = parse_url($config->get('APP_ORIGIN'));
        if ($parts === false || !isset($parts['scheme'], $parts['host']) || isset($parts['user']) || isset($parts['pass'])) {
            throw new HttpException(422, 'simulation_url', 'Le lien de simulation est invalide.');
        }
        $urlOrigin = strtolower($parts['scheme'] . '://' . $parts['host'] . (isset($parts['port']) ? ':' . $parts['port'] : ''));
        $expectedOrigin = strtolower(($originParts['scheme'] ?? '') . '://' . ($originParts['host'] ?? '') . (isset($originParts['port']) ? ':' . $originParts['port'] : ''));
        $path = $parts['path'] ?? '/';
        if (!hash_equals($expectedOrigin, $urlOrigin) || !in_array($path, ['/', '/index.html', '/simulateur-trajectoire-airsoft/'], true)) {
            throw new HttpException(422, 'simulation_url', 'Utilise un lien généré par le simulateur F.A.T.');
        }
        $query = $parts['query'] ?? '';
        preg_match_all('/(?:^|&)([^=&]+)=([^&]*)/', $query, $matches, PREG_SET_ORDER);
        $params = [];
        foreach ($matches as $match) {
            $key = rawurldecode($match[1]);
            $params[$key] ??= [];
            $params[$key][] = rawurldecode($match[2]);
        }
        if (count($params['m'] ?? []) !== 1 || count($params['j'] ?? []) !== 1) {
            throw new HttpException(422, 'simulation_url', 'Le lien doit contenir une seule valeur de grammage et d’énergie.');
        }
        foreach (['m', 'j'] as $key) {
            if (!preg_match('/^(?:\d+(?:\.\d*)?|\.\d+)$/', $params[$key][0])) {
                throw new HttpException(422, 'simulation_url', 'Les paramètres de simulation sont invalides.');
            }
        }
        $mass = (float) $params['m'][0];
        $energy = (float) $params['j'][0];
        if ($mass < 0.01 || $mass > 5 || $energy <= 0 || $energy > 20) {
            throw new HttpException(422, 'simulation_url', 'Les paramètres de simulation dépassent les bornes autorisées.');
        }
        return ['url' => $url, 'massG' => $mass, 'energyJ' => $energy];
    }
}
