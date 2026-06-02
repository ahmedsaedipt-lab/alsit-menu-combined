# مقهى الست · Multi-branch menu

One Node/Express app that serves **two** separate menus (two branches) so it can
run as a single Render service.

## Routes

| Branch | Menu page | Admin dashboard | Menu data file |
|--------|-----------|-----------------|----------------|
| Branch 1 | `/` | `/admin` | `data/branch1/menu.json` |
| Branch 2 | `/branch2` | `/branch2/admin` | `data/branch2/menu.json` |

The two menus are completely independent — different items, prices, and offers.
Only the design template and the server code are shared.

## Local run

```
npm install
npm start
```

- Branch 1: http://localhost:8000/  ·  admin: http://localhost:8000/admin
- Branch 2: http://localhost:8000/branch2  ·  admin: http://localhost:8000/branch2/admin

Default admin password: `alsit2026` (override with the `ADMIN_PASSWORD` env var).
You can set separate passwords with `ADMIN_PASSWORD_BRANCH1` and
`ADMIN_PASSWORD_BRANCH2`.

## Notes
- Static assets (logos, background video) live in `public/` and are shared.
- Uploaded offer images are stored per branch under `uploads/branch1` and `uploads/branch2`.
- On Render's free tier the filesystem is ephemeral: menu edits and uploads made
  through the dashboard reset on redeploy/restart. To make a change permanent,
  edit the branch's `menu.json` and push to GitHub.
