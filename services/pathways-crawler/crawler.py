#!/usr/bin/env python3
"""AXOM Pathways crawler. Private capture, review-gated publication, durable jobs.
Python 3.11+. Core collection and dashboard require only the standard library.
"""
from __future__ import annotations
import argparse
import base64
import contextlib
import datetime as dt
import fcntl
import hashlib
import html
from html.parser import HTMLParser
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import ipaddress
import json
import os
from pathlib import Path
import random
import re
import signal
import socket
import sqlite3
import ssl
import subprocess
import sys
import threading
import time
from urllib.parse import urlsplit, urlunsplit, urljoin, parse_qsl, urlencode, quote, unquote
import uuid
import zlib

ROOT = Path(__file__).resolve().parent
FIELDS = json.loads((ROOT / "fields.json").read_text())
VERSION = "axom-pathways-1.0.0"
UA = "AXOMPathwaysBot/1.0 (+https://axom.info)"
DENY_HOSTS = ("wdoms.org", "ama-assn.org", "aamc.org", "acgmecloud.org", "nrmp.org")
SKIP_PATH = re.compile(r"(?:^|/)(?:login|signin|sign-in|logout|cart|checkout|wp-admin|wp-json|search)(?:/|$)", re.I)
LINK_TOPICS = re.compile(r"admiss|require|tuition|fee|scholar|financial|curricul|handbook|catalog|bulletin|clinical|clerkship|rotation|elective|hospital|residen|graduate-medical|student|accredit|outcome|match|mission|policy|policies|program|contact|application|academic", re.I)
COMPILED = {m: [(f"{group}.{key}", key.replace("_", " "), re.compile(pat, re.I)) for group, fields in groups.items() for key, pat in fields.items()] for m, groups in FIELDS.items()}
MAX_BYTES = 3_000_000
STOP = threading.Event()


def iso(ts: float | None = None) -> str:
    return dt.datetime.fromtimestamp(time.time() if ts is None else ts, dt.timezone.utc).isoformat().replace("+00:00", "Z")


def digest(*parts: str) -> str:
    return hashlib.sha256("\0".join(parts).encode()).hexdigest()


def canonical(url: str) -> str:
    if not isinstance(url, str) or any(ord(c) < 32 for c in url) or "\\" in url:
        raise ValueError("invalid URL")
    p = urlsplit(url.strip())
    if p.scheme not in ("https", "http") or p.username or p.password or not p.hostname:
        raise ValueError("only credential-free HTTP(S) URLs are allowed")
    host = p.hostname.encode("idna").decode().lower().rstrip(".")
    if p.port not in (None, 80 if p.scheme == "http" else 443):
        raise ValueError("nonstandard port")
    if ":" in host or host == "localhost" or host.endswith((".local", ".internal", ".localhost")):
        raise ValueError("local or literal address")
    try:
        ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        raise ValueError("literal IPs are not crawl targets")
    if any(host == h or host.endswith("." + h) for h in DENY_HOSTS):
        raise ValueError("restricted directory: use permitted imports instead")
    path = quote(p.path or "/", safe="/%:@!$&'()*+,;=-._~")
    if any(part in (".", "..") for part in unquote(path).split("/")):
        raise ValueError("dot path segments")
    if SKIP_PATH.search(path):
        raise ValueError("interactive or authentication path")
    query = [(k, v) for k, v in parse_qsl(p.query, keep_blank_values=True) if not k.lower().startswith("utm_") and k.lower() not in ("fbclid", "gclid", "sessionid", "token", "access_token")]
    if len(query) > 8 or len(url) > 2000:
        raise ValueError("unbounded query")
    return urlunsplit((p.scheme, host, path, urlencode(sorted(query)), ""))


def public_addresses(host: str) -> list[str]:
    answers = list(dict.fromkeys(item[4][0] for item in socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)))
    if not answers or any(not ipaddress.ip_address(a).is_global for a in answers):
        raise ValueError("DNS includes a nonpublic address")
    return answers


class CaptureError(Exception):
    def __init__(self, message: str, state: str = "retry", delay: float = 3600):
        super().__init__(message)
        self.state, self.delay = state, delay


