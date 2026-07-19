<?php
declare(strict_types=1);

namespace Fat\Api\Services;

final readonly class EmailMessage
{
    public function __construct(
        public string $subject,
        public string $textBody,
        public string $htmlBody,
    ) {
        if ($subject === '' || preg_match('/[\r\n]/', $subject)) {
            throw new \InvalidArgumentException('Objet d’email invalide.');
        }
        if ($textBody === '' || $htmlBody === '') {
            throw new \InvalidArgumentException('Les versions texte et HTML sont obligatoires.');
        }
    }
}
