# Admin Panel

A standalone, multi-user administration panel. Self-contained — no external
integrations.

## Features

- Session-based login with hashed passwords (Werkzeug PBKDF2).
- Role-based access: **admin** and **user**.
- User management (admin): create, enable/disable, change role, delete.
- Self-service password change for every user.
- CSRF protection on all state-changing requests.
- Deployable under a sub-path (e.g. `https://brawlboost.us/targetpanel`).

## Stack

Python + Flask + SQLite (stdlib `sqlite3`). Served by gunicorn behind nginx.

## Run locally

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python app.py          # http://127.0.0.1:8000
```

On first run a database `panel.db` is created and the initial admin is seeded:

- login: `rym6a`
- password: `targetclxn_rym6a4ka`

**Change this password after first login** (Аккаунт → Смена пароля), or override
the seed before first run with `PANEL_ADMIN_USER` / `PANEL_ADMIN_PASSWORD`.

## Configuration (environment variables)

| Variable                | Default            | Purpose                                        |
|-------------------------|--------------------|------------------------------------------------|
| `PANEL_SECRET_KEY`      | random per boot    | Flask session signing key. **Set a fixed value in production** or sessions drop on restart. |
| `PANEL_DB_PATH`         | `./panel.db`       | SQLite file location.                          |
| `PANEL_URL_PREFIX`      | *(empty)*          | Sub-path when run directly (nginx uses `X-Forwarded-Prefix` instead). |
| `PANEL_COOKIE_SECURE`   | `0`                | Set to `1` behind HTTPS.                        |
| `PANEL_ADMIN_USER`      | `rym6a`            | Seeded admin login (first run only).           |
| `PANEL_ADMIN_PASSWORD`  | `targetclxn_rym6a4ka` | Seeded admin password (first run only).     |

## Tests

```bash
.venv/bin/python smoke_test.py
```

## Deploy to a VPS (Ubuntu/Debian) under brawlboost.us/targetpanel

DNS: an `A` record for `brawlboost.us` must point at the server.

```bash
# 1. System packages
sudo apt update
sudo apt install -y python3-venv nginx certbot python3-certbot-nginx

# 2. App code
sudo mkdir -p /opt/targetpanel
sudo cp -r app.py wsgi.py requirements.txt templates /opt/targetpanel/
cd /opt/targetpanel
sudo python3 -m venv .venv
sudo .venv/bin/pip install -r requirements.txt
sudo chown -R www-data:www-data /opt/targetpanel

# 3. systemd service (edit PANEL_SECRET_KEY first!)
#    Generate one: python3 -c "import secrets; print(secrets.token_hex(32))"
sudo cp deploy/panel.service /etc/systemd/system/panel.service
sudo nano /etc/systemd/system/panel.service        # set PANEL_SECRET_KEY
sudo systemctl daemon-reload
sudo systemctl enable --now panel

# 4. nginx + TLS
sudo cp deploy/nginx.conf /etc/nginx/sites-available/brawlboost
sudo ln -s /etc/nginx/sites-available/brawlboost /etc/nginx/sites-enabled/
sudo certbot --nginx -d brawlboost.us            # issues the certificate
sudo nginx -t && sudo systemctl reload nginx
```

The panel is then available at `https://brawlboost.us/targetpanel/`.

### Notes

- `panel.db` holds all users; back it up. It is git-ignored.
- To reset the admin password, delete `panel.db` and restart (re-seeds), or
  update the `password_hash` directly in SQLite.
