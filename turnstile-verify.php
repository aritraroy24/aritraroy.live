<?php
ini_set('log_errors', 1);
ini_set('error_log', 'turnstile_verify_errors.log');

header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Headers: Content-Type");
header("Content-Type: application/json");

function loadSecretsFile()
{
    $paths = [
        __DIR__ . '/../private/secrets.php',
        __DIR__ . '/../secrets.php',
    ];

    foreach ($paths as $path) {
        if (file_exists($path)) {
            $data = require $path;
            if (is_array($data)) {
                return $data;
            }
        }
    }

    return [];
}

function getSecret($key, $default = '')
{
    $value = getenv($key);
    if ($value !== false && $value !== '') return $value;

    static $fileSecrets = null;
    if ($fileSecrets === null) {
        $fileSecrets = loadSecretsFile();
    }

    if (isset($fileSecrets[$key]) && $fileSecrets[$key] !== '') {
        return $fileSecrets[$key];
    }

    return $default;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['success' => false, 'message' => 'Method not allowed']);
    exit;
}

$input = json_decode(file_get_contents('php://input'), true);
$token = isset($input['token']) ? trim($input['token']) : '';

if ($token === '') {
    http_response_code(400);
    echo json_encode(['success' => false, 'message' => 'Missing Turnstile token']);
    exit;
}

$secret = getSecret('TURNSTILE_SECRET_KEY', '');
if ($secret === '') {
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'Turnstile secret is not configured']);
    exit;
}

$verifyEndpoint = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
$payload = http_build_query([
    'secret' => $secret,
    'response' => $token,
    'remoteip' => $_SERVER['REMOTE_ADDR'] ?? '',
]);

$ch = curl_init($verifyEndpoint);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);
curl_setopt($ch, CURLOPT_TIMEOUT, 15);

$response = curl_exec($ch);
$curlError = curl_error($ch);
curl_close($ch);

if ($curlError) {
    http_response_code(502);
    echo json_encode(['success' => false, 'message' => 'Turnstile request failed']);
    exit;
}

$decoded = json_decode($response, true);
if (!is_array($decoded)) {
    http_response_code(502);
    echo json_encode(['success' => false, 'message' => 'Invalid Turnstile response']);
    exit;
}

if (isset($decoded['success']) && $decoded['success'] === true) {
    echo json_encode(['success' => true]);
    exit;
}

http_response_code(400);
echo json_encode([
    'success' => false,
    'message' => 'Turnstile verification failed',
    'errors' => $decoded['error-codes'] ?? [],
]);
