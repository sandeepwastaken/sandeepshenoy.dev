<?php
// Keep secrets in .env. This file only contains non-secret runtime settings.

return [
    'openai_model' => 'gpt-4o-mini',

    // Add the exact URL where the widget page/API will run.
    // Same-origin requests are allowed automatically.
    'allowed_origins' => [
        'https://www.lateetud.com',
        'https://lateetud.com',
    ],

    // Flip this to true only after confirming the browser sends Origin correctly.
    'require_origin_header' => false,

    // Keep false unless the site is behind Cloudflare or a proxy you control.
    'trust_proxy_headers' => false,

    // Frictionless for normal visitors, hard-capped for abuse.
    'rate_limit_window_seconds' => 60,
    'rate_limit_burst' => 8,
    'rate_limit_daily_max' => 90,

    'max_body_bytes' => 18000,
    'max_question_chars' => 900,
    'max_history_item_chars' => 520,
    'max_context_chunk_chars' => 1400,
    'max_context_chars' => 6500,
    'max_openai_tokens' => 650,
];
