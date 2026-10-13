"""Optional isolated Chromium renderer. All page requests pass the safe fetcher.
Browser DNS is disabled, third-party hosts and non-GET requests are refused.
Uses no personal browser profile, account cookies, or authenticated sessions.
"""
import base64
import json
import os
import sys
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright
from crawler import Store, Fetcher, canonical

payload = json.load(sys.stdin)
store = Store(payload['db'])
fetcher = Fetcher(store)
url = canonical(payload['url'])
host = urlsplit(url).hostname
original = base64.b64decode(payload['body'])
count = 0
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path=os.environ.get('CHROMIUM_PATH') or None,
        args=['--host-resolver-rules=MAP * ~NOTFOUND', '--disable-background-networking'])
    context = browser.new_context(service_workers='block', accept_downloads=False,
        user_agent='AXOMPathwaysBot/1.0 (+https://axom.info)', java_script_enabled=True)
    context.route_web_socket('**/*', lambda ws: ws.close())
    def intercept(route):
        global count
        try:
            request = route.request
            target = canonical(request.url)
            if request.method != 'GET' or urlsplit(target).hostname != host or count >= 25 or request.resource_type in ('image','media','font'):
                route.abort(); return
            count += 1
            if target == url:
                route.fulfill(status=200, content_type='text/html', body=original); return
            status, headers, body = fetcher.fetch(target)
            route.fulfill(status=status, headers={k:v for k,v in headers.items() if k in ('content-type','access-control-allow-origin')}, body=body)
        except Exception:
            route.abort()
    context.route('**/*', intercept)
    page = context.new_page()
    try:
        page.goto(url, wait_until='domcontentloaded', timeout=40000)
        page.wait_for_timeout(1200)
        rendered = page.content()
        if len(rendered.encode()) > 3_000_000:
            raise ValueError('Rendered document exceeds budget')
        json.dump({'html': rendered, 'requests': count}, sys.stdout)
    finally:
        context.close(); browser.close(); store.close()
