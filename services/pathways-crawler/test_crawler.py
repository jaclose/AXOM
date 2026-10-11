"""Network-free regression suite. Fixtures are synthetic, not school facts."""
import json
import sqlite3
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch
import crawler as c

HTML = b'''<html><head><title>Synthetic admissions fixture</title><script>minimum GPA 1.0</script></head><body><nav>MCAT 472</nav><h1>Admissions requirements</h1><p>The minimum GPA is 3.4 for the early decision program in 2027. This is not the regular admission threshold.</p><p>The entering class had a median MCAT score of 512 in 2025. This describes matriculants, not a minimum requirement.</p><p>International applicants should review the separate citizenship policy and application prerequisites.</p><a href="/admissions/tuition?utm_source=test">Tuition</a><a href="https://other.example/requirements">Off-site</a></body></html>'''

class FakeFetcher:
    def __init__(self, body=HTML, code=200): self.body,self.code,self.calls=body,code,[]
    def fetch(self,url,conditional=None): self.calls.append((url,conditional)); return self.code,{'content-type':'text/html','etag':'v1'},self.body

class URLTests(unittest.TestCase):
    def test_tracking_and_fragments(self): self.assertEqual(c.canonical('https://School.edu/a?utm_source=x&b=2#top'),'https://school.edu/a?b=2')
    def test_credentials(self):
        with self.assertRaises(ValueError): c.canonical('https://user:pass@school.edu/')
    def test_local(self):
        for url in ['http://localhost/','http://127.0.0.1/','http://[::1]/','file:///etc/passwd','https://x.internal/','https://x.local/']:
            with self.subTest(url=url),self.assertRaises(ValueError):c.canonical(url)
    def test_nonstandard_port(self):
        with self.assertRaises(ValueError):c.canonical('https://school.edu:5432/')
    def test_restricted_directories(self):
        for domain in ['wdoms.org','search.wdoms.org','freida.ama-assn.org','acgmecloud.org']:
            with self.subTest(domain=domain),self.assertRaises(ValueError):c.canonical('https://'+domain+'/')
    def test_dot_segments(self):
        with self.assertRaises(ValueError):c.canonical('https://school.edu/%2e%2e/a')
    def test_query_budget(self):
        with self.assertRaises(ValueError):c.canonical('https://school.edu/?'+('&'.join(f'a{i}=1' for i in range(10))))
    def test_idempotent_escaped_path(self):
        url='https://school.edu/a%252Fb'
        self.assertEqual(c.canonical(c.canonical(url)),c.canonical(url))
    def test_private_dns(self):
        with patch('crawler.socket.getaddrinfo',return_value=[(2,1,6,'',('10.0.0.1',443))]),self.assertRaises(ValueError):c.public_addresses('school.edu')
    def test_mixed_dns(self):
        with patch('crawler.socket.getaddrinfo',return_value=[(2,1,6,'',('8.8.8.8',443)),(2,1,6,'',('127.0.0.1',443))]),self.assertRaises(ValueError):c.public_addresses('school.edu')
    def test_public_dns(self):
        with patch('crawler.socket.getaddrinfo',return_value=[(2,1,6,'',('8.8.8.8',443))]):self.assertEqual(c.public_addresses('school.edu'),['8.8.8.8'])

class RobotsTests(unittest.TestCase):
    def test_empty(self):self.assertTrue(c.Robots('').allows('https://school.edu/a'))
    def test_deny(self):self.assertFalse(c.Robots('User-agent: *\nDisallow: /').allows('https://school.edu/a'))
    def test_longest(self):self.assertTrue(c.Robots('User-agent: *\nDisallow: /a\nAllow: /a/public').allows('https://school.edu/a/public'))
    def test_allow_tie(self):self.assertTrue(c.Robots('User-agent: *\nDisallow: /a\nAllow: /a').allows('https://school.edu/a'))
    def test_wildcard(self):self.assertFalse(c.Robots('User-agent: *\nDisallow: /*.pdf$').allows('https://school.edu/a.pdf'))
    def test_anchor(self):self.assertTrue(c.Robots('User-agent: *\nDisallow: /a$').allows('https://school.edu/ab'))
    def test_specific_group(self):self.assertTrue(c.Robots('User-agent: *\nDisallow: /\nUser-agent: AXOMPathwaysBot\nAllow: /').allows('https://school.edu/a'))
    def test_delay(self):self.assertEqual(c.Robots('User-agent: *\nCrawl-delay: 10').delay,10)
    def test_combine_groups(self):self.assertFalse(c.Robots('User-agent: AXOMPathwaysBot\nDisallow: /a\nUser-agent: AXOMPathwaysBot\nDisallow: /b').allows('https://school.edu/b'))

