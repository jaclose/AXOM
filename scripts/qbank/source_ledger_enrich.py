"""Evidence-preserving enrichment for AXOM's private Agent 1 source ledger."""
import collections
import hashlib
import pathlib
import re
import subprocess
from difflib import SequenceMatcher

QUESTION_TYPES = {"imcq", "esoft", "pq", "answer_key", "small_group", "case", "review_questions"}

def _sha(txt):
    return hashlib.sha256(txt.encode("utf-8")).hexdigest()

def _pdf_first_question(path):
    try:
        result = subprocess.run(
            ["pdftotext", "-f", "1", "-l", "3", "-layout", path, "-"],
            capture_output=True, timeout=10, check=False
        )
        if result.returncode: return None
        txt = result.stdout.decode("utf8", "replace")
        # Drop answer explanations and page furniture; this is a CORRESPONDENCE HINT only.
        m = re.search(r"(?im)^\s*(?:question|q)\s*#?\s*1\s*[:.)-]?\s*", txt)
        fragment = txt[m.end():m.end()+600] if m else txt[:1200]
        fragment = re.sub(r"(?im)^\s*(?:answer|correct|explanation)\s*:.*$", "", fragment)
        fragment = re.sub(r"\s+", " ", fragment.casefold()).strip()
        return fragment if len(fragment) > 70 else None
    except (OSError, subprocess.TimeoutExpired): return None

def enrich_source_records(rows):
    for r in rows:
        typ = r["document_type"]
        if typ == "tracker_template":
            disposition = "template_activity_rows_generated"
        elif typ == "native_manifest":
            disposition = "native_package_locally_prepared" if r["review_status"].startswith("package_structural_checks_passed") else "native_package_review_required"
        elif typ == "native_questions":
            disposition = "native_package_component_not_a_separate_bank"
        elif typ in {"image_asset","native_mapping","checksum_sidecar"}:
            disposition = "linked_supporting_asset_not_independent_question_source"
        elif typ == "metadata_manifest":
            disposition = "non_AXOM_manifest_not_question_source"
        elif typ in QUESTION_TYPES:
            disposition = "queued_for_import_extraction_and_review"
        elif typ in {"curriculum_schedule", "structured_unknown"}:
            disposition = "curriculum_or_unclassified_source_triage"
        elif typ in {"lecture_reference","academic_document_unclassified"}:
            disposition = "academic_reference_not_proven_question_source"
        else:
            disposition = "source_triage_exception"
        if not r.get("source_sha256") and r["priority"] <= 4:
            disposition = "hash_and_source_triage_pending"
        r["disposition"] = disposition
        if typ in QUESTION_TYPES and r["extraction_status"] == "unexamined":
            r["extraction_status"] = "queued_not_yet_extracted"
        if typ in {"lecture_reference","academic_document_unclassified"} and r["extraction_status"] == "unexamined":
            r["extraction_status"] = "reference_only_no_question_count"
        if not r.get("unresolved_reason") and disposition.endswith("pending"):
            r["unresolved_reason"] = "inspection_pending"

def canonical_packages(packages):
    fingerprint_to_primary = {}
    canonical = []
    for p in packages:
        keyfile = pathlib.Path(p["questions_file"])
        # Same bank ID alone is not sufficient to collapse distinct revisions.
        h = hashlib.sha256(keyfile.read_bytes()).hexdigest()
        k = (p["bank_id"], h)
        p["questions_sha256"] = h
        p["canonical_package_key"] = _sha("|".join(k))[:24]
        if k in fingerprint_to_primary:
            primary = fingerprint_to_primary[k]
            p["canonical_status"] = "byte_identical_questions_package_copy"
            p["canonical_package"] = primary["package"]
            primary["mirrored_paths"].append(p["package"])
        else:
            p["canonical_status"] = "canonical_distinct_question_collection"
            p["canonical_package"] = p["package"]
            p["mirrored_paths"] = []
            fingerprint_to_primary[k] = p
            canonical.append(p)
    return canonical

