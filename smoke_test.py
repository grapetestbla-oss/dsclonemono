"""End-to-end smoke test using Flask's test client. No network needed."""
import os, re, tempfile

os.environ["PANEL_DB_PATH"] = tempfile.mktemp(suffix=".db")
os.environ["PANEL_SECRET_KEY"] = "test-secret"
os.environ["PANEL_ADMIN_USER"] = "rym6a"
os.environ["PANEL_ADMIN_PASSWORD"] = "targetclxn_rym6a4ka"

import app as app_module
client = app_module.app.test_client()


def csrf(html):
    m = re.search(r'name="_csrf" value="([0-9a-f]+)"', html)
    assert m, "no csrf token found"
    return m.group(1)


def test():
    # 1. Unauthenticated root redirects to login
    r = client.get("/", follow_redirects=False)
    assert r.status_code == 302 and "/login" in r.headers["Location"], r.headers
    print("OK  root -> login redirect")

    # 2. Login page renders with a csrf token
    r = client.get("/login")
    tok = csrf(r.get_data(as_text=True))
    print("OK  login page renders")

    # 3. Wrong password rejected
    r = client.post("/login", data={"username": "rym6a", "password": "wrong", "_csrf": tok},
                    follow_redirects=True)
    assert "Неверный логин или пароль" in r.get_data(as_text=True)
    print("OK  wrong password rejected")

    # 4. Missing CSRF is rejected
    r = client.post("/login", data={"username": "rym6a", "password": "x"})
    assert r.status_code == 400
    print("OK  missing CSRF -> 400")

    # 5. Correct login
    r = client.get("/login"); tok = csrf(r.get_data(as_text=True))
    r = client.post("/login", data={"username": "rym6a", "password": "targetclxn_rym6a4ka",
                                    "_csrf": tok}, follow_redirects=True)
    body = r.get_data(as_text=True)
    assert "Добро пожаловать, rym6a" in body
    print("OK  admin login works")

    # 6. Admin can see users page and create a user
    r = client.get("/users"); tok = csrf(r.get_data(as_text=True))
    r = client.post("/users/create", data={"username": "operator1", "password": "supersecret1",
                                           "role": "user", "_csrf": tok}, follow_redirects=True)
    assert "operator1" in r.get_data(as_text=True)
    print("OK  admin creates user")

    # 7. Duplicate username rejected
    r = client.get("/users"); tok = csrf(r.get_data(as_text=True))
    r = client.post("/users/create", data={"username": "operator1", "password": "supersecret1",
                                           "role": "user", "_csrf": tok}, follow_redirects=True)
    assert "уже существует" in r.get_data(as_text=True)
    print("OK  duplicate username rejected")

    # 8. Logout
    r = client.get("/users"); tok = csrf(r.get_data(as_text=True))
    client.post("/logout", data={"_csrf": tok})
    r = client.get("/users", follow_redirects=False)
    assert r.status_code == 302 and "/login" in r.headers["Location"]
    print("OK  logout works")

    # 9. Non-admin cannot access /users
    r = client.get("/login"); tok = csrf(r.get_data(as_text=True))
    client.post("/login", data={"username": "operator1", "password": "supersecret1",
                                "_csrf": tok}, follow_redirects=True)
    r = client.get("/users")
    assert r.status_code == 403, r.status_code
    print("OK  non-admin blocked from /users (403)")

    # 10. Subpath middleware: url_for honors X-Forwarded-Prefix
    r = client.get("/login", headers={"X-Forwarded-Prefix": "/targetpanel"})
    assert 'action="/targetpanel/login' in r.get_data(as_text=True)
    print("OK  subpath prefix reflected in generated URLs")

    # 11. Open redirect via ?next=//host is ignored
    client.post("/logout", data={"_csrf": csrf(client.get("/account").get_data(as_text=True))})
    r = client.get("/login"); tok = csrf(r.get_data(as_text=True))
    r = client.post("/login?next=//evil.example", data={"username": "operator1",
                    "password": "supersecret1", "_csrf": tok})
    assert r.status_code == 302 and "evil.example" not in r.headers["Location"], r.headers
    print("OK  ?next=//host does not redirect off-site")

    # 12. ?next keeps the sub-path prefix after login
    tok = csrf(client.get("/account").get_data(as_text=True))
    client.post("/logout", data={"_csrf": tok})
    pfx = {"X-Forwarded-Prefix": "/targetpanel"}
    r = client.get("/account", headers=pfx)
    assert r.headers["Location"].startswith("/targetpanel/login?next=/account"), r.headers
    tok = csrf(client.get("/login", headers=pfx).get_data(as_text=True))
    r = client.post("/login?next=/account", headers=pfx, data={"username": "operator1",
                    "password": "supersecret1", "_csrf": tok})
    assert r.headers["Location"] == "/targetpanel/account", r.headers
    print("OK  ?next redirect honors sub-path prefix")

    # 13. Brute force: IP is locked out after repeated failures
    tok = csrf(client.get("/account").get_data(as_text=True))
    client.post("/logout", data={"_csrf": tok})
    ip = {"X-Real-IP": "203.0.113.9"}
    for _ in range(app_module.LOGIN_MAX_FAILURES):
        tok = csrf(client.get("/login").get_data(as_text=True))
        client.post("/login", headers=ip, data={"username": "operator1", "password": "nope",
                                                "_csrf": tok})
    tok = csrf(client.get("/login").get_data(as_text=True))
    r = client.post("/login", headers=ip, data={"username": "operator1",
                    "password": "supersecret1", "_csrf": tok})
    assert r.status_code == 429 and "Слишком много попыток" in r.get_data(as_text=True)
    print("OK  login throttled after repeated failures (429)")

    # 14. Every page renders for an admin
    tok = csrf(client.get("/login").get_data(as_text=True))
    client.post("/login", data={"username": "rym6a", "password": "targetclxn_rym6a4ka", "_csrf": tok})
    for path in ("/dashboard", "/users", "/account"):
        assert client.get(path).status_code == 200, path
    assert client.get("/nope").status_code == 404
    assert client.get("/static/app.css").status_code == 200
    print("OK  all pages render")

    print("\nALL TESTS PASSED")


if __name__ == "__main__":
    test()
