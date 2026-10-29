# Tidwyn

[한국어](README.md)

A personal news archive. Every day, AI gathers Korean, world, and IT/AI news, rewrites it in plain Korean, and links stories into issues so you can follow how events unfold.

- Site: <https://tidwyn.vercel.app>

<img src="docs/images/site-home.jpg" alt="Tidwyn home screen (phone width)" width="320">

## What it does

- **Daily briefs:** Top stories and short items in three sections (Korea, World, IT/AI). Each story has a one-line summary, why it matters, background, key facts, outlook, and sources.
- **Ongoing stories:** Stories are linked into issues, with earlier developments, an issue summary, a timeline, and related issues.
- **People, organizations, and countries:** Each one that appears in the news has a page with a one-line description and the stories and issues it appears in.
- **Glossary:** Difficult terms are collected with plain explanations. Tapping an underlined word in an expanded card opens its explanation right there.
- **Browsing:** Category filters, a date list, an issue list, and on-site search, all usable on a phone.

## How it works

1. Running the `/brief` skill in a local Claude Code session researches the previous day's news and writes it in a fixed format.
2. A script validates it, saves it to a local SQLite database, and links stories to issues. The database is the source of truth.
3. The whole database is exported as monthly JSON, committed to the `data` branch as a backup, and pushed.
4. A static site is built from the database and deployed to Vercel.


## Tech stack

- Collection and storage: TypeScript (Node 24, built-in `node:sqlite`), Claude Code skills
- Site: Vite, React, Pagefind (search), Vercel (hosting, Web Analytics)
- Tests: `node:test`

## Getting started

```bash
pnpm install
```

```bash
pnpm verify
```

- Daily collection runs with `/brief` in Claude Code. A trial run is `/brief test`.
- To view the site with generated sample data, run `pnpm site:dev`.
- Run conditions, manual deploys, rollbacks, and troubleshooting are in the [operations guide](docs/operations.md) (Korean).
- Project goals and stages are in the [project plan](docs/plan.md) (Korean).

## License and copyright

- The code is under the [MIT License](LICENSE).
- The brief and issue texts (the backup data on the `data` branch and the site content) are copyrighted by mivomad33 and may not be reused.
- Original articles and images belong to their publishers. The site rewrites article text and links images by their original URLs only.
- The texts are written by AI and may contain errors. Please check the original articles for anything important.
