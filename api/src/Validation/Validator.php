<?php
declare(strict_types=1);

namespace Fat\Api\Validation;

use Fat\Api\HttpException;
use Fat\Api\Support;

final class Validator
{
    /** @param array<string,mixed> $input @param list<string> $allowed @param list<string> $required */
    public static function keys(array $input, array $allowed, array $required = []): void
    {
        $unknown = array_values(array_diff(array_keys($input), $allowed));
        $missing = array_values(array_diff($required, array_keys($input)));
        if ($unknown || $missing) {
            throw new HttpException(422, 'validation', 'Le corps contient des champs invalides.', [
                'unknown' => $unknown,
                'missing' => $missing,
            ]);
        }
    }

    public static function text(mixed $value, string $label, int $min, int $max): string
    {
        $text = Support::normalizeText($value);
        $length = mb_strlen($text);
        if ($length < $min || $length > $max || preg_match('/[\x00-\x1F\x7F<>]/u', $text) || preg_match('/https?:\/\//i', $text)) {
            throw new HttpException(422, 'validation', "{$label} est invalide.");
        }
        return $text;
    }

    public static function email(mixed $value): string
    {
        $email = mb_strtolower(trim((string) $value));
        if (strlen($email) > 254 || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
            throw new HttpException(422, 'validation', 'Adresse email invalide.');
        }
        return $email;
    }

    public static function password(mixed $value): string
    {
        $password = (string) $value;
        if (strlen($password) < 12 || strlen($password) > 128 || !preg_match('/[A-Za-z]/', $password) || !preg_match('/\d/', $password)) {
            throw new HttpException(422, 'validation', 'Le mot de passe doit contenir 12 à 128 caractères, une lettre et un chiffre.');
        }
        return $password;
    }

    public static function boolTrue(mixed $value, string $label): true
    {
        if ($value !== true) {
            throw new HttpException(422, 'validation', "{$label} doit être confirmé.");
        }
        return true;
    }

    public static function version(mixed $value): int
    {
        $version = filter_var($value, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
        if ($version === false) {
            throw new HttpException(422, 'validation', 'Version de ressource invalide.');
        }
        return $version;
    }
}
