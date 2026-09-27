"""Read Phase 1 / GodFile CSV research into the AXOM school dataset.

Institutional text becomes researchFacts, class statistics become reportedStats,
and research-team estimates stay under `estimates` (never facts or rules).
Anything a field_provenance_raw source_type or the text itself attributes to a
third party is never published as a fact. A stat is official-capture only with a
matching OFFICIAL_VERIFIED provenance row; thresholds, ranges and open-ended
figures are flagged floorLike, and estimates that repeat a school minimum are
flagged floorBased, so neither is ever used as a competitive benchmark.
Every table except schools_raw is optional. Originals are only read; output is
deterministic for identical input.

Usage: python3 scripts/build-application-research.py CSV_FOLDER OUTPUT_JSON
"""
import csv
import json
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

TABLES = {
    "admissions_requirements_raw": ("policy_url", {
        "min_gpa": "GPA minimum (read exceptions)", "min_science_gpa": "Science GPA minimum (read exceptions)",
        "mcat_min": "MCAT minimum (read exceptions)", "mcat_recency_policy": "MCAT dates and recency",
        "citizenship_policy": "Citizenship policy", "requirement_type": "Requirement context",
    }),
    "coursework_policy_raw": ("prereq_policy_url", {
        "biology_hours": "Biology coursework", "gen_chem_hours": "General chemistry coursework",
        "orgo_hours": "Organic chemistry coursework", "biochem_hours": "Biochemistry coursework",
        "physics_hours": "Physics coursework", "math_stats_hours": "Math and statistics coursework",
        "english_hours": "English coursework", "behavioral_sci_hours": "Behavioral science coursework",
        "online_coursework_accepted": "Online coursework", "community_college_accepted": "Community college coursework",
        "pass_fail_policy": "Pass/fail coursework", "ap_credit_policy": "AP credit",
        "clep_policy": "CLEP credit", "degree_requirement": "Degree requirement",
        "prereq_required_before": "Prerequisite timing",
    }),
    "application_process_raw": ("process_policy_url", {
        "application_service": "Application service", "primary_deadline": "Primary deadline",
        "secondary_deadline": "Secondary deadline", "rolling_admissions": "Rolling admissions",
        "secondary_model": "Secondary application process", "secondary_fee": "Secondary application fee",
        "state_residency_rules": "State residency", "international_policy": "International applicants",
        "daca_policy": "DACA policy",
    }),
    "cost_financial_aid_raw": ("cost_policy_url", {
        "academic_year": "Cost figures academic year", "tuition_in_state": "Tuition (in-state)",
        "tuition_out_of_state": "Tuition (out-of-state)", "tuition_flat": "Tuition (all students)",
        "total_cost_of_attendance": "Total cost of attendance",
        "title_iv_federal_loan_eligible": "U.S. federal (Title IV) loan eligibility",
    }),
    "accreditation_regulatory_raw": ("accreditation_policy_url", {
        "accreditor_primary": "Primary accreditor", "accreditor_type": "Accreditor type",
        "wfme_recognized": "WFME / NCFMEA recognition", "state_approvals": "State approvals",
        "ecfmg_eligible": "ECFMG eligibility",
    }),
    "caribbean_risk_eligibility_raw": ("source_url", {
        "state_approvals_ny_ca_fl": "NY/CA/FL clinical approvals",
        "federal_loan_eligibility": "Federal loan eligibility (risk review)",
        "ecfmg_eligible": "ECFMG eligibility (risk review)",
    }),
}
STATS_TABLE = "admissions_requirements_raw"
REPORTED_STATS = {
    "avg_gpa": ("gpa", "average", "Reported class GPA"),
    "competitive_gpa": ("gpa", "competitive", "Reported competitive GPA"),
    "avg_science_gpa": ("science-gpa", "average", "Reported class science GPA"),
    "competitive_science_gpa": ("science-gpa", "competitive", "Reported competitive science GPA"),
    "mcat_avg": ("mcat", "average", "Reported class MCAT"),
    "mcat_competitive": ("mcat", "competitive", "Reported competitive MCAT"),
}
PLAUSIBLE = {"gpa": (2.0, 4.0), "science-gpa": (2.0, 4.0), "mcat": (472, 528), "index": (0.1, 100), "hours": (0, 20000)}
# A stat cell without a number that states a testing policy is also published as a fact so rules can read it.
POLICY_NOTE_LABELS = {"gpa": "GPA policy note", "science-gpa": "Science GPA policy note", "mcat": "MCAT policy note"}
ESTIMATE_TABLE = "applicant_profile_estimate_raw"
ESTIMATE_HOURS = {
    "est_research_hours_range": "research", "est_clinical_volunteer_hours_range": "clinicalVolunteer",
    "est_nonclinical_volunteer_hours_range": "nonclinicalVolunteer", "est_shadowing_hours_range": "shadowing",
    "est_paid_clinical_work_hours_range": "paidClinical", "est_paid_nonclinical_work_hours_range": "paidNonclinical",
    "est_leadership_extracurricular_hours_range": "leadership",
}
RISK_TABLE = "caribbean_risk_eligibility_raw"
SEGMENTS = ("US_MD", "US_DO", "PUERTO_RICO", "CARIBBEAN_INTL", "CANADA_MD")
# Review-queue fields that describe exported evidence even though they are not column names.
CONFLICT_FIELDS = {"state_or_country", "accreditation", "accreditor_primary", "federal_loans", "tuition",
                   "tuition_flat", "ecfmg_eligible", "campus_and_pass_rate"}
