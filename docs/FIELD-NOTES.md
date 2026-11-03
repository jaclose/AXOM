# Field Notes

## Live Deployment

AXOM has a hosted web app for demos, testing, and website embedding:

- **Hosted app:** https://www.axom.info/#dashboard
- **Package download:** pending GitHub release/package link

Use the hosted app when you want the full Vercel deployment path: static Vite
app, serverless `/api/*` routes, optional Postgres sync, and mock/real AI
endpoints through environment variables.

Use the downloadable package when you want a local-first copy that opens without
localhost. The package can still export/import JSON backups, but cloud sync needs
the hosted deployment because it depends on serverless functions.
