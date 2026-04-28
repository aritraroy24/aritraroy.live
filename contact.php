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

// Configure SMTP settings
$smtp_host = 'smtp.hostinger.com';
$smtp_port = 465; // SSL connection
$smtp_username = 'contact@aritraroy.live';
$smtp_password = getSecret('SMTP_PASSWORD', 'SMTP_PASSWORD');
$from_email = 'contact@aritraroy.live';
$from_name = 'Aritra Roy Contact Form';
$admin_email = 'contact@aritraroy.live'; // Admin email

// Send data to Google Sheet using Google Apps Script
$appscript_url = 'https://script.google.com/macros/s/AKfycbx26JrCgMaWQn5L4WhpqMHCdP_9T3gU8IZx8dQKU7Q7ItlenkqoXtM7TFRld_kfKPFe/exec';

// Prepare data for the AppScript
$appscript_data = http_build_query([
    'Name' => $name,
    'Phone' => $phone,
    'Email' => $email,
    'Message' => $message
]);

// Initialize cURL
$curl = curl_init();
curl_setopt($curl, CURLOPT_URL, $appscript_url);
curl_setopt($curl, CURLOPT_RETURNTRANSFER, true);
curl_setopt($curl, CURLOPT_POST, true);
curl_setopt($curl, CURLOPT_POSTFIELDS, $appscript_data);

// Execute cURL request
$response = curl_exec($curl);
$err = curl_error($curl);
curl_close($curl);

if ($err) {
    error_log("Google Sheet Error: " . $err);
}