class ParserTests(unittest.TestCase):
    def test_ignore_scripts_navigation(self):
        p=c.parse_page(HTML,'text/html');text=' '.join(p['blocks']);self.assertNotIn('GPA 1.0',text);self.assertNotIn('MCAT 472',text)
    def test_links(self):self.assertEqual(len(c.parse_page(HTML,'text/html')['links']),2)
    def test_title(self):self.assertEqual(c.parse_page(HTML,'text/html')['title'],'Synthetic admissions fixture')
    def test_unknown_charset(self):self.assertTrue(c.parse_page(HTML,'text/html; charset=unknown-encoding')['blocks'])
    def test_unsupported(self):
        with self.assertRaises(c.CaptureError):c.parse_page(b'video','video/mp4')
    def test_qualifiers(self):
        props=c.proposals('medical-schools',c.parse_page(HTML,'text/html'))
        gpa=next(p for p in props if p['field']=='admissions.gpa_minimum')
        self.assertIn('early-decision',gpa['context']['qualifiers']);self.assertIn('2027',gpa['context']['mentionedYears'])
    def test_no_numeric_autofill(self):
        props=c.proposals('medical-schools',c.parse_page(HTML,'text/html'))
        self.assertTrue(all('value' not in p and 'minimum' not in p for p in props))
    def test_missing_not_negative(self):self.assertEqual(c.proposals('medical-schools',{'title':'','blocks':['Nothing about admissions.'],'links':[]}),[])
    def test_heading_preserves_context(self):
        p=c.parse_page(b'<h2>Tuition</h2><p>For 2027 the annual amount is $50,000 for residents only.</p>','text/html')
        props=c.proposals('medical-schools',p);self.assertIn('residents only',next(x for x in props if x['field']=='costs.tuition')['excerpt'])

