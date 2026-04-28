<?php
// Enable error logging
ini_set('log_errors', 1);
ini_set('error_log', 'contact_form_errors.log');

// Set headers to allow cross-origin requests if needed
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

function verifyTurnstileToken($secret, $token, $remoteIp)
{
    $verifyEndpoint = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
    $payload = http_build_query([
        'secret' => $secret,
        'response' => $token,
        'remoteip' => $remoteIp ?: '',
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
        return ['success' => false, 'message' => 'Turnstile request failed'];
    }

    $decoded = json_decode($response, true);
    if (!is_array($decoded)) {
        return ['success' => false, 'message' => 'Invalid Turnstile response'];
    }

    return [
        'success' => isset($decoded['success']) && $decoded['success'] === true,
        'message' => $decoded['error-codes'][0] ?? 'turnstile_failed'
    ];
}

function getRateLimitFilePath()
{
    $preferred = __DIR__ . '/../private/contact_rate_limits.json';
    $fallback = sys_get_temp_dir() . '/contact_rate_limits.json';

    $preferredDir = dirname($preferred);
    if (is_dir($preferredDir) && is_writable($preferredDir)) {
        return $preferred;
    }

    return $fallback;
}

function isRateLimited($ip, $maxRequests = 3, $windowSeconds = 600)
{
    $filePath = getRateLimitFilePath();
    $now = time();
    $records = [];

    if (file_exists($filePath)) {
        $raw = file_get_contents($filePath);
        $decoded = json_decode($raw, true);
        if (is_array($decoded)) {
            $records = $decoded;
        }
    }

    // Drop old records first.
    foreach ($records as $k => $timestamps) {
        if (!is_array($timestamps)) {
            unset($records[$k]);
            continue;
        }
        $records[$k] = array_values(array_filter($timestamps, function ($ts) use ($now, $windowSeconds) {
            return is_int($ts) && ($now - $ts) <= $windowSeconds;
        }));
        if (count($records[$k]) === 0) {
            unset($records[$k]);
        }
    }

    $ipEntries = $records[$ip] ?? [];
    $limited = count($ipEntries) >= $maxRequests;
    if (!$limited) {
        $ipEntries[] = $now;
        $records[$ip] = $ipEntries;
    }

    @file_put_contents($filePath, json_encode($records), LOCK_EX);
    return $limited;
}

// Get form data - match field names from React frontend
$timestamp = date('Y-m-d H:i:s');
$name = isset($_POST['Name']) ? htmlspecialchars($_POST['Name']) : '';
$phone = isset($_POST['Phone']) ? htmlspecialchars($_POST['Phone']) : '';
$email = isset($_POST['Email']) ? htmlspecialchars($_POST['Email']) : '';
$message = isset($_POST['Message']) ? htmlspecialchars($_POST['Message']) : '';
$honeypot = isset($_POST['Website']) ? trim($_POST['Website']) : '';
$formStartedAt = isset($_POST['FormStartedAt']) ? trim($_POST['FormStartedAt']) : '';
$turnstileToken = isset($_POST['cf-turnstile-response']) ? trim($_POST['cf-turnstile-response']) : '';
$requestIp = $_SERVER['REMOTE_ADDR'] ?? 'unknown';

// Honeypot trap: hidden field should remain empty for real users.
if (!empty($honeypot)) {
    http_response_code(400);
    echo json_encode(['result' => 'error', 'message' => 'Submission rejected']);
    exit;
}

// Time-based bot check: reject unrealistically fast submissions (< 3 seconds).
if (ctype_digit($formStartedAt)) {
    $elapsed = (int) floor((microtime(true) * 1000 - (int)$formStartedAt) / 1000);
    if ($elapsed < 3) {
        http_response_code(400);
        echo json_encode(['result' => 'error', 'message' => 'Please take a bit more time before submitting.']);
        exit;
    }
}

// Basic IP rate limiting: max 3 submissions per 10 minutes.
if (isRateLimited($requestIp, 3, 600)) {
    http_response_code(429);
    echo json_encode(['result' => 'error', 'message' => 'Too many submissions. Please try again later.']);
    exit;
}

// Verify Turnstile if configured.
$turnstileSecret = getSecret('TURNSTILE_SECRET_KEY', '');
if (!empty($turnstileSecret)) {
    if (empty($turnstileToken)) {
        http_response_code(400);
        echo json_encode(['result' => 'error', 'message' => 'Security token missing']);
        exit;
    }

    $turnstileResult = verifyTurnstileToken($turnstileSecret, $turnstileToken, $requestIp);
    if (!$turnstileResult['success']) {
        http_response_code(400);
        echo json_encode(['result' => 'error', 'message' => 'Security verification failed']);
        exit;
    }
}

// Validate required fields
if (empty($name) || empty($email) || empty($message)) {
    http_response_code(400);
    echo json_encode(['result' => 'error', 'message' => 'Please fill all required fields']);
    exit;
}

// Validate email format
if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    http_response_code(400);
    echo json_encode(['result' => 'error', 'message' => 'Invalid email format']);
    exit;
}

