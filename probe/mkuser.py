"""Create a throwaway user on the disposable PocketBase copy (:8090) via the
public signup endpoint, and mint an auth token for the Playwright UI probe.

Touches only /tmp/trackdev. No admin credentials involved.
"""
import json, urllib.request, urllib.error, os

BASE = 'http://localhost:8090'
EMAIL = 'uiprobe@example.com'
PW = 'uiprobe-throwaway-1'


def req(path, data=None, method=None):
    body = json.dumps(data).encode() if data is not None else None
    r = urllib.request.Request(BASE + path, data=body, method=method or ('POST' if body else 'GET'))
    r.add_header('Content-Type', 'application/json')
    with urllib.request.urlopen(r) as resp:
        return json.load(resp)


try:
    req('/api/collections/users/records',
        {'email': EMAIL, 'password': PW, 'passwordConfirm': PW})
    print('created', EMAIL)
except urllib.error.HTTPError as e:
    print('signup:', e.code, e.read()[:200])

auth = req('/api/collections/users/auth-with-password', {'identity': EMAIL, 'password': PW})
os.makedirs('/tmp/trackprobe', exist_ok=True)
with open('/tmp/trackprobe/auth.json', 'w') as f:
    json.dump({'token': auth['token'], 'model': auth['record']}, f)
print('token ok for', auth['record']['id'])
