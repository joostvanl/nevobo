<?php
/**
 * Password reset via e-mail met tijdelijke token.
 */
if (!defined('SCOUT_LIB_PASSWORD_RESET')) {
    define('SCOUT_LIB_PASSWORD_RESET', 1);
}

require_once __DIR__ . '/email_auth.php';

/** Geldigheidsduur van de reset-link in minuten (standaard 60) */
function scout_reset_expiry_minutes() {
    $configDir = dirname(__DIR__) . '/config';
    if (file_exists($configDir . '/auth.php')) {
        $cfg = require $configDir . '/auth.php';
        return (int) ($cfg['password_reset_expiry_minutes'] ?? 60);
    }
    return 60;
}

/**
 * Stuur een password-reset e-mail.
 * @param string $email
 * @param string $resetUrl Volledige URL naar auth/reset-password.php?token=...
 * @return bool Of het verzenden gelukt is
 */
function scout_send_reset_email($email, $resetUrl) {
    $configDir = dirname(__DIR__) . '/config';
    $from = 'noreply@example.com';
    if (file_exists($configDir . '/auth.php')) {
        $cfg = require $configDir . '/auth.php';
        $from = $cfg['mail_from'] ?? $from;
    }

    $subject = 'Wachtwoord resetten – Volleybal Scouting';
    $body = "Hallo,\n\n";
    $body .= "Je hebt een wachtwoordreset aangevraagd voor Volleybal Scouting.\n\n";
    $body .= "Klik op onderstaande link om een nieuw wachtwoord in te stellen:\n";
    $body .= $resetUrl . "\n\n";
    $body .= "Deze link is " . scout_reset_expiry_minutes() . " minuten geldig.\n\n";
    $body .= "Als je dit niet zelf hebt aangevraagd, negeer deze e-mail dan.\n";

    $headers = [
        'From: ' . $from,
        'Reply-To: ' . $from,
        'Content-Type: text/plain; charset=UTF-8',
        'X-Mailer: PHP/' . PHP_VERSION,
    ];
    return @mail($email, $subject, $body, implode("\r\n", $headers));
}

/**
 * Maak een reset-token voor het e-mailadres en stuur de e-mail.
 * Alleen voor e-mail-accounts (met wachtwoord). Retourneert altijd true bij geldig e-mailformaat
 * om geen informatie te lekken over bestaande accounts.
 * @return array ['ok'=>bool, 'sent'=>bool, 'error'=>string|null]
 */
function scout_request_password_reset($email) {
    $email = trim($email);
    if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        return ['ok' => false, 'sent' => false, 'error' => 'Vul een geldig e-mailadres in'];
    }

    $dataDir = dirname(__DIR__) . '/data';
    $usersFile = $dataDir . '/users.json';
    $tokensFile = $dataDir . '/password_reset_tokens.json';

    $users = [];
    if (file_exists($usersFile)) {
        $raw = file_get_contents($usersFile);
        $users = $raw ? json_decode($raw, true) : [];
    }
    if (!is_array($users)) $users = [];

    $userId = scout_email_user_id($email);
    $u = $users[$userId] ?? null;

    // Alleen e-mail-accounts met wachtwoord kunnen resetten (geen OAuth-only)
    if (!$u || empty($u['passwordHash'])) {
        // Stuur geen mail, maar geef ook geen fout om enumeratie te voorkomen
        return ['ok' => true, 'sent' => false, 'error' => null];
    }

    $token = bin2hex(random_bytes(32));
    $tokenHash = hash('sha256', $token);
    $expiresAt = date('c', time() + (scout_reset_expiry_minutes() * 60));

    $tokens = [];
    if (file_exists($tokensFile)) {
        $raw = file_get_contents($tokensFile);
        $tokens = $raw ? json_decode($raw, true) : [];
    }
    if (!is_array($tokens)) $tokens = [];

    // Verwijder oude tokens van deze gebruiker
    $tokens = array_filter($tokens, function ($row) use ($userId) {
        return ($row['userId'] ?? '') !== $userId;
    });

    $tokens[$tokenHash] = [
        'userId' => $userId,
        'email' => $u['email'],
        'expiresAt' => $expiresAt,
    ];

    if (!is_dir($dataDir)) mkdir($dataDir, 0755, true);
    if (file_put_contents($tokensFile, json_encode($tokens, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE)) === false) {
        return ['ok' => false, 'sent' => false, 'error' => 'Kon reset niet aanmaken'];
    }

    $configDir = dirname(__DIR__) . '/config';
    $baseUrl = 'http://localhost:8080/volleyball-scout';
    if (file_exists($configDir . '/auth.php')) {
        $cfg = require $configDir . '/auth.php';
        $baseUrl = rtrim($cfg['base_url'] ?? $baseUrl, '/');
    }
    $resetUrl = $baseUrl . '/auth/reset-password.php?token=' . urlencode($token);

    $sent = scout_send_reset_email($email, $resetUrl);

    return ['ok' => true, 'sent' => $sent, 'error' => null];
}

