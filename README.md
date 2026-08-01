# Sandeep Shenoy Portfolio

![Portfolio preview](images/thumb.png)

This is my personal portfolio website. It shows my work in web design, coding, art, interactive projects, and small tools.

## What Is Inside

- `index.html` is the main homepage.
- `css/` has the styles for the site.
- `js/` has the scripts that control animations and page behavior.
- `projects/` has separate project pages and demos.
- `gallery/`, `art/`, `resume/`, and `theater/` hold other parts of the site.
- `api/` and some project folders include PHP files for server features.

## How To Run It

For the normal website pages, you can open `index.html` in a browser.

For PHP features, run the site with a local PHP server:

```sh
php -S 127.0.0.1:8000 -t .
```

Then open:

```text
http://127.0.0.1:8000
```

## Environment Variables

Some server features use the OpenAI API. They need a `.env` file on the server with this value:

```text
OPENAI_API_KEY=your_key_here
```

The real `.env` file should not be committed to GitHub. Use `.env.example` as the safe example file.

## Safety Notes

This repo is set up so private runtime files are ignored by Git, including real environment files, access token balances, password files, logs, and rate-limit data.

If you clone this repo, add your own `.env` file on the server before using the PHP features that call OpenAI.

## License

This is a personal portfolio project. Please do not reuse private content, branding, or personal files without permission.
