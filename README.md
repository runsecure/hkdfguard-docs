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

The site is published at <https://runsecure.github.io> (blog at `/blog`, docs at `/docs`).
Every push to `main` runs [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml),
which builds the site and pushes the output to the
[runsecure/runsecure.github.io](https://github.com/runsecure/runsecure.github.io) repo.
Pull requests run the build only. One-time setup steps are at the top of the workflow file.
