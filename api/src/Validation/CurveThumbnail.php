<?php
declare(strict_types=1);

namespace Fat\Api\Validation;

use Fat\Api\HttpException;

final class CurveThumbnail
{
    /** @var list<string> */
    private const TAGS = ['svg','rect','line','path','circle','text'];
    /** @var list<string> */
    private const ATTRS = ['xmlns','viewBox','role','aria-label','class','x','y','x1','y1','x2','y2','width','height','cx','cy','r','d'];

    public static function sanitize(mixed $value): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }
        $svg = (string) $value;
        if (strlen($svg) > 80_000 || preg_match('/<!DOCTYPE|<!ENTITY/i', $svg)) {
            throw new HttpException(422, 'curve_thumbnail', 'Miniature de courbe invalide.');
        }
        $previous = libxml_use_internal_errors(true);
        $document = new \DOMDocument();
        $loaded = $document->loadXML($svg, LIBXML_NONET | LIBXML_NOBLANKS | LIBXML_NOCDATA);
        libxml_clear_errors();
        libxml_use_internal_errors($previous);
        if (!$loaded || $document->documentElement?->localName !== 'svg') {
            throw new HttpException(422, 'curve_thumbnail', 'Miniature de courbe invalide.');
        }
        foreach ($document->getElementsByTagName('*') as $node) {
            if (!in_array($node->localName, self::TAGS, true)) {
                throw new HttpException(422, 'curve_thumbnail', 'Balise SVG interdite.');
            }
            foreach (iterator_to_array($node->attributes ?? []) as $attribute) {
                if (!in_array($attribute->nodeName, self::ATTRS, true) || preg_match('/^on/i', $attribute->nodeName)) {
                    $node->removeAttribute($attribute->nodeName);
                }
            }
        }
        return $document->saveXML($document->documentElement) ?: null;
    }
}