def canonicalize_queue(rows, packages, jobs):
    row_lookup = {r["source_id"]:r for r in rows}
    canonical_jobs = {}
    # Keep all original source paths and source-ID associations, but extract identical bytes once.
    package_by_dir = {p["package"]:p for p in packages}
    for job in jobs:
        path = job["source_path"]
        if job["input_mode"] == "native_package_folder":
            p = package_by_dir.get(path)
            key = "pkg:" + p["canonical_package_key"] if p else "pkgpath:" + path
        else:
            ids = job.get("source_ids") or []
            row = row_lookup.get(ids[0]) if ids else None
            key = "byte:" + row["source_sha256"] if row and row.get("source_sha256") else "path:" + path
        if key in canonical_jobs:
            primary = canonical_jobs[key]
            primary["equivalent_paths"].append(path)
            primary["source_ids"] = sorted(set(primary["source_ids"]) | set(job.get("source_ids") or []))
            # Never promote a 'review required' source into ready because a mirror was ready.
            if job.get("unresolved"): primary["mirror_review_issues"].append(job["unresolved"])
        else:
            cloned = dict(job)
            cloned["source_ids"] = list(job.get("source_ids") or [])
            cloned["equivalent_paths"] = []
            cloned["mirror_review_issues"] = []
            cloned["canonical_input_key"] = key
            canonical_jobs[key] = cloned
    return sorted(canonical_jobs.values(), key=lambda x: (x["priority"], bool(x.get("unresolved")),
                                                         str(x.get("module") or ""), x["source_path"]))

def enrich_pairs(rows, pairs):
    records = {r["source_id"]:r for r in rows}
    distinct = {}
    for p in pairs:
        a = records.get(p["questions_only_id"])
        b = records.get(p["answered_id"])
        if not a or not b: continue
        k = (a["source_sha256"],b["source_sha256"])
        if k in distinct:
            p["canonical_pair_status"] = "mirrored_same_byte_pair"
            p["canonical_pair"] = distinct[k]["original_file"]
            continue
        p["canonical_pair_status"] = "unique_candidate_pair"
        distinct[k] = p
        left,right = _pdf_first_question(p["original_file"]),_pdf_first_question(p["answered_file"])
        if left and right:
            ratio = round(SequenceMatcher(None,left,right).ratio(),3)
            p["first_question_text_similarity"] = ratio
            p["text_evidence"] = "first_question_correspondence_supported" if ratio >= .83 else "partial_or_conflicting_first_question_text"
        else:
            p["text_evidence"] = "text_insufficient_unverified"
        # It is still not safe to copy any answers without comparing the numbered items throughout.
        p["answer_attribution_permitted"] = False
    return list(distinct.values())

def add_workbook_answer_candidates(rows, existing):
    # A generic Answers.pdf does not identify a question by its position.
    # Pair only if one workbook and one answer document share a uniquely identified folder.
    already = {(p["questions_only_id"],p["answered_id"]) for p in existing}
    folders = collections.defaultdict(list)
    for r in rows:
        if r["document_type"] in QUESTION_TYPES:
            folders[str(pathlib.Path(r["original_path"]).parent)].append(r)
    proposals = []
    for folder, group in folders.items():
        workbooks = [r for r in group if re.search(r"(?i)\bworkbook\b",r["original_filename"])]
        keys = [r for r in group if re.search(r"(?i)^answers?\.",r["original_filename"])]
        if len(workbooks) == len(keys) == 1:
            a,b = workbooks[0],keys[0]
            if (a["source_id"],b["source_id"]) in already:continue
            proposals.append(dict(questions_only_id=a["source_id"],answered_id=b["source_id"],
                original_file=a["original_path"],answered_file=b["original_path"],
                evidence=["same_unique_small_group_folder","sole_workbook_and_sole_answers_file"],
                text_evidence="unverified_item_correspondence",answer_attribution_permitted=False,
                canonical_pair_status="unique_group_local_candidate"))
    return proposals

def evidence_counts(rows, canonical, pairs, canonical_jobs):
    original_q = sum(p["questions"] for p in canonical)
    original_ans = sum(p["questions_with_answer_fields"] for p in canonical)
    docs = [r for r in rows if r["document_type"] in QUESTION_TYPES]
    sha_count = len({r["source_sha256"] for r in docs if r.get("source_sha256")})
    return dict(
        canonical_native_packages=len(canonical),
        mirrored_native_packages=sum(len(p["mirrored_paths"]) for p in canonical),
        canonical_native_question_records=original_q,
        canonical_native_answer_fields=original_ans,
        native_question_count_basis="distinct bank_id + byte-identical questions.json SHA-256",
        unique_pdf_and_office_source_sha=sha_count,
        canonically_distinct_import_jobs=len(canonical_jobs),
        unique_answer_pair_candidates=len(pairs),
        files_with_review_or_exception=sum(bool(r.get("unresolved_reason")) for r in rows),
        warning="Counts reflect available local records; not proof of answer correctness or backend import.")

