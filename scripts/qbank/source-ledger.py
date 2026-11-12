#!/usr/bin/env python3
"""Read-only academic source reconciliation for AXOM Agent 1.

Private outputs under artifacts/qbank-6way-20261014 (gitignored).
Does not upload content, parse questions into a competing database, or edit sources.
Usage: python3 scripts/qbank/source-ledger.py [--probe-pdfs 40] [--max-hash-mb 64]
"""
import argparse
import collections
import csv
import hashlib
import json
import os
import pathlib
import re
import stat
import subprocess
import sys
import unicodedata
from difflib import SequenceMatcher
from source_ledger_enrich import (enrich_source_records, canonical_packages, canonicalize_queue,
    enrich_pairs, add_workbook_answer_candidates, evidence_counts, build_lead_dispositions,
    ordered_import_batches, index_source_archives, merge_agent2_assessment,
    raw_text_stem_fingerprints, baseline_source_continuity)
from datetime import datetime, timezone

HOME = pathlib.Path.home()
PROJECT = pathlib.Path(__file__).resolve().parents[2]
OUT = PROJECT / "artifacts/qbank-6way-20261014"
DOCUMENT_EXT = {".pdf", ".txt", ".md", ".json", ".docx", ".pptx", ".ppsx", ".xlsx", ".xls", ".html", ".csv", ".zip", ".sha256"}
ASSET_EXT = {".png", ".webp", ".jpg", ".jpeg", ".gif", ".svg", ".heic"}
IGNORE_DIRS = {"node_modules", ".git", "__MACOSX", ".Trash", ".Spotlight-V100", "dist", "build", ".next", ".venv", "venv", "__pycache__", ".cache"}
IGNORE_NAMES = {".DS_Store", "Thumbs.db", "desktop.ini"}
TITLE_TOKENS = re.compile(r"(?i)\b(?:questions?|qbank|bank|practice|pqs?|imcqs?|esofts?|examsoft|quiz|assessments?|case|small.?group|workbook|answers?|answer.?key|syllabus|schedules?|calendar|course.?tracker|learning.?objective|review|sample.?exam|nbme)\b")
QUEST_TOKENS = re.compile(r"(?i)\b(?:questions?|qbank|bank|practice|pqs?|imcqs?|esofts?|examsoft|quiz|assessments?|workbook|answers?|answer.?key|test|sample.?exam)\b")
COURSE_MAP = {
    "CPR 1": "T1", "CPR 2": "T1", "FTM 1": "T1", "FTM 2": "T1", "MSK": "T1",
    "ER": "T2", "DM": "T2", "NB 1": "T2", "NB 2": "T2", "NB 3": "T2",
    "BPM502 Pre-Midterm": "T3", "BPM502 Post-Midterm": "T3",
    "FTCM": "T4", "NCRS": "T4", "RHPS": "T4", "DERS": "T4", "GOER": "T5",
}
TEMPLATE_MAP = {
    "CPR1": "CPR 1", "CPR2": "CPR 2", "NB1": "NB 1", "NB2": "NB 2",
    "NB3": "NB 3", "BPM502_PreMidterm": "BPM502 Pre-Midterm",
    "BPM502_PostMidterm": "BPM502 Post-Midterm", "FTM1": "FTM 1",
    "FTM2": "FTM 2", "MSK": "MSK", "ER": "ER", "DM": "DM",
}
MODULE_TESTS = [
    ("BPM502 Post-Midterm", r"(?i)bpm\s*502.*post"), ("BPM502 Pre-Midterm", r"(?i)bpm\s*502.*pre"),
    ("NCRS", r"(?i)\bncrs\b"), ("FTCM", r"(?i)\bftcm\b"),
    ("RHPS", r"(?i)\b(?:rhps|rhs)\b"), ("DERS", r"(?i)\bders\b"),
    ("GOER", r"(?i)\bgoer\b"), ("MI", r"(?i)(?:^|[/ ])mi[/ _ -]|\bmi\s*\d+"),
    ("CPR 1", r"(?i)\bcpr\s*1\b"), ("CPR 2", r"(?i)\bcpr\s*2\b"),
    ("FTM 1", r"(?i)\bftm\s*1\b"), ("FTM 2", r"(?i)\bftm\s*2\b"),
    ("NB 1", r"(?i)\bnb\s*1\b"), ("NB 2", r"(?i)\bnb\s*2\b"), ("NB 3", r"(?i)\bnb\s*3\b"),
    ("MSK", r"(?i)\bmsk\b"), ("ER", r"(?i)(?:^|[/ ])er(?:[/ _.-]|$)"),
    ("DM", r"(?i)(?:^|[/ ])dm(?:[/ _.-]|$)"),
]
ROOTS = [
    ("baseline_templates", HOME / "Developer/AXOM/AXOM Templates Completed"),
    ("baseline_t1", HOME / "Developer/AXOM/Course update 2026 August t1 (FTM1-MSK)"),
    ("baseline_mi", HOME / "Downloads/MI"),
    ("baseline_ncrs_banks", HOME / "Downloads/NCRS_IMCQ_3-8_Examsoft_5-6_AXOM_Banks"),
    ("baseline_goer_prepared", HOME / "Downloads/AXOM_GOER_Prepared_Library"),
    ("baseline_goer_mapped", HOME / "Downloads/AXOM_GOER_Mapped_Imports"),
    ("t1_local", HOME / "Developer/AXOM/01 BPM 500"),
    ("t2_local", HOME / "Developer/AXOM/01 BPM 501"),
    ("local_course_packs", HOME / "Developer/AXOM/PQ Qbank Templates Course Tracker"),
    ("local_t1t2_exam", HOME / "Developer/AXOM/T1-T2 eSofts:IMCQs BCSE Review"),
    ("local_exam_master", HOME / "Developer/AXOM/eSofts:IMCQ Master Folder"),
    ("local_upper_terms", HOME / "Developer/AXOM/00 📥 Inbox - Need Work Look Over/Upper Terms"),
    ("downloads_course_packs", HOME / "Downloads/PQ Qbank Templates Course Tracker"),
    ("downloads_t1t2_exam", HOME / "Downloads/T1-T2 eSofts:IMCQs BCSE Review"),
    ("downloads_exam_master", HOME / "Downloads/eSofts:IMCQ Master Folder"),
    ("downloads_med_school", HOME / "Downloads/01 🩺 SGU Med School"),
    ("downloads_term4", HOME / "Downloads/Term 4"),
    ("downloads_goer_content", HOME / "Downloads/GOER Content"),
    ("downloads_goer_week2", HOME / "Downloads/GOER Week 2"),
    ("downloads_rhps", HOME / "Downloads/3_ RHPS"),
    ("downloads_crs", HOME / "Downloads/Module 2 - CRS"),
    ("downloads_ncrs_week4", HOME / "Downloads/NCRS_Week_4_AXOM_Question_Banks"),
    ("downloads_ncrs_deck", HOME / "Downloads/NCRS Master Deck"),
    ("downloads_goer", HOME / "Downloads/GOER"),
    ("downloads_exam_decoder", HOME / "Downloads/GOER_Exam_Decoder_v2"),
    ("downloads_ftm", HOME / "Downloads/ftm"),
    ("downloads_root_academic_files", HOME / "Downloads"),
    ("desktop_ncrs", HOME / "Desktop/NCRS"),
    ("desktop_ftcm", HOME / "Desktop/FTCM"),
    ("desktop_rhps", HOME / "Desktop/RHPS"),
]
SSD = pathlib.Path("/Volumes/JDabSSD/Medical School")
if SSD.is_dir():
    ROOTS += [("ssd_term_" + str(n), p) for n in range(1, 6) for p in SSD.iterdir()
              if p.is_dir() and p.name.startswith("Term " + str(n) + " ")]
    ROOTS += [("ssd_recovered", SSD / "_WhatsApp Recovered PDFs")]
