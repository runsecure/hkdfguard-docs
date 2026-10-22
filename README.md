# runsecure.github.io

Documentation library, wiki and blog for the HkdfGuard projects, built with [Docusaurus](https://docusaurus.io/) and published at <https://runsecure.github.io>.

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
Set GitHub Pages to use **GitHub Actions** as its source in the repository's
Settings > Pages. Every push to `main` runs
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml), which builds and
deploys the site directly to GitHub Pages. Pull requests run the build without
deploying.