def build_lead_dispositions(rows, canonical):
    """One explicit source-kind and state for every SHA in Agent 0's acceptance gate."""
    groups = collections.defaultdict(list)
    bypath = {r["original_path"]:r for r in rows}
    for r in rows:
        if r.get("source_sha256"): groups[r["source_sha256"]].append(r)
    package_original = {}
    for p in canonical:
        original = bypath.get(p.get("source_path"))
        if original and original.get("source_sha256"):
            package_original[original["source_sha256"]] = p
    precedence = {
        "pq": 0, "imcq": 0, "esoft": 0, "small_group": 1, "review_questions": 1,
        "case": 2, "answer_key": 3, "tracker_template": 4, "native_manifest": 5,
        "native_questions": 6, "curriculum_schedule": 7, "structured_unknown": 8,
        "lecture_reference": 9, "academic_document_unclassified": 10,
        "native_mapping": 11, "image_asset": 12, "metadata_manifest": 13,
    }
    result = []
    for sha, group in sorted(groups.items()):
        # Prefer an actual academic question source over a generic mirrored reference path.
        ranked = sorted(group, key=lambda r: (precedence.get(r["document_type"], 20), r["priority"],r["original_path"]))
        r = ranked[0]
        t = r["document_type"]
        p = package_original.get(sha)
        entry = dict(sha256=sha)
        if p is not None:
            entry.update(kind="question-source",status="prepared",
                         questionCount=p["questions"],readyCount=0,reviewCount=p["questions"],
                         reason="Native AXOM package locally verified structurally; source answer correctness and backend readback unverified.")
        elif t in QUESTION_TYPES and t != "answer_key":
            entry.update(kind="question-source",status="review-required",
                         reason="Original is queued for extraction/review; no validated parser or cloud receipt.")
            counts = [x.get("detected_question_headings") for x in group if x.get("detected_question_headings") is not None]
            if counts:
                n = max(counts)
                entry.update(questionCount=n,readyCount=0,reviewCount=n)
                entry["reason"] = "Tagged text headings and answer labels counted; no source-key validation or cloud receipt."
        elif t == "answer_key":
            entry.update(kind="answer-key",status="review-required",
                         reason="Answer key candidate; numbered question correspondence not yet verified.")
        elif t == "tracker_template":
            entry.update(kind="course-template",status="prepared",
                         reason="Raw template parsed into per-activity source records; installation is Agent 4's responsibility.")
        elif t in {"image_asset", "native_mapping", "native_questions", "checksum_sidecar"}:
            entry.update(kind="asset",status="excluded",
                         reason="Supporting package file or image, not an independent original question collection.")
        elif t in {"lecture_reference", "curriculum_schedule", "academic_document_unclassified"}:
            entry.update(kind="reference",status="excluded",
                         reason="Academic context/reference; no independently verified question items.")
        elif t == "metadata_manifest":
            entry.update(kind="other",status="excluded",
                         reason="Not an AXOM native question-package manifest.")
        else:
            entry.update(kind="other",status="review-required",
                         reason="Unclassified supported document; requires content triage before import.")
        result.append(entry)
    return dict(sources=result, notes={
        "scope":"All distinct SHA256 entries in master-source-manifest.jsonl, not all un-hashed academic references.",
        "missing_sha_file_count":sum(not r.get("source_sha256") for r in rows),
        "cloud_reads":"not_performed",
        "ready_count_explanation":"readyCount=0 for source-labelled questions awaiting reviewed answers; local packages have questions but no cloud receipt."
    })

