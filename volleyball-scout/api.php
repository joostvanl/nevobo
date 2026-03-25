<?php
/**
 * API for volleyball scouting app.
 * Saves/loads match data in the same JSON structure as example.json.
 */
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST');
header('Access-Control-Allow-Headers: Content-Type');

require_once __DIR__ . '/lib/auth.php';

$configDir = __DIR__ . '/config';
$appConfig = file_exists($configDir . '/app.php') ? require $configDir . '/app.php' : [];

$dataDir = __DIR__ . '/data';
if (!is_dir($dataDir)) {
    mkdir($dataDir, 0755, true);
}

$action = $_GET['action'] ?? $_POST['action'] ?? '';

/** Valideer matchId: alleen a-z, A-Z, 0-9, underscore, max 64 tekens. */
function validMatchId($id) {
    return is_string($id) && preg_match('/^[a-zA-Z0-9_]{1,64}$/', $id);
}

switch ($action) {
    case 'load':
        $matchId = $_GET['matchId'] ?? '';
        if (!validMatchId($matchId)) {
            http_response_code(400);
            echo json_encode(['error' => 'Invalid or missing matchId']);
            break;
        }
        $file = $dataDir . '/' . $matchId . '.json';
        if (file_exists($file)) {
            echo file_get_contents($file);
        } else {
            echo json_encode([
                'matchDate' => date('Y-m-d'),
                'teamA' => '',
                'teamB' => '',
                'sets' => []
            ]);
        }
        break;

    case 'save':
        if (scout_auth_enabled() && !scout_is_logged_in()) {
            http_response_code(401);
            echo json_encode(['error' => 'Log in om wedstrijd op te slaan.', 'authHint' => 'login']);
            break;
        }
        try {
            $raw = file_get_contents('php://input');
            $data = json_decode($raw, true);
            if ($data === null) {
                http_response_code(400);
                echo json_encode(['error' => 'Invalid JSON']);
                break;
            }
            $matchId = $data['matchId'] ?? '';
            if (!validMatchId($matchId)) {
                http_response_code(400);
                echo json_encode(['error' => 'Invalid or missing matchId']);
                break;
            }
            unset($data['matchId']);
            if (scout_auth_enabled()) {
                $user = scout_current_user();
                if ($user) {
                    $data['userId'] = $user['id'];
                    $teamA = trim($data['teamA'] ?? '');
                    if ($teamA && !in_array($teamA, scout_user_teams(), true)) {
                        $utFile = $dataDir . '/user_teams.json';
                        $ut = file_exists($utFile) ? (json_decode(file_get_contents($utFile), true) ?: []) : [];
                        $uid = $user['id'];
                        if (!isset($ut[$uid]) || !is_array($ut[$uid])) $ut[$uid] = [];
                        if (!in_array($teamA, $ut[$uid], true)) {
                            $ut[$uid][] = $teamA;
                            file_put_contents($utFile, json_encode($ut, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
                        }
                    }
                }
            }
            $file = $dataDir . '/' . $matchId . '.json';
            $written = @file_put_contents($file, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
            if ($written !== false) {
                echo json_encode(['ok' => true, 'matchId' => $matchId]);
            } else {
                http_response_code(500);
                $err = error_get_last();
                $debug = [
                    'error' => 'Could not save',
                    'dataDirExists' => is_dir($dataDir),
                    'dataDirWritable' => is_writable($dataDir),
                    'dataDirPath' => realpath($dataDir) ?: $dataDir,
                    'phpError' => ($err && $err['message']) ? $err['message'] : null
                ];
                echo json_encode($debug);
            }
        } catch (Throwable $e) {
            http_response_code(500);
            echo json_encode([
                'error' => 'Could not save',
                'exception' => $e->getMessage(),
                'file' => $e->getFile(),
                'line' => $e->getLine()
            ]);
        }
        break;

    case 'export':
        $matchId = $_GET['matchId'] ?? '';
        if (!validMatchId($matchId)) {
            http_response_code(400);
            echo json_encode(['error' => 'Invalid or missing matchId']);
            break;
        }
        $file = $dataDir . '/' . $matchId . '.json';
        if (file_exists($file)) {
            $name = 'scout_' . ($matchId ?: date('Y-m-d_His')) . '.json';
            header('Content-Disposition: attachment; filename="' . $name . '"');
            echo file_get_contents($file);
        } else {
            http_response_code(404);
            echo json_encode(['error' => 'No match data']);
        }
        break;

    case 'list':
        $matches = [];
        $ongoingOnly = isset($_GET['ongoing']) && $_GET['ongoing'] === '1';
        $tzOffsetMin = isset($_GET['tzOffset']) ? (int)$_GET['tzOffset'] : 0;
        $userTeams = [];
        if (scout_auth_enabled()) {
            $user = scout_current_user();
            if (!$user) {
                echo json_encode(['matches' => [], 'authHint' => 'login']);
                break;
            }
            $userTeams = scout_user_teams();
            if (empty($userTeams)) {
                echo json_encode(['matches' => [], 'authHint' => 'add_teams']);
                break;
            }
        }
        $files = glob($dataDir . '/*.json');
        foreach ($files as $file) {
            $matchId = basename($file, '.json');
            if ($matchId === 'current_match') continue;
            $raw = file_get_contents($file);
            if ($raw === false) continue;
            $data = json_decode($raw, true);
            if (!is_array($data)) continue;
            $sets = $data['sets'] ?? [];
            $homeScore = 0;
            $awayScore = 0;
            $homeSets = 0;
            $awaySets = 0;
            $matchTime = '';
            $matchDate = $data['matchDate'] ?? '';
            $matchTimestamp = '';
            $matchTimeLocal = '';
            $matchDateLocal = '';
            if (!empty($sets)) {
                $last = end($sets);
                $rallies = $last['rallies'] ?? [];
                if (!empty($rallies)) {
                    $lastRally = end($rallies);
                    $homeScore = (int)($lastRally['HomeScore'] ?? 0);
                    $awayScore = (int)($lastRally['AwayScore'] ?? 0);
                    $homeSets = (int)($last['HomeSets'] ?? 0);
                    $awaySets = (int)($last['AwaySets'] ?? 0);
                }
                $firstRally = $sets[0]['rallies'][0] ?? null;
                if ($firstRally && !empty($firstRally['events'])) {
                    $firstTs = $firstRally['events'][0]['timestamp'] ?? '';
                    if (preg_match('/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/', $firstTs, $m)) {
                        $matchDate = $m[1];
                        $h = (int)$m[2];
                        $min = (int)$m[3];
                        $q = (int)round($min / 15) * 15;
                        if ($q >= 60) { $h = ($h + 1) % 24; $q = 0; }
                        $matchTime = sprintf('%02d:%02d', $h, $q);
                    }
                    if ($firstTs) {
                        $matchTimestamp = (strpos($firstTs, 'Z') !== false || strpos($firstTs, '+') !== false || preg_match('/-\d{2}$/', $firstTs))
                            ? $firstTs : $firstTs . 'Z';
                        if (preg_match('/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/', $matchTimestamp, $tm)) {
                            $utc = gmmktime(
                                (int)$tm[4],
                                (int)($tm[5] ?? 0),
                                (int)($tm[6] ?? 0),
                                (int)$tm[2],
                                (int)$tm[3],
                                (int)$tm[1]
                            );
                            if ($utc !== false && $tzOffsetMin !== 0) {
                                $rawTotalMins = ((int)gmdate('G', $utc) * 60 + (int)gmdate('i', $utc)) + $tzOffsetMin;
                                $dayShift = (int)floor($rawTotalMins / 1440);
                                $totalMins = (($rawTotalMins % 1440) + 1440) % 1440;
                                $lh = (int)floor($totalMins / 60);
                                $lm = $totalMins % 60;
                                $q = (int)round($lm / 15) * 15;
                                if ($q >= 60) { $lh = ($lh + 1) % 24; $q = 0; }
                                $matchTimeLocal = sprintf('%02d:%02d', $lh, $q);
                                $matchDateLocal = gmdate('d-m-Y', $utc + $dayShift * 86400);
                            } elseif ($utc !== false) {
                                $lm = (int)gmdate('i', $utc);
                                $q = (int)round($lm / 15) * 15;
                                $lh = (int)gmdate('G', $utc);
                                if ($q >= 60) { $lh = ($lh + 1) % 24; $q = 0; }
                                $matchTimeLocal = sprintf('%02d:%02d', $lh, $q);
                                $matchDateLocal = gmdate('d-m-Y', $utc);
                            }
                        }
                    }
                }
            }
            if (!$matchDate && !empty($sets)) {
                $firstRally = $sets[0]['rallies'][0] ?? null;
                if ($firstRally && !empty($firstRally['events'])) {
                    $firstTs = $firstRally['events'][0]['timestamp'] ?? '';
                    if (preg_match('/^(\d{4}-\d{2}-\d{2})/', $firstTs, $m)) {
                        $matchDate = $m[1];
                    }
                }
            }
            $completed = ($data['completed'] ?? false) === true;
            if ($ongoingOnly && $completed) continue;
            if (scout_auth_enabled() && !scout_match_belongs_to_user($data, $userTeams)) continue;
            $matches[] = [
                'matchId' => $matchId,
                'completed' => $completed,
                'teamA' => $data['teamA'] ?? '',
                'teamB' => $data['teamB'] ?? '',
                'matchDate' => $matchDate,
                'matchTime' => $matchTime,
                'matchTimestamp' => $matchTimestamp ?? '',
                'matchDateLocal' => $matchDateLocal ?? '',
                'matchTimeLocal' => $matchTimeLocal ?? '',
                'homeScore' => $homeScore,
                'awayScore' => $awayScore,
                'homeSets' => $homeSets,
                'awaySets' => $awaySets
            ];
        }
        usort($matches, function ($a, $b) {
            $da = $a['matchDate'] . ' ' . $a['matchTime'];
            $db = $b['matchDate'] . ' ' . $b['matchTime'];
            return strcmp($db, $da);
        });
        echo json_encode(['matches' => $matches]);
        break;

    case 'auth_login':
        if (!scout_auth_enabled()) {
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => 'Auth uitgeschakeld']);
            break;
        }
        require_once __DIR__ . '/lib/email_auth.php';
        $raw = file_get_contents('php://input');
        $body = $raw ? json_decode($raw, true) : null;
        $email = isset($body['email']) ? trim((string)$body['email']) : '';
        $password = isset($body['password']) ? $body['password'] : '';
        $res = scout_login_email($email, $password);
        if ($res['ok']) {
            scout_set_user($res['user']);
            echo json_encode(['ok' => true, 'user' => $res['user']]);
        } else {
            http_response_code(401);
            echo json_encode(['ok' => false, 'error' => $res['error']]);
        }
        break;

    case 'auth_register':
        if (!scout_auth_enabled()) {
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => 'Auth uitgeschakeld']);
            break;
        }
        require_once __DIR__ . '/lib/email_auth.php';
        $raw = file_get_contents('php://input');
        $body = $raw ? json_decode($raw, true) : null;
        $email = isset($body['email']) ? trim((string)$body['email']) : '';
        $password = isset($body['password']) ? $body['password'] : '';
        $name = isset($body['name']) ? trim((string)$body['name']) : '';
        $res = scout_register_user($email, $password, $name);
        if ($res['ok']) {
            scout_set_user($res['user']);
            echo json_encode(['ok' => true, 'user' => $res['user']]);
        } else {
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => $res['error']]);
        }
        break;

    case 'auth_status':
        $enabled = scout_auth_enabled();
        $user = $enabled ? scout_current_user() : null;
        echo json_encode([
            'authEnabled' => $enabled,
            'loggedIn' => $user !== null,
            'user' => $user ? ['id' => $user['id'], 'name' => $user['name'] ?? '', 'email' => $user['email'] ?? ''] : null,
            'teams' => $enabled && $user ? scout_user_teams() : []
        ]);
        break;

    case 'teams':
        if (!scout_auth_enabled() || !scout_is_logged_in()) {
            http_response_code(401);
            echo json_encode(['error' => 'Not authenticated']);
            break;
        }
        $user = scout_current_user();
        $userId = $user['id'] ?? '';
        $utFile = $dataDir . '/user_teams.json';
        $ut = file_exists($utFile) ? (json_decode(file_get_contents($utFile), true) ?: []) : [];
        $teams = isset($ut[$userId]) && is_array($ut[$userId]) ? $ut[$userId] : [];
        if ($_SERVER['REQUEST_METHOD'] === 'POST') {
            $raw = file_get_contents('php://input');
            $body = json_decode($raw, true);
            $teamName = isset($body['team']) ? trim((string)$body['team']) : '';
            $action = $body['action'] ?? 'add';
            if (!$teamName) {
                http_response_code(400);
                echo json_encode(['error' => 'Missing team name']);
                break;
            }
            if (!isset($ut[$userId]) || !is_array($ut[$userId])) $ut[$userId] = [];
            if ($action === 'remove') {
                $ut[$userId] = array_values(array_filter($ut[$userId], function ($t) use ($teamName) { return $t !== $teamName; }));
            } else {
                if (in_array($teamName, $ut[$userId], true)) {
                    /* already in list, no-op */
                } else {
                    $existsGlobally = false;
                    foreach ($ut as $uid => $list) {
                        if (is_array($list) && in_array($teamName, $list, true)) {
                            $existsGlobally = true;
                            break;
                        }
                    }
                    if ($existsGlobally) {
                        http_response_code(400);
                        echo json_encode(['error' => 'Deze teamnaam bestaat al in het systeem.']);
                        break;
                    }
                    $ut[$userId][] = $teamName;
                }
            }
            file_put_contents($utFile, json_encode($ut, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
            $teams = $ut[$userId];
        }
        echo json_encode(['teams' => $teams]);
        break;

    case 'team_players':
        if (!scout_auth_enabled() || !scout_is_logged_in()) {
            http_response_code(401);
            echo json_encode(['error' => 'Not authenticated']);
            break;
        }
        $user = scout_current_user();
        $userId = $user['id'] ?? '';
        $userTeams = scout_user_teams();
        $teamName = isset($_GET['team']) ? trim((string)$_GET['team']) : '';
        $postBody = null;
        if ($_SERVER['REQUEST_METHOD'] === 'POST') {
            $raw = file_get_contents('php://input');
            $postBody = $raw ? json_decode($raw, true) : null;
            if (!$teamName && is_array($postBody) && !empty($postBody['team'])) {
                $teamName = trim((string)$postBody['team']);
            }
        }
        if (!$teamName || !in_array($teamName, $userTeams, true)) {
            http_response_code(403);
            echo json_encode(['error' => 'Team niet gevonden of geen toegang']);
            break;
        }
        $tpFile = $dataDir . '/user_team_players.json';
        $tp = file_exists($tpFile) ? (json_decode(file_get_contents($tpFile), true) ?: []) : [];
        if (!isset($tp[$userId]) || !is_array($tp[$userId])) $tp[$userId] = [];
        if (!isset($tp[$userId][$teamName]) || !is_array($tp[$userId][$teamName])) $tp[$userId][$teamName] = [];

        if ($_SERVER['REQUEST_METHOD'] === 'POST' && is_array($postBody)) {
            $body = $postBody;
            $action = $body['action'] ?? 'add';
            $players = &$tp[$userId][$teamName];

            if ($action === 'replace' && isset($body['players']) && is_array($body['players'])) {
                $players = [];
                foreach ($body['players'] as $p) {
                    $name = isset($p['name']) ? trim((string)$p['name']) : '';
                    if ($name !== '') {
                        $num = isset($p['number']) ? (int)$p['number'] : 0;
                        $players[] = ['name' => $name, 'number' => $num];
                    }
                }
            } elseif ($action === 'add') {
                $name = isset($body['name']) ? trim((string)$body['name']) : '';
                $number = isset($body['number']) ? (int)$body['number'] : 0;
                if ($name !== '') {
                    $players[] = ['name' => $name, 'number' => $number];
                }
            } elseif ($action === 'remove') {
                $name = isset($body['name']) ? trim((string)$body['name']) : '';
                $number = isset($body['number']) ? (int)$body['number'] : null;
                $players = array_values(array_filter($players, function ($p) use ($name, $number) {
                    if ($number !== null) {
                        return ($p['name'] ?? '') !== $name || ((int)($p['number'] ?? 0)) !== $number;
                    }
                    return ($p['name'] ?? '') !== $name;
                }));
            }

            file_put_contents($tpFile, json_encode($tp, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
        }

        echo json_encode(['team' => $teamName, 'players' => $tp[$userId][$teamName]]);
        break;

    case 'timeoutAdvice':
        if (scout_auth_enabled() && !scout_is_logged_in()) {
            http_response_code(401);
            echo json_encode(['error' => 'Log in om de AI Coach te gebruiken.', 'authHint' => 'login']);
            break;
        }
        $env = ($appConfig['timeout_webhook_env'] ?? 'test') === 'production' ? 'production' : 'test';
        $webhookUrl = $appConfig['timeout_webhook_' . $env] ?? $appConfig['timeout_webhook_test'] ?? 'http://localhost:5678/webhook-test/ed3961ab-04bc-4688-a796-7b3e4b3e85d5';
        $raw = file_get_contents('php://input');
        if ($raw === false || $raw === '') {
            http_response_code(400);
            echo json_encode(['error' => 'Geen data ontvangen']);
            break;
        }
        $decoded = json_decode($raw, true);
        if ($decoded === null && json_last_error() !== JSON_ERROR_NONE) {
            http_response_code(400);
            echo json_encode(['error' => 'Ongeldige JSON']);
            break;
        }

        $resp = null;
        $httpCode = 0;
        $connectError = '';

        if (function_exists('curl_init')) {
            $ch = curl_init($webhookUrl);
            curl_setopt_array($ch, [
                CURLOPT_POST => true,
                CURLOPT_POSTFIELDS => $raw,
                CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_TIMEOUT => 60,
                CURLOPT_CONNECTTIMEOUT => 10
            ]);
            $resp = curl_exec($ch);
            $httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
            if ($resp === false) {
                $connectError = curl_error($ch);
            }
            curl_close($ch);
        } else {
            $ctx = stream_context_create([
                'http' => [
                    'method' => 'POST',
                    'header' => "Content-Type: application/json\r\n",
                    'content' => $raw,
                    'timeout' => 60
                ]
            ]);
            $resp = @file_get_contents($webhookUrl, false, $ctx);
            if (isset($http_response_header) && !empty($http_response_header[0]) && preg_match('/^HTTP\/\d\.\d\s+(\d+)/', $http_response_header[0], $m)) {
                $httpCode = (int)$m[1];
            }
            if ($resp === false) {
                $connectError = error_get_last()['message'] ?? 'Verbinding mislukt';
            }
        }

        $debugInfo = ['webhookEnv' => $env, 'webhookUrl' => $webhookUrl];

        if ($resp === false) {
            http_response_code(502);
            echo json_encode(array_merge([
                'error' => 'Kon geen verbinding maken met de AI coach.',
                'hint' => 'Controleer of N8N draait. Start N8N met: n8n start',
                'detail' => $connectError ?: 'Onbekende netwerkfout'
            ], $debugInfo));
            break;
        }
        if ($httpCode >= 400) {
            http_response_code(502);
            echo json_encode(array_merge([
                'error' => 'AI coach gaf een foutmelding terug (HTTP ' . $httpCode . ').'
            ], $debugInfo));
            break;
        }
        header('Content-Type: application/json; charset=utf-8');
        echo $resp;
        break;

    default:
        http_response_code(400);
        echo json_encode(['error' => 'Unknown action']);
}
