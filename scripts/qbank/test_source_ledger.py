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
