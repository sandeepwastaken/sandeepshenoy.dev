# GPT Console Drop-In

Upload these files into `public_html/gpt/`.

Expected private files outside this folder:

- `public_html/.env` containing `OPENAI_API_KEY=...`
- `public_html/gpt/keys/{token}.txt` containing a whole number request balance, for example `1000`

Open `https://your-domain.com/gpt/`, enter a token whose text file exists, and the wrapper will validate it through `quota.php`. AI calls go through `api.php`, reserve one request, call OpenAI, then refund the request if the upstream call fails.

Chats, images, selected model, and login token are stored only in the browser with `localStorage`. Delete browser site data to clear them.

Security notes:

- Use long random tokens for real access codes. Short examples like `1234` are easy to guess.
- Confirm `public_html/.env` is not downloadable from the browser.
- The PHP attempts to add a deny-all `.htaccess` and blank `index.html` inside `public_html/gpt/keys/` when it can write there, but you should still confirm `/gpt/keys/example.txt` is not publicly readable.
