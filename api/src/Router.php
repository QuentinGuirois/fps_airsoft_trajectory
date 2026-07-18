<?php
declare(strict_types=1);

namespace Fat\Api;

final class Router
{
    /** @var list<array{string,string,callable}> */
    private array $routes = [];

    public function add(string $method, string $pattern, callable $handler): void
    {
        $this->routes[] = [strtoupper($method), $pattern, $handler];
    }

    public function dispatch(Request $request): mixed
    {
        foreach ($this->routes as [$method, $pattern, $handler]) {
            if ($request->method !== $method) {
                continue;
            }
            $regex = preg_replace_callback('/\{([a-zA-Z][a-zA-Z0-9_]*)\}/', static fn(array $match): string => '(?P<' . $match[1] . '>[A-Za-z0-9-]+)', $pattern);
            if (!preg_match('#^' . $regex . '$#D', $request->path, $matches)) {
                continue;
            }
            $params = array_filter($matches, 'is_string', ARRAY_FILTER_USE_KEY);
            return $handler($request, $params);
        }
        throw new HttpException(404, 'not_found', 'Route introuvable.');
    }
}
