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

$error = '';
$success = false;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $email = trim($_POST['email'] ?? '');
    $res = scout_request_password_reset($email);
    if ($res['ok']) {
        $success = true;
    } else {
        $error = $res['error'] ?? 'Er is iets misgegaan';
    }
}

$redirectParam = isset($_GET['redirect']) ? '?redirect=' . urlencode($_GET['redirect']) : '';
?>
<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#1a1a2e">
  <title>Wachtwoord vergeten – Volleybal Scouting</title>
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
    <h1>Wachtwoord vergeten</h1>
    <p class="hint">Vul je e-mailadres in. We sturen je een link om een nieuw wachtwoord in te stellen.</p>

    <?php if ($success): ?>
      <p class="auth-success">Als er een account bestaat met dit e-mailadres, ontvang je binnen enkele minuten een e-mail met een link om je wachtwoord te resetten. De link is <?= scout_reset_expiry_minutes() ?> minuten geldig.</p>
    <?php else: ?>
      <?php if ($error): ?><p class="auth-error"><?= htmlspecialchars($error) ?></p><?php endif; ?>
      <form method="post" class="auth-form">
        <div class="field">
          <label for="email">E-mail</label>
          <input type="email" id="email" name="email" required autocomplete="email" placeholder="jouw@email.nl" value="<?= htmlspecialchars($_POST['email'] ?? '') ?>">
        </div>
        <button type="submit" class="btn btn-primary" style="width:100%">Verstuur reset-link</button>
      </form>
    <?php endif; ?>

    <p class="auth-back">
      <a href="login.php<?= htmlspecialchars($redirectParam) ?>">← Terug naar inloggen</a>
    </p>
  </main>
</body>
</html>