class Robots:
    """Longest-match robots rules, wildcard/end anchors, tied allow wins."""
    def __init__(self, text: str):
        groups, agents, rules, delay = [], [], [], 3.0
        started = False
        for raw in text.splitlines():
            line = raw.split("#", 1)[0].strip()
            if ":" not in line:
                continue
            key, value = [s.strip() for s in line.split(":", 1)]
            key = key.lower()
            if key == "user-agent":
                if started:
                    groups.append((agents, rules, delay)); agents, rules, delay, started = [], [], 3.0, False
                agents.append(value.lower())
            elif agents and key in ("allow", "disallow", "crawl-delay"):
                started = True
                if key == "crawl-delay":
                    try: delay = max(3.0, float(value))
                    except ValueError: pass
                elif value:
                    rules.append((key == "allow", value))
        if agents:
            groups.append((agents, rules, delay))
        selected, best = [], -1
        for agents, rules, delay in groups:
            score = max((0 if a == "*" else len(a) for a in agents if a == "*" or a in UA.lower()), default=-1)
            if score > best: selected, best = [(rules, delay)], score
            elif score == best and score >= 0: selected.append((rules, delay))
        self.rules = [r for rs, _ in selected for r in rs] if best >= 0 else []
        self.delay = max((d for _, d in selected), default=3.0)

    def allows(self, url: str) -> bool:
        p = urlsplit(url)
        target = p.path + ("?" + p.query if p.query else "")
        matching = []
        for allow, pattern in self.rules:
            anchored = pattern.endswith("$")
            core = pattern[:-1] if anchored else pattern
            regex = "^" + re.escape(core).replace(r"\*", ".*") + ("$" if anchored else "")
            if re.search(regex, target):
                matching.append((len(core.replace("*", "").encode()), allow))
        return max(matching)[1] if matching else True


class PageParser(HTMLParser):
    BLOCKS = {"p", "li", "h1", "h2", "h3", "h4", "h5", "h6", "tr", "div", "section", "article", "br"}
    VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.skip: list[str] = []
        self.buffer: list[str] = []
        self.blocks: list[str] = []
        self.links: list[str] = []
        self.title_parts: list[str] = []
        self.in_title = False
    def flush(self):
        value = re.sub(r"\s+", " ", "".join(self.buffer)).strip()
        if value and (not self.blocks or self.blocks[-1] != value): self.blocks.append(value)
        self.buffer = []
    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if not self.skip and tag == "a" and a.get("href"): self.links.append(a["href"])
        if self.skip:
            if tag not in self.VOID: self.skip.append(tag)
            return
        if tag in {"script", "style", "svg", "nav", "footer", "aside"} or "hidden" in a or a.get("aria-hidden") == "true":
            if tag not in self.VOID: self.skip.append(tag)
            return
        if tag == "title": self.in_title = True
        if tag in self.BLOCKS: self.flush()
        if tag in {"td", "th"}: self.buffer.append(" | ")
    def handle_endtag(self, tag):
        if self.skip:
            if tag in self.skip:
                self.skip = self.skip[:len(self.skip) - 1 - self.skip[::-1].index(tag)]
            return
        if tag == "title": self.in_title = False
        if tag in self.BLOCKS: self.flush()
    def handle_data(self, data):
        if self.skip: return
        if self.in_title: self.title_parts.append(data)
        else: self.buffer.append(data)
    def result(self):
        self.flush()
        return {"title": " ".join(self.title_parts).strip()[:240], "blocks": self.blocks, "links": self.links}


def parse_page(body: bytes, content_type: str) -> dict:
    if "pdf" in content_type or body.startswith(b"%PDF"):
        try:
            p = subprocess.run([sys.executable, str(ROOT / "pdf_worker.py")], input=body, capture_output=True, timeout=25)
            if p.returncode: raise CaptureError("PDF parser unavailable or failed", "needs-parser", 86400)
            data = json.loads(p.stdout)
            if sum(map(len, data["blocks"])) < 80: raise CaptureError("Scanned PDF needs visual review; OCR not run", "needs-visual-review", 604800)
            return data
        except subprocess.TimeoutExpired:
            raise CaptureError("PDF parse timeout", "needs-visual-review", 604800)
    if not any(t in content_type for t in ("html", "text/plain", "xhtml")):
        raise CaptureError("Unsupported document type", "unsupported", 604800)
    match = re.search(r"charset=([\w-]+)", content_type, re.I)
    encoding = match.group(1) if match else "utf-8"
    try: text = body.decode(encoding, errors="replace")
    except LookupError: text = body.decode("utf-8", errors="replace")
    if "text/plain" in content_type: return {"title": "", "blocks": text.splitlines(), "links": []}
    p = PageParser(); p.feed(text); return p.result()