class StoreTests(unittest.TestCase):
    def setUp(self):
        c.STOP.clear();self.tmp=tempfile.TemporaryDirectory();self.dir=Path(self.tmp.name);self.store=c.Store(self.dir/'test.sqlite')
        self.seed=self.dir/'schools.json';self.seed.write_text(json.dumps({'schemaVersion':2,'schools':[{'id':'S0001','canonicalName':'Synthetic fixture school','degree':'MD','sources':[{'url':'https://school.edu/admissions'}]}]}))
    def tearDown(self):self.store.close();self.tmp.cleanup()
    def bootstrap(self,allow=True):return self.store.bootstrap(self.seed,'medical-schools',allow)
    def capture(self):self.bootstrap();c.run_batch(self.store,1,FakeFetcher())
    def test_stable_id(self):self.bootstrap();self.assertEqual(self.store.db.execute('select id from entities').fetchone()[0],'medical-schools:S0001')
    def test_idempotent_import(self):self.bootstrap();self.bootstrap();self.assertEqual(self.store.db.execute('select count(*) from sources').fetchone()[0],1)
    def test_no_implicit_permission(self):self.bootstrap(False);self.assertIsNone(self.store.claim())
    def test_only_first_stage_enabled(self):self.assertEqual([r[0] for r in self.store.db.execute('select name from modules where enabled=1')],['medical-schools'])
    def test_pause(self):self.bootstrap();self.store.set('paused','1');self.assertIsNone(self.store.claim())
    def test_claim_exclusive(self):self.bootstrap();self.assertIsNotNone(self.store.claim());self.assertIsNone(self.store.claim())
    def test_expired_lease(self):self.bootstrap();first=self.store.claim();self.store.db.execute('update sources set lease_until=0');self.store.db.commit();second=self.store.claim();self.assertNotEqual(first['lease'],second['lease'])
    def test_wrong_lease_rejected(self):
        self.bootstrap();job=self.store.claim();job['lease']='bad'
        with self.assertRaises(RuntimeError):self.store.finish(job,'ok',86400)
        self.store.db.rollback()
    def test_capture_candidates(self):self.capture();self.assertGreater(self.store.db.execute('select count(*) from candidates').fetchone()[0],0)
    def test_same_host_discovery(self):self.capture();urls=[r[0] for r in self.store.db.execute('select url from sources')];self.assertIn('https://school.edu/admissions/tuition',urls);self.assertTrue(all('other.example' not in x for x in urls))
    def test_no_unreviewed_exports(self):self.capture();self.assertEqual(self.store.export()['schools']['recordCount'],0)
    def test_no_review_without_summary(self):
        self.capture();cid=self.store.db.execute('select id from candidates limit 1').fetchone()[0]
        with self.assertRaises(ValueError):self.store.review(cid,'','test',False)
    def test_review_does_not_bypass_publication_policy(self):
        self.capture();cid=self.store.db.execute('select id from candidates limit 1').fetchone()[0];self.store.review(cid,'Reviewed synthetic summary.','test-reviewer',False);self.assertEqual(self.store.export()['schools']['recordCount'],0)
    def test_reviewed_legacy_contract(self):
        self.capture();cid=self.store.db.execute('select id from candidates limit 1').fetchone()[0];self.store.review(cid,'Reviewed synthetic summary.','test-reviewer',False);self.store.db.execute("update policies set publication='facts'");self.store.db.commit();out=self.store.export()['schools'];self.assertEqual(out['schemaVersion'],2);self.assertEqual(out['schools'][0]['id'],'S0001');self.assertEqual(out['schools'][0]['verificationStatus'],'incomplete')
    def test_unchanged_does_not_reopen(self):
        self.capture();cid=self.store.db.execute('select id from candidates limit 1').fetchone()[0];self.store.review(cid,'Reviewed summary.','tester',False)
        job=dict(self.store.db.execute("select s.*,e.module from sources s join entities e on e.id=s.entity_id where s.hash is not null").fetchone());self.store.save(job,c.parse_page(HTML,'text/html'),{})
        self.assertEqual(self.store.db.execute('select status from candidates where id=?',(cid,)).fetchone()[0],'approved')
    def test_changed_document_reopens(self):
        self.capture();cid=self.store.db.execute('select id from candidates limit 1').fetchone()[0];self.store.review(cid,'Reviewed summary.','tester',False)
        job=dict(self.store.db.execute("select s.*,e.module from sources s join entities e on e.id=s.entity_id where s.hash is not null").fetchone());self.store.save(job,c.parse_page(HTML.replace(b'3.4',b'3.8'),'text/html'),{})
        self.assertEqual(self.store.db.execute("select count(*) from candidates where status='approved'").fetchone()[0],0)
    def test_304_keeps_snapshot_count(self):
        self.capture();before=self.store.db.execute('select count(*) from snapshots').fetchone()[0];self.store.db.execute("delete from sources where hash is null");self.store.db.execute('update sources set next_at=0');self.store.db.commit();c.run_batch(self.store,1,FakeFetcher(code=304));self.assertEqual(self.store.db.execute('select count(*) from snapshots').fetchone()[0],before)
    def test_thin_document_deferred(self):self.bootstrap();c.run_batch(self.store,1,FakeFetcher(b'<html><div id="app"></div></html>'));self.assertEqual(self.store.db.execute('select status from sources').fetchone()[0],'needs-browser')
    def test_transient_error_retries(self):
        self.bootstrap()
        class Failed:
            def fetch(self,*_):raise OSError('synthetic connection failure')
        c.run_batch(self.store,1,Failed());self.assertEqual(self.store.db.execute('select status from sources').fetchone()[0],'retry')
    def test_status_does_not_call_once_daemon(self):self.capture();self.assertFalse(self.store.status()['workerRecentlySeen'])
    def test_foreign_keys(self):
        with self.assertRaises(sqlite3.IntegrityError):self.store.db.execute("insert into sources(id,entity_id,url,host) values('bad','missing','https://school.edu/a','school.edu')")
    def test_crossdomain_fetch_blocked(self):
        self.bootstrap();f=c.Fetcher(self.store)
        with self.assertRaises(c.CaptureError):f.request('https://different.edu/',{'school.edu'})
    def test_robots_unavailable_fail_closed(self):
        self.bootstrap();f=c.Fetcher(self.store)
        with patch.object(f,'request',return_value=(503,{},b'')),self.assertRaises(c.CaptureError):f.check_robots('https://school.edu/admissions',{'school.edu'})
    def test_robots_404_allows(self):
        self.bootstrap();f=c.Fetcher(self.store)
        with patch.object(f,'request',return_value=(404,{},b'')):f.check_robots('https://school.edu/admissions',{'school.edu'})
    def test_robots_deny(self):
        self.bootstrap();f=c.Fetcher(self.store)
        with patch.object(f,'request',return_value=(200,{},b'User-agent: *\nDisallow: /')),self.assertRaises(c.CaptureError):f.check_robots('https://school.edu/admissions',{'school.edu'})

if __name__=='__main__':unittest.main(verbosity=2)