OPTIONAL_TABLES = [*TABLES, ESTIMATE_TABLE, "field_provenance_raw", "conflicts_and_review_queue"]

SENTINEL = re.compile(r"^(NOT_PUBLICLY_DISCLOSED|NOT_FOUND_AFTER_OFFICIAL_SEARCH|REQUIRES_MANUAL_VERIFICATION|CONFLICTING_SOURCES|NF)\b")
THIRD_PARTY_TEXT = re.compile(r"third[- ]party|aggregator", re.I)
# field_provenance_raw.source_type such as THIRD_PARTY_AGGREGATOR, thirdparty_of_official, official+thirdparty.
THIRD_PARTY_SOURCE = re.compile(r"third", re.I)
# A search digest of an official page is not an official-page capture.
DIGEST_TEXT = re.compile(r"digest|per search", re.I)
# Thresholds, recommended minimums, open-ended figures and ranges are not class statistics.
FLOOR_LIKE_TEXT = re.compile(r"threshold|minimum|\bmin\b|recommended|required|scholarship|typical|accepted range|\+|>|≥|range", re.I)
POLICY_NOTE_TEXT = re.compile(r"required|optional|not required", re.I)
# A minimum text naming one of these marks any equal number in it as a floor, not a competitive figure.
FLOOR_CONTEXT = re.compile(r"scholarship|threshold|track|min", re.I)
ANY_NUMBER = re.compile(r"\d+(?:\.\d+)?")
LEADING_NUMBER = re.compile(r"^[\s~>]*(\d+(?:\.\d+)?)")
APPROXIMATE = re.compile(r"[~>+]|\bmedian\b|approx", re.I)
NUMBER_RANGE = re.compile(r"\d\s*[-–]\s*\d")
# "2024-25 entering" names a class year, not a value range.
YEAR_RANGE = re.compile(r"\b(?:19|20)\d{2}\s*[-–]\s*\d{2,4}\b")
HOUR_RANGE = re.compile(r"^\s*(\d[\d,]*)\s*[-–]\s*(\d[\d,]*)(\+)?")
ISO_DAY = re.compile(r"^\d{4}-\d{2}-\d{2}")
CONFIDENCE = {"LOW": "low", "MODERATE": "moderate", "HIGH": "high"}


