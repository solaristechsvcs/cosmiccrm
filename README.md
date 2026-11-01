# CosmicCRM

A self-hosted CRM for Solaris: Node.js 24, external MySQL 8, a local `config.js`, and Wisp/Docker deployment. Responsive cosmic purple interface, with a private staff workspace.

## Included

- Dashboard with open pipeline value, weighted forecast, contacts, leads, tickets, upcoming tasks and recent activity.
- Companies and contacts, linked to owners and related business records.
- Leads with atomic, repeat-safe conversion into a company and contact.
- Deals with six sales stages, probability, close dates, table and paginated pipeline views.
- Tasks with due dates, priorities, assigned staff and related contacts, companies and deals.
- Support tickets with assignments, priorities, statuses and internal notes.
- Product catalog; quotes and invoices with product selection, line items, tax, server-calculated totals, and browser Print / Save as PDF.
- Accepted quotes convert into draft invoices without creating duplicates on repeat requests.
- Financial reporting grouped by currency and status; CSV exports for managers and administrators.
- Search, status filters, pagination and record notes.
- Administrator-managed staff accounts, password changes, session revocation, five staff roles.
- Persistent MySQL sessions, password hashing, CSRF protection, HTTP security headers, rate limits, input validation, transactional audit records, and concurrent-edit protection.
- Versioned migrations, restart-time Git updates, and optional GitHub Actions → Wisp automatic restarts.

This is a single-business internal CRM. All active staff roles can read all CRM records, including financial records. It is not a multi-tenant customer portal. Quotes/invoices are records: no emails are sent and no payments are collected. Confirm payments externally and update invoice status manually. Invoice overdue status is set manually. Pipeline values use the workspace currency.

## First Wisp installation

Use a Node.js 24 egg/image with **Git and Bash installed**. The repository must be a Git checkout, not an uploaded ZIP, for automatic updates.

1. Clone the repository into the server's `/home/container` directory (use Wisp's Git installation option, or the server file/SSH terminal):
   ```bash
   git clone https://github.com/solaristechsvcs/cosmiccrm.git .
   cp config.example.js config.js
   ```
   Clone into an empty directory. Do not overwrite an existing server's files.
2. Edit `config.js`:
   - Set your external MySQL host, port, database, user and password. Create an empty database first; the application creates its tables.
   - Set `port` to the actual Wisp allocation; keep `host: '0.0.0.0'`.
   - Set `publicUrl` to your exact browser-facing origin, for example `https://crm.your-domain.com`.
   - Generate a unique session secret:
     ```bash
     node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
     ```
   - For Cloudflare Tunnel HTTPS, use `secureCookies: true` and set `trustProxy` to your proxy hop count (normally 1 for a direct tunnel). Route the tunnel to this server's allocated address and port.
   - For direct HTTP testing only, use `secureCookies: false`, the matching HTTP `publicUrl`, and `trustProxy: false`.
   - Set your business currency before entering deals/products. Quotes and invoices have their own currency.
3. Install dependencies and create the first administrator, using an interactive terminal in the server directory:
   ```bash
   npm ci --ignore-scripts
   npm run setup
   ```
   Setup applies migrations and asks for name, email and a hidden password. It refuses to run once an active administrator exists. There is no public registration or default password.
4. Set Wisp's startup command to:
   ```bash
   bash /home/container/scripts/start.sh
   ```
   If your Node egg only exposes **Main file / MAIN_FILE**, set it to **`start.cjs`**. This wrapper runs the same update process. `server.js` is the application entry point, but starting it directly skips source updates.
5. Start the server. Open your configured domain and sign in. Add staff from **Team**.

You can also import `deploy/egg-cosmiccrm.json` into a compatible Wisp/Pterodactyl panel. Verify its image and startup fields in your Wisp version. It does not clone source automatically: install the checkout and config first.

Health check: `GET /health` returns 200 with `{"ok":true}` when MySQL is reachable. It returns 503 if the database is unavailable.

## Automatic updates when restarting

Every start through `scripts/start.sh`:

1. Reads local configuration and verifies the Git branch and clean tracked files.
2. Fetches the configured branch (default `main`) and merges **fast-forward only**. If Wisp changed only `package-lock.json`, it first preserves that change in a named Git stash and uses the repository lockfile.
3. Refuses a remote commit that tracks `config.js` or `deploy.config.js`.
4. Runs `npm ci`, JavaScript syntax checks and unit tests.
5. Applies pending, lock-protected database migrations, then starts `server.js`.

