<?php
declare(strict_types=1);

namespace Fat\Api\Services;

use DateTimeImmutable;
use DateTimeZone;
use Fat\Api\Config;

final class TransactionalEmailFactory
{
    private readonly string $templateRoot;

    public function __construct(private readonly Config $config)
    {
        $this->templateRoot = dirname(__DIR__, 2) . DIRECTORY_SEPARATOR . 'templates' . DIRECTORY_SEPARATOR . 'email';
    }

    public function registration(string $pseudo, string $confirmationUrl): EmailMessage
    {
        $html = $this->render('email-bienvenue.html', [
            'PSEUDO' => $pseudo,
            'LIEN_CONFIRMATION' => $confirmationUrl,
            'LOGO_URL' => $this->assetUrl('/assets/img/fat-logo-email.png'),
        ]);
        $text = "Bienvenue au râtelier, {$pseudo}.\n\n"
            . "Confirme ton adresse email pour ouvrir ton compte F.A.T. :\n{$confirmationUrl}\n\n"
            . "Ce lien est valable 24 heures et ne peut servir qu’à confirmer ce compte.\n"
            . "Si tu n’as rien demandé, ignore simplement ce message.\n\n"
            . "F.A.T. — FPS Airsoft Trajectory\n"
            . $this->config->get('APP_ORIGIN') . "\n";

        return new EmailMessage(
            "Bienvenue au râtelier, {$pseudo} — confirme ton email",
            $text,
            $html,
        );
    }

    public function passwordReset(string $email, string $resetUrl, string $requestIp, ?DateTimeImmutable $issuedAt = null): EmailMessage
    {
        $issuedAt ??= new DateTimeImmutable('now', new DateTimeZone('Europe/Paris'));
        $displayIp = self::truncateIp($requestIp);
        $html = $this->render('email-reset-mdp.html', [
            'EMAIL' => $email,
            'LIEN_RESET' => $resetUrl,
            'DATE' => $issuedAt->format('d/m/Y'),
            'HEURE' => $issuedAt->format('H:i'),
            'IP_TRONQUEE' => $displayIp,
            'LOGO_URL' => $this->assetUrl('/assets/img/fat-logo-email.png'),
        ]);
        $text = "Réinitialisation de ton mot de passe F.A.T.\n\n"
            . "Une demande a été faite pour le compte {$email}.\n"
            . "Choisis un nouveau mot de passe avec ce lien :\n{$resetUrl}\n\n"
            . "Ce lien est valable 30 minutes et utilisable une seule fois.\n"
            . "Si tu n’es pas à l’origine de cette demande, ignore ce message : ton mot de passe reste inchangé.\n\n"
            . "Demande émise le {$issuedAt->format('d/m/Y')} à {$issuedAt->format('H:i')} — IP {$displayIp}\n"
            . "F.A.T. — FPS Airsoft Trajectory\n"
            . $this->config->get('APP_ORIGIN') . "\n";

        return new EmailMessage(
            'Réinitialisation de ton mot de passe F.A.T. (30 min)',
            $text,
            $html,
        );
    }

    public function moderation(string $pseudo, string $replicaName, string $replicaType): EmailMessage
    {
        $moderationUrl = rtrim($this->config->get('APP_ORIGIN'), '/') . '/compte/armurerie.html';
        $html = $this->render('email-moderation.html', [
            'PSEUDO' => $pseudo,
            'REPLIQUE' => $replicaName,
            'TYPE' => $replicaType,
            'LIEN_MODERATION' => $moderationUrl,
            'LOGO_URL' => $this->assetUrl('/assets/img/fat-logo-email.png'),
        ]);
        $text = "Une card attend ta modération sur F.A.T.\n\n"
            . "Joueur : {$pseudo}\nRéplique : {$replicaName}\nType : {$replicaType}\n\n"
            . "Ouvre L’Armurerie puis la vue Modération :\n{$moderationUrl}\n\n"
            . "Cet email est envoyé uniquement aux comptes administrateurs actifs et vérifiés.\n";

        return new EmailMessage(
            "Card à modérer : {$replicaName} — {$pseudo}",
            $text,
            $html,
        );
    }

    public static function truncateIp(string $ip): string
    {
        if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
            $parts = explode('.', $ip);
            return $parts[0] . '.' . $parts[1] . '.—.—';
        }
        if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6)) {
            $packed = inet_pton($ip);
            if ($packed !== false) {
                $groups = array_values(unpack('n8', $packed) ?: []);
                return implode(':', array_map(static fn(int $group): string => dechex($group), array_slice($groups, 0, 4))) . ':—:—:—:—';
            }
        }
        return 'indisponible';
    }

    /** @param array<string,string> $variables */
    private function render(string $name, array $variables): string
    {
        $path = $this->templateRoot . DIRECTORY_SEPARATOR . $name;
        $template = is_file($path) ? file_get_contents($path) : false;
        if (!is_string($template)) {
            throw new \RuntimeException("Gabarit d’email introuvable : {$name}");
        }
        $replacements = [];
        foreach ($variables as $key => $value) {
            $replacements['{{' . $key . '}}'] = htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
        }
        $rendered = strtr($template, $replacements);
        if (preg_match('/{{[A-Z_]+}}/', $rendered)) {
            throw new \RuntimeException("Variable d’email non remplacée : {$name}");
        }
        return $rendered;
    }

    private function assetUrl(string $path): string
    {
        return rtrim($this->config->get('APP_ORIGIN'), '/') . $path;
    }
}