def http_url(value):
    value = (value or "").strip()
    parsed = urlparse(value)
    return value if parsed.scheme in ("http", "https") and parsed.netloc else None


def iso_day(value):
    match = ISO_DAY.match((value or "").strip())
    return match.group(0) + "T00:00:00Z" if match else None


def read_table(folder, name):
    path = folder / (name + ".csv")
    if not path.exists():
        return None
    with path.open(newline="", encoding="utf-8-sig") as source:
        return [{key.strip(): value or "" for key, value in row.items() if key is not None} for row in csv.DictReader(source)]


def latest(rows, key_fields, date_field):
    """Keep the newest row per key (ties: last row); returns (rows by key, superseded count)."""
    chosen = {}
    keyed = 0
    for row in rows:
        key = tuple(row.get(field, "").strip() for field in key_fields)
        if not key[0]:
            continue
        keyed += 1
        current = chosen.get(key)
        if current is None or row.get(date_field, "").strip() >= current.get(date_field, "").strip():
            chosen[key] = row
    return chosen, keyed - len(chosen)


def capture_status(status):
    upper = status.upper()
    if "THIRD_PARTY" in upper or "ESTIMATE" in upper:
        return None
    return "official-capture" if upper == "OFFICIAL_VERIFIED" else "unverified-capture"


def plausible_number(value, bounds):
    match = LEADING_NUMBER.match(value)
    if not match:
        return None
    number = float(match.group(1))
    if not bounds[0] <= number <= bounds[1]:
        return None
    return int(number) if number.is_integer() else number


def has_value_range(value):
    return bool(NUMBER_RANGE.search(YEAR_RANGE.sub("", value)))


def is_approximate(value):
    return bool(APPROXIMATE.search(value) or has_value_range(value))


def is_floor_like(value):
    return bool(FLOOR_LIKE_TEXT.search(value) or has_value_range(value))


def equals_minimum(number, minimum, bounds):
    """True when an estimate repeats the school's own minimum (or a scholarship/threshold/track figure)."""
    if not minimum:
        return False
    if plausible_number(minimum, bounds) == number:
        return True
    return bool(FLOOR_CONTEXT.search(minimum)) and any(float(found) == number for found in ANY_NUMBER.findall(minimum))


def text(row, field):
    value = (row or {}).get(field, "").strip()
    return value if value and not SENTINEL.match(value) else None


def estimated_score(row, value_field, basis_field, bounds, minimums):
    value = text(row, value_field)
    basis = text(row, basis_field)
    number = plausible_number(value, bounds) if value else None
    if number is None or not basis:
        return None
    floor = bool(re.search(r"floor|minimum", basis, re.I)) or any(equals_minimum(number, minimum, bounds) for minimum in minimums)
    return {"value": number, "basis": basis, "floorBased": floor,
            "peerFallback": bool(re.search(r"PEER_FALLBACK", basis, re.I))}


def hour_range(value):
    result = {"text": value}
    match = HOUR_RANGE.match(value)
    if match:
        low, high = (int(part.replace(",", "")) for part in match.group(1, 2))
        if PLAUSIBLE["hours"][0] <= low <= high <= PLAUSIBLE["hours"][1]:
            result.update(min=low, max=high)
            if match.group(3):
                result["openEnded"] = True
    return result


