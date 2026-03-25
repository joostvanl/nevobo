<?php
/**
 * OAuth 2.0 helpers voor Google en Facebook.
 */
if (!defined('SCOUT_LIB_OAUTH')) {
    define('SCOUT_LIB_OAUTH', 1);
}

function scout_oauth_config() {
    $configDir = dirname(__DIR__) . '/config';
    $file = $configDir . '/auth.php';
    if (!file_exists($file)) return null;
    return require $file;
}

function scout_oauth_http($url, $postData = null) {
    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
    if ($postData !== null) {
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, is_string($postData) ? $postData : http_build_query($postData));
        curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/x-www-form-urlencoded']);
    }
    $body = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return ['body' => $body, 'code' => $code];
}

/**
 * @param string $state Optioneel: redirect-naam na login (bijv. overview.php)
 * @return string|null Redirect-URL voor Google
 */
function scout_google_auth_url($state = '') {
    $cfg = scout_oauth_config();
    if (!$cfg || empty($cfg['google']['client_id'])) return null;
    $base = rtrim($cfg['base_url'] ?? '', '/');
    $redirect = $base . '/auth/callback.php?provider=google';
    $params = [
        'client_id' => $cfg['google']['client_id'],
        'redirect_uri' => $redirect,
        'response_type' => 'code',
        'scope' => 'email profile',
        'access_type' => 'online',
    ];
    if ($state !== '') $params['state'] = $state;
    return 'https://accounts.google.com/o/oauth2/v2/auth?' . http_build_query($params);
}

/**
 * @return array|null ['id'=>string,'email'=>string,'name'=>string] of null
 */
function scout_google_exchange_code($code) {
    $cfg = scout_oauth_config();
    if (!$cfg || empty($cfg['google']['client_id']) || empty($cfg['google']['client_secret'])) return null;
    $base = rtrim($cfg['base_url'] ?? '', '/');
    $redirect = $base . '/auth/callback.php?provider=google';
    $resp = scout_oauth_http('https://oauth2.googleapis.com/token', [
        'code' => $code,
        'client_id' => $cfg['google']['client_id'],
        'client_secret' => $cfg['google']['client_secret'],
        'redirect_uri' => $redirect,
        'grant_type' => 'authorization_code',
    ]);
    if ($resp['code'] !== 200) return null;
    $tokenData = json_decode($resp['body'], true);
    $accessToken = $tokenData['access_token'] ?? null;
    if (!$accessToken) return null;
    $ch = curl_init('https://www.googleapis.com/oauth2/v2/userinfo');
    curl_setopt($ch, CURLOPT_HTTPHEADER, ['Authorization: Bearer ' . $accessToken]);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    $userBody = curl_exec($ch);
    curl_close($ch);
    $user = json_decode($userBody, true);
    if (!is_array($user) || empty($user['id'])) return null;
    return [
        'id' => 'google_' . $user['id'],
        'email' => $user['email'] ?? '',
        'name' => $user['name'] ?? ($user['email'] ?? 'Gebruiker'),
    ];
}

/**
 * @param string $state Optioneel: redirect-naam na login
 * @return string|null Redirect-URL voor Facebook
 */
function scout_facebook_auth_url($state = '') {
    $cfg = scout_oauth_config();
    if (!$cfg || empty($cfg['facebook']['app_id'])) return null;
    $base = rtrim($cfg['base_url'] ?? '', '/');
    $redirect = $base . '/auth/callback.php?provider=facebook';
    $params = [
        'client_id' => $cfg['facebook']['app_id'],
        'redirect_uri' => $redirect,
        'response_type' => 'code',
        'scope' => 'email,public_profile',
    ];
    if ($state !== '') $params['state'] = $state;
    return 'https://www.facebook.com/v18.0/dialog/oauth?' . http_build_query($params);
}

/**
 * @return array|null ['id'=>string,'email'=>string,'name'=>string] of null
 */
function scout_facebook_exchange_code($code) {
    $cfg = scout_oauth_config();
    if (!$cfg || empty($cfg['facebook']['app_id']) || empty($cfg['facebook']['app_secret'])) return null;
    $base = rtrim($cfg['base_url'] ?? '', '/');
    $redirect = $base . '/auth/callback.php?provider=facebook';
    $tokenUrl = 'https://graph.facebook.com/v18.0/oauth/access_token?' . http_build_query([
        'client_id' => $cfg['facebook']['app_id'],
        'client_secret' => $cfg['facebook']['app_secret'],
        'redirect_uri' => $redirect,
        'code' => $code,
    ]);
    $tokenResp = scout_oauth_http($tokenUrl);
    if ($tokenResp['code'] !== 200) return null;
    $tokenData = json_decode($tokenResp['body'], true);
    $accessToken = $tokenData['access_token'] ?? null;
    if (!$accessToken) return null;
    $userUrl = 'https://graph.facebook.com/me?fields=id,name,email&access_token=' . urlencode($accessToken);
    $userResp = scout_oauth_http($userUrl);
    if ($userResp['code'] !== 200) return null;
    $user = json_decode($userResp['body'], true);
    if (!is_array($user) || empty($user['id'])) return null;
    return [
        'id' => 'fb_' . $user['id'],
        'email' => $user['email'] ?? '',
        'name' => $user['name'] ?? 'Gebruiker',
    ];
}
