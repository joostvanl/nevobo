<?php
/**
 * Auth helpers – sessie, huidige gebruiker, team-lookup.
 * Alleen actief wanneer feature_auth_enabled in config/app.php true is.
 */
if (!defined('SCOUT_LIB_AUTH')) {
    define('SCOUT_LIB_AUTH', 1);
}

$configDir = dirname(__DIR__) . '/config';
$appConfig = file_exists($configDir . '/app.php') ? require $configDir . '/app.php' : [];
$authEnabled = ($appConfig['feature_auth_enabled'] ?? false) === true;

/**
 * @return bool Of auth-feature actief is
 */
function scout_auth_enabled() {
    global $authEnabled;
    return $authEnabled;
}

/**
 * Start sessie indien nog niet gestart
 */
function scout_session_start() {
    if (session_status() === PHP_SESSION_NONE) {
        session_start([
            'cookie_httponly' => true,
            'cookie_samesite' => 'Lax',
            'use_strict_mode' => true
        ]);
    }
}

/**
 * @return array|null Huidige gebruiker of null als gast
 */
function scout_current_user() {
    if (!scout_auth_enabled()) return null;
    scout_session_start();
    return isset($_SESSION['scout_user']) ? $_SESSION['scout_user'] : null;
}

/**
 * @return bool Of er een ingelogde gebruiker is
 */
function scout_is_logged_in() {
    return scout_current_user() !== null;
}

/**
 * Sla gebruiker op in sessie na succesvolle login
 * @param array $user ['id' => string, 'email' => string, 'name' => string]
 */
function scout_set_user($user) {
    scout_session_start();
    $_SESSION['scout_user'] = $user;
}

/**
 * Log uit
 */
function scout_logout() {
    scout_session_start();
    unset($_SESSION['scout_user']);
}

/**
 * @return string[] Teamnamen van huidige gebruiker
 */
function scout_user_teams() {
    $user = scout_current_user();
    if (!$user || empty($user['id'])) return [];
    $dataDir = dirname(__DIR__) . '/data';
    $file = $dataDir . '/user_teams.json';
    if (!file_exists($file)) return [];
    $raw = file_get_contents($file);
    $data = $raw ? json_decode($raw, true) : null;
    if (!is_array($data)) return [];
    $teams = $data[$user['id']] ?? [];
    return is_array($teams) ? $teams : [];
}

/**
 * Match hoort bij gebruiker als teamA of teamB in zijn teams zit
 */
function scout_match_belongs_to_user($match, $userTeams) {
    if (empty($userTeams)) return false;
    $teamA = trim($match['teamA'] ?? '');
    $teamB = trim($match['teamB'] ?? '');
    return in_array($teamA, $userTeams, true) || in_array($teamB, $userTeams, true);
}
