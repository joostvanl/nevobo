<?php
require_once __DIR__ . '/../lib/auth.php';
require_once __DIR__ . '/../lib/oauth.php';

if (!scout_auth_enabled()) {
    header('Location: ../index.php');
    exit;
}

$provider = $_GET['provider'] ?? '';
$code = $_GET['code'] ?? '';
$error = $_GET['error'] ?? '';
$redirect = $_GET['state'] ?? '';

if ($error) {
    header('Location: ../auth/login.php?error=1');
    exit;
}

if (!$code || !in_array($provider, ['google', 'facebook'], true)) {
    header('Location: ../auth/login.php');
    exit;
}

$oauthUser = null;
if ($provider === 'google') {
    $oauthUser = scout_google_exchange_code($code);
} elseif ($provider === 'facebook') {
    $oauthUser = scout_facebook_exchange_code($code);
}

if (!$oauthUser || empty($oauthUser['id'])) {
    header('Location: ../auth/login.php?error=1');
    exit;
}

$dataDir = dirname(__DIR__) . '/data';
$usersFile = $dataDir . '/users.json';
$users = [];
if (file_exists($usersFile)) {
    $raw = file_get_contents($usersFile);
    $users = $raw ? json_decode($raw, true) : [];
}
if (!is_array($users)) $users = [];

$userId = $oauthUser['id'];
if (!isset($users[$userId])) {
    $users[$userId] = [
        'id' => $userId,
        'email' => $oauthUser['email'] ?? '',
        'name' => $oauthUser['name'] ?? 'Gebruiker',
        'createdAt' => date('c'),
    ];
    if (!is_dir($dataDir)) mkdir($dataDir, 0755, true);
    file_put_contents($usersFile, json_encode($users, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
}

scout_set_user([
    'id' => $userId,
    'email' => $users[$userId]['email'],
    'name' => $users[$userId]['name'],
]);

$target = '../index.php';
if ($redirect && preg_match('/^[a-zA-Z0-9_\-\.]+\.php(\?.*)?$/', $redirect)) {
    $target = '../' . $redirect;
}

header('Location: ' . $target);
exit;