// Get the first name for personalization
$firstName = explode(' ', $name)[0];

// Respond to browser immediately — background work continues after
echo json_encode(['result' => 'success', 'message' => 'Your message has been sent successfully']);
http_response_code(200);

if (function_exists('fastcgi_finish_request')) {
    fastcgi_finish_request();
} else {
    $size = ob_get_length();
    header("Content-Length: $size");
    header("Connection: close");
    ob_end_flush();
    flush();
}

// --- Background processing below (browser already received success) ---

// Configure SMTP settings
$smtp_host = 'smtp.hostinger.com';
$smtp_port = 465;
$smtp_username = 'contact@aritraroy.live';
$smtp_password = getSecret('SMTP_PASSWORD', 'SMTP_PASSWORD');
$from_email = 'contact@aritraroy.live';
$from_name = 'Aritra Roy Contact Form';
$admin_email = 'contact@aritraroy.live';

// Log to Google Sheet (non-blocking, short timeout)
$appscript_url = 'https://script.google.com/macros/s/AKfycbx26JrCgMaWQn5L4WhpqMHCdP_9T3gU8IZx8dQKU7Q7ItlenkqoXtM7TFRld_kfKPFe/exec';
$curl = curl_init();
curl_setopt($curl, CURLOPT_URL, $appscript_url);
curl_setopt($curl, CURLOPT_RETURNTRANSFER, true);
curl_setopt($curl, CURLOPT_POST, true);
curl_setopt($curl, CURLOPT_POSTFIELDS, http_build_query([
    'Name' => $name, 'Phone' => $phone, 'Email' => $email, 'Message' => $message
]));
curl_setopt($curl, CURLOPT_TIMEOUT, 10);
$err = curl_error($curl);
curl_exec($curl);
curl_close($curl);
if ($err) error_log("Google Sheet Error: " . $err);