/**
 * Valideer een reset-token.
 * @return array|null ['userId'=>string, 'email'=>string] of null als ongeldig/verlopen
 */
function scout_validate_reset_token($token) {
    $token = trim($token ?? '');
    if ($token === '') return null;

    $tokenHash = hash('sha256', $token);
    $dataDir = dirname(__DIR__) . '/data';
    $tokensFile = $dataDir . '/password_reset_tokens.json';

    if (!file_exists($tokensFile)) return null;

    $raw = file_get_contents($tokensFile);
    $tokens = $raw ? json_decode($raw, true) : [];
    if (!is_array($tokens)) return null;

    $row = $tokens[$tokenHash] ?? null;
    if (!$row) return null;

    $expiresAt = $row['expiresAt'] ?? '';
    if ($expiresAt === '' || strtotime($expiresAt) < time()) {
        unset($tokens[$tokenHash]);
        file_put_contents($tokensFile, json_encode($tokens, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
        return null;
    }

    return [
        'userId' => $row['userId'],
        'email' => $row['email'],
    ];
}

/**
 * Reset het wachtwoord met een geldige token. Na succes wordt de token ongeldig gemaakt.
 * @return array ['ok'=>bool, 'error'=>string|null]
 */
function scout_reset_password_with_token($token, $newPassword) {
    $info = scout_validate_reset_token($token);
    if (!$info) {
        return ['ok' => false, 'error' => 'Deze link is ongeldig of verlopen. Vraag een nieuwe aan.'];
    }

    if (strlen($newPassword) < 6) {
        return ['ok' => false, 'error' => 'Wachtwoord moet minimaal 6 tekens zijn'];
    }

    $dataDir = dirname(__DIR__) . '/data';
    $usersFile = $dataDir . '/users.json';
    $tokensFile = $dataDir . '/password_reset_tokens.json';

    $raw = file_get_contents($usersFile);
    $users = $raw ? json_decode($raw, true) : [];
    if (!is_array($users)) return ['ok' => false, 'error' => 'Fout bij bijwerken'];

    $userId = $info['userId'];
    if (!isset($users[$userId])) return ['ok' => false, 'error' => 'Gebruiker niet gevonden'];

    $users[$userId]['passwordHash'] = password_hash($newPassword, PASSWORD_DEFAULT);

    if (file_put_contents($usersFile, json_encode($users, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE)) === false) {
        return ['ok' => false, 'error' => 'Kon wachtwoord niet opslaan'];
    }

    // Token ongeldig maken
    $tokenHash = hash('sha256', trim($token));
    $tokens = file_exists($tokensFile) ? json_decode(file_get_contents($tokensFile), true) : [];
    if (is_array($tokens) && isset($tokens[$tokenHash])) {
        unset($tokens[$tokenHash]);
        file_put_contents($tokensFile, json_encode($tokens, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
    }

    return ['ok' => true, 'error' => null];
}
