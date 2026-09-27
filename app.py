"""
Standalone multi-user admin panel.

A self-contained web panel with:
  - session-based login
  - role-based access (admin / user)
  - user management (admin can create, disable, delete users and set roles)
  - self-service password change

No external integrations. This is a generic administration foundation.
"""
import os
import sqlite3
import secrets
from datetime import datetime, timedelta, timezone
from functools import wraps

from flask import (
    Flask, g, request, session, redirect, url_for,
    render_template, flash, abort,
)
from werkzeug.security import generate_password_hash, check_password_hash


# --------------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------------- #
BASE_DIR = os.path.abspath(os.path.dirname(__file__))
DB_PATH = os.environ.get("PANEL_DB_PATH", os.path.join(BASE_DIR, "panel.db"))

# URL prefix so the app can live under e.g. https://example.com/targetpanel
URL_PREFIX = os.environ.get("PANEL_URL_PREFIX", "").rstrip("/")

# Initial admin seeded on first run. Override via env in production.
SEED_ADMIN_USER = os.environ.get("PANEL_ADMIN_USER", "rym6a")
SEED_ADMIN_PASSWORD = os.environ.get("PANEL_ADMIN_PASSWORD", "targetclxn_rym6a4ka")

# Brute-force protection: this many failed logins from one IP within the
# window locks that IP out until the window passes.
LOGIN_MAX_FAILURES = 5
LOGIN_WINDOW = timedelta(minutes=15)


def load_secret_key():
    """
    Return the session signing key.

    Prefer PANEL_SECRET_KEY. Otherwise persist a generated key next to the
    database: a per-process random key would differ between gunicorn workers
    and log users out on every other request.
    """
    key = os.environ.get("PANEL_SECRET_KEY")
    if key:
        return key
    path = os.path.join(os.path.dirname(os.path.abspath(DB_PATH)), ".panel_secret_key")
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        with open(path) as f:
            return f.read().strip()
    key = secrets.token_hex(32)
    with os.fdopen(fd, "w") as f:
        f.write(key)
    return key


class PrefixMiddleware:
    """
    Make the app mountable under a sub-path (e.g. /targetpanel) behind nginx.

    nginx proxies /targetpanel/ -> 127.0.0.1:8000/ and sends the original
    prefix in the X-Forwarded-Prefix header. We copy that into SCRIPT_NAME so
    Flask's url_for() generates correct absolute paths, and honor
    X-Forwarded-Proto so secure cookies / redirects use https.
    """

    def __init__(self, wsgi_app, default_prefix=""):
        self.wsgi_app = wsgi_app
        self.default_prefix = default_prefix

    def __call__(self, environ, start_response):
        prefix = environ.get("HTTP_X_FORWARDED_PREFIX", self.default_prefix).rstrip("/")
        if prefix:
            environ["SCRIPT_NAME"] = prefix
            path = environ.get("PATH_INFO", "")
            if path.startswith(prefix):
                environ["PATH_INFO"] = path[len(prefix):] or "/"
        proto = environ.get("HTTP_X_FORWARDED_PROTO")
        if proto:
            environ["wsgi.url_scheme"] = proto
        return self.wsgi_app(environ, start_response)


