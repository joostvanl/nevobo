<?php
require_once __DIR__ . '/../lib/auth.php';
require_once __DIR__ . '/../lib/password_reset.php';

if (!scout_auth_enabled()) {
    header('Location: ../index.php');
    exit;
}

if (scout_is_logged_in()) {
    header('Location: ../index.php');
    exit;
}

$token = $_GET['token'] ?? '';
$info = scout_validate_reset_token($token);
$tokenValid = $info !== null;

$error = '';
$success = false;

if ($_SERVER['REQUEST_METHOD'] === 'POST' && $tokenValid) {
    $newPassword = $_POST['password'] ?? '';
    $confirmPassword = $_POST['password_confirm'] ?? '';
    if ($newPassword !== $confirmPassword) {
        $error = 'De wachtwoorden komen niet overeen';
    } else {
        $res = scout_reset_password_with_token($token, $newPassword);
        if ($res['ok']) {
            $success = true;
        } else {
            $error = $res['error'] ?? 'Er is iets misgegaan';
        }
    }
}
?>
<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#1a1a2e">
  <title>Nieuw wachtwoord – Volleybal Scouting</title>
  <link rel="stylesheet" href="../css/style.css">
  <style>
    .auth-page { max-width: 360px; margin: 2rem auto; padding: 1.5rem; text-align: center; }
    .auth-page h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
    .auth-page p.hint { color: var(--text-muted); font-size: 0.95rem; margin-bottom: 1rem; }
    .auth-form { text-align: left; margin-bottom: 1.5rem; }
    .auth-form .field { margin-bottom: 1rem; }
    .auth-form label { display: block; margin-bottom: 0.25rem; font-size: 0.9rem; }
    .auth-form input { width: 100%; padding: 0.6rem; border-radius: var(--radius); border: 1px solid var(--surface2); box-sizing: border-box; }
    .auth-error { color: #e74c3c; font-size: 0.9rem; margin-bottom: 1rem; }
    .auth-success { color: #27ae60; font-size: 0.9rem; margin-bottom: 1rem; }
    .auth-back { margin-top: 1.5rem; }
    .auth-back a { color: var(--accent); text-decoration: none; }
    .auth-back a:hover { text-decoration: underline; }
  </style>
</head>
<body class="setup-page">
  <main class="auth-page">
    <h1>Nieuw wachtwoord</h1>

    <?php if (!$tokenValid && $_SERVER['REQUEST_METHOD'] !== 'POST'): ?>
      <p class="auth-error">Deze link is ongeldig of verlopen. Vraag een <a href="forgot-password.php">nieuwe reset-link</a> aan.</p>
    <?php elseif ($success): ?>
      <p class="auth-success">Je wachtwoord is bijgewerkt. Je kunt nu <a href="login.php">inloggen</a> met je nieuwe wachtwoord.</p>
    <?php else: ?>
      <?php if ($tokenValid): ?>
        <p class="hint">Kies een nieuw wachtwoord voor <?= htmlspecialchars($info['email']) ?></p>
        <?php if ($error): ?><p class="auth-error"><?= htmlspecialchars($error) ?></p><?php endif; ?>
        <form method="post" class="auth-form">
          <div class="field">
            <label for="password">Nieuw wachtwoord</label>
            <input type="password" id="password" name="password" required autocomplete="new-password" minlength="6" placeholder="Minimaal 6 tekens">
          </div>
          <div class="field">
            <label for="password_confirm">Bevestig wachtwoord</label>
            <input type="password" id="password_confirm" name="password_confirm" required autocomplete="new-password" minlength="6" placeholder="Herhaal wachtwoord">
          </div>
          <button type="submit" class="btn btn-primary" style="width:100%">Wachtwoord opslaan</button>
        </form>
      <?php else: ?>
        <p class="auth-error"><?= htmlspecialchars($error ?: 'Deze link is verlopen. Vraag een nieuwe aan.') ?></p>
        <p class="auth-back"><a href="forgot-password.php">Nieuwe reset-link aanvragen</a></p>
      <?php endif; ?>
    <?php endif; ?>

    <p class="auth-back">
      <a href="login.php">← Terug naar inloggen</a>
    </p>
  </main>
</body>
</html>