def ordered_import_batches(canonical_jobs, pairs, rows):
    """Actionable short batches while retaining the exhaustive canonical queue separately."""
    rows_by_id = {r["source_id"]:r for r in rows}
    batch0 = []; batch1 = []; scored = []; triage = []
    for index, job in enumerate(canonical_jobs):
        descriptor = dict(queue_index=index, canonical_input_key=job["canonical_input_key"],
                          source_path=job["source_path"],source_ids=job.get("source_ids",[]),
                          expected_questions=job.get("expected_questions"),mode=job["input_mode"])
        if job["input_mode"] == "native_package_folder":
            batch0.append(descriptor)
        elif job["input_mode"] == "tagged_raw_text":
            batch1.append(descriptor)
        elif job["input_mode"] in {"pdf_original_extract_with_review", "office_original_extract_with_review"}:
            first = rows_by_id.get((job.get("source_ids") or [""])[0]) or {}
            score = sum([
                12 if first.get("document_type") in {"pq","imcq","esoft"} else 0,
                8 if first.get("academic_term") else 0,
                6 if first.get("module") else 0,
                4 if first.get("week") else 0,
                3 if first.get("answer_variant") == "answered_version" else 0,
                3 if first.get("file_size",0) <= 10*1048576 else 0,
                1 if first.get("source_sha256") else 0,
            ])
            descriptor.update(score=score, academic_term=first.get("academic_term"),
                              module=first.get("module"),week=first.get("week"))
            scored.append(descriptor)
        else: triage.append(descriptor)
    scored.sort(key=lambda a:(-a["score"],a["source_path"]))
    return dict(
      processing_order=[
        dict(id="B0", description="Five distinct native GOER AXOM packages. Preserve existing asset paths and review answer evidence.", jobs=batch0),
        dict(id="B1", description="Thirteen structured raw TXT banks; 195 detected numbered questions with answer labels, not independently verified.", jobs=batch1),
        dict(id="B2", description="Ten distinct proposed question-only/answered PDF or workbook pair relationships; compare every numbered stem before associating any answer.", jobs=pairs),
        dict(id="B3", description="First 120 high-signal source PDFs/Office files by explicit academic evidence, prioritizing assessed questions.", jobs=scored[:120]),
        dict(id="B4", description="Remaining PDF/Office source candidates; use full canonical queue for eventual processing.", job_indices=[x["queue_index"] for x in scored[120:]]),
        dict(id="B5", description="Other ambiguous candidate source files; manual parser compatibility review required.", jobs=triage),
      ],
      full_queue="agent-2-import-inputs-deduplicated.json",
      counting_policy="Batch pair items may overlap B3/B4 file jobs; never sum batch job counts into collection totals.",
      privacy="All paths refer to private user-authorized source files. No public upload or blanket content licensing permitted.",
    )

def index_source_archives(rows):
    """Read ZIP *central directories only*. Never unpack originals or trust CRC32 as SHA256."""
    import zipfile
    archives = []
    allowed={".pdf",".txt",".docx",".pptx",".ppsx",".xlsx",".xls",".csv",".json"}
    for r in rows:
        if r["document_type"] != "archive_review": continue
        p=pathlib.Path(r["original_path"])
        archived=dict(archive_path=str(p),archive_sha256=r.get("source_sha256"),
                      archive_id=r["source_id"],entries=[],errors=[],question_candidate_count=0)
        try:
            with zipfile.ZipFile(p,"r",allowZip64=True) as z:
                archived["total_zip_entries"]=len(z.infolist())
                archived["reported_uncompressed_bytes"]=sum(i.file_size for i in z.infolist())
                for i in z.infolist():
                    if i.is_dir():continue
                    name=i.filename
                    unsafe=name.startswith(("/", "\\")) or ".." in pathlib.PurePosixPath(name).parts
                    ext=pathlib.Path(name).suffix.casefold()
                    if ext not in allowed:continue
                    academic=bool(re.search(r"(?i)(?:\bpq\b|practice.?q|imcq|e.?soft|examsoft|quiz|questions?|workbook|answer.?key)",name))
                    candidate=dict(virtual_source_id=_sha(str(p)+"|"+name+"|"+str(i.CRC)+"|"+str(i.file_size))[:24],
                        member_name=name,extension=ext,reported_byte_size=i.file_size,
                        zip_compressed_bytes=i.compress_size,crc32=f"{i.CRC:08x}",
                        encrypted=bool(i.flag_bits & 1), unsafe_path=unsafe,
                        academic_question_hint=academic,
                        content_sha256=None, status="metadata_only_not_extracted")
                    archived["entries"].append(candidate)
                    if academic and not unsafe:archived["question_candidate_count"]+=1
                    if len(archived["entries"])>=10000:
                        archived["errors"].append("member_output_capped_at_10000")
                        break
            r["archive_index_status"]="central_directory_indexed"
            r["archive_candidate_members"]=archived["question_candidate_count"]
            r["archive_total_entries"]=archived["total_zip_entries"]
        except (OSError,ValueError,zipfile.BadZipFile,RuntimeError) as err:
            archived["errors"].append(type(err).__name__+":"+str(err)[:100])
            r["archive_index_status"]="invalid_or_unreadable_archive"
            r["unresolved_reason"]="archive_central_directory_unreadable"
        archives.append(archived)
    return archives