def proposals(module: str, page: dict) -> list[dict]:
    result = []
    blocks = page["blocks"]
    for field, label, pattern in COMPILED[module]:
        seen = set()
        for i, block in enumerate(blocks):
            match = pattern.search(block)
            if not match: continue
            context = block
            if len(block) < 90 and i + 1 < len(blocks): context += " " + blocks[i + 1]
            if len(context) < 35: continue
            start = max(0, match.start() - 180)
            excerpt = context[start:start + 1100].strip()
            if excerpt in seen: continue
            seen.add(excerpt)
            years = sorted(set(re.findall(r"\b20\d{2}(?:[-/](?:20)?\d{2})?\b", excerpt)))
            qualifiers = [q for q, pat in {"minimum":"minimum|at.least|required|no.less.than", "class-statistic":"median|average|mean|matriculat", "early-decision":"early.decision|\\bEDP\\b", "international":"international|foreign", "scholarship":"scholarship|merit.award", "negation":"not.required|do.not.require|no.minimum"}.items() if re.search(pat, excerpt, re.I)]
            result.append({"field": field, "label": label, "excerpt": excerpt, "context": {"mentionedYears": years, "qualifiers": qualifiers, "sourceTitle": page["title"], "interpretation": "candidate passage; not a normalized requirement"}})
            if len(seen) >= 2: break
    return result


SCHEMA = """
CREATE TABLE IF NOT EXISTS entities(id TEXT PRIMARY KEY, module TEXT NOT NULL, name TEXT NOT NULL, seed TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS policies(host TEXT PRIMARY KEY, fetch TEXT NOT NULL DEFAULT 'review', publication TEXT NOT NULL DEFAULT 'none', note TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS modules(name TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0, priority INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sources(id TEXT PRIMARY KEY, entity_id TEXT NOT NULL REFERENCES entities(id), url TEXT NOT NULL, host TEXT NOT NULL, depth INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'queued', next_at REAL NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0, lease TEXT, lease_until REAL, etag TEXT, modified TEXT, hash TEXT, checked_at TEXT, success_at TEXT, error TEXT, UNIQUE(entity_id,url));
CREATE INDEX IF NOT EXISTS sources_due ON sources(status,next_at);
CREATE TABLE IF NOT EXISTS snapshots(id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id), captured_at TEXT NOT NULL, content BLOB NOT NULL, title TEXT, UNIQUE(source_id,id));
CREATE TABLE IF NOT EXISTS candidates(id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id), field TEXT NOT NULL, label TEXT NOT NULL, excerpt TEXT NOT NULL, context TEXT NOT NULL, snapshot_id TEXT NOT NULL REFERENCES snapshots(id), status TEXT NOT NULL DEFAULT 'pending', first_seen TEXT NOT NULL, last_seen TEXT NOT NULL, value TEXT, reviewer TEXT, reviewed_at TEXT);
CREATE INDEX IF NOT EXISTS candidates_source ON candidates(source_id,status);
CREATE TABLE IF NOT EXISTS host_state(host TEXT PRIMARY KEY, next_at REAL NOT NULL DEFAULT 0, day TEXT NOT NULL, requests INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY, at TEXT NOT NULL, source_id TEXT, kind TEXT NOT NULL, detail TEXT);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
"""


