<?php
require_once __DIR__ . '/../lib/auth.php';
require_once __DIR__ . '/../lib/oauth.php';
require_once __DIR__ . '/../lib/email_auth.php';

if (!scout_auth_enabled()) {
    header('Location: ../index.php');
    exit;
}

if (scout_is_logged_in()) {
    $redirect = $_GET['redirect'] ?? '../index.php';
    $redirect = strpos($redirect, '..') === 0 ? $redirect : '../' . ltrim($redirect, '/');
    header('Location: ' . $redirect);
    exit;
}

$error = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['login_email'])) {
    $email = trim($_POST['email'] ?? '');
    $password = $_POST['password'] ?? '';
    $res = scout_login_email($email, $password);
    if ($res['ok']) {
        scout_set_user($res['user']);
        $redirect = $_GET['redirect'] ?? 'index.php';
        $redirect = preg_match('/^[a-zA-Z0-9_\-\.]+\.php(\?.*)?$/', $redirect) ? $redirect : 'index.php';
        header('Location: ../' . $redirect);
        exit;
    }
    $error = $res['error'] ?? 'Inloggen mislukt';
}

$redirect = $_GET['redirect'] ?? '';
$googleUrl = scout_google_auth_url($redirect);
$facebookUrl = scout_facebook_auth_url($redirect);
?>
<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#1a1a2e">
  <title>Inloggen – Volleybal Scouting</title>
  <link rel="stylesheet" href="../css/style.css">
  <style>
    .auth-page { max-width: 360px; margin: 2rem auto; padding: 1.5rem; text-align: center; }
    .auth-page h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
    .auth-page p.hint { color: var(--text-muted); font-size: 0.95rem; margin-bottom: 1rem; }
    .auth-form { text-align: left; margin-bottom: 1.5rem; }
    .auth-form .field { margin-bottom: 1rem; }
    .auth-form label { display: block; margin-bottom: 0.25rem; font-size: 0.9rem; }
    .auth-form input { width: 100%; padding: 0.6rem; border-radius: var(--radius); border: 1px solid var(--surface2); }
    .auth-error { color: #e74c3c; font-size: 0.9rem; margin-bottom: 1rem; }
    .auth-divider { margin: 1.25rem 0; color: var(--text-muted); font-size: 0.9rem; }
    .auth-buttons { display: flex; flex-direction: column; gap: 0.75rem; }
    .auth-btn { display: flex; align-items: center; justify-content: center; gap: 0.5rem; padding: 0.75rem 1.25rem; border-radius: var(--radius); border: none; font-size: 1rem; cursor: pointer; text-decoration: none; color: #fff; width: 100%; box-sizing: border-box; }
    .auth-btn-google { background: #4285f4; }
    .auth-btn-google:hover { background: #3367d6; }
    .auth-btn-facebook { background: #1877f2; }
    .auth-btn-facebook:hover { background: #166fe5; }
    .auth-btn-email { background: var(--accent); color: #fff; }
    .auth-btn:disabled, .auth-btn.disabled { opacity: 0.5; cursor: not-allowed; pointer-events: none; }
    .auth-forgot a { color: var(--accent); text-decoration: none; }
    .auth-forgot a:hover { text-decoration: underline; }
    .auth-back { margin-top: 1.5rem; }
    .auth-back a { color: var(--accent); text-decoration: none; }
    .auth-back a:hover { text-decoration: underline; }
  </style>
</head>
<body class="setup-page">
  <main class="auth-page">
    <h1>Inloggen</h1>
    <p class="hint">Log in om je wedstrijden en teams te beheren.</p>
    <?php if ($error): ?><p class="auth-error"><?= htmlspecialchars($error) ?></p><?php endif; ?>
    <form method="post" class="auth-form">
      <input type="hidden" name="login_email" value="1">
      <div class="field">
        <label for="email">E-mail</label>
        <input type="email" id="email" name="email" required autocomplete="email" placeholder="jouw@email.nl">
      </div>
      <div class="field">
        <label for="password">Wachtwoord</label>
        <input type="password" id="password" name="password" required autocomplete="current-password">
      </div>
      <button type="submit" class="btn btn-primary auth-btn auth-btn-email">Inloggen met e-mail</button>
      <p class="auth-forgot" style="margin-top: 0.75rem; font-size: 0.9rem;">
        <a href="forgot-password.php<?= $redirect ? '?redirect=' . urlencode($redirect) : '' ?>">Wachtwoord vergeten?</a>
      </p>
    </form>
    <?php if ($googleUrl || $facebookUrl): ?>
    <p class="auth-divider">— of —</p>
    <div class="auth-buttons">
      <?php if ($googleUrl): ?>
      <a href="<?= htmlspecialchars($googleUrl) ?>" class="auth-btn auth-btn-google">
        <svg width="20" height="20" viewBox="0 0 24 24"><path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
        Inloggen met Google
      </a>
      <?php endif; ?>
      <?php if ($facebookUrl): ?>
      <a href="<?= htmlspecialchars($facebookUrl) ?>" class="auth-btn auth-btn-facebook">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
        Inloggen met Facebook
      </a>
      <?php endif; ?>
      <?php if (!$googleUrl && !$facebookUrl): ?>
      <p class="hint">OAuth is nog niet geconfigureerd. Gebruik e-mail hierboven of voeg config/auth.php toe.</p>
      <?php endif; ?>
    </div>
    <?php endif; ?>
    <p class="auth-back">
      <a href="register.php<?= $redirect ? '?redirect=' . urlencode($redirect) : '' ?>">Account aanmaken</a><br>
      <a href="../index.php">← Terug</a>
    </p>
  </main>
</body>
</html>
