<?php
require_once __DIR__ . '/../lib/auth.php';

if (scout_auth_enabled()) {
    scout_logout();
}

header('Location: ../index.php');
exit;