def build_estimates(row, requirements):
    """`requirements` is the school's admissions row; its minimums mark estimates that merely repeat a floor."""
    disclaimer = (row or {}).get("disclaimer", "").strip()
    estimated_at = iso_day((row or {}).get("date_estimated"))
    if not disclaimer or not estimated_at:
        return None
    estimates = {}
    for key, field in (("tier", "tier_classification"), ("tierRationale", "tier_rationale")):
        if text(row, field):
            estimates[key] = text(row, field)
    for key, value_field, basis_field, bounds, minimum_fields in (
            ("competitiveGpa", "est_competitive_gpa", "gpa_basis", PLAUSIBLE["gpa"], ("min_gpa", "min_science_gpa")),
            ("competitiveMcat", "est_competitive_mcat", "mcat_basis", PLAUSIBLE["mcat"], ("mcat_min",))):
        score = estimated_score(row, value_field, basis_field, bounds, [text(requirements, field) for field in minimum_fields])
        if score:
            estimates[key] = score
    index = plausible_number(text(row, "est_lizzym_composite_index") or "", PLAUSIBLE["index"])
    if index is not None:
        estimates["indexScore"] = {"value": index}
        if text(row, "lizzym_benchmark_interpretation"):
            estimates["indexScore"]["interpretation"] = text(row, "lizzym_benchmark_interpretation")
    estimates["hours"] = {activity: hour_range(text(row, field)) for field, activity in ESTIMATE_HOURS.items() if text(row, field)}
    estimates["confidence"] = CONFIDENCE.get(row.get("confidence_level", "").strip().upper(), "unknown")
    estimates["disclaimer"] = disclaimer
    if row.get("sources_referenced", "").strip():
        estimates["sourcesReferenced"] = row["sources_referenced"].strip()
    estimates["estimatedAt"] = estimated_at
    return estimates


