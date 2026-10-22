# hkdfguard-docs

Documentation library, wiki and blog for the HkdfGuard projects, built with [Docusaurus](https://docusaurus.io/).

Start at [docs/index.md](docs/index.md).

## Layout

| Path | Purpose |
| --- | --- |
| `docs/index.md` | Home page and table of contents |
| `docs/projects/` | One page per HkdfGuard project |
| `docs/guides/` | Cross-project guides and concepts |
| `docs/CONTRIBUTING.md` | How to add or update documentation |
| `blog/` | Blog posts (`YYYY-MM-DD-title.md`) |

## Local development

```bash
npm install
npm start     # local dev server with live reload
npm run build # production build into build/
```

## Deployment

```bash
USE_SSH=true npm run deploy             # using SSH
GIT_USER=<GitHub username> npm run deploy # using HTTPS
```

This builds the site and pushes it to the `gh-pages` branch for GitHub Pages.