def merge_agent2_assessment(dispositions, canonical, rows, audit_path):
    """Integrate parser's independent per-SHA assessment without granting cloud status.

    Returns a tiny evidence report with no question stems, answers or secrets.
    Ignore stale/mismatched audit entries; never replace unknown counts with guesses.
    """
    import json
    import re
    if not audit_path.is_file():
        return dict(status="no_agent2_audit", validated_sources=[], rejected_audit_rows=[])
    try:
        audit=json.loads(audit_path.read_text(encoding="utf8"))
        native=audit.get("native", [])
        raw=audit.get("raw",[])
        if not isinstance(native,list) or not isinstance(raw,list):
            raise ValueError("audit_list_schema_mismatch")
    except (OSError,ValueError,TypeError) as error:
        return dict(status="unreadable_agent2_audit", validated_sources=[],
                    rejected_audit_rows=[str(error)])
    rows_by_path={r["original_path"]:r for r in rows}
    bysha={r["sha256"]:r for r in dispositions["sources"]}
    accepted=[];rejected=[]
    expected={}
    for p in canonical:
        record=rows_by_path.get(p.get("source_path"))
        if record and record.get("source_sha256"):
            expected[(p["bank_id"],record["source_sha256"])]=p
    for item in native:
        if not isinstance(item,dict):
            rejected.append("native_row_not_object");continue
        bank_id,sha=item.get("bankId"),item.get("sourceSha256")
        source=bysha.get(sha)
        pkg=expected.get((bank_id,sha))
        detected,ready,review=item.get("questionRecords"),item.get("ready"),item.get("needsReview")
        unresolved=item.get("unresolved",0)
        if (not pkg or not source or any(type(v) is not int or v<0 for v in [detected,ready,review,unresolved])
                or detected!=pkg["questions"] or ready+review+unresolved!=detected
                or item.get("sourceVerified") is not True or item.get("cloudVerified") is True):
            rejected.append("native_record_mismatch:" + str(bank_id));continue
        source.update(kind="question-source",status="prepared",
                      questionCount=detected,readyCount=ready,reviewCount=review+unresolved,
                      reason="Parser assessed local AXOM package using source and assets; assessed question readiness is NOT installed/backend persisted.")
        accepted.append(dict(sourceSha256=sha,bankId=bank_id,format="native_package",
                             detected=detected,ready=ready,review=review+unresolved,
                             audit_ref=str(audit_path),cloudVerified=False))
    for item in raw:
        if not isinstance(item,dict):
            rejected.append("raw_row_not_object");continue
        raw_sha=item.get("sha256")
        sha=raw_sha.removeprefix("sha256:") if isinstance(raw_sha,str) else None
        detected=item.get("questionsDetected")
        ready=item.get("ready",0)
        review=item.get("needsReview",item.get("review-suggested",0))
        unresolved=item.get("unresolved",0)
        source=bysha.get(sha)
        if (not source or not re.fullmatch(r"[a-f0-9]{64}",sha or "")
                or any(type(v) is not int or v<0 for v in [detected,ready,review,unresolved])
                or detected!=ready+review+unresolved
                or item.get("sourceVerified") is not True or item.get("cloudVerified") is True):
            rejected.append("raw_record_mismatch:" + str(item.get("file")));continue
        source.update(kind="question-source",status="review-required",
                      questionCount=detected,readyCount=ready,reviewCount=review+unresolved,
                      reason="Agent 2 parser assessed raw source locally; answer-page fidelity/human review and cloud readback NOT established.")
        accepted.append(dict(sourceSha256=sha,filename=item.get("file"),format=item.get("type"),
                             detected=detected,ready=ready,review=review+unresolved,
                             audit_ref=str(audit_path),cloudVerified=False))
    return dict(status="audit_assessed_without_upload",validated_sources=accepted,
                rejected_audit_rows=rejected, canonical_native_packages=len(expected),
                assessed_source_count=len(accepted),
                assessed_questions_detected=sum(x["detected"] for x in accepted),
                assessed_ready_not_installed=sum(x["ready"] for x in accepted),
                assessed_review_required=sum(x["review"] for x in accepted))

