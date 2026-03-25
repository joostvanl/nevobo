<?php
/**
 * Eenvoudig e-mail/wachtwoord login (zonder externe providers).
 */
if (!defined('SCOUT_LIB_EMAIL_AUTH')) {
    define('SCOUT_LIB_EMAIL_AUTH', 1);
}

/**
 * Genereer user-id voor e-mailgebruiker
 */
function scout_email_user_id($email) {
    return 'email_' . strtolower(trim($email));
}

/**
 * Registreer nieuwe gebruiker
 * @return array ['ok'=>bool, 'error'=>string|null, 'user'=>array|null]
 */
function scout_register_user($email, $password, $name) {
    $email = trim($email);
    $name = trim($name ?: '');
    if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        return ['ok' => false, 'error' => 'Ongeldig e-mailadres', 'user' => null];
    }
    if (strlen($password) < 6) {
        return ['ok' => false, 'error' => 'Wachtwoord moet minimaal 6 tekens zijn', 'user' => null];
    }
    $dataDir = dirname(__DIR__) . '/data';
    $usersFile = $dataDir . '/users.json';
    $users = [];
    if (file_exists($usersFile)) {
        $raw = file_get_contents($usersFile);
        $users = $raw ? json_decode($raw, true) : [];
    }
    if (!is_array($users)) $users = [];
    $userId = scout_email_user_id($email);
    if (isset($users[$userId])) {
        return ['ok' => false, 'error' => 'Dit e-mailadres is al in gebruik', 'user' => null];
    }
    $hash = password_hash($password, PASSWORD_DEFAULT);
    $users[$userId] = [
        'id' => $userId,
        'email' => $email,
        'name' => $name ?: explode('@', $email)[0],
        'passwordHash' => $hash,
        'createdAt' => date('c'),
    ];
    if (!is_dir($dataDir)) mkdir($dataDir, 0755, true);
    if (file_put_contents($usersFile, json_encode($users, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE)) === false) {
        return ['ok' => false, 'error' => 'Kon account niet aanmaken', 'user' => null];
    }
    return [
        'ok' => true,
        'error' => null,
        'user' => ['id' => $userId, 'email' => $email, 'name' => $users[$userId]['name']]
    ];
}

/**
 * Log in met e-mail/wachtwoord
 * @return array ['ok'=>bool, 'error'=>string|null, 'user'=>array|null]
 */
function scout_login_email($email, $password) {
    $email = trim($email);
    if ($email === '' || $password === '') {
        return ['ok' => false, 'error' => 'Vul e-mail en wachtwoord in', 'user' => null];
    }
    $dataDir = dirname(__DIR__) . '/data';
    $usersFile = $dataDir . '/users.json';
    if (!file_exists($usersFile)) {
        return ['ok' => false, 'error' => 'Onbekend e-mailadres of verkeerd wachtwoord', 'user' => null];
    }
    $raw = file_get_contents($usersFile);
    $users = $raw ? json_decode($raw, true) : [];
    if (!is_array($users)) {
        return ['ok' => false, 'error' => 'Onbekend e-mailadres of verkeerd wachtwoord', 'user' => null];
    }
    $userId = scout_email_user_id($email);
    $u = $users[$userId] ?? null;
    if (!$u || empty($u['passwordHash']) || !password_verify($password, $u['passwordHash'])) {
        return ['ok' => false, 'error' => 'Onbekend e-mailadres of verkeerd wachtwoord', 'user' => null];
    }
    return [
        'ok' => true,
        'error' => null,
        'user' => ['id' => $userId, 'email' => $u['email'], 'name' => $u['name'] ?? $u['email']]
    ];
}
