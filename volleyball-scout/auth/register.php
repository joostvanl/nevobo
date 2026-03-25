<?php
require_once __DIR__ . '/../lib/auth.php';
require_once __DIR__ . '/../lib/email_auth.php';

if (!scout_auth_enabled()) {
    header('Location: ../index.php');
    exit;
}

if (scout_is_logged_in()) {
    header('Location: ../index.php');
    exit;
}

$error = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $email = trim($_POST['email'] ?? '');
    $password = $_POST['password'] ?? '';
    $name = trim($_POST['name'] ?? '');
    $res = scout_register_user($email, $password, $name);
    if ($res['ok']) {
        scout_set_user($res['user']);
        $redirect = $_GET['redirect'] ?? 'index.php';
        $redirect = preg_match('/^[a-zA-Z0-9_\-\.]+\.php(\?.*)?$/', $redirect) ? $redirect : 'index.php';
        header('Location: ../' . $redirect);
        exit;
    }
    $error = $res['error'] ?? 'Registreren mislukt';
}

$redirectParam = isset($_GET['redirect']) ? '?redirect=' . urlencode($_GET['redirect']) : '';
?>
<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#1a1a2e">
  <title>Account aanmaken – Volleybal Scouting</title>
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
    .auth-back { margin-top: 1.5rem; }
    .auth-back a { color: var(--accent); text-decoration: none; }
    .auth-back a:hover { text-decoration: underline; }
  </style>
</head>
<body class="setup-page">
  <main class="auth-page">
    <h1>Account aanmaken</h1>
    <p class="hint">Maak een account aan met e-mail en wachtwoord.</p>
    <?php if ($error): ?><p class="auth-error"><?= htmlspecialchars($error) ?></p><?php endif; ?>
    <form method="post" class="auth-form">
      <div class="field">
        <label for="name">Naam</label>
        <input type="text" id="name" name="name" autocomplete="name" placeholder="Jouw naam">
      </div>
      <div class="field">
        <label for="email">E-mail</label>
        <input type="email" id="email" name="email" required autocomplete="email" placeholder="jouw@email.nl">
      </div>
      <div class="field">
        <label for="password">Wachtwoord</label>
        <input type="password" id="password" name="password" required autocomplete="new-password" minlength="6" placeholder="Minimaal 6 tekens">
      </div>
      <button type="submit" class="btn btn-primary" style="width:100%">Account aanmaken</button>
    </form>
    <p class="auth-back">
      <a href="login.php<?= htmlspecialchars($redirectParam) ?>">← Terug naar inloggen</a>
    </p>
  </main>
</body>
</html>
