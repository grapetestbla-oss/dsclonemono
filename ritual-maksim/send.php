<?php
/**
 * Lead form handler: forwards callback requests from the site to Telegram.
 *
 * Settings come from environment variables or from config.php next to this
 * file (see config.example.php). The bot token never reaches the browser.
 *
 *   TELEGRAM_BOT_TOKEN  token from @BotFather
 *   TELEGRAM_CHAT_ID    one or more chat ids, comma-separated
 *   ALLOWED_ORIGIN      optional, e.g. https://ritual-maksim.by
 *   TELEGRAM_API_BASE   optional, Bot API base URL (default https://api.telegram.org)
 */

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
date_default_timezone_set('Europe/Minsk');

function respond(int $status, array $body): void
{
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_UNICODE);
    exit;
}

$config = [];
if (is_file(__DIR__ . '/config.php')) {
    $config = require __DIR__ . '/config.php';
}
$setting = static function (string $key) use ($config): string {
    $env = getenv($key);
    return trim((string) ($env !== false && $env !== '' ? $env : ($config[$key] ?? '')));
};

$token = $setting('TELEGRAM_BOT_TOKEN');
$chatIds = array_filter(array_map('trim', explode(',', $setting('TELEGRAM_CHAT_ID'))));
$allowedOrigin = $setting('ALLOWED_ORIGIN');
$apiBase = rtrim($setting('TELEGRAM_API_BASE') ?: 'https://api.telegram.org', '/');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    header('Allow: POST');
    respond(405, ['ok' => false, 'error' => 'method']);
}
if ($token === '' || !$chatIds) {
    error_log('send.php: TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not configured');
    respond(500, ['ok' => false, 'error' => 'config']);
}
if ($allowedOrigin !== '') {
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin !== '' && rtrim($origin, '/') !== rtrim($allowedOrigin, '/')) {
        respond(403, ['ok' => false, 'error' => 'origin']);
    }
}

$raw = file_get_contents('php://input', false, null, 0, 8192);
$data = json_decode($raw ?: '', true);
if (!is_array($data)) {
    $data = $_POST; // plain form post
}

// Honeypot: real visitors never see or fill this field.
if (trim((string) ($data['website'] ?? '')) !== '') {
    respond(200, ['ok' => true]);
}

$clip = static fn($v, int $n): string => mb_substr(trim(preg_replace('/\s+/u', ' ', (string) $v)), 0, $n);
$name = $clip($data['name'] ?? '', 80);
$topic = $clip($data['topic'] ?? '', 80);
$page = $clip($data['page'] ?? '', 200);
$digits = preg_replace('/\D/', '', (string) ($data['phone'] ?? ''));

if (!preg_match('/^375\d{9}$/', $digits)) {
    respond(422, ['ok' => false, 'error' => 'phone']);
}

// Rate limit: 5 requests per IP per 10 minutes.
$ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
$bucket = sys_get_temp_dir() . '/ritual-leads-' . hash('sha256', $ip);
$now = time();
$hits = [];
if (is_file($bucket)) {
    $hits = array_filter(
        array_map('intval', explode(',', (string) file_get_contents($bucket))),
        static fn(int $t): bool => $t > $now - 600
    );
}
if (count($hits) >= 5) {
    respond(429, ['ok' => false, 'error' => 'rate']);
}
$hits[] = $now;
file_put_contents($bucket, implode(',', $hits), LOCK_EX);

$esc = static fn(string $s): string => htmlspecialchars($s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
$pretty = sprintf('+375 %s %s-%s-%s', substr($digits, 3, 2), substr($digits, 5, 3), substr($digits, 8, 2), substr($digits, 10, 2));
$lines = [
    '🕯 <b>Новая заявка с сайта</b>',
    '',
    '<b>Тема:</b> ' . $esc($topic !== '' ? $topic : 'Обратный звонок'),
    '<b>Имя:</b> ' . $esc($name !== '' ? $name : '—'),
    '<b>Телефон:</b> ' . $pretty,
];
if ($page !== '') {
    $lines[] = '<b>Страница:</b> ' . $esc($page);
}
$lines[] = '<i>' . date('d.m.Y H:i') . '</i>';
$text = implode("\n", $lines);

$sent = 0;
foreach ($chatIds as $chatId) {
    $payload = json_encode([
        'chat_id' => $chatId,
        'text' => $text,
        'parse_mode' => 'HTML',
        'disable_web_page_preview' => true,
    ], JSON_UNESCAPED_UNICODE);
    $url = $apiBase . '/bot' . $token . '/sendMessage';

    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $payload,
            CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 10,
        ]);
        $result = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
    } else {
        $ctx = stream_context_create(['http' => [
            'method' => 'POST',
            'header' => "Content-Type: application/json\r\n",
            'content' => $payload,
            'timeout' => 10,
            'ignore_errors' => true,
        ]]);
        $result = @file_get_contents($url, false, $ctx);
        $code = 0;
        if (isset($http_response_header[0]) && preg_match('/\s(\d{3})\s/', $http_response_header[0], $m)) {
            $code = (int) $m[1];
        }
    }

    if ($code === 200) {
        $sent++;
    } else {
        error_log('send.php: Telegram error for chat ' . $chatId . ': HTTP ' . $code . ' ' . substr((string) $result, 0, 300));
    }
}

if ($sent === 0) {
    respond(502, ['ok' => false, 'error' => 'telegram']);
}
respond(200, ['ok' => true]);