def build(folder):
    loaded = {name: read_table(folder, name) for name in ["schools_raw", *OPTIONAL_TABLES]}
    if loaded["schools_raw"] is None:
        raise FileNotFoundError(f"schools_raw.csv is required in {folder}")
    missing_tables = sorted(name for name, rows in loaded.items() if rows is None)
    rows = {name: loaded[name] or [] for name in loaded}
    superseded = {}
    roster, superseded["schools_raw"] = latest(rows["schools_raw"], ("school_id",), "date_seeded")
    by_school = {}
    for name in [*TABLES, ESTIMATE_TABLE]:
        chosen, superseded[name] = latest(rows[name], ("school_id",), "date_estimated" if name == ESTIMATE_TABLE else "date_captured")
        by_school[name] = {key[0]: row for key, row in chosen.items()}
    provenance, superseded["field_provenance_raw"] = latest(rows["field_provenance_raw"], ("school_id", "table_name", "field_name"), "date_captured")
    conflicts = {}
    for row in rows["conflicts_and_review_queue"]:
        conflicts.setdefault(row.get("school_id", "").strip(), []).append(row)
    review_fields = {field for _, fields in TABLES.values() for field in fields} | CONFLICT_FIELDS

    def evidence(school_id, table, field, value, row, url_field):
        """(status, url, capturedAt, matching provenance row or {}, provenance names a third-party source)."""
        found = provenance.get((school_id, table, field), {})
        third_party_source = bool(THIRD_PARTY_SOURCE.search(found.get("source_type", "")))
        mismatched = bool(found and found.get("captured_value") != value)
        if mismatched:
            found = {}
        status = "REQUIRES_MANUAL_VERIFICATION" if mismatched else (found.get("verification_status") or row.get("verification_status", "")).strip()
        return (status, http_url(found.get("source_url") or row.get(url_field)), iso_day(found.get("date_captured") or row.get("date_captured")),
                found, third_party_source)

    schools = []
    excluded = []
    counts = {"thirdParty": 0, "conflicts": 0, "stats": 0, "floorLikeStats": 0, "floorBasedEstimates": 0, "policyNotes": 0}
    # Items that would otherwise be published as institutional evidence, reclassified by provenance source_type.
    third_party_by_source = {"facts": 0, "stats": 0}
    dropped = {"facts": 0, "stats": 0, "riskFlags": 0}
    facts_by_status = {"official-capture": 0, "unverified-capture": 0}
    facts_by_table = {table: 0 for table in TABLES}
    segments = {}
    for (school_id,), raw in roster.items():
        if raw.get("is_canonical", "").strip().lower() == "false":
            excluded.append(school_id)
            continue
        facts = []
        sources = {}
        for table, (url_field, fields) in TABLES.items():
            row = by_school[table].get(school_id)
            if not row:
                continue
            for field, label in fields.items():
                value = row.get(field, "").strip()
                if not value:
                    continue
                status, url, captured, _, third_party_source = evidence(school_id, table, field, value, row, url_field)
                kind = capture_status(status)
                if kind is None or third_party_source or THIRD_PARTY_TEXT.search(value):
                    counts["thirdParty"] += 1
                    if kind is not None and not THIRD_PARTY_TEXT.search(value):
                        third_party_by_source["facts"] += 1
                    continue
                if not url or not captured:
                    dropped["facts"] += 1
                    continue
                facts.append({"id": f"{table}.{field}", "label": label, "value": value,
                              "url": url, "capturedAt": captured, "captureStatus": kind})
                facts_by_status[kind] += 1
                facts_by_table[table] += 1
                sources[(url, captured)] = {"url": url, "retrievedAt": captured,
                                            "title": "Historical research source (confirm current policy)"}
        stats = []
        policy_notes = []
        stats_row = by_school[STATS_TABLE].get(school_id)
        for field, (metric, kind, label) in REPORTED_STATS.items():
            value = text(stats_row, field)
            if not value:
                continue
            status, url, captured, matched, third_party_source = evidence(school_id, STATS_TABLE, field, value, stats_row, TABLES[STATS_TABLE][0])
            if not url or not captured:
                dropped["stats"] += 1
                continue
            stat = {"id": f"{STATS_TABLE}.{field}", "label": label, "metric": metric, "kind": kind, "value": value}
            number = plausible_number(value, PLAUSIBLE[metric])
            if number is not None:
                stat["number"] = number
            if is_approximate(value):
                stat["approximate"] = True
            if is_floor_like(value):
                stat["floorLike"] = True
                counts["floorLikeStats"] += 1
            # Official only with a matching official-page provenance row; a row-level status alone is not enough.
            if THIRD_PARTY_TEXT.search(value) or capture_status(status) is None:
                basis = "third-party"
            elif third_party_source:
                basis = "third-party"
                third_party_by_source["stats"] += 1
            elif matched.get("verification_status", "").strip().upper() == "OFFICIAL_VERIFIED" and not DIGEST_TEXT.search(value):
                basis = "official-capture"
            else:
                basis = "unverified-capture"
            stat.update(url=url, capturedAt=captured, basis=basis)
            stats.append(stat)
            if number is None and basis != "third-party" and POLICY_NOTE_TEXT.search(value):
                policy_notes.append({"id": stat["id"], "label": POLICY_NOTE_LABELS[metric], "value": value,
                                     "url": url, "capturedAt": captured, "captureStatus": basis})
        for fact in policy_notes:
            facts.append(fact)
            facts_by_status[fact["captureStatus"]] += 1
            facts_by_table[STATS_TABLE] += 1
            counts["policyNotes"] += 1
            sources[(fact["url"], fact["capturedAt"])] = {"url": fact["url"], "retrievedAt": fact["capturedAt"],
                                                          "title": "Historical research source (confirm current policy)"}
        risk = None
        risk_row = by_school[RISK_TABLE].get(school_id)
        tier = text(risk_row, "risk_tier")
        if tier:
            status, url, captured, _, third_party_source = evidence(school_id, RISK_TABLE, "risk_tier", tier, risk_row, "source_url")
            kind = None if third_party_source else capture_status(status)
            if kind and not (url and captured):
                dropped["riskFlags"] += 1
            elif kind:
                risk = {"tier": tier}
                if risk_row.get("notes", "").strip():
                    risk["notes"] = risk_row["notes"].strip()
                risk.update(url=url, capturedAt=captured, captureStatus=kind)
        estimates = build_estimates(by_school[ESTIMATE_TABLE].get(school_id), stats_row)
        if estimates:
            counts["floorBasedEstimates"] += sum(estimates.get(key, {}).get("floorBased", False) for key in ("competitiveGpa", "competitiveMcat"))
        school_conflicts = {}
        for row in conflicts.get(school_id, []):
            status = row.get("status", "").strip().upper()
            if status.startswith("RESOLVED"):
                continue
            field = row.get("field_name", "").strip()
            if status == "OPEN_NOT_RECORDED" or field in REPORTED_STATS or field not in review_fields:
                counts["conflicts"] += 1
                continue
            school_conflicts[row.get("conflict_id", "").strip() + ": " + field] = {"existing": row.get("value_a", ""), "incoming": row.get("value_b", "")}
        program = raw.get("program_type", "").strip()
        segment = raw.get("segment", "").strip().upper()
        program_type = program.lower() if program.lower() in ("md", "do") else "md" if segment == "CANADA_MD" else "other"
        dates = [fact["capturedAt"] for fact in facts] + [stat["capturedAt"] for stat in stats]
        dates += [risk["capturedAt"]] if risk else []
        dates += [estimates["estimatedAt"]] if estimates else []
        seeded = iso_day(raw.get("date_seeded"))
        school = {"id": school_id, "canonicalName": raw.get("institution_name", "").strip(), "name": raw.get("institution_name", "").strip(),
                  "degree": program, "programType": program_type}
        if segment:
            school["segment"] = segment if segment in SEGMENTS else "OTHER"
            segments[school["segment"]] = segments.get(school["segment"], 0) + 1
        school.update({"location": raw.get("state_or_country", "").strip(), "sources": list(sources.values()), "researchFacts": facts,
                       "verificationStatus": "conflicting" if school_conflicts else "incomplete" if facts else "unknown"})
        updated = max(dates, default=seeded)
        if updated:
            school["updatedAt"] = updated
        if http_url(raw.get("admissions_website_phase0")):
            school["website"] = http_url(raw.get("admissions_website_phase0"))
        if school_conflicts:
            school["conflicts"] = school_conflicts
        if stats:
            school["reportedStats"] = stats
            counts["stats"] += len(stats)
        if estimates:
            school["estimates"] = estimates
        if risk:
            school["riskFlag"] = risk
        schools.append(school)
    if len({s["id"] for s in schools}) != len(schools):
        raise ValueError("Duplicate school IDs")
    updated = [s["updatedAt"] for s in schools if s.get("updatedAt")]
    if not updated:
        raise ValueError("No dated school records; cannot set generatedAt deterministically")
    return {"schemaVersion": 2, "sourcePipelineVersion": "phase1-research-adapter-v2",
            "generatedAt": max(updated), "recordCount": len(schools), "schools": schools}, {
            "rosterRows": len(rows["schools_raw"]), "publishedSchools": len(schools), "excludedNoncanonicalIds": excluded,
            "schoolsWithResearch": sum(bool(s["researchFacts"]) for s in schools),
            "researchFacts": sum(len(s["researchFacts"]) for s in schools),
            "schoolsWithEstimates": sum("estimates" in s for s in schools), "reportedStats": counts["stats"],
            "riskFlags": sum("riskFlag" in s for s in schools), "excludedThirdPartyFacts": counts["thirdParty"],
            "thirdPartyBySourceType": third_party_by_source, "droppedNoUrlOrDate": dropped,
            "statPolicyNoteFacts": counts["policyNotes"], "floorLikeStats": counts["floorLikeStats"],
            "floorBasedEstimates": counts["floorBasedEstimates"],
            "supersededRows": superseded, "excludedConflicts": counts["conflicts"],
            "factsByCaptureStatus": facts_by_status, "factsByTable": facts_by_table,
            "segments": dict(sorted(segments.items())), "missingTables": missing_tables}


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    dataset, report = build(Path(sys.argv[1]))
    output = Path(sys.argv[2])
    if output.suffix != ".json":
        raise ValueError("Output must be a JSON dataset")
    output.write_text(json.dumps(dataset, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
