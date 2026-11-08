#!/usr/bin/env python3
"""Focused deterministic tests; no external academic content copied or committed."""
import hashlib
import importlib.util
import json
import pathlib
import tempfile
import unittest

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("source_ledger_under_test", HERE / "source-ledger.py")
ledger = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ledger)
import source_ledger_enrich as enriched

def digest(text):
    return hashlib.sha256(text.encode()).hexdigest()

class SourceLedgerTests(unittest.TestCase):
    def test_explicit_term_folder_not_imcq_number(self):
        x = ledger.mapping("Term 4/NCRS/IMCQ 8.pdf", "downloads_med_school")
        self.assertEqual(x["academic_term"], "T4")
        self.assertEqual(x["module"], "NCRS")
        self.assertIsNone(x["week"])
        self.assertEqual(ledger.assessment_number("IMCQ 8.pdf", "imcq"),8)
        self.assertEqual(ledger.mapping("NCRS/IMCQ 8.pdf", "downloads_ncrs_week4")["week"], 4)
        self.assertIsNone(ledger.mapping("NCRS/IMCQ 8.pdf", "baseline_ncrs_banks")["week"])

    def test_ssd_explicit_root_term(self):
        r = ledger.mapping("01 Course Content/NCRS/IMCQ 3.pdf", "ssd_term_4")
        self.assertEqual(r["academic_term"], "T4")
        self.assertEqual(r["term_evidence"], "explicit_external_ssd_term_root")

    def test_template_module_and_source_week(self):
        x = ledger.mapping("09_BPM502_PreMidterm_Lectures_DLA.txt", "baseline_templates")
        self.assertEqual(x["module"], "BPM502 Pre-Midterm")
        self.assertEqual(x["academic_term"], "T3")
        self.assertEqual(ledger.classification("09_BPM502_PreMidterm_Lectures_DLA.txt","baseline_templates"),"tracker_template")
        self.assertEqual(ledger.mapping("GOER/Week 2/IMCQ 1.pdf", "downloads_goer_week2")["week"],2)

    def test_explicit_week_20_is_source_hint_not_assessment_number(self):
        # Source filenames may identify DERS week 20; do not infer a week from IMCQ 20.
        for path in ("DERS/Week 20/PQ.pdf", "DERS/wk20/PQ.pdf", "DERS/Week 020/PQ.pdf"):
            with self.subTest(path=path):
                mapped = ledger.mapping(path, "downloads_med_school")
                self.assertEqual(mapped["week"], 20)
                self.assertEqual(mapped["week_evidence"], "explicit_path_week")
        self.assertEqual(ledger.mapping("DERS/Week 19/PQ.pdf", "downloads_med_school")["week"], 19)
        self.assertIsNone(ledger.mapping("DERS/IMCQ 20.pdf", "downloads_med_school")["week"])
        self.assertIsNone(ledger.mapping("DERS/Week 21/PQ.pdf", "downloads_med_school")["week"])

    def test_variant_relationship_is_name_not_assumed_truth(self):
        a = ledger.normalized_pair_key("Examsoft Quiz 5 (Without Answers).pdf")
        b = ledger.normalized_pair_key("Examsoft Quiz 5 (With Answers).pdf")
        self.assertEqual(a,b)
        self.assertEqual(ledger.answer_variant("Examsoft Quiz 5 (Without Answers).pdf"),"questions_only")
        self.assertEqual(ledger.answer_variant("Examsoft Quiz 5 (With Answers).pdf"),"answered_version")
        self.assertNotEqual(ledger.normalized_pair_key("Examsoft Quiz 5 With Answers.pdf"),
                            ledger.normalized_pair_key("Examsoft Quiz 6 With Answers.pdf"))

    def test_native_manifest_requires_adjacent_questions(self):
        with tempfile.TemporaryDirectory(dir=ledger.OUT) as root:
            p=pathlib.Path(root)/"manifest.json"
            p.write_text("{}")
            self.assertEqual(ledger.classification("manifest.json","ssd_term_3",p),"metadata_manifest")
            (p.parent/"questions.json").write_text("{}")
            self.assertEqual(ledger.classification("manifest.json","ssd_term_3",p),"native_manifest")

    def test_text_question_headings_count_without_answer_invention(self):
        with tempfile.TemporaryDirectory(dir=ledger.OUT) as root:
            p=pathlib.Path(root)/"Bank.txt"
            p.write_text("Question 1: What?\nA. Yes\nAnswer: A\n\nQuestion 2: Why?\nA. Yes\nAnswer: B\n")
            data=ledger.inspect_txt_question_metadata(p, pathlib.Path(root))
            self.assertEqual(data["detected_question_headings"],2)
            self.assertEqual(data["answer_lines"],2)
            self.assertTrue(data["heading_numbers_contiguous"])

    def test_canonicalization_preserves_mirrors_and_distinct_revisions(self):
        with tempfile.TemporaryDirectory(dir=ledger.OUT) as root:
            r=pathlib.Path(root)
            for n,questions in [("a",[{"id":"1"}]),("b",[{"id":"1"}]),("c",[{"id":"1"},{"id":"2"}])]:
                (r/n).mkdir()
                (r/n/"questions.json").write_text(json.dumps({"questions":questions}))
            packages=[dict(package=str(r/n),questions_file=str(r/n/"questions.json"),bank_id="demo",questions=z,
                           questions_with_answer_fields=0,issues=[],status="local_ready_for_agent2_review",
                           source_root=str(r),questions_relative_path="questions.json",
                           inspected_questions_sha256=hashlib.sha256((r/n/"questions.json").read_bytes()).hexdigest())
                      for n,z in (("a",1),("b",1),("c",2))]
            unique=enriched.canonical_packages(packages, ledger.verify_native_package_questions_sha)
            self.assertEqual(len(unique),2)
            self.assertEqual(unique[0]["mirrored_paths"],[packages[1]["package"]])
            self.assertNotEqual(unique[0]["canonical_package_key"],unique[1]["canonical_package_key"])

    def test_canonical_sha_matches_exact_inspected_native_bytes(self):
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp)
            package_dir = root / "native"
            package_dir.mkdir()
            question_bytes = b'{"bankId":"demo","questions":[{"id":"q1","stem":"One question","choices":["A","B"]}]}'
            (package_dir / "questions.json").write_bytes(question_bytes)
            (package_dir / "manifest.json").write_text(json.dumps({
                "schemaVersion": 1, "bank": {"id": "demo", "title": "Synthetic"},
                "questionsFile": "questions.json", "source": {"filename": "missing.pdf"}
            }))
            row = {"document_type": "native_manifest", "root_label": "test_native",
                   "original_path": str(package_dir / "manifest.json"),
                   "review_status": "unexamined"}
            old_roots = ledger.ROOTS
            try:
                ledger.ROOTS = [("test_native", root)]
                packages, _, _ = ledger.inspect_packages([row])
            finally:
                ledger.ROOTS = old_roots
            self.assertEqual(len(packages), 1)
            self.assertEqual(packages[0]["inspected_questions_sha256"],
                             hashlib.sha256(question_bytes).hexdigest())
            self.assertEqual(packages[0]["questions_relative_path"], "questions.json")

    def test_canonicalization_holds_changed_source_bytes_with_original_digest(self):
        import os
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp)
            pdir = root / "native"
            pdir.mkdir()
            question = pdir / "questions.json"
            first = b'{"questions":[{"id":"a"}]}'
            revised = b'{"questions":[{"id":"b"}]}'
            self.assertEqual(len(first), len(revised))
            question.write_bytes(first)
            original_stat = question.stat()
            package = dict(package=str(pdir), questions_file=str(question),
                           questions_relative_path="questions.json", source_root=str(root),
                           inspected_questions_sha256=hashlib.sha256(first).hexdigest(),
                           bank_id="demo", questions=1, questions_with_answer_fields=0,
                           issues=[], status="local_ready_for_agent2_review")
            question.write_bytes(revised)
            os.utime(question, ns=(original_stat.st_atime_ns, original_stat.st_mtime_ns))
            result = enriched.canonical_packages([package], ledger.verify_native_package_questions_sha)
            self.assertEqual(len(result), 1)
            self.assertEqual(package["canonical_status"], "source_snapshot_review_required")
            self.assertIn("questions_changed_after_inspection", package["issues"])
            self.assertEqual(package["status"], "requires_package_review")
            self.assertIsNone(package.get("questions_sha256"))
            self.assertNotEqual(package["canonical_package_key"],
                                enriched._sha("demo|" + hashlib.sha256(revised).hexdigest())[:24])

    def test_canonicalization_rejects_leaf_and_parent_symlink_substitution(self):
        import os
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp) / "source"
            root.mkdir()
            external = pathlib.Path(temp) / "external"
            external.mkdir()
            (external / "questions.json").write_bytes(b'{"questions":[{"id":"outside"}]}')
            parent = root / "cohort"
            parent.mkdir()
            pdir = parent / "native"
            pdir.mkdir()
            qpath = pdir / "questions.json"
            original = b'{"questions":[{"id":"inside"}]}'
            qpath.write_bytes(original)
            def candidate():
                return dict(package=str(pdir), questions_file=str(qpath),
                            questions_relative_path="questions.json", source_root=str(root),
                            inspected_questions_sha256=hashlib.sha256(original).hexdigest(),
                            bank_id="demo", questions=1, questions_with_answer_fields=0,
                            issues=[], status="local_ready_for_agent2_review")
            try:
                qpath.unlink()
                qpath.symlink_to(external / "questions.json")
            except (OSError, NotImplementedError):
                self.skipTest("filesystem does not permit source symlinks")
            leaf = candidate()
            enriched.canonical_packages([leaf], ledger.verify_native_package_questions_sha)
            self.assertEqual(leaf["canonical_status"], "source_snapshot_review_required")
            self.assertIn("questions_secure_recheck_unavailable", leaf["issues"])
            self.assertIsNone(leaf.get("questions_sha256"))
            qpath.unlink()
            qpath.write_bytes(original)
            parent.rename(root / "renamed")
            try:
                parent.symlink_to(external, target_is_directory=True)
            except (OSError, NotImplementedError):
                self.skipTest("filesystem does not permit directory symlinks")
            linked_parent = candidate()
            enriched.canonical_packages([linked_parent], ledger.verify_native_package_questions_sha)
            self.assertEqual(linked_parent["canonical_status"], "source_snapshot_review_required")
            self.assertIn("questions_secure_recheck_unavailable", linked_parent["issues"])
            self.assertIsNone(linked_parent.get("questions_sha256"))

    def test_native_inventory_sha_mismatch_never_becomes_canonical_ready(self):
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp)
            pkg_dir = root / "native"
            pkg_dir.mkdir()
            qpath = pkg_dir / "questions.json"
            old = b'{"bankId":"demo","questions":[{"id":"old","stem":"old","choices":["A"]}]}'
            new = b'{"bankId":"demo","questions":[{"id":"new","stem":"new","choices":["A"]}]}'
            qpath.write_bytes(new)
            manifest = pkg_dir / "manifest.json"
            manifest.write_text(json.dumps({"schemaVersion": 1,
                "bank": {"id": "demo", "title": "Synthetic"},
                "questionsFile": "questions.json", "source": {"filename": "missing.pdf"}}))
            rows = [
                {"document_type": "native_manifest", "root_label": "test_native",
                 "original_path": str(manifest), "review_status": "unexamined"},
                {"document_type": "native_questions", "root_label": "test_native",
                 "original_path": str(qpath), "source_sha256": hashlib.sha256(old).hexdigest()}
            ]
            previous_roots = ledger.ROOTS
            try:
                ledger.ROOTS = [("test_native", root)]
                packages, _, _ = ledger.inspect_packages(rows)
            finally:
                ledger.ROOTS = previous_roots
            self.assertEqual(len(packages), 1)
            self.assertEqual(packages[0]["inspected_questions_sha256"],
                             hashlib.sha256(new).hexdigest())
            self.assertIn("questions_differ_from_inventory_sha", packages[0]["issues"])
            unique = enriched.canonical_packages(packages, ledger.verify_native_package_questions_sha)
            self.assertEqual(unique[0]["canonical_status"], "source_snapshot_review_required")
            self.assertNotIn("questions_sha256", unique[0])
            self.assertEqual(ledger.prepare_queue(rows, packages)[0]["status"],
                             "requires_package_review")

    def test_dispositions_account_for_unique_sha(self):
        rows=[dict(source_sha256=digest("source"),original_path="/s.pdf",document_type="pq",priority=1,
                   extracted_status="queued",detected_question_headings=3),
              dict(source_sha256=digest("asset"),original_path="/a.png",document_type="image_asset",priority=3)]
        result=enriched.build_lead_dispositions(rows,[])
        self.assertEqual(len(result["sources"]),2)
        indexed={r["sha256"]:r for r in result["sources"]}
        self.assertEqual(indexed[digest("source")]["status"],"review-required")
        self.assertEqual(indexed[digest("source")]["questionCount"],3)
        self.assertEqual(indexed[digest("asset")]["kind"],"asset")

    def test_zip_central_directory_safe_index_only(self):
        import zipfile
        with tempfile.TemporaryDirectory(dir=ledger.OUT) as root:
            p=pathlib.Path(root)/"T4 Question Sources.zip"
            with zipfile.ZipFile(p,"w") as z:
                z.writestr("NCRS/IMCQ 3.txt","Question 1: test")
                z.writestr("../unsafe.pdf","not-safe")
                z.writestr("images/photo.png","image")
            row=dict(document_type="archive_review",original_path=str(p),source_sha256=None,source_id="synthetic")
            archives=enriched.index_source_archives([row])
            self.assertEqual(archives[0]["question_candidate_count"],1)
            self.assertEqual(len(archives[0]["entries"]),2)
            self.assertTrue(any(x["unsafe_path"] for x in archives[0]["entries"]))
            self.assertIsNone(archives[0]["entries"][0]["content_sha256"])

    def test_agent2_audit_join_requires_exact_sha_and_count(self):
        with tempfile.TemporaryDirectory(dir=ledger.OUT) as root:
            directory=pathlib.Path(root)
            sha=digest("native source")
            original=directory/"source.pdf"; original.write_bytes(b"native source")
            bysha={"sources":[{"sha256":sha,"kind":"question-source","status":"review-required"}]}
            packages=[dict(bank_id="example",questions=2,source_path=str(original))]
            rows=[{"source_sha256":sha,"original_path":str(original)}]
            file=directory/"audit.json"
            file.write_text(json.dumps({"native":[{"bankId":"example","sourceSha256":sha,
                   "questionRecords":2,"ready":1,"needsReview":1,
                   "sourceVerified":True,"cloudVerified":False}],"raw":[]}))
            valid=enriched.merge_agent2_assessment(bysha,packages,rows,file)
            self.assertEqual(valid["assessed_ready_not_installed"],1)
            self.assertEqual(bysha["sources"][0]["readyCount"],1)
            file.write_text(json.dumps({"native":[{"bankId":"example","sourceSha256":sha,
                   "questionRecords":3,"ready":2,"needsReview":1,
                   "sourceVerified":True,"cloudVerified":False}],"raw":[]}))
            invalid=enriched.merge_agent2_assessment(bysha,packages,rows,file)
            self.assertEqual(invalid["assessed_ready_not_installed"],0)
            self.assertEqual(len(invalid["rejected_audit_rows"]),1)

    def test_agent2_audit_cannot_promote_native_source_review_holds(self):
        # A historical parser receipt cannot erase a newly detected source
        # substitution, nor promote a structurally incomplete native package.
        with tempfile.TemporaryDirectory(dir=ledger.OUT) as root:
            directory = pathlib.Path(root)
            sha = digest("held academic source")
            original = directory / "source.pdf"
            original.write_bytes(b"held academic source")
            audit_file = directory / "audit.json"
            audit_file.write_text(json.dumps({"native": [{
                "bankId": "example", "sourceSha256": sha,
                "questionRecords": 2, "ready": 2, "needsReview": 0,
                "sourceVerified": True, "cloudVerified": False,
            }], "raw": []}))
            rows = [{"source_sha256": sha, "original_path": str(original),
                     "document_type": "pq", "priority": 1,
                     "detected_question_headings": 2}]
            cases = [
                ("source_snapshot_review_required", "requires_package_review",
                 ["questions_changed_after_inspection"]),
                ("canonical_distinct_question_collection", "requires_package_review",
                 ["missing_or_unsafe_assets:1"]),
            ]
            for canonical_status, status, issues in cases:
                with self.subTest(canonical_status=canonical_status, issues=issues):
                    pkg = dict(bank_id="example", questions=2, source_path=str(original),
                               canonical_status=canonical_status, status=status, issues=issues)
                    dispositions = enriched.build_lead_dispositions(rows, [pkg])
                    before = json.loads(json.dumps(dispositions))
                    result = enriched.merge_agent2_assessment(
                        dispositions, [pkg], rows, audit_file)
                    self.assertEqual(result["assessed_ready_not_installed"], 0)
                    self.assertEqual(result["assessed_source_count"], 0)
                    self.assertEqual(len(result["rejected_audit_rows"]), 1)
                    self.assertEqual(dispositions, before)

    def test_agent2_audit_rejects_ambiguous_native_source_tuple(self):
        # Two revisions citing the same source SHA and bank ID must not win
        # by dictionary insertion order when joining a historical audit.
        with tempfile.TemporaryDirectory(dir=ledger.OUT) as root:
            directory = pathlib.Path(root)
            sha = digest("shared pdf source")
            source = directory / "source.pdf"
            source.write_bytes(b"shared pdf source")
            audit_file = directory / "audit.json"
            audit_file.write_text(json.dumps({"native": [{
                "bankId": "example", "sourceSha256": sha,
                "questionRecords": 2, "ready": 1, "needsReview": 1,
                "sourceVerified": True, "cloudVerified": False,
            }], "raw": []}))
            rows = [{"source_sha256": sha, "original_path": str(source),
                     "document_type": "pq", "priority": 1}]
            verified = dict(bank_id="example", questions=2, source_path=str(source),
                            canonical_status="canonical_distinct_question_collection",
                            status="local_ready_for_agent2_review", issues=[],
                            package="/synthetic/verified")
            held = dict(verified, package="/synthetic/held",
                        canonical_status="source_snapshot_review_required",
                        status="requires_package_review",
                        issues=["questions_changed_after_inspection"])
            for packages in ([held, verified], [verified, held]):
                with self.subTest(order=[p["package"] for p in packages]):
                    dispositions = enriched.build_lead_dispositions(rows, packages)
                    before = json.loads(json.dumps(dispositions))
                    result = enriched.merge_agent2_assessment(
                        dispositions, packages, rows, audit_file)
                    self.assertEqual(result["assessed_ready_not_installed"], 0)
                    self.assertEqual(result["assessed_source_count"], 0)
                    self.assertEqual(len(result["rejected_audit_rows"]), 1)
                    self.assertEqual(dispositions, before)

    def test_source_hash_cache_cannot_mask_equal_size_replacement(self):
        # A restored timestamp must never allow an old content SHA to label new bytes.
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp) / "sources"
            out = pathlib.Path(temp) / "output"
            source = root / "DERS" / "Week 20" / "PQ 1.txt"
            source.parent.mkdir(parents=True)
            out.mkdir()
            old_bytes = b"Question 1: A?\\n"
            new_bytes = b"Question 1: B?\\n"
            self.assertEqual(len(old_bytes), len(new_bytes))
            source.write_bytes(old_bytes)

            previous_roots, previous_out = ledger.ROOTS, ledger.OUT
            try:
                ledger.ROOTS, ledger.OUT = [("synthetic_source_root", root)], out
                first, _ = ledger.load_candidates(ledger.argparse.Namespace(max_hash_mb=1))
                self.assertEqual(len(first), 1)
                old_sha, old_id = first[0]["source_sha256"], first[0]["source_id"]
                self.assertEqual(old_sha, hashlib.sha256(old_bytes).hexdigest())
                prior = source.stat()
                source.write_bytes(new_bytes)
                import os
                os.utime(source, ns=(prior.st_atime_ns, prior.st_mtime_ns))
                self.assertEqual(source.stat().st_size, prior.st_size)
                self.assertEqual(source.stat().st_mtime_ns, prior.st_mtime_ns)

                second, _ = ledger.load_candidates(ledger.argparse.Namespace(max_hash_mb=1))
                self.assertEqual(len(second), 1)
                new_sha = hashlib.sha256(new_bytes).hexdigest()
                self.assertEqual(second[0]["source_sha256"], new_sha)
                self.assertNotEqual(second[0]["source_sha256"], old_sha)
                self.assertNotEqual(second[0]["source_id"], old_id)
                self.assertEqual(second[0]["source_revision"], "sha256:" + new_sha)
                cache = json.loads((out / "source-hash-cache.json").read_text())
                self.assertEqual(cache[str(source)]["sha256"], new_sha)
                self.assertEqual(second[0]["week"], 20)

                # A hash read failure must not resurrect an old cached checksum.
                from unittest.mock import patch
                with patch.object(ledger, "sha256_file", side_effect=OSError("synthetic read failure")):
                    failed, _ = ledger.load_candidates(ledger.argparse.Namespace(max_hash_mb=1))
                self.assertIsNone(failed[0]["source_sha256"])
                self.assertIsNone(failed[0]["source_revision"])
                self.assertEqual(failed[0]["unresolved_reason"], "hash_failed:OSError")
                self.assertNotIn(str(source), json.loads((out / "source-hash-cache.json").read_text()))
            finally:
                ledger.ROOTS, ledger.OUT = previous_roots, previous_out

    def test_scanner_does_not_follow_source_file_symlinks(self):
        # A folder traversal with followlinks=False still enumerates symlinked files.
        import os
        with tempfile.TemporaryDirectory() as temp:
            base = pathlib.Path(temp)
            root = base / "authorized_sources"
            out = base / "output"
            root.mkdir()
            out.mkdir()
            legitimate = root / "PQ ordinary.txt"
            legitimate.write_bytes(b"Question 1: synthetic authorized source")
            outside = base / "unapproved_source.txt"
            outside.write_bytes(b"Question 1: synthetic source outside the authorized root")
            external_alias = root / "PQ external alias.txt"
            internal_alias = root / "PQ internal alias.txt"
            try:
                external_alias.symlink_to(outside)
                internal_alias.symlink_to(legitimate)
            except (OSError, NotImplementedError):
                self.skipTest("filesystem does not permit file symlinks")

            previous_roots, previous_out = ledger.ROOTS, ledger.OUT
            try:
                ledger.ROOTS, ledger.OUT = [("synthetic_source_root", root)], out
                rows, stats = ledger.load_candidates(ledger.argparse.Namespace(max_hash_mb=1))
            finally:
                ledger.ROOTS, ledger.OUT = previous_roots, previous_out

            self.assertEqual([row["original_filename"] for row in rows], [legitimate.name])
            self.assertEqual(stats[0]["catalogued"], 1)
            self.assertEqual(stats[0]["skipped"].get("symlinked_file_not_followed"), 2)
            self.assertEqual(rows[0]["source_sha256"], hashlib.sha256(legitimate.read_bytes()).hexdigest())
            cache = json.loads((out / "source-hash-cache.json").read_text())
            self.assertEqual(list(cache), [str(legitimate)])
            self.assertNotIn(str(external_alias), cache)
            self.assertNotIn(str(internal_alias), cache)

            # Also refuse a new symlink at hash-open time, closing the scan/open race
            # on platforms where O_NOFOLLOW is supported.
            if hasattr(os, "O_NOFOLLOW"):
                with self.assertRaises(OSError):
                    ledger.sha256_file(external_alias)

    def test_scanner_holds_checksum_if_source_changes_mid_read(self):
        # A digest of partially stale bytes must never become an authoritative revision.
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp) / "sources"
            out = pathlib.Path(temp) / "output"
            root.mkdir()
            out.mkdir()
            source = root / "PQ 1.txt"
            source.write_bytes(b"Question 1: initial source")
            actual_hash = ledger.sha256_file

            def mutate_after_digest(path):
                digest = actual_hash(path)
                path.write_bytes(b"Question 1: changed while being read")
                return digest

            prior_roots, prior_out = ledger.ROOTS, ledger.OUT
            try:
                ledger.ROOTS, ledger.OUT = [("synthetic_source_root", root)], out
                with patch.object(ledger, "sha256_file", side_effect=mutate_after_digest):
                    rows, _ = ledger.load_candidates(ledger.argparse.Namespace(max_hash_mb=1))
            finally:
                ledger.ROOTS, ledger.OUT = prior_roots, prior_out

            self.assertEqual(len(rows), 1)
            self.assertIsNone(rows[0]["source_sha256"])
            self.assertIsNone(rows[0]["source_revision"])
            self.assertEqual(rows[0]["unresolved_reason"], "hash_source_changed_during_scan")
            self.assertNotIn(str(source), json.loads((out / "source-hash-cache.json").read_text()))

    def test_scanned_lecture_filename_hints_do_not_infer_academic_weeks(self):
        # Filename tokens are candidate lecture links, not proven week or source rights.
        filenames = {
            "Lecture 05 Notes.pdf": [5],
            "NCRS_Lecture_007_Notes.pdf": [7],
            "lec-09.pdf": [9],
            "Lecture_012_and_Lect-13.pdf": [12, 13],
            "BiologyLecture 17.pdf": [],
            "IMCQ 20.pdf": [],
            "Lecture 1234.pdf": [],
        }
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp) / "sources"
            out = pathlib.Path(temp) / "output"
            root.mkdir()
            out.mkdir()
            for name in filenames:
                (root / name).write_bytes(b"synthetic filename-only source fixture")

            prior_roots, prior_out = ledger.ROOTS, ledger.OUT
            try:
                ledger.ROOTS = [("synthetic_source_root", root)]
                ledger.OUT = out
                rows, root_stats = ledger.load_candidates(ledger.argparse.Namespace(max_hash_mb=1))
            finally:
                ledger.ROOTS, ledger.OUT = prior_roots, prior_out

            self.assertEqual(root_stats[0]["catalogued"], len(filenames))
            indexed = {row["original_filename"]: row for row in rows}
            self.assertEqual(set(indexed), set(filenames))
            for name, expected in filenames.items():
                with self.subTest(name=name):
                    self.assertEqual(indexed[name]["lecture_references"], expected)
                    self.assertIsNone(indexed[name]["week"])
                    self.assertIsNone(indexed[name]["week_evidence"])
                    self.assertEqual(
                        indexed[name]["sharing_rights"],
                        "private_use_only_rights_not_asserted",
                    )

    def test_native_source_roots_with_same_label_remain_isolated(self):
        # SSD term roots may share one label while pointing at distinct approved folders.
        import os
        if not (hasattr(os, "O_NOFOLLOW") and hasattr(os, "O_DIRECTORY")
                and os.open in os.supports_dir_fd):
            self.skipTest("fd-relative no-follow package open unavailable")
        with tempfile.TemporaryDirectory() as temp:
            base = pathlib.Path(temp)
            first, second = base / "Term 4 A", base / "Term 4 B"
            first.mkdir()
            second.mkdir()
            package = second / "bank"
            package.mkdir()
            (package / "questions.json").write_text(json.dumps(
                {"bankId": "source-b", "questions": [{"id": "q", "stem": "control",
                 "choices": ["A", "B"]}]}))
            manifest = package / "manifest.json"
            manifest.write_text(json.dumps({"schemaVersion": 1,
                "questionsFile": "questions.json", "bank": {"id": "source-b"}}))
            row = {"document_type": "native_manifest", "original_path": str(manifest),
                   "root_label": "ssd_term_4"}
            previous_roots = ledger.ROOTS
            try:
                ledger.ROOTS = [("ssd_term_4", first), ("ssd_term_4", second)]
                packages, _, notes = ledger.inspect_packages([row])
            finally:
                ledger.ROOTS = previous_roots
            self.assertFalse(notes)
            self.assertEqual(len(packages), 1)
            self.assertEqual(packages[0]["questions"], 1)

    def test_malformed_native_bank_metadata_is_held_without_crashing_scan(self):
        import os
        if not (hasattr(os, "O_NOFOLLOW") and hasattr(os, "O_DIRECTORY")
                and os.open in os.supports_dir_fd):
            self.skipTest("secure fd-relative native package opening unavailable")
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp)
            package = root / "bank"
            package.mkdir()
            (package / "questions.json").write_text(json.dumps(
                {"bankId": "demo", "questions": [{"id": "one", "stem": "Synthetic",
                "choices": ["A", "B"]}]}))
            manifest = package / "manifest.json"
            original_roots = ledger.ROOTS
            try:
                ledger.ROOTS = [("synthetic", root)]
                for field in ("bank", "source"):
                    with self.subTest(field=field):
                        native = {"schemaVersion": 1, "bank": {"id": "demo"},
                            "questionsFile": "questions.json", "source": {}}
                        native[field] = ["non-object", "invalid"]
                        manifest.write_text(json.dumps(native))
                        row = {"document_type": "native_manifest", "original_path": str(manifest),
                               "root_label": "synthetic"}
                        packages, _, notes = ledger.inspect_packages([row])
                        self.assertEqual(packages, [])
                        self.assertEqual(row["review_status"], "package_invalid")
                        self.assertTrue(notes)
            finally:
                ledger.ROOTS = original_roots

    def test_native_questions_file_must_be_contained_and_not_linked(self):
        # Real file contents are synthetic. Never interpret an outside questions file as a reviewed native bank.
        import os
        if not (hasattr(os, "O_NOFOLLOW") and hasattr(os, "O_DIRECTORY")
                and os.open in os.supports_dir_fd):
            self.skipTest("fd-relative no-follow package open is unavailable; production fails closed")
        with tempfile.TemporaryDirectory() as temp:
            base = pathlib.Path(temp)
            root, package = base / "authorized", base / "authorized" / "bank"
            package.mkdir(parents=True)
            outside = base / "outside.json"
            valid_questions = {"bankId": "demo", "questions": [
                {"id": "q1", "stem": "Synthetic native question", "choices": ["A", "B"], "correctAnswer": "A"}]}
            outside.write_text(json.dumps(valid_questions))
            manifest = package / "manifest.json"
            row = {"document_type": "native_manifest", "original_path": str(manifest),
                   "root_label": "synthetic_native"}
            old_roots = ledger.ROOTS
            try:
                ledger.ROOTS = [("synthetic_native", root)]
                for name in ("questions.json", "nested/questions.json"):
                    with self.subTest(valid=name):
                        target = package / name
                        target.parent.mkdir(exist_ok=True)
                        target.write_text(json.dumps(valid_questions))
                        manifest.write_text(json.dumps({"schemaVersion": 1, "bank": {"id": "demo"},
                            "questionsFile": name, "source": {}}))
                        copied_row = dict(row)
                        packages, _, notes = ledger.inspect_packages([copied_row])
                        self.assertFalse(notes)
                        self.assertEqual(len(packages), 1)
                        self.assertEqual(packages[0]["questions"], 1)
                        self.assertEqual(copied_row["extraction_status"], "native_package_structurally_checked")
                        self.assertFalse(packages[0]["backend_verified"])

                # With old Path.is_file()/read_text(), all three references are read as valid banks.
                escapes = ["../../outside.json", str(outside), "questions-link.json",
                           "linked-parent/outside.json"]
                (package / "questions-link.json").symlink_to(outside)
                (package / "linked-parent").symlink_to(base, target_is_directory=True)
                for name in escapes:
                    with self.subTest(rejected=name):
                        manifest.write_text(json.dumps({"schemaVersion": 1, "bank": {"id": "demo"},
                            "questionsFile": name, "source": {}}))
                        copied_row = dict(row)
                        packages, _, notes = ledger.inspect_packages([copied_row])
                        self.assertEqual(packages, [])
                        self.assertEqual(copied_row["review_status"], "package_invalid")
                        self.assertTrue(notes)
                        self.assertNotIn("native_package_structurally_checked",
                                         copied_row.get("extraction_status", ""))
            finally:
                ledger.ROOTS = old_roots

    def test_native_manifest_link_and_assets_directory_cannot_escape(self):
        import os
        if not (hasattr(os, "O_NOFOLLOW") and hasattr(os, "O_DIRECTORY")
                and os.open in os.supports_dir_fd):
            self.skipTest("fd-relative no-follow package open is unavailable; production fails closed")
        with tempfile.TemporaryDirectory() as temp:
            base = pathlib.Path(temp)
            root, package = base / "authorized", base / "authorized" / "bank"
            package.mkdir(parents=True)
            outside = base / "outside"
            outside.mkdir()
            (outside / "figure.png").write_bytes(b"synthetic external image")
            source = {"bankId": "demo", "questions": [{"id": "one", "stem": "Synthetic",
                "choices": ["A", "B"], "assets": [{"filename": "figure.png"}]}]}
            (package / "questions.json").write_text(json.dumps(source))
            manifest = package / "manifest.json"
            row = {"document_type": "native_manifest", "original_path": str(manifest),
                   "root_label": "synthetic_native"}
            prior_roots = ledger.ROOTS
            try:
                ledger.ROOTS = [("synthetic_native", root)]
                for directory in ("../../outside", "assets"):
                    with self.subTest(assetsDirectory=directory):
                        if directory == "assets":
                            (package / "assets").symlink_to(outside, target_is_directory=True)
                        manifest.write_text(json.dumps({"schemaVersion": 1, "bank": {"id": "demo"},
                            "questionsFile": "questions.json", "assetsDirectory": directory}))
                        packages, _, notes = ledger.inspect_packages([dict(row)])
                        self.assertEqual(len(packages), 1)
                        self.assertFalse(notes)
                        self.assertEqual(packages[0]["missing_assets"], ["figure.png"])
                        self.assertTrue(any(str(x).startswith("missing_or_unsafe_assets:")
                                            for x in packages[0]["issues"]))
                # A swapped/linked manifest is never a trusted source of native metadata.
                manifest.unlink()
                manifest.symlink_to(outside / "manifest.json")
                (outside / "manifest.json").write_text(json.dumps({"schemaVersion": 1,
                    "questionsFile": "questions.json", "bank": {"id": "demo"}}))
                packages, _, notes = ledger.inspect_packages([dict(row)])
                self.assertEqual(packages, [])
                self.assertTrue(notes)
            finally:
                ledger.ROOTS = prior_roots

    def test_postscan_text_probe_rejects_swapped_outside_symlink(self):
        # Source scanning and later text extraction must share a no-follow boundary.
        import os
        with tempfile.TemporaryDirectory() as temp:
            base = pathlib.Path(temp)
            root, out = base / "authorized", base / "reports"
            root.mkdir()
            out.mkdir()
            source = root / "PQ 1.txt"
            source.write_text("Question 1: authorized synthetic question\n")
            outside = base / "outside.txt"
            outside.write_text("Question 1: OTHER\nQuestion 2: OTHER\n")
            old_roots, old_out = ledger.ROOTS, ledger.OUT
            try:
                ledger.ROOTS, ledger.OUT = [("synthetic_sources", root)], out
                rows, _ = ledger.load_candidates(ledger.argparse.Namespace(max_hash_mb=1))
                self.assertEqual(len(rows), 1)
                source.unlink()
                try:
                    source.symlink_to(outside)
                except (OSError, NotImplementedError):
                    self.skipTest("filesystem lacks symlinks")
                ledger.inspect_text_files(rows)
                self.assertNotIn("detected_question_headings", rows[0])
                self.assertEqual(rows[0].get("scan_error"), "OSError")
                self.assertNotEqual(rows[0].get("review_status"), "tagged_source_answers_present_not_source_verified")
            finally:
                ledger.ROOTS, ledger.OUT = old_roots, old_out

    def test_postscan_template_parser_rejects_swapped_outside_symlink(self):
        # Do not copy unauthorized template titles into the Course Tracker work queue.
        with tempfile.TemporaryDirectory() as temp:
            base = pathlib.Path(temp)
            root, out = base / "authorized_templates", base / "reports"
            root.mkdir()
            out.mkdir()
            source = root / "01_FTM1_Lectures_DLA.txt"
            source.write_text("Authorized lesson [Lecture]\n")
            outside = base / "outside.txt"
            outside.write_text("Unapproved external lesson [Lecture]\n")
            old_roots, old_out = ledger.ROOTS, ledger.OUT
            try:
                ledger.ROOTS, ledger.OUT = [("baseline_templates", root)], out
                rows, _ = ledger.load_candidates(ledger.argparse.Namespace(max_hash_mb=1))
                self.assertEqual(len(rows), 1)
                self.assertEqual(rows[0]["document_type"], "tracker_template")
                self.assertEqual([a["title"] for a in ledger.parse_templates(rows)],
                                 ["Authorized lesson"])
                source.unlink()
                try:
                    source.symlink_to(outside)
                except (OSError, NotImplementedError):
                    self.skipTest("filesystem lacks symlinks")
                new_rows = [dict(rows[0])]
                activities = ledger.parse_templates(new_rows)
                self.assertEqual(activities, [])
                self.assertEqual(new_rows[0].get("review_status"), "source_read_unavailable")
                self.assertNotEqual(new_rows[0].get("extraction_status"),
                                    "tracker_template_activities_parsed")
            finally:
                ledger.ROOTS, ledger.OUT = old_roots, old_out

    def test_postscan_pdf_probe_never_invokes_pdftotext_on_swapped_symlink(self):
        # Even a partial PDF probe must read the root-contained descriptor, not a path.
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as temp:
            base = pathlib.Path(temp)
            root, out = base / "authorized", base / "reports"
            root.mkdir()
            out.mkdir()
            source = root / "PQ sample.pdf"
            source.write_bytes(b"%PDF-1.4\nsynthetic permitted bytes")
            outside = base / "outside.pdf"
            outside.write_bytes(b"%PDF-1.4\nsynthetic outside bytes")
            old_roots, old_out = ledger.ROOTS, ledger.OUT
            try:
                ledger.ROOTS, ledger.OUT = [("synthetic_sources", root)], out
                rows, _ = ledger.load_candidates(ledger.argparse.Namespace(max_hash_mb=1))
                self.assertEqual(len(rows), 1)
                with patch.object(ledger.subprocess, "run") as runner:
                    def check_safe_pdf(command, **kwargs):
                        self.assertEqual(command[-2:], ["-", "-"])
                        self.assertTrue(kwargs["stdin"].read().startswith(b"%PDF-1.4"))
                        return ledger.subprocess.CompletedProcess(command, 0,
                            stdout=b"Question 1. Synthetic example")
                    runner.side_effect = check_safe_pdf
                    self.assertEqual(ledger.inspect_pdf_sample(rows, 1), 1)
                    self.assertEqual(runner.call_count, 1)
                source.unlink()
                try:
                    source.symlink_to(outside)
                except (OSError, NotImplementedError):
                    self.skipTest("filesystem lacks symlinks")
                with patch.object(ledger.subprocess, "run") as runner:
                    self.assertEqual(ledger.inspect_pdf_sample(rows, 1), 1)
                    runner.assert_not_called()
                    self.assertEqual(rows[0]["pdf_probe_status"],
                                     "probe_unavailable_or_timed_out")
            finally:
                ledger.ROOTS, ledger.OUT = old_roots, old_out

    def test_existing_templates_still_parse_547(self):
        if not (ledger.HOME / "Developer/AXOM/AXOM Templates Completed").is_dir():
            self.skipTest("real source root unavailable")
        source_rows=[dict(original_path=str(p), source_id=digest(str(p)),document_type="tracker_template",
                          root_label="baseline_templates",
                          module=ledger.mapping(p.name,"baseline_templates")["module"],
                          academic_term=ledger.mapping(p.name,"baseline_templates")["academic_term"],
                          module_evidence="explicit_template_filename",extraction_status="unexamined")
                     for p in (ledger.HOME / "Developer/AXOM/AXOM Templates Completed").glob("*.txt")]
        self.assertEqual(len(source_rows),22)
        self.assertEqual(len(ledger.parse_templates(source_rows)),547)

if __name__ == "__main__":
    ledger.OUT.mkdir(parents=True,exist_ok=True)
    unittest.main()