try {
    // 1. Send notification email to admin
    $admin_conn = fsockopen('ssl://' . $smtp_host, $smtp_port, $errno, $errstr, 30);
    if (!$admin_conn) {
        throw new Exception("Failed to connect to SMTP server: $errstr ($errno)");
    }

    // Read greeting
    $response = fgets($admin_conn, 515);
    if (substr($response, 0, 3) != '220') {
        throw new Exception("SMTP Error: " . $response);
    }

    // Send EHLO
    fputs($admin_conn, "EHLO " . gethostname() . "\r\n");
    $response = fgets($admin_conn, 515);

    // Read multi-line response
    while (substr($response, 3, 1) == '-') {
        $response = fgets($admin_conn, 515);
    }

    // Authenticate
    fputs($admin_conn, "AUTH LOGIN\r\n");
    $response = fgets($admin_conn, 515);
    if (substr($response, 0, 3) != '334') {
        throw new Exception("SMTP Error: " . $response);
    }

    fputs($admin_conn, base64_encode($smtp_username) . "\r\n");
    $response = fgets($admin_conn, 515);
    if (substr($response, 0, 3) != '334') {
        throw new Exception("SMTP Error: " . $response);
    }

    fputs($admin_conn, base64_encode($smtp_password) . "\r\n");
    $response = fgets($admin_conn, 515);
    if (substr($response, 0, 3) != '235') {
        throw new Exception("SMTP Authentication failed: " . $response);
    }

    // Set sender
    fputs($admin_conn, "MAIL FROM:<$from_email>\r\n");
    $response = fgets($admin_conn, 515);
    if (substr($response, 0, 3) != '250') {
        throw new Exception("SMTP Error: " . $response);
    }

    // Set recipient
    fputs($admin_conn, "RCPT TO:<$admin_email>\r\n");
    $response = fgets($admin_conn, 515);
    if (substr($response, 0, 3) != '250') {
        throw new Exception("SMTP Error: " . $response);
    }

    // Start data
    fputs($admin_conn, "DATA\r\n");
    $response = fgets($admin_conn, 515);
    if (substr($response, 0, 3) != '354') {
        throw new Exception("SMTP Error: " . $response);
    }

    // Prepare admin notification email
    $admin_subject = "$firstName Submitted the Contact Form on the Website";

    // Prepare the notification message body
    if (empty($phone)) {
        $defaultPhMsg = "Phone number is not provided";
        $admin_body = "<b>Name:</b> " . $name . "<br>" .
            "<b>Email:</b> <a href=\"mailto:" . $email . "\">" . $email . "</a><br>" .
            "<b>Phone No.:</b> " . $defaultPhMsg . "<br>" .
            "<b>Message:</b> " . $message;
    } else {
        // Format phone number for tel: link (remove spaces, parentheses, etc.)
        $phoneLink = preg_replace('/[^0-9+]/', '', $phone);
        $admin_body = "<b>Name:</b> " . $name . "<br>" .
            "<b>Email:</b> <a href=\"mailto:" . $email . "\">" . $email . "</a><br>" .
            "<b>Phone No.:</b> <a href=\"tel:" . $phoneLink . "\">" . $phone . "</a><br>" .
            "<b>Message:</b> " . $message;
    }

    // Prepare email headers and content
    $admin_email_content = "From: $from_name <$from_email>\r\n";
    $admin_email_content .= "To: <$admin_email>\r\n";
    $admin_email_content .= "Reply-To: $name <$email>\r\n";
    $admin_email_content .= "Subject: $admin_subject\r\n";
    $admin_email_content .= "MIME-Version: 1.0\r\n";
    $admin_email_content .= "Content-Type: text/html; charset=UTF-8\r\n";
    $admin_email_content .= "\r\n";
    $admin_email_content .= $admin_body;
    $admin_email_content .= "\r\n.\r\n";

    // Send email content
    fputs($admin_conn, $admin_email_content);
    $response = fgets($admin_conn, 515);
    if (substr($response, 0, 3) != '250') {
        throw new Exception("SMTP Error: " . $response);
    }

    // Quit
    fputs($admin_conn, "QUIT\r\n");
    fclose($admin_conn);
    $notificationMailSent = true;

    // 2. Send thank you email to the user
    $user_conn = fsockopen('ssl://' . $smtp_host, $smtp_port, $errno, $errstr, 30);
    if (!$user_conn) {
        throw new Exception("Failed to connect to SMTP server: $errstr ($errno)");
    }

    // Read greeting
    $response = fgets($user_conn, 515);
    if (substr($response, 0, 3) != '220') {
        throw new Exception("SMTP Error: " . $response);
    }

    // Send EHLO
    fputs($user_conn, "EHLO " . gethostname() . "\r\n");
    $response = fgets($user_conn, 515);

    // Read multi-line response
    while (substr($response, 3, 1) == '-') {
        $response = fgets($user_conn, 515);
    }

    // Authenticate
    fputs($user_conn, "AUTH LOGIN\r\n");
    $response = fgets($user_conn, 515);
    if (substr($response, 0, 3) != '334') {
        throw new Exception("SMTP Error: " . $response);
    }

    fputs($user_conn, base64_encode($smtp_username) . "\r\n");
    $response = fgets($user_conn, 515);
    if (substr($response, 0, 3) != '334') {
        throw new Exception("SMTP Error: " . $response);
    }

    fputs($user_conn, base64_encode($smtp_password) . "\r\n");
    $response = fgets($user_conn, 515);
    if (substr($response, 0, 3) != '235') {
        throw new Exception("SMTP Authentication failed: " . $response);
    }

    // Set sender
    fputs($user_conn, "MAIL FROM:<$from_email>\r\n");
    $response = fgets($user_conn, 515);
    if (substr($response, 0, 3) != '250') {
        throw new Exception("SMTP Error: " . $response);
    }

    // Set recipient
    fputs($user_conn, "RCPT TO:<$email>\r\n");
    $response = fgets($user_conn, 515);
    if (substr($response, 0, 3) != '250') {
        throw new Exception("SMTP Error: " . $response);
    }

    // Start data
    fputs($user_conn, "DATA\r\n");
    $response = fgets($user_conn, 515);
    if (substr($response, 0, 3) != '354') {
        throw new Exception("SMTP Error: " . $response);
    }

    // Prepare thank you email
    $user_subject = "Thank You, " . $firstName;

    // Create the thank you email with the signature
    $userEmailBody = "Hi {$firstName},<br><br>
                   Thank you for contacting me.I'll catch up with you soon at {$email}. Feel free to reply to this email if you'd like to start the conversation right away.<br><br>
                   <div dir=\"ltr\"><div><div dir=\"auto\" style=\"color:rgb(34,34,34)\">Best wishes,</div><div dir=\"auto\" style=\"color:rgb(34,34,34)\">Aritra</div></div><div dir=\"auto\" style=\"color:rgb(34,34,34)\"><br></div><font size=\"3\">-----</font><div><table cellspacing=\"0\" cellpadding=\"0\" border=\"0\" style=\"border-spacing:0px;border-collapse:collapse;color:rgb(68,68,68);font-size:14px;font-family:Verdana,sans-serif;width:420px;background:transparent!important\"><tbody><tr><td style=\"padding:0px;width:240px\"><span style=\"font-size:12pt;color:rgb(2,60,79);line-height:13pt\"><span style=\"font-weight:700\">Aritra Roy</span></span><span style=\"font-size:9pt;line-height:11pt;color:rgb(113,113,113)\"><br>Doctoral Researcher /&nbsp;Research Assist.</span></td><td style=\"padding:0px;font-size:10pt;width:180px;color:rgb(113,113,113);vertical-align:top;text-align:right\"><br></td></tr><tr><td colspan=\"2\" style=\"padding:25px 0px 0px;font-size:9pt;line-height:14pt\"><span style=\"font-size:9pt\"><span style=\"color:rgb(38,38,38)\">School of Engineering - Chemical Process &amp; Energy Engineering<span>,&nbsp;<br></span></span><span>London South Bank University<span>,&nbsp;<br></span></span><span>103 Borough Road, London SE1 0AA, United Kingdom</span><br></span><span><br><span style=\"font-weight:700\">Email:</span>&nbsp;</span><a href=\"mailto:contact@aritraroy.live\" title=\"mailto:contact@aritraroy.live\" style=\"border:0px;font-stretch:inherit;line-height:inherit;margin:0px;padding:0px;vertical-align:baseline;color:rgb(0,36,81)\" target=\"_blank\">contact@aritraroy.live</a><span><br><span style=\"font-size:9pt\"><span style=\"font-size:9pt;color:rgb(38,38,38)\"><span style=\"font-weight:700\">Mobile:</span>&nbsp;+44 73930 62351</span></span><br><b>Website:</b><span style=\"color:rgb(38,38,38)\">&nbsp;</span><a href=\"http://www.aritraroy.live/\" rel=\"noopener\" style=\"background-color:transparent;color:rgb(51,122,183)\" target=\"_blank\" data-saferedirecturl=\"https://www.google.com/url?q=http://www.aritraroy.live/&amp;source=gmail&amp;ust=1706613724000000&amp;usg=AOvVaw2STHuuzNZzOY6V9Ow66f4m\"><span style=\"font-weight:700;color:rgb(2,60,79);font-size:9pt\">www.aritraroy.live</span></a><br><br><img width=\"200\" height=\"77\" src=\"https://ci3.googleusercontent.com/mail-sig/AIorK4z2KJkun0UAPb4dSVPQP_jHpUDPv1YoKkr2_ulGU27xWb7XKbBF5V1Dj3uoorPOWPWrnjpSEeY\" class=\"CToWUd\" data-bit=\"iit\" alt=\"\"><br></span></td></tr><tr><td colspan=\"2\" style=\"padding:25px 0px 0px;max-width:420px\"></td></tr><tr></tr></tbody></table><div><table cellpadding=\"0\" cellspacing=\"0\" style=\"vertical-align:-webkit-baseline-middle;font-size:medium\"><tbody><tr><td><table cellpadding=\"0\" cellspacing=\"0\" style=\"vertical-align:-webkit-baseline-middle;font-family:Arial\"><tbody><tr><td style=\"vertical-align:top\"></td><td width=\"46\"></td><td style=\"padding:0px;vertical-align:middle\"><table cellpadding=\"0\" cellspacing=\"0\" style=\"color:rgb(255,255,255);font-family:Arial;vertical-align:-webkit-baseline-middle\"></table></td></tr></tbody></table></td></tr></tbody></table></div></div></div>";

    // Prepare email headers and content
    $user_email_content = "From: Aritra Roy <$from_email>\r\n";
    $user_email_content .= "To: $name <$email>\r\n";
    $user_email_content .= "Reply-To: <$admin_email>\r\n";
    $user_email_content .= "Subject: $user_subject\r\n";
    $user_email_content .= "MIME-Version: 1.0\r\n";
    $user_email_content .= "Content-Type: text/html; charset=UTF-8\r\n";
    $user_email_content .= "\r\n";
    $user_email_content .= $userEmailBody;
    $user_email_content .= "\r\n.\r\n";

    // Send email content
    fputs($user_conn, $user_email_content);
    $response = fgets($user_conn, 515);
    if (substr($response, 0, 3) != '250') {
        throw new Exception("SMTP Error: " . $response);
    }

    // Quit
    fputs($user_conn, "QUIT\r\n");
    fclose($user_conn);
    $userMailSent = true;

    // Return success response to match what the React frontend expects
    echo json_encode(['result' => 'success', 'message' => 'Your message has been sent successfully']);
} catch (Exception $e) {
    // Log the error
    error_log("Mailer Error: " . $e->getMessage());

    // Return error response in the format expected by the React frontend
    http_response_code(500);
    echo json_encode(['result' => 'error', 'message' => 'Failed to send email. Error: ' . $e->getMessage()]);
}