class Store:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(self.path, timeout=20)
        os.chmod(self.path, 0o600)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA foreign_keys=ON")
        self.db.executescript(SCHEMA)
        self.db.executemany("INSERT OR IGNORE INTO modules VALUES(?,?,?)", [(name, int(name == "medical-schools"), i) for i, name in enumerate(FIELDS)])
        self.db.commit()
    def close(self): self.db.close()
    def setting(self, key: str, default: str = "") -> str:
        row = self.db.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
        return row[0] if row else default
    def set(self, key: str, value: str):
        self.db.execute("INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, value)); self.db.commit()
    def event(self, kind: str, source: str | None, detail: str):
        self.db.execute("INSERT INTO events(at,source_id,kind,detail) VALUES(?,?,?,?)", (iso(), source, kind, detail[:500]))
        self.db.execute("DELETE FROM events WHERE id < (SELECT COALESCE(MAX(id),0)-3000 FROM events)")
    def policy(self, host: str) -> dict:
        row = self.db.execute("SELECT * FROM policies WHERE host=?", (host,)).fetchone()
        return dict(row) if row else {"host": host, "fetch": "review", "publication": "none", "note": "Not registered"}
    def add_source(self, entity: str, url: str, depth: int = 0):
        try: url = canonical(url)
        except ValueError: return False
        host = urlsplit(url).hostname
        self.db.execute("INSERT OR IGNORE INTO policies(host) VALUES(?)", (host,))
        count = self.db.execute("SELECT COUNT(*) FROM sources WHERE entity_id=?", (entity,)).fetchone()[0]
        if count >= 60: return False
        self.db.execute("INSERT OR IGNORE INTO sources(id,entity_id,url,host,depth) VALUES(?,?,?,?,?)", (digest(entity, url), entity, url, host, depth))
        return True
    def bootstrap(self, path: Path, module: str, allow_capture: bool = False) -> dict:
        payload = json.loads(path.read_text())
        rows = payload.get("schools", payload.get("programs", payload.get("institutions", payload.get("opportunities", payload.get("facilities", [])))))
        if not isinstance(rows, list): raise ValueError("Dataset must contain an array of records")
        result = {"entities": 0, "seedURLs": 0, "rejectedURLs": 0, "module": module}
        for row in rows:
            identity = str(row.get("id", "")).strip()
            name = row.get("canonicalName") or row.get("programName") or row.get("name")
            if not identity or not isinstance(name, str): continue
            eid = module + ":" + identity
            self.db.execute("INSERT INTO entities VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,seed=excluded.seed", (eid, module, name, json.dumps(row)))
            result["entities"] += 1
            urls = ([row["website"]] if row.get("website") else []) + [s.get("url", "") for s in row.get("sources", [])]
            urls += [s.get("url", "") for s in row.get("researchFacts", [])]
            for raw in dict.fromkeys(urls):
                if not self.add_source(eid, raw): result["rejectedURLs"] += 1; continue
                result["seedURLs"] += 1
                host = urlsplit(canonical(raw)).hostname
                if allow_capture:
                    self.db.execute("UPDATE policies SET fetch='allow',note='Operator-authorized private capture of roster source; publication and authority require review' WHERE host=? AND fetch='review'", (host,))
        self.db.commit(); return result
    def claim(self):
        if self.setting("paused", "0") == "1": return None
        now = time.time()
        self.db.execute("BEGIN IMMEDIATE")
        self.db.execute("UPDATE sources SET status='retry',lease=NULL WHERE status='running' AND lease_until<?", (now,))
        row = self.db.execute("""SELECT s.*,e.module,e.name FROM sources s JOIN entities e ON e.id=s.entity_id JOIN modules m ON m.name=e.module JOIN policies p ON p.host=s.host WHERE m.enabled=1 AND p.fetch='allow' AND s.status IN ('queued','retry','ok','unchanged') AND s.next_at<=? ORDER BY CASE WHEN s.success_at IS NULL THEN 0 ELSE 1 END,m.priority,s.depth,s.next_at,s.id LIMIT 1""", (now,)).fetchone()
        if row:
            token = uuid.uuid4().hex
            self.db.execute("UPDATE sources SET status='running',lease=?,lease_until=? WHERE id=?", (token, now + 180, row["id"]))
            result = dict(row); result["lease"] = token
        else: result = None
        self.db.commit(); return result
    def finish(self, job: dict, state: str, delay: float, error: str = ""):
        cur = self.db.execute("UPDATE sources SET status=?,next_at=?,checked_at=?,error=?,attempts=CASE WHEN ? IN ('ok','unchanged') THEN 0 ELSE attempts+1 END,lease=NULL,lease_until=NULL WHERE id=? AND lease=?", (state, time.time()+delay, iso(), error[:500], state, job["id"], job["lease"]))
        if not cur.rowcount: raise RuntimeError("Job lease was lost")
        self.event(state, job["id"], error or job["url"]); self.db.commit()
    def save(self, job: dict, page: dict, headers: dict):
        text = "\n".join(page["blocks"])[:400000]
        sha = digest(text)
        if job["depth"] < 3:
            for href in page["links"]:
                try: url = canonical(urljoin(job["url"], href))
                except ValueError: continue
                if urlsplit(url).hostname == job["host"] and LINK_TOPICS.search(url): self.add_source(job["entity_id"], url, job["depth"]+1)
        if sha != job["hash"]:
            sid = digest(job["id"], sha)
            self.db.execute("INSERT OR IGNORE INTO snapshots VALUES(?,?,?,?,?)", (sid, job["id"], iso(), zlib.compress(text.encode()), page["title"]))
            self.db.execute("UPDATE candidates SET status='superseded' WHERE source_id=?", (job["id"],))
            for proposal in proposals(job["module"], page):
                cid = digest(job["id"], proposal["field"], proposal["excerpt"])
                self.db.execute("""INSERT INTO candidates(id,source_id,field,label,excerpt,context,snapshot_id,first_seen,last_seen) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET snapshot_id=excluded.snapshot_id,last_seen=excluded.last_seen,context=excluded.context,status='pending',value=NULL,reviewer=NULL,reviewed_at=NULL""", (cid, job["id"], proposal["field"], proposal["label"], proposal["excerpt"], json.dumps(proposal["context"]), sid, iso(), iso()))
            self.db.execute("UPDATE sources SET hash=? WHERE id=?", (sha, job["id"]))
        self.db.execute("UPDATE sources SET etag=?,modified=?,success_at=? WHERE id=?", (headers.get("etag"), headers.get("last-modified"), iso(), job["id"]))
        self.db.commit()
        return "unchanged" if sha == job["hash"] else "ok"
    def status(self):
        counts = {r[0]: r[1] for r in self.db.execute("SELECT status,count(*) FROM sources GROUP BY status")}
        modules = [dict(r) for r in self.db.execute("SELECT m.*,COUNT(DISTINCT e.id) AS entities FROM modules m LEFT JOIN entities e ON e.module=m.name GROUP BY m.name ORDER BY m.priority")]
        heartbeat = float(self.setting("heartbeat", "0"))
        return {"version": VERSION, "at": iso(), "workerHeartbeat": iso(heartbeat) if heartbeat else None, "workerRecentlySeen": bool(self.setting("mode") == "serve" and heartbeat and time.time()-heartbeat < 90), "paused": self.setting("paused", "0") == "1", "sources": counts, "modules": modules, "candidates": {r[0]: r[1] for r in self.db.execute("SELECT status,count(*) FROM candidates GROUP BY status")}, "policyReviewHosts": self.db.execute("SELECT count(*) FROM policies WHERE fetch='review'").fetchone()[0], "databaseBytes": sum(p.stat().st_size for p in self.path.parent.glob(self.path.name+"*") if p.is_file()), "publication": "reviewed facts only; no automatic changes to AXOM production"}
    def review(self, cid: str, value: str, reviewer: str, reject: bool):
        if not reviewer.strip() or (not reject and not value.strip()): raise ValueError("Reviewer and approved summary are required")
        cur = self.db.execute("UPDATE candidates SET status=?,value=?,reviewer=?,reviewed_at=? WHERE id=? AND status IN ('pending','approved','rejected')", ("rejected" if reject else "approved", value[:2000], reviewer, iso(), cid))
        if not cur.rowcount: raise ValueError("Candidate missing or superseded")
        self.event("review", None, cid); self.db.commit()
    def export(self):
        schools, records = [], []
        for entity in self.db.execute("SELECT * FROM entities ORDER BY module,name").fetchall():
            seed = json.loads(entity["seed"])
            facts = self.db.execute("""SELECT c.*,s.url,s.success_at,p.publication FROM candidates c JOIN sources s ON s.id=c.source_id JOIN policies p ON p.host=s.host WHERE s.entity_id=? AND c.status='approved' AND p.publication='facts' ORDER BY c.field,c.id""", (entity["id"],)).fetchall()
            facts = [f for f in facts if f["success_at"] and dt.datetime.fromisoformat(f["success_at"].replace("Z", "+00:00")).timestamp() > time.time()-14*86400]
            byfield = {}
            for f in facts: byfield.setdefault(f["field"], []).append(f)
            conflicting = {field: values for field, values in byfield.items() if len({f["value"] for f in values}) > 1}
            evidence = [{"id": "crawler."+f["field"]+"."+f["id"][:10], "label": f["label"]+(" (conflicting sources)" if f["field"] in conflicting else ""), "value": f["value"], "url": f["url"], "capturedAt": f["last_seen"], "captureStatus": "unverified-capture"} for f in facts]
            sources = list({f["url"]: {"url": f["url"], "retrievedAt": f["last_seen"]} for f in facts}.values())
            records.append({"id": seed["id"], "module": entity["module"], "name": entity["name"], "reviewedFacts": evidence, "conflictingFields": list(conflicting), "fieldCount": len(COMPILED[entity["module"]])})
            if entity["module"] == "medical-schools" and facts:
                row = {k: seed[k] for k in ("id", "canonicalName", "name", "segment", "degree", "programType", "location", "website") if seed.get(k)}
                row.update(canonicalName=entity["name"], name=entity["name"], verificationStatus="conflicting" if conflicting else "incomplete", sources=sources, researchFacts=evidence, updatedAt=iso())
                if conflicting: row["conflicts"] = {"crawler."+k: {"existing": v[0]["value"], "incoming": v[1]["value"]} for k,v in conflicting.items()}
                schools.append(row)
        school_export = {"schemaVersion": 2, "sourcePipelineVersion": VERSION, "generatedAt": iso(), "recordCount": len(schools), "successfulRecords": 0, "incompleteRecords": len(schools), "rejectedRecords": 0, "schools": schools}
        return {"schools": school_export, "pathways": {"schemaVersion": 1, "generatedAt": iso(), "records": records}}


class Fetcher:
    def __init__(self, store: Store): self.store, self.robots = store, {}
    def request(self, url: str, allowed: set[str], conditional: dict | None = None):
        url = canonical(url); host = urlsplit(url).hostname
        if host not in allowed or self.store.policy(host)["fetch"] != "allow": raise CaptureError("Host approval required", "needs-permission", 86400)
        addresses = public_addresses(host)
        day, now = iso()[:10], time.time()
        row = self.store.db.execute("SELECT * FROM host_state WHERE host=?", (host,)).fetchone()
        daily = self.store.db.execute("SELECT COALESCE(sum(requests),0) FROM host_state WHERE day=?", (day,)).fetchone()[0]
        if daily >= 2000 or (row and row["day"] == day and row["requests"] >= 150): raise CaptureError("Daily request budget reached", "retry", 86400)
        if row and row["next_at"] > now:
            if row["next_at"] - now > 25: raise CaptureError("Host crawl-delay cooldown", "retry", row["next_at"]-now)
            STOP.wait(row["next_at"]-now)
            if STOP.is_set(): raise CaptureError("Stopping", "retry", 10)
        delay = self.robots.get(host, (0, Robots("")))[1].delay
        self.store.db.execute("INSERT INTO host_state VALUES(?,?,?,1) ON CONFLICT(host) DO UPDATE SET next_at=excluded.next_at,requests=CASE WHEN host_state.day=excluded.day THEN host_state.requests+1 ELSE 1 END,day=excluded.day", (host, time.time()+max(3,delay), day)); self.store.db.commit()
        p = urlsplit(url)
        sock = socket.create_connection((addresses[0], 443 if p.scheme == "https" else 80), timeout=15)
        conn = http.client.HTTPConnection(host, timeout=15)
        try:
            if p.scheme == "https": sock = ssl.create_default_context().wrap_socket(sock, server_hostname=host)
            conn.sock = sock
            headers = {"User-Agent": UA, "Accept": "text/html,application/pdf,text/plain;q=0.8", "Accept-Encoding": "identity", "Host": host}
            if conditional: headers.update(conditional)
            conn.request("GET", p.path+("?"+p.query if p.query else ""), headers=headers)
            response = conn.getresponse()
            h = {k.lower(): v for k,v in response.getheaders()}
            length = int(h.get("content-length", "0"))
            if length > MAX_BYTES: raise CaptureError("Document exceeds size budget", "oversized", 604800)
            body = response.read(MAX_BYTES+1)
            if len(body) > MAX_BYTES: raise CaptureError("Document exceeds size budget", "oversized", 604800)
            if h.get("content-encoding", "identity") != "identity": raise CaptureError("Unexpected compressed transfer; stopped safely", "needs-parser", 86400)
            return response.status, h, body
        finally: conn.close(); sock.close()
    def check_robots(self, url: str, allowed: set[str]):
        host = urlsplit(url).hostname
        if host not in self.robots or time.time()-self.robots[host][0] > 3600:
            origin = urlsplit(url)
            roboturl = urlunsplit((origin.scheme, host, "/robots.txt", "", ""))
            for _ in range(4):
                status, headers, body = self.request(roboturl, allowed)
                if status in (301,302,303,307,308) and headers.get("location"):
                    roboturl = canonical(urljoin(roboturl,headers["location"])); continue
                break
            if status in (404,410): parser = Robots("")
            elif status == 200: parser = Robots(body.decode("utf-8", "replace"))
            else: raise CaptureError(f"Robots unavailable (HTTP {status}); fail closed", "retry", 21600)
            self.robots[host] = (time.time(), parser)
        if not self.robots[host][1].allows(url): raise CaptureError("Disallowed by robots.txt", "robots-blocked", 604800)
    def fetch(self, url: str, conditional: dict | None = None):
        host = urlsplit(url).hostname
        alias = host[4:] if host.startswith("www.") else "www."+host
        allowed = {host} | ({alias} if self.store.policy(alias)["fetch"] == "allow" else set())
        for _ in range(4):
            url = canonical(url)
            self.check_robots(url, allowed)
            status, headers, body = self.request(url, allowed, conditional)
            if status in (301,302,303,307,308) and headers.get("location"):
                url = canonical(urljoin(url, headers["location"])); conditional = None; continue
            if status == 429:
                retry = headers.get("retry-after", "")
                try: delay = float(retry)
                except ValueError:
                    try:
                        from email.utils import parsedate_to_datetime
                        delay = parsedate_to_datetime(retry).timestamp()-time.time()
                    except (ValueError, TypeError): delay = 3600
                raise CaptureError("HTTP 429: backing off", "retry", max(60, min(delay, 86400)))
            if status in (401,403): raise CaptureError(f"HTTP {status}; no bypass attempted", "access-blocked", 86400)
            if status in (404,410): raise CaptureError(f"HTTP {status}", "not-found", 604800)
            if status not in (200,304): raise CaptureError(f"HTTP {status}", "retry", 3600)
            return status, headers, body
        raise CaptureError("Redirect limit", "needs-permission", 86400)


def run_batch(store: Store, limit: int, fetcher: Fetcher | None = None) -> int:
    fetcher = fetcher or Fetcher(store)
    n = 0
    while n < limit and not STOP.is_set():
        store.set("heartbeat", str(time.time()))
        if store.status()["databaseBytes"] > 250_000_000:
            store.set("paused", "1"); store.event("quota", None, "Database size cap reached; capture paused"); store.db.commit(); break
        job = store.claim()
        if not job: break
        n += 1
        try:
            conditional = {}
            if job["etag"]: conditional["If-None-Match"] = job["etag"]
            if job["modified"]: conditional["If-Modified-Since"] = job["modified"]
            code, headers, body = fetcher.fetch(job["url"], conditional)
            if code == 304:
                store.db.execute("UPDATE sources SET success_at=? WHERE id=?", (iso(), job["id"]))
                store.finish(job, "unchanged", 86400); continue
            page = parse_page(body, headers.get("content-type", ""))
            if sum(map(len, page["blocks"])) < 100 and os.environ.get("AXOM_BROWSER") == "1":
                payload = {"db": str(store.path.resolve()), "url": job["url"], "body": base64.b64encode(body).decode()}
                try:
                    rendered = subprocess.run([sys.executable,str(ROOT/"browser_worker.py")], input=json.dumps(payload).encode(), capture_output=True, timeout=65)
                    if rendered.returncode:
                        raise CaptureError("Chromium render failed; no access bypass attempted", "needs-browser", 86400)
                    page = parse_page(json.loads(rendered.stdout)["html"].encode(), "text/html")
                except (subprocess.TimeoutExpired, json.JSONDecodeError):
                    raise CaptureError("Chromium render timed out or returned invalid data", "needs-browser", 86400)
            if sum(map(len, page["blocks"])) < 100:
                raise CaptureError("Thin or client-rendered page: browser capture required", "needs-browser", 86400)
            state = store.save(job, page, headers)
            store.finish(job, state, 86400)
        except CaptureError as exc:
            store.finish(job, exc.state, exc.delay, str(exc))
        except (OSError, ValueError, http.client.HTTPException) as exc:
            delay = min(21600, 60*2**min(job["attempts"], 8)) + random.random()*15
            store.finish(job, "retry" if job["attempts"] < 7 else "needs-review", delay, type(exc).__name__+": "+str(exc))
    return n


def write_json(path: Path, value: dict):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name+".tmp")
    temp.write_text(json.dumps(value, indent=2, ensure_ascii=False)+"\n")
    os.chmod(temp, 0o600); temp.replace(path)


