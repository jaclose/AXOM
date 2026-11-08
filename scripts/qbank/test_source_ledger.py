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
            data=ledger.inspect_txt_question_metadata(p)
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
                           questions_with_answer_fields=0) for n,z in (("a",1),("b",1),("c",2))]
            unique=enriched.canonical_packages(packages)
            self.assertEqual(len(unique),2)
            self.assertEqual(unique[0]["mirrored_paths"],[packages[1]["package"]])
            self.assertNotEqual(unique[0]["canonical_package_key"],unique[1]["canonical_package_key"])

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