def create_app():
    app = Flask(__name__)
    app.config.update(
        SECRET_KEY=load_secret_key(),
        APPLICATION_ROOT=URL_PREFIX or "/",
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        # Set to True behind HTTPS (the provided nginx config terminates TLS).
        SESSION_COOKIE_SECURE=os.environ.get("PANEL_COOKIE_SECURE", "0") == "1",
    )

    # ------------------------------------------------------------------ #
    # Database helpers
    # ------------------------------------------------------------------ #
    def get_db():
        if "db" not in g:
            g.db = sqlite3.connect(DB_PATH)
            g.db.row_factory = sqlite3.Row
            g.db.execute("PRAGMA foreign_keys = ON")
        return g.db

    @app.teardown_appcontext
    def close_db(_exc):
        db = g.pop("db", None)
        if db is not None:
            db.close()

    def init_db():
        db = sqlite3.connect(DB_PATH)
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                username      TEXT    UNIQUE NOT NULL,
                password_hash TEXT    NOT NULL,
                role          TEXT    NOT NULL DEFAULT 'user',
                is_active     INTEGER NOT NULL DEFAULT 1,
                created_at    TEXT    NOT NULL,
                created_by    TEXT
            )
            """
        )
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS login_failures (
                ip         TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        db.commit()
        # Seed the first admin only if the table is empty.
        count = db.execute("SELECT COUNT(*) FROM users").fetchone()[0]
        if count == 0:
            db.execute(
                "INSERT INTO users (username, password_hash, role, is_active, created_at, created_by)"
                " VALUES (?, ?, 'admin', 1, ?, 'system')",
                (
                    SEED_ADMIN_USER,
                    generate_password_hash(SEED_ADMIN_PASSWORD),
                    datetime.now(timezone.utc).isoformat(timespec="seconds"),
                ),
            )
            db.commit()
        db.close()

    init_db()

    # ------------------------------------------------------------------ #
    # Auth utilities
    # ------------------------------------------------------------------ #
    def current_user():
        uid = session.get("uid")
        if uid is None:
            return None
        row = get_db().execute(
            "SELECT * FROM users WHERE id = ? AND is_active = 1", (uid,)
        ).fetchone()
        return row

    @app.context_processor
    def inject_user():
        return {"current_user": current_user()}

    def safe_next(target):
        """Only allow redirects to a local path (not //host or /\\host)."""
        if target.startswith("/") and not target.startswith(("//", "/\\")):
            return target
        return None

    def login_required(view):
        @wraps(view)
        def wrapped(*args, **kwargs):
            if current_user() is None:
                return redirect(url_for("login", next=request.path))
            return view(*args, **kwargs)
        return wrapped

    def admin_required(view):
        @wraps(view)
        def wrapped(*args, **kwargs):
            u = current_user()
            if u is None:
                return redirect(url_for("login", next=request.path))
            if u["role"] != "admin":
                abort(403)
            return view(*args, **kwargs)
        return wrapped

    # ------------------------------------------------------------------ #
    # CSRF protection (session token, checked on every POST)
    # ------------------------------------------------------------------ #
    def csrf_token():
        tok = session.get("_csrf")
        if not tok:
            tok = secrets.token_hex(16)
            session["_csrf"] = tok
        return tok

    app.jinja_env.globals["csrf_token"] = csrf_token

    # ------------------------------------------------------------------ #
    # Template helpers
    # ------------------------------------------------------------------ #
    MONTHS_RU = ("янв", "фев", "мар", "апр", "мая", "июн",
                 "июл", "авг", "сен", "окт", "ноя", "дек")

    @app.template_filter("hue")
    def hue(text):
        """Stable avatar hue (0-359) derived from a username."""
        return sum((i + 1) * b for i, b in enumerate(str(text).encode())) % 360

    @app.template_filter("date_ru")
    def date_ru(iso):
        """'2026-09-27T11:03:27+00:00' -> '27 сен 2026'."""
        try:
            d = datetime.fromisoformat(iso)
        except (TypeError, ValueError):
            return iso or "—"
        return f"{d.day} {MONTHS_RU[d.month - 1]} {d.year}"

    @app.before_request
    def check_csrf():
        if request.method == "POST":
            sent = request.form.get("_csrf", "")
            if not sent or not secrets.compare_digest(sent, session.get("_csrf", "")):
                abort(400, "Invalid CSRF token")

    # ------------------------------------------------------------------ #
    # Routes: authentication
    # ------------------------------------------------------------------ #
    @app.route("/")
    def index():
        if current_user() is None:
            return redirect(url_for("login"))
        return redirect(url_for("dashboard"))

    def client_ip():
        # nginx sets X-Real-IP; gunicorn only listens on localhost.
        return request.headers.get("X-Real-IP") or request.remote_addr or "?"

    @app.route("/login", methods=["GET", "POST"])
    def login():
        if request.method == "POST":
            db = get_db()
            ip = client_ip()
            since = (datetime.now(timezone.utc) - LOGIN_WINDOW).isoformat(timespec="seconds")
            db.execute("DELETE FROM login_failures WHERE created_at < ?", (since,))
            failures = db.execute(
                "SELECT COUNT(*) FROM login_failures WHERE ip = ?", (ip,)
            ).fetchone()[0]
            if failures >= LOGIN_MAX_FAILURES:
                db.commit()
                flash("Слишком много попыток входа. Попробуйте через 15 минут.", "error")
                return render_template("login.html"), 429
            username = request.form.get("username", "").strip()
            password = request.form.get("password", "")
            row = db.execute(
                "SELECT * FROM users WHERE username = ?", (username,)
            ).fetchone()
            if row and row["is_active"] and check_password_hash(row["password_hash"], password):
                db.execute("DELETE FROM login_failures WHERE ip = ?", (ip,))
                db.commit()
                session.clear()
                session["uid"] = row["id"]
                session.permanent = False
                nxt = safe_next(request.args.get("next", ""))
                if nxt:
                    # `next` is app-relative (request.path); re-add the mount prefix.
                    return redirect(request.script_root + nxt)
                return redirect(url_for("dashboard"))
            db.execute(
                "INSERT INTO login_failures (ip, created_at) VALUES (?, ?)",
                (ip, datetime.now(timezone.utc).isoformat(timespec="seconds")),
            )
            db.commit()
            flash("Неверный логин или пароль.", "error")
        return render_template("login.html")

    @app.route("/logout", methods=["POST"])
    def logout():
        session.clear()
        return redirect(url_for("login"))

    # ------------------------------------------------------------------ #
    # Routes: dashboard + account
    # ------------------------------------------------------------------ #
    @app.route("/dashboard")
    @login_required
    def dashboard():
        db = get_db()
        total = db.execute("SELECT COUNT(*) FROM users").fetchone()[0]
        admins = db.execute("SELECT COUNT(*) FROM users WHERE role = 'admin'").fetchone()[0]
        active = db.execute("SELECT COUNT(*) FROM users WHERE is_active = 1").fetchone()[0]
        recent = db.execute(
            "SELECT * FROM users ORDER BY created_at DESC, id DESC LIMIT 5"
        ).fetchall()
        return render_template(
            "dashboard.html", total=total, admins=admins, active=active, recent=recent
        )

    @app.route("/account", methods=["GET", "POST"])
    @login_required
    def account():
        u = current_user()
        if request.method == "POST":
            cur = request.form.get("current_password", "")
            new = request.form.get("new_password", "")
            confirm = request.form.get("confirm_password", "")
            if not check_password_hash(u["password_hash"], cur):
                flash("Текущий пароль указан неверно.", "error")
            elif len(new) < 8:
                flash("Новый пароль должен быть не короче 8 символов.", "error")
            elif new != confirm:
                flash("Пароли не совпадают.", "error")
            else:
                get_db().execute(
                    "UPDATE users SET password_hash = ? WHERE id = ?",
                    (generate_password_hash(new), u["id"]),
                )
                get_db().commit()
                flash("Пароль обновлён.", "success")
                return redirect(url_for("account"))
        return render_template("account.html")

    # ------------------------------------------------------------------ #
    # Routes: user management (admin only)
    # ------------------------------------------------------------------ #
    @app.route("/users")
    @admin_required
    def users():
        rows = get_db().execute(
            "SELECT * FROM users ORDER BY created_at DESC, id DESC"
        ).fetchall()
        return render_template("users.html", users=rows)

    @app.route("/users/create", methods=["POST"])
    @admin_required
    def users_create():
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        role = request.form.get("role", "user")
        if role not in ("user", "admin"):
            role = "user"
        if not username or len(username) < 3:
            flash("Логин должен быть не короче 3 символов.", "error")
            return redirect(url_for("users"))
        if len(password) < 8:
            flash("Пароль должен быть не короче 8 символов.", "error")
            return redirect(url_for("users"))
        try:
            get_db().execute(
                "INSERT INTO users (username, password_hash, role, is_active, created_at, created_by)"
                " VALUES (?, ?, ?, 1, ?, ?)",
                (
                    username,
                    generate_password_hash(password),
                    role,
                    datetime.now(timezone.utc).isoformat(timespec="seconds"),
                    current_user()["username"],
                ),
            )
            get_db().commit()
            flash(f"Пользователь «{username}» создан.", "success")
        except sqlite3.IntegrityError:
            flash("Такой логин уже существует.", "error")
        return redirect(url_for("users"))

    @app.route("/users/<int:user_id>/toggle", methods=["POST"])
    @admin_required
    def users_toggle(user_id):
        me = current_user()
        if user_id == me["id"]:
            flash("Нельзя отключить собственную учётную запись.", "error")
            return redirect(url_for("users"))
        row = get_db().execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        if row:
            get_db().execute(
                "UPDATE users SET is_active = ? WHERE id = ?",
                (0 if row["is_active"] else 1, user_id),
            )
            get_db().commit()
        return redirect(url_for("users"))

    @app.route("/users/<int:user_id>/role", methods=["POST"])
    @admin_required
    def users_role(user_id):
        me = current_user()
        new_role = request.form.get("role", "user")
        if new_role not in ("user", "admin"):
            new_role = "user"
        if user_id == me["id"] and new_role != "admin":
            flash("Нельзя снять с себя роль администратора.", "error")
            return redirect(url_for("users"))
        get_db().execute("UPDATE users SET role = ? WHERE id = ?", (new_role, user_id))
        get_db().commit()
        return redirect(url_for("users"))

    @app.route("/users/<int:user_id>/delete", methods=["POST"])
    @admin_required
    def users_delete(user_id):
        me = current_user()
        if user_id == me["id"]:
            flash("Нельзя удалить собственную учётную запись.", "error")
            return redirect(url_for("users"))
        get_db().execute("DELETE FROM users WHERE id = ?", (user_id,))
        get_db().commit()
        flash("Пользователь удалён.", "success")
        return redirect(url_for("users"))

    @app.errorhandler(400)
    def bad_request(_e):
        return render_template("error.html", code=400,
                               message="Некорректный запрос. Обновите страницу и попробуйте снова."), 400

    @app.errorhandler(403)
    def forbidden(_e):
        return render_template("error.html", code=403,
                               message="Доступ запрещён."), 403

    @app.errorhandler(404)
    def not_found(_e):
        return render_template("error.html", code=404,
                               message="Страница не найдена."), 404

    # Mount under a sub-path when deployed behind nginx (X-Forwarded-Prefix),
    # falling back to PANEL_URL_PREFIX for direct runs.
    app.wsgi_app = PrefixMiddleware(app.wsgi_app, default_prefix=URL_PREFIX)
    return app


app = create_app()


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", "8000")), debug=False)
