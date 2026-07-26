# Lateetud chatbot — Hostinger shared-hosting build

This folder is the no-Python deployable version:

- `index.html` — static demo page with the chat overlay
- `assets/chat.css` and `assets/chat.js` — frontend only
- `api/chat.php` — PHP backend that calls OpenAI and keeps the API key server-side
- `private/knowledge-base.json` — generated retrieval index
- `.env` — server-only secrets file containing `OPENAI_API_KEY=...`
- `private/config.php` — server-only non-secret runtime settings

## Upload

1. Run the index builder locally whenever content changes:

   ```bash
   ./venv/bin/python tools/build_hostinger_kb.py
   ```

2. Create `.env` beside the deployed app, or in a parent folder, with:

   ```text
   OPENAI_API_KEY=...
   ```

3. Keep non-secret runtime settings in `private/config.php`.

4. Upload the contents of `hostinger/` to a Hostinger folder, for example:

   ```text
   public_html/lateetud-chatbot-demo/
   ```

   Or upload `lateetud-hostinger-chatbot.zip` into that folder and extract it there.

5. Open:

   ```text
   https://your-domain.com/lateetud-chatbot-demo/
   ```

## Important

- Use PHP 8.1 or newer in Hostinger hPanel.
- Do not commit or share `.env`.
- The API key never appears in `index.html`, `chat.css`, or `chat.js`.
- `private/.htaccess` blocks direct browser access to the knowledge base and config on Apache/Hostinger.

## Using it as an overlay on the real Lateetud site

Keep the files on the same domain if possible. If you move `api/chat.php`, set the widget endpoint:

```html
<div class="lateetud-chat" id="widget" data-open="false" data-api="/lateetud-chatbot-demo/api/chat.php">
```

Then include the same markup plus:

```html
<link rel="stylesheet" href="/lateetud-chatbot-demo/assets/chat.css">
<script src="/lateetud-chatbot-demo/assets/chat.js" defer></script>
```