`config.js` is ignored by Git and remains on the server. The database is external and survives restarts. Source updates stop on local source edits (listing the affected files), divergent history, failed fetches, failed checks or failed migrations. Ordinary changes to only `package-lock.json` are backed up automatically in Git stash; the backup SHA is printed to the console. Inspect it with `git stash show -p BACKUP_SHA`. These lockfile backups are not reapplied automatically. There is no forced reset, file cleanup or automatic database rollback. Set `update.enabled: false` to run a pinned checkout without fetching (Git is then unnecessary). Future schema changes must use a new migration version; do not edit already-applied migrations.

## Automatically restart Wisp after changes

The repository includes `.github/workflows/ci.yml`. It runs syntax checks, dependency auditing, unit tests and a real MySQL integration suite before requesting a restart.

In GitHub → repository → **Settings → Secrets and variables → Actions**, create:

| Name | Type | Value |
| --- | --- | --- |
| `WISP_PANEL_URL` | Secret | Your panel origin, e.g. `https://panel.example.com` |
| `WISP_SERVER_ID` | Secret | This CRM server's short UUID from its panel URL |
| `WISP_API_KEY` | Secret | A Wisp **client** API key with power/restart access to this server |
| `WISP_AUTO_DEPLOY` | Variable | `true` |

Configure the GitHub `production` environment as needed. Prefer a client API key limited to this CRM server. Do not commit it or paste it into configuration examples.

Flow: **push to main → checks pass → Wisp restart requested → startup fetches main → checks/migrations → CRM starts**. The panel must be reachable from the GitHub runner. Automatic deployment is dormant until the variable and secrets are set. A successful power API response confirms the request, not application readiness; review the Wisp console and `/health`.

If you do not enable this workflow, manually restarting Wisp still pulls updates. Wisp's built-in Git auto-update should be disabled to avoid two update processes. Only merge verified changes to main: a manual restart fetches its current head.

## Permissions

| Role | Read CRM | Write records | Delete records / CSV export | Audit | Staff administration |
| --- | --- | --- | --- | --- | --- |
| Admin | All | All | Yes | Yes | Yes |
| Manager | All | All | Yes | Yes | No |
| Sales | All | Companies, contacts, leads, deals, tasks, quotes, invoices | No | No | No |
| Support | All | Contacts, tasks, tickets | No | No | No |
| Viewer | All | No | No | No | No |

Password/role/status updates revoke existing sessions. Administrators cannot disable or demote themselves. Exports are capped at 10,000 records per request; narrow the search for larger datasets. CSV formula-like cells are escaped. Notes are internal and follow the parent module's write permissions.

## Docker

Build the included runtime, then mount the server checkout so its Git metadata and local config are available:

```bash
docker build -t cosmiccrm .
docker run --name cosmiccrm --restart unless-stopped \
  -p 3015:3015 -v /absolute/path/to/cosmiccrm:/home/container cosmiccrm
```

The mounted directory must be writable by container UID 1000. Set `config.port` to the container port and point your tunnel at the published port. No database is included in the image.

## Development and testing

```bash
npm ci --ignore-scripts
npm run check
npm test
npm audit --omit=dev
```

MySQL integration tests are skipped by default. They use **only the disposable `cosmiccrm_test` database** and clear its tables. GitHub Actions provisions that database automatically. To run them against a local disposable MySQL 8 instance, set `CRM_TEST_MYSQL=1`, `CRM_TEST_DB_PASSWORD` and optionally `CRM_TEST_DB_PORT` before `npm test`. Runtime configuration remains in `config.js`; environment variables are only used for CI/deployment credentials and tests.

Back up MySQL before deploying future schema changes. Preserve `config.js` separately, use least-privilege database credentials, and use MySQL TLS when connecting across untrusted networks (`database.ssl` accepts mysql2 TLS options). Restore the matching source revision and database backup together when rolling back schema changes.

## Initial release validation

Local syntax, unit/security checks and dependency auditing are included. Browser smoke checks run in GitHub Actions against the test database and save desktop/mobile screenshots as workflow artifacts. The GitHub CI result is the source of truth for the MySQL integration run. Live Wisp deployment requires your panel secrets, server allocation and database configuration and is not performed merely by pushing source.