try {
    // Single SMTP connection for both emails
    $conn = fsockopen('ssl://' . $smtp_host, $smtp_port, $errno, $errstr, 30);
    if (!$conn) {
        throw new Exception("Failed to connect to SMTP server: $errstr ($errno)");
    }

    // Read greeting
    $response = fgets($conn, 515);
    if (substr($response, 0, 3) != '220') {
        throw new Exception("SMTP Error: " . $response);
    }

    // Send EHLO
    fputs($conn, "EHLO " . gethostname() . "\r\n");
    $response = fgets($conn, 515);
    while (substr($response, 3, 1) == '-') {
        $response = fgets($conn, 515);
    }

    // Authenticate once
    fputs($conn, "AUTH LOGIN\r\n");
    $response = fgets($conn, 515);
    if (substr($response, 0, 3) != '334') throw new Exception("SMTP Error: " . $response);

    fputs($conn, base64_encode($smtp_username) . "\r\n");
    $response = fgets($conn, 515);
    if (substr($response, 0, 3) != '334') throw new Exception("SMTP Error: " . $response);

    fputs($conn, base64_encode($smtp_password) . "\r\n");
    $response = fgets($conn, 515);
    if (substr($response, 0, 3) != '235') throw new Exception("SMTP Authentication failed: " . $response);

    // --- Email 1: admin notification ---
    fputs($conn, "MAIL FROM:<$from_email>\r\n");
    $response = fgets($conn, 515);
    if (substr($response, 0, 3) != '250') throw new Exception("SMTP Error: " . $response);

    fputs($conn, "RCPT TO:<$admin_email>\r\n");
    $response = fgets($conn, 515);
    if (substr($response, 0, 3) != '250') throw new Exception("SMTP Error: " . $response);

    fputs($conn, "DATA\r\n");
    $response = fgets($conn, 515);
    if (substr($response, 0, 3) != '354') throw new Exception("SMTP Error: " . $response);

    // Admin email body
    if (empty($phone)) {
        $admin_body = "<b>Name:</b> $name<br><b>Email:</b> <a href=\"mailto:$email\">$email</a><br><b>Phone No.:</b> Phone number is not provided<br><b>Message:</b> $message";
    } else {
        $phoneLink = preg_replace('/[^0-9+]/', '', $phone);
        $admin_body = "<b>Name:</b> $name<br><b>Email:</b> <a href=\"mailto:$email\">$email</a><br><b>Phone No.:</b> <a href=\"tel:$phoneLink\">$phone</a><br><b>Message:</b> $message";
    }

    $admin_email_content  = "From: $from_name <$from_email>\r\nTo: <$admin_email>\r\nReply-To: $name <$email>\r\n";
    $admin_email_content .= "Subject: $firstName Submitted the Contact Form on the Website\r\n";
    $admin_email_content .= "MIME-Version: 1.0\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n";
    $admin_email_content .= $admin_body . "\r\n.\r\n";

    fputs($conn, $admin_email_content);
    $response = fgets($conn, 515);
    if (substr($response, 0, 3) != '250') throw new Exception("SMTP Error: " . $response);

    // --- Email 2: thank-you to user (reuse same connection) ---
    fputs($conn, "MAIL FROM:<$from_email>\r\n");
    $response = fgets($conn, 515);
    if (substr($response, 0, 3) != '250') throw new Exception("SMTP Error: " . $response);

    fputs($conn, "RCPT TO:<$email>\r\n");
    $response = fgets($conn, 515);
    if (substr($response, 0, 3) != '250') throw new Exception("SMTP Error: " . $response);

    fputs($conn, "DATA\r\n");
    $response = fgets($conn, 515);
    if (substr($response, 0, 3) != '354') throw new Exception("SMTP Error: " . $response);

    $userEmailBody = "Hi {$firstName},<br><br>
                   Thank you for contacting me.I'll catch up with you soon at {$email}. Feel free to reply to this email if you'd like to start the conversation right away.<br><br>
                   <div dir=\"ltr\"><div><div dir=\"auto\" style=\"color:rgb(34,34,34)\">Best wishes,</div><div dir=\"auto\" style=\"color:rgb(34,34,34)\">Aritra</div></div><div dir=\"auto\" style=\"color:rgb(34,34,34)\"><br></div><font size=\"3\">-----</font><div><table cellspacing=\"0\" cellpadding=\"0\" border=\"0\" style=\"border-spacing:0px;border-collapse:collapse;color:rgb(68,68,68);font-size:14px;font-family:Verdana,sans-serif;width:420px;background:transparent!important\"><tbody><tr><td style=\"padding:0px;width:240px\"><span style=\"font-size:12pt;color:rgb(2,60,79);line-height:13pt\"><span style=\"font-weight:700\">Aritra Roy</span></span><span style=\"font-size:9pt;line-height:11pt;color:rgb(113,113,113)\"><br>Doctoral Researcher /&nbsp;Research Assist.</span></td><td style=\"padding:0px;font-size:10pt;width:180px;color:rgb(113,113,113);vertical-align:top;text-align:right\"><br></td></tr><tr><td colspan=\"2\" style=\"padding:25px 0px 0px;font-size:9pt;line-height:14pt\"><span style=\"font-size:9pt\"><span style=\"color:rgb(38,38,38)\">School of Engineering - Chemical Process &amp; Energy Engineering<span>,&nbsp;<br></span></span><span>London South Bank University<span>,&nbsp;<br></span></span><span>103 Borough Road, London SE1 0AA, United Kingdom</span><br></span><span><br><span style=\"font-weight:700\">Email:</span>&nbsp;</span><a href=\"mailto:contact@aritraroy.live\" title=\"mailto:contact@aritraroy.live\" style=\"border:0px;font-stretch:inherit;line-height:inherit;margin:0px;padding:0px;vertical-align:baseline;color:rgb(0,36,81)\" target=\"_blank\">contact@aritraroy.live</a><span><br><span style=\"font-size:9pt\"><span style=\"font-size:9pt;color:rgb(38,38,38)\"><span style=\"font-weight:700\">Mobile:</span>&nbsp;+44 73930 62351</span></span><br><b>Website:</b><span style=\"color:rgb(38,38,38)\">&nbsp;</span><a href=\"http://www.aritraroy.live/\" rel=\"noopener\" style=\"background-color:transparent;color:rgb(51,122,183)\" target=\"_blank\"><span style=\"font-weight:700;color:rgb(2,60,79);font-size:9pt\">www.aritraroy.live</span></a><br><br><img width=\"200\" height=\"77\" src=\"https://ci3.googleusercontent.com/mail-sig/AIorK4z2KJkun0UAPb4dSVPQP_jHpUDPv1YoKkr2_ulGU27xWb7XKbBF5V1Dj3uoorPOWPWrnjpSEeY\" class=\"CToWUd\" data-bit=\"iit\" alt=\"LSBU Logo\"><br></span></td></tr><tr><td colspan=\"2\" style=\"padding:25px 0px 0px;max-width:420px\"></td></tr><tr></tr></tbody></table></div></div>";

    $user_email_content  = "From: Aritra Roy <$from_email>\r\nTo: $name <$email>\r\nReply-To: <$admin_email>\r\n";
    $user_email_content .= "Subject: Thank You, $firstName\r\n";
    $user_email_content .= "MIME-Version: 1.0\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n";
    $user_email_content .= $userEmailBody . "\r\n.\r\n";

    fputs($conn, $user_email_content);
    $response = fgets($conn, 515);
    if (substr($response, 0, 3) != '250') throw new Exception("SMTP Error: " . $response);

    fputs($conn, "QUIT\r\n");
    fclose($conn);

} catch (Exception $e) {
    error_log("Mailer Error: " . $e->getMessage());
}