def raw_text_stem_fingerprints(rows):
    """Metadata-only TXT stem fingerprints to spot reuse without exporting source text.

    This is NOT the application parser: it does not transform or install questions.
    Question boundaries from labels and A-E choice patterns yield *hints* only.
    """
    import collections
    import unicodedata
    hashes=collections.defaultdict(list)
    source_stats=[]
    header=re.compile(r"(?im)^\s*Question\s+(\d{1,4})\s*[:.\-]\s*")
    choices=re.compile(r"(?im)^\s*[A-E]\s*[.)]\s+")
    for row in rows:
        if row["file_extension"] != ".txt" or row.get("detected_question_headings",0) == 0:continue
        path=pathlib.Path(row["original_path"])
        try:
            text=path.read_text(encoding="utf-8-sig",errors="replace")
        except OSError:
            continue
        matches=list(header.finditer(text))
        repeat_numbers=collections.Counter(int(m.group(1)) for m in matches)
        source_stats.append(dict(source_id=row["source_id"],source_sha256=row.get("source_sha256"),
           path=str(path),numbered_heading_count=len(matches),
           repeated_number_labels=sum(1 for n,v in repeat_numbers.items() if v>1),
           distinct_number_labels=len(repeat_numbers),
           split_into_multiple_collections="possible" if any(v>1 for v in repeat_numbers.values()) else "unknown"))
        for ix,m in enumerate(matches):
            body=text[m.end():(matches[ix+1].start() if ix+1<len(matches) else len(text))]
            first_choice=choices.search(body)
            candidate=body[:first_choice.start()] if first_choice else body[:500]
            normalized=re.sub(r"\s+"," ",unicodedata.normalize("NFKC",candidate).casefold()).strip(" :\t-")
            if len(normalized)<35:continue
            hashes[_sha(normalized)].append(dict(source_id=row["source_id"],source_sha256=row.get("source_sha256"),
                   question_number=int(m.group(1)),local_position=ix+1,
                   correspondence="raw_text_stem_metadata_hint_not_answer_mapping"))
    return dict(source_statistics=source_stats,
                repeated_stem_hashes=[dict(stem_sha256=h,associations=a)
                                      for h,a in hashes.items() if len(a)>1],
                distinct_stem_hint_count=len(hashes),
                warning="Do not copy answers or collapse questions from this approximate stem-hash report. Full parser validation required.")

def baseline_source_continuity(previous_manifest_path, rows):
    """Prove which earlier six-root SHA identities remain reachable after moves."""
    import json
    if not previous_manifest_path.is_file():
        return dict(status="baseline_not_found")
    try:
        baseline=json.loads(previous_manifest_path.read_text(encoding="utf8"))
        entries=baseline.get("entries",[])
    except (OSError,ValueError) as error:
        return dict(status="baseline_unreadable",reason=str(error))
    previous=collections.defaultdict(list)
    for r in entries:
        sha=r.get("sha256")
        if isinstance(sha,str) and len(sha)==64:
            previous[sha].append(dict(root=r.get("root"),path=r.get("path"),filename=r.get("fileName")))
    current=collections.defaultdict(list)
    for r in rows:
        if r.get("source_sha256"):
            current[r["source_sha256"]].append(r["original_path"])
    missing=[dict(sha256=h,previous_paths=paths,status="not_found_in_current_hashed_source_cohort")
             for h,paths in previous.items() if h not in current]
    return dict(status="checked",previous_file_paths=len(entries),
         previous_distinct_hashes=len(previous),previous_distinct_hashes_preserved=len(previous)-len(missing),
         previous_distinct_hashes_currently_unavailable=len(missing),
         missing=missing,
         caution="Some missing hashes can reflect moved/unmounted/renamed roots or un-hashed priority files; do not claim deletion.")