# Overlapping directories are not included, avoiding double-counting through nested roots.

def digest_text(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()

def sha256_file(path):
    h = hashlib.sha256()
    # No-follow prevents a file swapped for a symlink between scan and open on POSIX.
    flags = os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(path, flags)
    with os.fdopen(fd, "rb") as f:
        for chunk in iter(lambda: f.read(2 * 1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()

def save_json(name, obj):
    path = OUT / name
    temporary = path.with_name(path.name + ".tmp-agent1")
    with temporary.open("w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2, sort_keys=True)
        f.write("\n")
    temporary.replace(path)

def jsonl(name, rows):
    path = OUT / name
    temporary = path.with_name(path.name + ".tmp-agent1")
    with temporary.open("w", encoding="utf-8") as f:
        for r in rows: f.write(json.dumps(r, ensure_ascii=False, sort_keys=True) + "\n")
    temporary.replace(path)

def write_csv(name, rows, fields):
    path = OUT / name
    temporary = path.with_name(path.name + ".tmp-agent1")
    with temporary.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        for item in rows: w.writerow(item)
    temporary.replace(path)

def classification(path, root_label, physical_path=None):
    lower = path.lower()
    leaf = pathlib.Path(path).name.lower()
    if leaf.startswith(".") or leaf in IGNORE_NAMES: return "excluded_hidden"
    if root_label == "baseline_templates" and pathlib.Path(leaf).suffix == ".txt": return "tracker_template"
    if leaf == "manifest.json":
        return "native_manifest" if physical_path and (physical_path.parent / "questions.json").is_file() else "metadata_manifest"
    if leaf == "questions.json": return "native_questions"
    if leaf in {"mapping.json", "catalog.json"}: return "native_mapping"
    ext = pathlib.Path(leaf).suffix
    if ext in ASSET_EXT: return "image_asset" if ("assets/" in lower or root_label.startswith("baseline_goer")) else "unlinked_image"
    if ext == ".zip": return "archive_review" if TITLE_TOKENS.search(lower) else "archive_unrelated"
    if ext not in DOCUMENT_EXT: return "excluded_unsupported_extension"
    if ext == ".sha256": return "checksum_sidecar"
    if "template" in lower and ext == ".txt": return "tracker_template"
    if re.search(r"(?i)\bno[ _-]+pqs?\b", leaf): return "lecture_reference"
    if re.search(r"(?i)(examsoft|esoft|e.?soft|quiz)", lower): return "esoft"
    if re.search(r"(?i)\bimcq\b|imcq[_ -]?\d", lower): return "imcq"
    if re.search(r"(?i)\b(?:pqs|pq|practice questions?)\b|(?:^|[/ _-])pq\d", lower): return "pq"
    if re.search(r"(?i)\b(?:answer key|solutions|correct answers?)\b|(?:^|[/ ])answers[/. ]", lower): return "answer_key"
    if re.search(r"(?i)\b(?:small groups?|workbooks?|sg\s*\d+)\b", lower): return "small_group"
    if re.search(r"(?i)\b(?:case|clinical vignette)s?\b", lower): return "case"
    if re.search(r"(?i)\b(?:schedule|course tracker|syllabus|academic calendar)\b", lower): return "curriculum_schedule"
    if re.search(r"(?i)\b(?:lecture|dla|course content|learning objectives?)\b", lower): return "lecture_reference"
    if re.search(r"(?i)\b(?:review|mock|practice|qbank|question)\b", lower): return "review_questions"
    if ext in {".txt", ".json", ".csv"}: return "structured_unknown"
    return "academic_document_unclassified"

def mapping(path, root_label, native=None):
    norm = path.replace("_", " ")
    course = None
    module = None
    module_evidence = None
    for label, pattern in MODULE_TESTS:
        if re.search(pattern, norm):
            module = label
            module_evidence = "directory_or_filename:" + label
            break
    if root_label == "baseline_templates":
        found = re.match(r"\d+_([A-Za-z0-9]+(?:_(?:Pre|Post)Midterm)?)_", pathlib.Path(path).name)
        if found:
            token = found.group(1)
            module = TEMPLATE_MAP.get(token, module)
            module_evidence = "explicit_template_filename:" + token
    term = None
    term_evidence = None
    m = re.search(r"(?i)(?:^|[/\\ ])term[ _-]*([1-5])(?=[/\\ _().-]|$)", path)
    if m: term, term_evidence = "T" + m.group(1), "explicit_term_folder"
    elif re.search(r"(?i)(?:^|[/\\ _-])t([1-5])(?=[/\\ _().-]|$)", path):
        m = re.search(r"(?i)(?:^|[/\\ _-])t([1-5])(?=[/\\ _().-]|$)", path)
        term, term_evidence = "T" + m.group(1), "explicit_term_path"
    elif root_label.startswith("ssd_term_"):
        term, term_evidence = "T" + root_label.rsplit("_", 1)[-1], "explicit_external_ssd_term_root"
    elif root_label == "t1_local": term, term_evidence = "T1", "local_01_BPM500_course_root"
    elif root_label == "t2_local": term, term_evidence = "T2", "local_01_BPM501_course_root"
    elif root_label == "downloads_term4": term, term_evidence = "T4", "explicit_root_Term_4"
    elif root_label == "downloads_ncrs_week4": term, term_evidence = "T4", "NCRS_T4_from_SSD_course_map"
    elif root_label == "downloads_goer_week2": term, term_evidence = "T5", "GOER_T5_from_native_package_manifest"
    elif root_label == "local_t1t2_exam" or root_label == "downloads_t1t2_exam":
        term_evidence = "ambiguous_T1_T2_root_no_assignment"
    elif module in COURSE_MAP and root_label == "baseline_templates":
        term, term_evidence = COURSE_MAP[module], "corroborated_module_term_crosswalk_requires_Agent4_review"
    if root_label == "t1_local": course = "BPM500"
    elif root_label == "t2_local": course = "BPM501"
    week = None
    week_evidence = None
    w = re.search(r"(?i)\bweek\s*0?([1-9]|1[0-9]|20)\b|\bwk\s*0?([1-9]|1[0-9]|20)\b", norm)
    if w: week, week_evidence = int(w.group(1) or w.group(2)), "explicit_path_week"
    elif root_label == "downloads_ncrs_week4": week, week_evidence = 4, "explicit_root_folder_NCRS_Week_4"
    elif root_label == "downloads_goer_week2": week, week_evidence = 2, "explicit_root_folder_GOER_Week_2"
    if not term and module in COURSE_MAP:
        term, term_evidence = COURSE_MAP[module], "inferred_module_term_crosswalk_requires_Agent4_review"
    # Do NOT convert IMCQ numbers or assessment numbers into weeks.
    if native:
        native_course = native.get("course", {})
        if isinstance(native_course, dict):
            if native_course.get("name"):
                module = str(native_course["name"])
                module_evidence = "package_manifest.course.name"
            native_term = native_course.get("term")
            if type(native_term) is int and 1 <= native_term <= 5:
                term, term_evidence = "T" + str(native_term), "package_manifest.course.term"
            # bool is an int in Python; zero/negative/boolean producer values
            # are not authoritative week evidence and must not erase path hints.
            native_week = native_course.get("week")
            if type(native_week) is int and native_week > 0:
                week = native_week
                source = native.get("source") or {}
                declared = source.get("sourceWeekDeclared") if isinstance(source, dict) else None
                week_evidence = "package_declared_week" if declared is True else "axom_assigned_week_not_official"
    return dict(academic_term=term, course=course, module=module, week=week,
                term_evidence=term_evidence, module_evidence=module_evidence, week_evidence=week_evidence)

def priority(typ, rel, root_label):
    if typ in {"tracker_template", "native_manifest", "native_questions", "native_mapping", "checksum_sidecar",
               "imcq", "esoft", "pq", "answer_key", "small_group", "review_questions", "curriculum_schedule"}:
        return 1
    if typ in {"case", "structured_unknown", "archive_review"}: return 2
    if typ == "image_asset": return 3
    if root_label.startswith("baseline_"): return 4
    if typ == "lecture_reference": return 5
    return 7

def answer_variant(path):
    n = pathlib.Path(path).stem.lower()
    if re.search(r"\b(without|no)\s*(?:the\s*)?answers?\b|questions?.?only|unanswered|clean.?copy", n):
        return "questions_only"
    if re.search(r"\b(with|including)\s*answers?\b|answered|answer.?reveal|marked.?copy", n):
        return "answered_version"
    if re.search(r"\banswers?\b|\bsolutions?\b|\bkey\b", n):
        return "answer_key_candidate"
    return None

def assessment_number(path, typ):
    name = pathlib.Path(path).stem
    m = re.search(r"(?i)\b(?:imcq|quiz|examsoft|e.?soft)[ _#:-]*0?(\d{1,2})\b", name)
    return int(m.group(1)) if m else None

def normalized_pair_key(path):
    n = pathlib.Path(path).stem.casefold()
    n = re.sub(r"(?i)\(?\b(?:with(?:out)?|no|including)\s*(?:the\s*)?answers?\b\)?|\b(?:answer.?key|solutions?|answered|unanswered|clean.?copy|questions?.?only)\b", "", n)
    n = re.sub(r"[^a-z0-9]+", "", n)
    return n

def inspect_txt_question_metadata(path, root):
    # Follow the original configured root, not an untrusted on-disk path alias.
    # A source changed into a symlink after inventory must remain unreadable.
    try:
        fd = open_native_package_file(root, path.parent, path.name)
        with os.fdopen(fd, "r", encoding="utf-8-sig", errors="replace") as stream:
            lines = stream.read().splitlines()
        numbers = [int(x) for line in lines[:20000] for x in re.findall(r"(?i)^\s*Question\s+(\d{1,4})\s*[:.\-]", line)]
        answers = sum(bool(re.match(r"(?i)^\s*(?:answer|correct answer)\s*:", line)) for line in lines)
        return dict(detected_question_headings=len(numbers), unique_question_numbers=len(set(numbers)),
                    answer_lines=answers, heading_numbers_contiguous=(sorted(numbers) == list(range(1,len(numbers)+1)) if numbers else None),
                    count_basis="labelled_text_headings_not_parser_output")
    except (OSError, ValueError) as error:
        return dict(scan_error=type(error).__name__)

def pdf_hint(row, pages=4):
    # pdftotext receives only bytes from an authorized, no-follow descriptor.
    # Never pass an untrusted source path to the external reader after inventory.
    try:
        fd = open_scanned_source_file(row)
        with os.fdopen(fd, "rb") as stream:
            r = subprocess.run(["pdftotext", "-f", "1", "-l", str(pages), "-layout", "-", "-"],
                               stdin=stream, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                               timeout=9, check=False)
        if r.returncode != 0: return dict(pdf_probe_status="unreadable_or_short_pdf")
        body = r.stdout.decode("utf-8", "replace")
        questions = re.findall(r"(?im)^\s*(?:Question|Q)\s*[#.: -]*\d{1,3}\s*[.:\-)]", body)
        return dict(pdf_probe_status="partial_text_probe", detected_question_headings_first_pages=len(questions),
                    sampled_pages=pages, count_basis="partial_pdf_pages_not_total")
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return dict(pdf_probe_status="probe_unavailable_or_timed_out")

def load_candidates(args):
    # The on-disk hash cache is an output snapshot, never a trusted source of hashes.
    # Metadata (even size + mtime_ns) cannot prove the bytes have not changed.
    cache = {}
    rows = []
    stats = []
    for label, root in ROOTS:
        if not root.is_dir():
            stats.append(dict(root_label=label, root_path=str(root), status="not_accessible", files_seen=0))
            continue
        seen=0; considered=0; skip=collections.Counter(); exts=collections.Counter(); size_total=0
        for base, dirs, files in os.walk(root, followlinks=False):
            dirs[:] = [] if label == "downloads_root_academic_files" else sorted(
                d for d in dirs if d not in IGNORE_DIRS
                and not (label in {"desktop_ncrs", "desktop_ftcm","desktop_rhps"}
                         and d in {"tmp","Anki","sc","work"})
                and not d.startswith("."))
            for name in sorted(files):
                seen += 1
                if name in IGNORE_NAMES or name.startswith("._"): skip["metadata_dotfile"] += 1; continue
                if label == "downloads_root_academic_files" and not TITLE_TOKENS.search(
                    re.sub(r"[_\\-]+", " ",name)):
                    skip["unrelated_top_level_file"] += 1
                    continue
                path = pathlib.Path(base) / name
                # os.walk(followlinks=False) still yields symlinked *files*.
                # Never read a file alias whose target may be outside this source root.
                if path.is_symlink():
                    skip["symlinked_file_not_followed"] += 1
                    continue
                ext = path.suffix.lower()
                if ext not in DOCUMENT_EXT | ASSET_EXT: skip["non_document_extension"] += 1; continue
                try:
                    st = path.stat()
                    if not path.is_file(): continue
                except OSError: skip["unreadable_metadata"] += 1; continue
                rel = str(path.relative_to(root))
                typ = classification(rel, label, path)
                if typ == "unlinked_image" and not label.startswith("baseline_"):
                    skip["unlinked_image_not_question_file"] += 1
                    continue
                if typ in {"excluded_hidden", "excluded_unsupported_extension", "archive_unrelated"}:
                    skip[typ] += 1; continue
                considered += 1;size_total += st.st_size;exts[ext] += 1
                r = dict(root_label=label, original_path=str(path), relative_path=rel,
                         original_filename=name, file_extension=ext, file_size=st.st_size,
                         source_format=ext.lstrip("."), document_type=typ, priority=priority(typ,rel,label),
                         answer_variant=answer_variant(name), assessment_number=assessment_number(name,typ),
                         source_sha256=None, duplicate_group=None, answer_key_partner=None,
                         lecture_references=[int(x) for x in re.findall(
                           r"(?i)(?<![a-z0-9])(?:lecture|lect|lec)[ _-]*0?(\d{1,3})(?![a-z0-9])",path.stem)],
                         topic_hint=path.stem, topic_hint_evidence="original_filename_not_semantic_validation",
                         sharing_rights="private_use_only_rights_not_asserted",
                         extraction_status="unexamined", review_status="not_reviewed",
                         backend_import_status="not_verified", prepared_package=None)
                r.update(mapping(rel, label))
                # Large source files are explicit pending exceptions, never silently skipped.
                bound = args.max_hash_mb * 1048576
                h_key = str(path)
                if r["priority"] <= 4 and st.st_size <= bound:
                    try:
                        current_sha = sha256_file(path)
                        after_hash = path.stat()
                        # A source changing during the read cannot receive an authoritative revision.
                        if (st.st_size, st.st_mtime_ns, st.st_ctime_ns) != (
                                after_hash.st_size, after_hash.st_mtime_ns, after_hash.st_ctime_ns):
                            r["unresolved_reason"] = "hash_source_changed_during_scan"
                        else:
                            r["source_sha256"] = current_sha
                    except OSError as error:
                        r["unresolved_reason"] = "hash_failed:" + type(error).__name__
                    if r["source_sha256"]:
                        cache[h_key] = dict(size=st.st_size, mtime_ns=st.st_mtime_ns, sha256=r["source_sha256"])
                else:
                    r["unresolved_reason"] = "oversized_source_needs_staged_review" if st.st_size > bound else "low_priority_reference_hash_deferred"
                r["source_id"] = digest_text(str(path) + "|" + (r["source_sha256"] or str(st.st_size) + ":" + str(st.st_mtime_ns)))[:24]
                r["source_revision"] = ("sha256:" + r["source_sha256"]) if r["source_sha256"] else None
                r["classification_confidence"] = "high" if typ == "tracker_template" else "medium" if r["priority"] <= 3 else "low"
                r["classification_evidence"] = "original_folder_and_filename_not_content_verified"
                rows.append(r)
        stats.append(dict(root_label=label, root_path=str(root), status="scanned",
                          files_seen=seen, catalogued=considered, skipped=dict(skip),
                          by_extension=dict(exts), catalogued_mb=round(size_total / 1048576, 2)))
        print("SCANNED", label, seen, "files;", considered, "documents/assets catalogued", flush=True)
    save_json("source-hash-cache.json", cache)
    return rows, stats

def process_duplicates(rows):
    groups = collections.defaultdict(list)
    for r in rows:
        if r["source_sha256"]: groups[r["source_sha256"]].append(r)
    for digest, group in groups.items():
        if len(group) > 1:
            for r in group: r["duplicate_group"] = "sha256:" + digest
    return {digest: [r["source_id"] for r in group] for digest, group in groups.items() if len(group) > 1}

def open_native_package_file(root, package_dir, relative_file):
    """Open a regular file through its configured source root without following package links.

    All post-root components are opened relative to held directory descriptors.
    Fail closed if secure no-follow, directory-relative opens are unavailable.
    This is a private inventory read, never a publication/rights approval.
    """
    if not (hasattr(os, "O_NOFOLLOW") and hasattr(os, "O_DIRECTORY")
            and os.open in os.supports_dir_fd):
        raise ValueError("secure_native_package_open_unavailable")
    if not isinstance(relative_file, str) or not relative_file or "\x00" in relative_file:
        raise ValueError("unsafe_native_package_path")
    file_path = pathlib.PurePosixPath(relative_file)
    windows_path = pathlib.PureWindowsPath(relative_file)
    if (file_path.is_absolute() or windows_path.drive or windows_path.is_absolute()
            or "\\" in relative_file or ".." in file_path.parts
            or not file_path.parts or file_path.name in {".", ".."}):
        raise ValueError("unsafe_native_package_path")
    try:
        package_parts = pathlib.Path(package_dir).relative_to(root).parts
    except ValueError as error:
        raise ValueError("native_package_outside_source_root") from error
    if ".." in package_parts:
        raise ValueError("native_package_outside_source_root")
    directory_flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    file_flags = os.O_RDONLY | os.O_NOFOLLOW | getattr(os, "O_NONBLOCK", 0)
    directory_fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY)
    try:
        for component in (*package_parts, *file_path.parts[:-1]):
            if component == ".":
                continue
            next_fd = os.open(component, directory_flags, dir_fd=directory_fd)
            os.close(directory_fd)
            directory_fd = next_fd
        fd = os.open(file_path.parts[-1], file_flags, dir_fd=directory_fd)
        try:
            if not stat.S_ISREG(os.fstat(fd).st_mode):
                raise ValueError("unsafe_native_package_file_type")
            return fd
        except BaseException:
            os.close(fd)
            raise
    finally:
        os.close(directory_fd)


def read_native_package_json(root, package_dir, relative_file, with_digest=False):
    """Parse the exact contained bytes that supply the inspection revision."""
    fd = open_native_package_file(root, package_dir, relative_file)
    with os.fdopen(fd, "rb") as stream:
        inspected_bytes = stream.read()
    data = json.loads(inspected_bytes.decode("utf-8"))
    if with_digest:
        return data, hashlib.sha256(inspected_bytes).hexdigest()
    return data


def verify_native_package_questions_sha(package):
    """Securely recheck the inspected revision, without following swapped links."""
    fd = open_native_package_file(package["source_root"], package["package"],
                                  package["questions_relative_path"])
    with os.fdopen(fd, "rb") as stream:
        before = os.fstat(stream.fileno())
        checksum = hashlib.sha256()
        while chunk := stream.read(1024 * 1024):
            checksum.update(chunk)
        after = os.fstat(stream.fileno())
        identity = lambda st: (st.st_dev, st.st_ino, st.st_size,
                               st.st_mtime_ns, st.st_ctime_ns)
        if identity(before) != identity(after):
            raise ValueError("questions_changed_during_secure_recheck")
    return checksum.hexdigest()


def native_package_file_exists(root, package_dir, relative_file):
    try:
        fd = open_native_package_file(root, package_dir, relative_file)
    except (ValueError, OSError):
        return False
    os.close(fd)
    return True


def source_root_for_row(row):
    """Choose the actual configured lexical source root, including duplicate-label SSD roots."""
    path = pathlib.Path(row["original_path"])
    matching = [root for label, root in ROOTS if label == row["root_label"]
                and path.is_relative_to(root)]
    if not matching:
        raise ValueError("source_outside_configured_root")
    return max(matching, key=lambda root: len(root.parts))


def open_scanned_source_file(row):
    """Reopen a post-inventory source without following file or directory symlinks."""
    path = pathlib.Path(row["original_path"])
    return open_native_package_file(source_root_for_row(row), path.parent, path.name)


def inspect_packages(rows):
    lookup = {r["original_path"]: r for r in rows}
    packages, fingerprints, notes = [], collections.defaultdict(list), []
    for r in rows:
        if r["document_type"] != "native_manifest": continue
        path = pathlib.Path(r["original_path"])
        issues = []
        try:
            # A label may cover several configured SSD roots. Select the actual
            # lexical ancestor of this manifest, not merely the first matching label.
            matching_roots = [directory for label, directory in ROOTS
                              if label == r["root_label"] and path.is_relative_to(directory)]
            if not matching_roots:
                raise ValueError("unknown_native_package_source_root")
            root = max(matching_roots, key=lambda directory: len(directory.parts))
            data = read_native_package_json(root, path.parent, path.name)
            if not isinstance(data, dict) or data.get("schemaVersion") != 1:
                raise ValueError("unsupported_native_manifest_schema")
            questions_file = data.get("questionsFile") or "questions.json"
            qdata, inspected_questions_sha256 = read_native_package_json(
                root, path.parent, questions_file, with_digest=True)
            qpath = path.parent / questions_file
            if not isinstance(qdata, dict):
                raise ValueError("invalid_native_questions_json")
            questions = qdata.get("questions", [])
            if not isinstance(questions, list) or not questions: raise ValueError("missing_or_empty_questions_array")
            bank = data.get("bank") or {}
            if not isinstance(bank, dict):
                raise ValueError("invalid_native_bank_metadata")
            if qdata.get("bankId") != bank.get("id"): issues.append("bank_id_mismatch")
            src = data.get("source") or {}
            if not isinstance(src, dict):
                raise ValueError("invalid_native_source_metadata")
            src_name = pathlib.Path(str(src.get("filename") or "")).name
            src_path = path.parent / "source" / src_name
            src_exists = native_package_file_exists(root, path.parent, "source/" + src_name)
            if not src_exists:
                src_path = path.parent / src_name
                src_exists = native_package_file_exists(root, path.parent, src_name)
            declared_src_sha = set()
            all_assets = set()
            asset_expected_checksums = {}
            unanswered_question_ids = []
            source_page_count = 0
            answer_count, any_provenance = 0, 0
            for ix, q in enumerate(questions):
                if not isinstance(q, dict):
                    issues.append("non_object_question:" + str(ix));continue
                if not q.get("stem") or not q.get("choices"): issues.append("missing_stem_or_choices:" + str(ix))
                if q.get("correctAnswer"): answer_count += 1
                else: unanswered_question_ids.append(str(q.get("id") or ix))
                source_ref = q.get("source") or {}
                if isinstance(source_ref, dict) and isinstance(source_ref.get("page"), int) and source_ref["page"] >= 1:
                    source_page_count += 1
                proven = q.get("provenance") or {}
                if isinstance(proven, dict):
                    if proven: any_provenance += 1
                    if proven.get("sourceChecksum"): declared_src_sha.add(str(proven["sourceChecksum"]).removeprefix("sha256:"))
                for asset in q.get("assets", []):
                    if isinstance(asset, dict):
                        asset_name = asset.get("filename")
                        if isinstance(asset_name, str):
                            all_assets.add(asset_name)
                            stated = asset.get("checksum")
                            if isinstance(stated, str):
                                bare = stated.removeprefix("sha256:")
                                if asset_name in asset_expected_checksums and asset_expected_checksums[asset_name] != bare:
                                    issues.append("inconsistent_asset_reference_checksum:" + asset_name)
                                asset_expected_checksums[asset_name] = bare
            if len(declared_src_sha) > 1: issues.append("conflicting_source_checksums")
            source_record = lookup.get(str(src_path)) if src_exists else None
            if src_exists and not source_record: issues.append("original_not_in_source_manifest")
            if src_exists and source_record and source_record.get("source_sha256") and declared_src_sha:
                if source_record["source_sha256"] not in declared_src_sha: issues.append("source_checksum_mismatch")
            if not src_exists and not declared_src_sha: issues.append("missing_source_and_source_checksum")
            missing_assets = []
            asset_directory = data.get("assetsDirectory") or "assets"
            for a in sorted(all_assets):
                if (not isinstance(asset_directory, str) or not isinstance(a, str)
                        or not native_package_file_exists(root, path.parent, asset_directory + "/" + a)):
                    missing_assets.append(a)
                    continue
                p = path.parent / asset_directory / a
                if a in asset_expected_checksums:
                    file_record = lookup.get(str(p))
                    actual = file_record.get("source_sha256") if file_record else None
                    if not actual: issues.append("asset_hash_not_verified:" + a)
                    elif actual != asset_expected_checksums[a]: issues.append("asset_checksum_mismatch:" + a)
            if missing_assets: issues.append("missing_or_unsafe_assets:" + str(len(missing_assets)))
            qrecord = lookup.get(str(qpath))
            # A post-scan substitution must not inherit the original source ID.
            if (qrecord and qrecord.get("source_sha256")
                    and qrecord["source_sha256"] != inspected_questions_sha256):
                issues.append("questions_differ_from_inventory_sha")
            native = mapping(str(path), r["root_label"], native=data)
            r.update(native)
            r["extraction_status"] = "native_package_structurally_checked"
            r["prepared_package"] = str(path.parent)
            r["review_status"] = "package_exceptions" if issues else "package_structural_checks_passed_answer_review_separate"
            if qrecord:
                qrecord.update(native)
                qrecord["prepared_package"] = str(path.parent)
                qrecord["extraction_status"] = "native_questions_array_parsed"
                qrecord["detected_questions"] = len(questions)
                qrecord["review_status"] = r["review_status"]
            for ix, q in enumerate(questions):
                if not isinstance(q, dict): continue
                blocks = q.get("stem") or []
                if isinstance(blocks, list):
                    stem = " ".join(str(b.get("text") or b.get("html") or "") for b in blocks if isinstance(b, dict))
                else: stem = str(blocks)
                normalized = re.sub(r"\s+", " ", unicodedata.normalize("NFKC", stem).casefold()).strip()
                if len(normalized) >= 30:
                    fingerprints[digest_text(normalized)].append(dict(package_manifest=str(path), bank_id=bank.get("id"),
                                                                       question_id=q.get("id"), source_checksum=sorted(declared_src_sha)))
            packages.append(dict(package=str(path.parent), manifest=str(path), questions_file=str(qpath),
                                 source_root=str(root), questions_relative_path=questions_file,
                                 inspected_questions_sha256=inspected_questions_sha256,
                                 bank_id=bank.get("id"), bank_title=bank.get("title"), source_filename=src_name,
                                 source_path=str(src_path) if src_exists else None,
                                 questions=len(questions), questions_with_answer_fields=answer_count,
                                 questions_with_provenance=any_provenance,
                                 questions_with_source_pages=source_page_count,
                                 unanswered_question_ids=unanswered_question_ids,
                                 referenced_assets=len(all_assets), missing_assets=missing_assets,
                                 course=data.get("course"), classification=native,
                                 issues=issues, status="local_ready_for_agent2_review" if not issues else "requires_package_review",
                                 backend_verified=False))
        except (OSError, ValueError, TypeError, UnicodeError) as error:
            r["review_status"] = "package_invalid"
            r["unresolved_reason"] = str(error)
            notes.append(dict(manifest=str(path), error=str(error)))
    collisions = [dict(stem_sha256=h, source_associations=locs)
                  for h, locs in fingerprints.items() if len(locs) > 1]
    return packages, collisions, notes

def answer_pair_candidates(rows):
    # A pairing is evidence to review, NOT an answer attribution.
    keyed = collections.defaultdict(list)
    for r in rows:
        if r["answer_variant"] and r["source_sha256"]:
            p = pathlib.Path(r["original_path"])
            keyed[(str(p.parent).casefold(), normalized_pair_key(r["original_filename"]),
                   r.get("assessment_number"))].append(r)
    pairs = []
    for key, group in keyed.items():
        originals = [r for r in group if r["answer_variant"] == "questions_only"]
        keys = [r for r in group if r["answer_variant"] != "questions_only"]
        for original in originals:
            for answer in keys:
                if answer["source_id"] == original["source_id"]: continue
                if original["source_sha256"] == answer["source_sha256"]: continue
                original["answer_key_partner"] = answer["source_id"]
                answer["answer_key_partner"] = original["source_id"]
                pairs.append(dict(questions_only_id=original["source_id"], answered_id=answer["source_id"],
                                  original_file=original["original_path"], answered_file=answer["original_path"],
                                  evidence=["same_folder", "same_normalized_assessment_name", "distinct_file_checksums"],
                                  status="candidate_unverified_question_stem_correspondence"))
    return pairs

def inspect_text_files(rows):
    for r in rows:
        if r["file_extension"] != ".txt" or r["document_type"] == "tracker_template": continue
        if r["priority"] > 3: continue
        try:
            meta = inspect_txt_question_metadata(pathlib.Path(r["original_path"]), source_root_for_row(r))
        except (OSError, ValueError) as error:
            meta = dict(scan_error=type(error).__name__)
        r.update(meta)
        if "scan_error" in meta:
            r["review_status"] = "source_read_unavailable"
            r["unresolved_reason"] = "unsafe_or_unreadable_text_source:" + meta["scan_error"]
            continue
        if meta.get("detected_question_headings", 0):
            if r["document_type"] == "structured_unknown":
                r["document_type"] = "review_questions"
                r["classification_evidence"] = "source_content:labelled_question_headings"
                r["classification_confidence"] = "high"
                r["priority"] = 1
            r["extraction_status"] = "question_headings_detected_requires_parser"
            if (meta["detected_question_headings"] == meta["answer_lines"] and
                    meta.get("heading_numbers_contiguous")):
                r["review_status"] = "tagged_source_answers_present_not_source_verified"
            else:
                r["review_status"] = "question_count_or_answer_structure_needs_review"

def inspect_pdf_sample(rows, max_count):
    selected = sorted((r for r in rows if r["file_extension"] == ".pdf" and r["priority"] == 1
                      and r["file_size"] <= 20 * 1048576), key=lambda x: (x["root_label"].startswith("ssd_"), x["file_size"]))
    checked = set()
    n = 0
    for r in selected:
        if n >= max_count: break
        sh = r["source_sha256"]
        if sh and sh in checked: continue
        if sh: checked.add(sh)
        r.update(pdf_hint(r))
        n += 1
    return n

def parse_templates(rows):
    acts = []
    templates = [r for r in rows if r["document_type"] == "tracker_template" and r["root_label"] == "baseline_templates"]
    for r in templates:
        try:
            fd = open_scanned_source_file(r)
            # Extract from the exact descriptor whose bytes match the original
            # scanner SHA. A safe path alone does not prove a stable revision.
            with os.fdopen(fd, "rb") as stream:
                original_bytes = stream.read()
            expected_sha = r.get("source_sha256")
            if type(expected_sha) is not str or re.fullmatch(r"[0-9a-f]{64}", expected_sha) is None:
                r["extraction_status"] = "template_source_integrity_held"
                r["review_status"] = "source_integrity_review_required"
                r["unresolved_reason"] = "template_original_revision_missing_or_invalid"
                continue
            if hashlib.sha256(original_bytes).hexdigest() != expected_sha:
                r["extraction_status"] = "template_source_integrity_held"
                r["review_status"] = "source_integrity_review_required"
                r["unresolved_reason"] = "template_source_revision_mismatch"
                continue
            lines = original_bytes.decode("utf-8-sig").splitlines()
        except (OSError, ValueError, UnicodeError) as error:
            r["extraction_status"] = "template_source_read_unavailable"
            r["review_status"] = "source_read_unavailable"
            r["unresolved_reason"] = "unsafe_or_unreadable_template:" + type(error).__name__
            continue
        for lineno, text in enumerate(lines, start=1):
            text = text.strip()
            if not text or text.endswith(":"): continue
            marker = re.search(r"\[([^]]+)\]\s*$", text)
            if not marker:
                continue
            label = marker.group(1).lower()
            if "lecture" in label: activity = "flipped_lecture" if "flip" in label else "lecture"
            elif "dla" in label: activity = "dla"
            elif "small" in label or label in {"sg", "s.g."}: activity = "small_group"
            elif "imcq" in label: activity = "imcq"
            elif "esoft" in label or "examsoft" in label: activity = "esoft"
            else: activity = "other:" + label
            title = text[:marker.start()].strip()
            week = None
            wk = re.search(r"(?i)\bweek\s*(\d{1,2})\b|\bwk\s*(\d{1,2})\b", title)
            if wk: week = int(wk.group(1) or wk.group(2))
            id_seed = (str(r["module"]) + "|" + activity + "|" + title.casefold())
            acts.append(dict(activity_id="activity:" + digest_text(id_seed)[:24], source_id=r["source_id"],
                             source_path=r["original_path"], source_line=lineno, academic_term=r["academic_term"],
                             module=r["module"], course=r.get("course"), week=week,
                             week_basis="explicit_line" if week else "not_established_by_template",
                             activity_type=activity, title=title, classification_evidence=r["module_evidence"],
                             installed_status="not_verified", source_association_status="unmatched"))
        r["extraction_status"] = "tracker_template_activities_parsed"
    # A repeated title within one module needs explicit distinction, never a silently duplicated ID.
    seen = collections.Counter()
    for a in acts:
        seen[a["activity_id"]] += 1
        if seen[a["activity_id"]] > 1:
            a["activity_id"] += "-repeat-" + str(seen[a["activity_id"]])
            a["id_collision_review"] = True
    return acts

def coverage_matrix(acts, rows):
    groups = collections.defaultdict(list)
    for a in acts:
        groups[(a["academic_term"], a["module"], a["week"], a["activity_type"])].append(a)
    available = collections.defaultdict(list)
    for r in rows:
        if r["document_type"] in {"imcq", "esoft", "pq", "small_group", "case", "review_questions"}:
            available[(r["academic_term"], r["module"] or "(unresolved module)", r["week"])].append(r)
    out = []
    for (term, module, week, typ), expected in sorted(groups.items(), key=lambda kv: str(kv[0])):
        candidates = []
        for (t,m,w), source in available.items():
            if m != module or (t and term and t != term): continue
            for r in source:
                if week is not None and w is not None and w != week: continue
                if typ in {"imcq", "esoft", "small_group"} and typ != r["document_type"]: continue
                candidates.append(r)
        hashes = {r["source_sha256"] or r["source_id"] for r in candidates}
        out.append(dict(academic_term=term, module=module, week=week, week_basis="explicit_template" if week else "unknown",
                        expected_activity_type=typ, expected_tracker_activities=len(expected),
                        candidate_source_files=len(candidates), byte_distinct_candidates=len(hashes),
                        available_source_ids=";".join(r["source_id"] for r in candidates[:12]),
                        source_match_status="module_and_type_candidate_not_line_item_verified" if candidates else "source_not_found",
                        installed_status="not_verified"))
    # Explicit source-available rows are not evidence that a required activity was scheduled.
    # Preserve T4/T5 and missing T1/T2/T3 modules without inventing "expected" activities.
    established = {(x["academic_term"],x["module"],x["week"],x["expected_activity_type"]) for x in out}
    for (term,module,week), sources in sorted(available.items(), key=lambda kv: str(kv[0])):
        by_type = collections.defaultdict(list)
        for source in sources: by_type[source["document_type"]].append(source)
        for typ, typed_sources in by_type.items():
            key = (term,module,week,typ)
            if key in established: continue
            out.append(dict(academic_term=term,module=module,week=week,
                week_basis="source_filename_or_folder_not_verified_schedule" if week else "unknown",
                expected_activity_type=typ, expected_tracker_activities=None,
                candidate_source_files=len(typed_sources),
                byte_distinct_candidates=len({x.get("source_sha256") or x["source_id"] for x in typed_sources}),
                available_source_ids=";".join(x["source_id"] for x in typed_sources[:12]),
                source_match_status="observed_source_no_authoritative_expected_activity_template",
                installed_status="not_verified"))
    return out

def prepare_queue(rows, packages):
    q = []
    used_packages = set()
    for p in packages:
        used_packages.add(p["questions_file"])
        used_packages.add(p["manifest"])
        q.append(dict(priority=1 if not p["issues"] else 2, input_mode="native_package_folder",
                      source_path=p["package"], source_ids=[], bank_id=p["bank_id"],
                      expected_questions=p["questions"], exact_count_basis="native_questions_json_array",
                      status=p["status"], unresolved=p["issues"],
                      instructions="Use existing nativeInput/packageJson/assessBank review; do not bypass answer validation."))
    for r in rows:
        if r["original_path"] in used_packages or r["document_type"] in {"image_asset", "native_mapping", "native_manifest", "native_questions", "tracker_template"}:
            continue
        if r["document_type"] in {"imcq", "esoft", "pq", "answer_key", "small_group", "case", "review_questions", "archive_review"}:
            if r["file_extension"] == ".zip":
                mode, priority_code = "zip_original_inventory_requires_parser", 5
            elif r["file_extension"] == ".txt" and r.get("detected_question_headings"):
                mode, priority_code = "tagged_raw_text", 2
            elif r["file_extension"] == ".pdf":
                mode, priority_code = "pdf_original_extract_with_review", 3
            elif r["file_extension"] in {".pptx", ".ppsx", ".docx"}:
                mode, priority_code = "office_original_extract_with_review", 4
            else:
                mode, priority_code = "manual_triage_unsupported_or_unspecified", 6
            q.append(dict(priority=priority_code, input_mode=mode, source_path=r["original_path"],
                          source_ids=[r["source_id"]], term=r["academic_term"], module=r["module"],
                          week=r["week"], document_type=r["document_type"], answered_variant=r["answer_variant"],
                          answer_key_candidate_id=r["answer_key_partner"], expected_questions=r.get("detected_question_headings"),
                          status=r.get("review_status"), unresolved=r.get("unresolved_reason"),
                          instructions="Preserve original source numbering, image assets, answers only if evidenced; review before persistence."))
    q.sort(key=lambda x: (x["priority"], str(x.get("module") or ""), x["source_path"]))
    return q

def report(args):
    OUT.mkdir(parents=True, exist_ok=True)
    records, roots = load_candidates(args)
    baseline_continuity = baseline_source_continuity(OUT / "manifest.json",records)
    dupgroups = process_duplicates(records)
    inspect_text_files(records)
    raw_stems = raw_text_stem_fingerprints(records, open_scanned_source_file)
    pairs = answer_pair_candidates(records)
    pdfprobed = inspect_pdf_sample(records, args.probe_pdfs)
    packages, collisions, package_errors = inspect_packages(records)
    acts = parse_templates(records)
    archives = index_source_archives(records, open_scanned_source_file)
    coverage = coverage_matrix(acts, records)
    # Canonical review holds must reach the import queue, not be added afterward.
    canonical = canonical_packages(packages, verify_native_package_questions_sha)
    queue = prepare_queue(records, packages)
    distinct_queue = canonicalize_queue(records, packages, queue)
    enrich_source_records(records)
    unique_pairs = enrich_pairs(records, pairs, open_scanned_source_file)
    unique_pairs.extend(add_workbook_answer_candidates(records, unique_pairs, open_scanned_source_file))
    prioritized_batches = ordered_import_batches(distinct_queue, unique_pairs, records)
    enriched = evidence_counts(records, canonical, unique_pairs, distinct_queue)
    dispositions = build_lead_dispositions(records, canonical)
    role2_assessment = merge_agent2_assessment(dispositions, canonical, records,
        OUT / "role-2-import-audit.json")
    canon_manifest_paths = {p["manifest"] for p in canonical}
    cross_bank_repeats = [dict(stem_sha256=c["stem_sha256"], source_associations=[x for x in c["source_associations"]
        if x["package_manifest"] in canon_manifest_paths]) for c in collisions]
    cross_bank_repeats = [c for c in cross_bank_repeats if len(c["source_associations"]) > 1]
    counts = collections.Counter(r["document_type"] for r in records)
    unique = {r["source_sha256"] for r in records if r["source_sha256"]}
    unresolved = [r for r in records if not r["source_sha256"] and r["priority"] <= 4]
    issues = [r for r in records if r["unresolved_reason"]] if False else [r for r in records if r.get("unresolved_reason")]
    native_q = sum(p["questions"] for p in packages)
    txt_q = sum(r.get("detected_question_headings", 0) for r in records if r["file_extension"] == ".txt")
    # Native package counts and raw text heading counts are NOT validated unique questions.
    local_package_ready = [p for p in packages if not p["issues"]]
    summary = dict(generated_at=datetime.now(timezone.utc).isoformat(), root_count=len(ROOTS),
        baseline_source_continuity=dict(previous_distinct_hashes=baseline_continuity.get("previous_distinct_hashes"),
            retained_sha256=baseline_continuity.get("previous_distinct_hashes_preserved"),
            currently_unavailable_sha256=baseline_continuity.get("previous_distinct_hashes_currently_unavailable")),
        accessible_roots=sum(r["status"] == "scanned" for r in roots),
        file_denominators=dict(all_directory_entries_seen=sum(r.get("files_seen",0) for r in roots),
            catalogued_document_and_asset_paths=len(records), sha256_hashed_paths=sum(bool(r["source_sha256"]) for r in records),
            distinct_byte_sha256=len(unique), excess_byte_duplicate_paths=sum(len(g)-1 for g in
                collections.defaultdict(list, ((digest, ids) for digest, ids in dupgroups.items())).values()),
            duplicate_sha_groups=len(dupgroups), eligible_priority_files_with_unresolved_sha=len(unresolved)),
        question_collection_denominators=dict(native_manifests=len(packages) + len(package_errors),
            native_packages_structurally_ready=len(local_package_ready), native_packages_needing_review=len(packages)-len(local_package_ready)+len(package_errors),
            prepared_raw_text_banks=sum(1 for r in records if r["file_extension"] == ".txt" and r.get("detected_question_headings")),
            proposed_import_jobs=len(queue), pdf_partial_probes=pdfprobed),
        individual_question_denominators=dict(native_question_records_present=native_q,
            native_answer_fields_present=sum(p["questions_with_answer_fields"] for p in packages),
            tagged_text_question_headings=txt_q, individual_questions_backend_verified=0,
            backend_count_note="Not queried. Zero here is verified receipts, NOT zero existing backend questions."),
        tracker_denominators=dict(template_files=len({a["source_path"] for a in acts}),
            parsed_activity_rows=len(acts), installed_verified=0,
            installed_note="No tracker install receipts; actual installed state unknown."),
        source_types=dict(counts), native_package_issues=package_errors,
        scanned_roots=roots, coverage_row_count=len(coverage), potential_answer_pairs=len(pairs),
        same_stem_sha_groups=len(collisions),
        archive_metadata=dict(archives_indexed=len(archives),
            candidate_document_members=sum(len(a["entries"]) for a in archives),
            question_filename_hint_members=sum(a["question_candidate_count"] for a in archives),
            note="ZIP CRC32 and filenames are metadata, NOT SHA-256 content identities or extracted questions."),
        canonical_metrics=enriched,
        cross_distinct_native_bank_stem_repeats=len(cross_bank_repeats),
        raw_txt_stem_hash_stats=dict(distinct_candidate_stem_hashes=raw_stems["distinct_stem_hint_count"],
            repeated_candidate_stem_hashes=len(raw_stems["repeated_stem_hashes"]),
            note="Hash hints only; do not treat as verified individual question identities."),
        agent2_assessed=dict(status=role2_assessment["status"],
            sources=role2_assessment.get("assessed_source_count",0),
            questions_detected=role2_assessment.get("assessed_questions_detected",0),
            ready_not_installed=role2_assessment.get("assessed_ready_not_installed",0),
            review_required=role2_assessment.get("assessed_review_required",0),
            rejected_audit_rows=role2_assessment.get("rejected_audit_rows",[])),
        uncertainty="A source count is not a bank count. PDF question totals not determined; scanned PDF snippets are not validated questions. Native package checks are local structural checks only.")
    jsonl("master-source-manifest.jsonl", records)
    jsonl("tracker-activities.jsonl", acts)
    save_json("roots-expanded.json", roots)
    save_json("baseline-source-continuity.json", baseline_continuity)
    save_json("source-summary.json", summary)
    save_json("dispositions.json", dispositions)
    save_json("agent-2-assessed-source-ledger.json", role2_assessment)
    save_json("exact-duplicates.json", dupgroups)
    save_json("archive-member-index.json", archives)
    save_json("native-package-readiness.json", packages)
    save_json("native-package-canonical.json", canonical)
    save_json("agent-2-import-inputs.json", queue)
    save_json("agent-2-import-inputs-deduplicated.json", distinct_queue)
    save_json("agent-2-priority-batches.json", prioritized_batches)
    save_json("agent-2-answer-pair-review-tasks.json", unique_pairs)
    save_json("answer-key-pair-candidates.json", pairs)
    save_json("raw-text-stem-reuse-hints.json", raw_stems)
    save_json("question-stem-repeat-candidates.json", collisions)
    save_json("cross-distinct-bank-question-stems.json", cross_bank_repeats)
    save_json("agent-3-reconciliation.json", dict(native_package_records=canonical,
              agent2_assessed_source_ledger="agent-2-assessed-source-ledger.json",
              expected_native_question_records=enriched["canonical_native_question_records"],
              physical_mirror_inclusive_native_records=native_q,
              expected_tagged_text_question_headings=txt_q,
              source_checksums=[dict(source_id=r["source_id"], sha256=r["source_sha256"], path=r["original_path"])
                                for r in records if r["source_sha256"] and r["priority"] <= 2],
              receipt_status="not_verified", remote_write_permitted=False))
    save_json("agent-4-curriculum-evidence.json", dict(
        activity_rows="tracker-activities.jsonl", matrix_rows="coverage-matrix.csv",
        module_term_crosswalk=COURSE_MAP,
        term_map_basis="crosswalk corroborated by named SSD term folders; Agent 4 must establish official schedule",
        explicit_week_rows=sum(a["week"] is not None for a in acts),
        unknown_week_rows=sum(a["week"] is None for a in acts),
        caution="Never promote inferred 3-week grouping into official schedule or use IMCQ # as week"))
    save_json("agent-0-completeness-ledger.json", dict(
        file_denominators=summary["file_denominators"],
        collection_denominators=summary["question_collection_denominators"],
        question_denominators=summary["individual_question_denominators"],
        canonical_count_denominators=enriched,
        activity_denominators=summary["tracker_denominators"],
        explicit_exceptions=[dict(source_id=r["source_id"], path=r["original_path"], reason=r.get("unresolved_reason"))
                            for r in issues], package_errors=package_errors,
        cloud_verification="NOT PERFORMED", school_content_rights="private_not_shareable_without_authorization"))
    write_csv("coverage-matrix.csv", coverage, ["academic_term", "module", "week", "week_basis", "expected_activity_type",
              "expected_tracker_activities", "candidate_source_files", "byte_distinct_candidates",
              "available_source_ids", "source_match_status", "installed_status"])
    write_csv("source-disposition.csv", records, ["source_id", "source_sha256", "root_label", "relative_path",
              "file_extension", "file_size", "document_type", "academic_term", "module", "week",
              "answer_variant", "assessment_number", "answer_key_partner", "duplicate_group",
              "extraction_status", "review_status", "disposition", "prepared_package", "backend_import_status", "unresolved_reason"])
    print(json.dumps({k:v for k,v in summary.items() if k not in {"scanned_roots","source_types","native_package_issues"}}, indent=2))
    if len(acts) != 547:
        print("NOTE: tracker activity count differs from prior baseline 547; investigate activity_parser_lines", file=sys.stderr)
    return summary

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--probe-pdfs", type=int, default=40)
    parser.add_argument("--max-hash-mb", type=int, default=64)
    args = parser.parse_args()
    report(args)

if __name__ == "__main__":
    main()