def make_handler(db_path: Path):
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            host = self.headers.get("Host", "").split(":")[0]
            if host not in ("127.0.0.1", "localhost"): self.send_error(403); return
            if self.headers.get("Origin") and self.headers["Origin"] not in (f"http://{self.headers.get('Host')}",): self.send_error(403); return
            path = urlsplit(self.path).path
            store = Store(db_path)
            try:
                if path == "/api/status": body = json.dumps(store.status()).encode(); mime = "application/json"
                elif path == "/api/recent":
                    rows = store.db.execute("SELECT e.name,c.id,c.field,c.excerpt,c.context,c.status,s.url,c.last_seen FROM candidates c JOIN sources s ON s.id=c.source_id JOIN entities e ON e.id=s.entity_id WHERE c.status<>'superseded' ORDER BY c.last_seen DESC LIMIT 120").fetchall()
                    body = json.dumps([dict(r) for r in rows]).encode(); mime = "application/json"
                elif path == "/api/coverage":
                    rows = store.db.execute("SELECT e.id,e.name,e.module,COUNT(DISTINCT s.id) AS pages,COUNT(DISTINCT CASE WHEN s.success_at IS NOT NULL THEN s.id END) AS captured,COUNT(DISTINCT CASE WHEN c.status<>'superseded' THEN c.field END) AS candidate_fields,COUNT(DISTINCT CASE WHEN c.status='approved' THEN c.field END) AS reviewed_fields FROM entities e LEFT JOIN sources s ON s.entity_id=e.id LEFT JOIN candidates c ON c.source_id=s.id GROUP BY e.id ORDER BY e.name LIMIT 15000").fetchall()
                    body = json.dumps([{**dict(r),"total_fields":len(COMPILED[r["module"]])} for r in rows]).encode(); mime = "application/json"
                elif path == "/api/sources":
                    body = json.dumps([dict(r) for r in store.db.execute("SELECT e.name,e.module,s.url,s.status,s.checked_at,s.error FROM sources s JOIN entities e ON e.id=s.entity_id ORDER BY s.checked_at DESC LIMIT 500")]).encode(); mime = "application/json"
                elif path in ("/", "/app.js", "/style.css"):
                    filename, mime = {"/": ("dashboard.html", "text/html"), "/app.js": ("app.js", "text/javascript"), "/style.css": ("style.css", "text/css")}[path]
                    body = (ROOT/filename).read_bytes()
                else: self.send_error(404); return
            finally: store.close()
            self.send_response(200)
            self.send_header("Content-Type", mime+"; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.end_headers(); self.wfile.write(body)
        def log_message(self, *args): pass
    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", default=str(ROOT/"data"/"crawler.sqlite"))
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("bootstrap"); p.add_argument("dataset", type=Path); p.add_argument("--module", choices=FIELDS, default="medical-schools"); p.add_argument("--allow-private-capture", action="store_true")
    p = sub.add_parser("once"); p.add_argument("--max-pages", type=int, default=20)
    p = sub.add_parser("serve"); p.add_argument("--port", type=int, default=5488); p.add_argument("--bind",choices=["127.0.0.1","0.0.0.0"],default="127.0.0.1")
    sub.add_parser("status")
    p = sub.add_parser("export"); p.add_argument("--output", type=Path, default=ROOT/"data"/"exports")
    p = sub.add_parser("enable"); p.add_argument("module", choices=FIELDS)
    sub.add_parser("pause"); sub.add_parser("resume")
    p = sub.add_parser("retry-blocked"); p.add_argument("--state", choices=["needs-browser","needs-parser","needs-review","robots-blocked","access-blocked","not-found","needs-permission"], required=True)
    p = sub.add_parser("policy"); p.add_argument("host"); p.add_argument("--fetch", choices=["allow","review","block"], required=True); p.add_argument("--publication", choices=["none","facts"], default="none"); p.add_argument("--note", required=True)
    p = sub.add_parser("review"); p.add_argument("id"); p.add_argument("--value", default=""); p.add_argument("--reviewer", required=True); p.add_argument("--reject", action="store_true")
    args = parser.parse_args()
    for sig in (signal.SIGINT, signal.SIGTERM): signal.signal(sig, lambda *_: STOP.set())
    store = Store(args.db)
    try:
        if args.command == "bootstrap": print(json.dumps(store.bootstrap(args.dataset,args.module,args.allow_private_capture),indent=2))
        elif args.command == "status": print(json.dumps(store.status(),indent=2))
        elif args.command == "enable": store.db.execute("UPDATE modules SET enabled=1 WHERE name=?", (args.module,)); store.db.commit()
        elif args.command in ("pause","resume"): store.set("paused", "1" if args.command=="pause" else "0")
        elif args.command == "retry-blocked": store.db.execute("UPDATE sources SET status='queued',next_at=0 WHERE status=?", (args.state,)); store.db.commit()
        elif args.command == "policy":
            host = urlsplit(canonical("https://"+args.host+"/")).hostname
            store.db.execute("INSERT INTO policies VALUES(?,?,?,?) ON CONFLICT(host) DO UPDATE SET fetch=excluded.fetch,publication=excluded.publication,note=excluded.note", (host,args.fetch,args.publication,args.note)); store.db.commit()
        elif args.command == "review": store.review(args.id,args.value,args.reviewer,args.reject)
        elif args.command == "export":
            exports=store.export(); write_json(args.output/"application-schools.incremental.json",exports["schools"]); write_json(args.output/"pathways.reviewed.json",exports["pathways"]); write_json(args.output/"status.json",store.status()); print(str(args.output))
        else:
            with open(str(store.path)+".lock", "w") as lock:
                try: fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError: raise SystemExit("Another worker already owns this database")
                if args.command == "once":
                    store.set("mode","once")
                    run_batch(store,max(1,min(args.max_pages,2000))); print(json.dumps(store.status(),indent=2))
                else:
                    store.set("mode","serve")
                    server=ThreadingHTTPServer((args.bind,args.port),make_handler(store.path))
                    thread=threading.Thread(target=server.serve_forever,daemon=True); thread.start()
                    print(f"AXOM crawler dashboard: http://127.0.0.1:{args.port}",flush=True)
                    try:
                        fetcher=Fetcher(store)
                        while not STOP.is_set():
                            run_batch(store,10,fetcher)
                            write_json(store.path.parent/"status.json",store.status())
                            STOP.wait(10)
                    finally:
                        store.set("mode","stopped")
                        server.shutdown(); server.server_close(); thread.join(timeout=3)
    finally: store.close()

if __name__ == "__main__": main()
