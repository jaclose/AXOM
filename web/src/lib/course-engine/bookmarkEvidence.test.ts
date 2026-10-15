import { describe, expect, it } from "vitest";
import { SGU_CURRICULUM } from "../curricula";
import type { Resource, Term, Course } from "../types";
import {
  academicBookmarkOwnerKey, academicResourcesForTrackerScope,
  asAcademicResource, asActivityLinkedBookmarkResource, bookmarkActivityCandidates,
  canonicalPanoptoVideoUrl, indexAcademicBookmarks,
  parseBookmarkHtml,
} from "./bookmarkEvidence";

const VIDEO = "https://sgu1.hosted.panopto.com/Panopto/Pages/Viewer.aspx?id=12345678-1234-4567-890a-bcdef0123456";
const SECOND = "https://sgu1.hosted.panopto.com/Panopto/Pages/Viewer.aspx?id=abcdef01-2345-6789-abcd-1234567890ab";
const entry = (title: string, url = VIDEO) => ({ title, url });

describe("source-aware browser bookmark indexing", () => {
  it("reads Chrome/Safari bookmark HTML as inert text, preserving unicode and entities", () => {
    const html = [
      "<!DOCTYPE NETSCAPE-Bookmark-file-1>",
      "<DL><DT><A ADD_DATE=\"0\" HREF=\"" + VIDEO.replace("&", "&amp;") + "\">DM DLA 7 &amp; Study Notes</A>",
      "<DT><A HREF='" + SECOND + "'>NCRS DLA 01 &#x2013; Leg Swelling</A>",
      "<DT><A HREF=\"javascript:alert(1)\">XSS bookmark</A></DL>",
    ].join("\n");
    const links = parseBookmarkHtml(html);
    expect(links).toEqual([
      { title: "DM DLA 7 & Study Notes", url: VIDEO },
      { title: "NCRS DLA 01 – Leg Swelling", url: SECOND },
      { title: "XSS bookmark", url: "javascript:alert(1)" },
    ]);
    const index = indexAcademicBookmarks(links, SGU_CURRICULUM);
    expect(index).toMatchObject({ totalLinks: 3, providerLinks: 2, excludedProviderLinks: 0, duplicateVideoLinks: 0 });
    expect(index.videos).toHaveLength(2);
  });

  it("permits only precise authorized Panopto viewer UUID links and discards sensitive query parameters", () => {
    expect(canonicalPanoptoVideoUrl(VIDEO + "&start=240&advance=true&pid=private")).toBe(VIDEO);
    expect(canonicalPanoptoVideoUrl(VIDEO.replace("https:", "javascript:"))).toBeUndefined();
    expect(canonicalPanoptoVideoUrl("https://sgu1.hosted.panopto.com.evil.test/Panopto/Pages/Viewer.aspx?id=12345678-1234-4567-890a-bcdef0123456")).toBeUndefined();
    expect(canonicalPanoptoVideoUrl(VIDEO.replace("sgu1.hosted.panopto.com", "login:secret@sgu1.hosted.panopto.com"))).toBeUndefined();
    expect(canonicalPanoptoVideoUrl(VIDEO.replace("Viewer.aspx", "Auth/Access.aspx"))).toBeUndefined();
    expect(canonicalPanoptoVideoUrl(VIDEO + "&id=abcdef01-2345-6789-abcd-1234567890ab")).toBeUndefined();
    expect(canonicalPanoptoVideoUrl(VIDEO.replace("bcdef0123456", "FAKE"))).toBeUndefined();
    expect(canonicalPanoptoVideoUrl(VIDEO.replace("https:", "http:"))).toBeUndefined();
    expect(indexAcademicBookmarks([entry("DM DLA 07"), entry("DM DLA 07", VIDEO + "&start=45")], SGU_CURRICULUM))
      .toMatchObject({ providerLinks: 2, duplicateVideoLinks: 1, videos: [{ url: VIDEO }] });
  });

  it("resolves only unique curriculum owners, never assumes FTM or NB has a single module", () => {
    const report = indexAcademicBookmarks([
      entry("DM DLA 7 - Amino Acid Metabolism", VIDEO),
      entry("NCRS DLA 01 - Approach to Leg Swelling", SECOND),
      entry("FTM DLA 03A - Lipid Structure", VIDEO.replace("12345678", "deadbeef")),
      entry("NB Lecture 65 - Sensory Motor Integration", VIDEO.replace("12345678", "aaaabbbb")),
      entry("DM DLAs Week 5", VIDEO.replace("12345678", "11111111")),
      entry("DLA 05 - MICR - Viruses", VIDEO.replace("12345678", "22222222")),
    ], SGU_CURRICULUM);
    expect(report.videos).toHaveLength(6);
    const [dm, ncrs, ftm, nb, dmWeek, noModule] = report.videos;
    expect(dm).toMatchObject({
      moduleToken: "DM", activity: "dla", activityNumber: 7, assignment: "unique-candidate",
      candidates: [{ term: "Term 2", module: "DM" }],
    });
    expect(ncrs).toMatchObject({ moduleToken: "NCRS", activity: "dla", activityNumber: 1,
      assignment: "unique-candidate", candidates: [{ term: "Term 4", module: "NCRS" }] });
    expect(ftm).toMatchObject({ moduleToken: "FTM", activity: "dla", activityNumber: 3, part: "A",
      assignment: "needs-course-review" });
    expect(ftm.candidates).toHaveLength(2);
    expect(nb).toMatchObject({ moduleToken: "NB", activity: "lecture", activityNumber: 65,
      assignment: "needs-course-review" });
    expect(nb.candidates).toHaveLength(3);
    expect(dmWeek).toMatchObject({ activity: "dla", mentionedWeek: 5, assignment: "unique-candidate" });
    expect(dmWeek).not.toHaveProperty("activityNumber");
    expect(noModule).toMatchObject({ assignment: "unassigned", candidates: [] });
  });

  it("builds private Resources from explicit owner selection, with no academic week claims", () => {
    const [bookmark] = indexAcademicBookmarks([entry("FTM DLA 03A", VIDEO)], SGU_CURRICULUM).videos;
    const owner = bookmark.candidates[1];
    const resource = asAcademicResource(bookmark, owner);
    expect(resource).toMatchObject({ category: "Academic videos", url: VIDEO, tags: [
      "axom:academic-panopto", "axom:unverified-school-week",
      "axom:bookmark-title-evidence", `academic:owner:${owner.key}`,
    ] });
    expect(resource.note).toMatch(/not prove official academic term, week/i);
    expect(asAcademicResource(bookmark).tags).toContain("axom:unassigned-course");
    expect(() => asAcademicResource(bookmark, {
      term: "Term 5", course: "PPM 501", module: "GOER",
      key: academicBookmarkOwnerKey("Term 5", "PPM 501", "GOER"),
    })).toThrow(/does not match/);
  });

  it("shows only explicitly course-scoped saved links and withholds ambiguous legacy scopes", () => {
    const owners = [
      { term: "Term 2", course: "BPM 501", module: "NB2" },
      { term: "Term 2", course: "ELECTIVE", module: "NB Block 2" },
    ];
    const links: Resource[] = owners.map((owner, index) => ({
      id: String(index), title: "Video " + index, url: index ? SECOND : VIDEO,
      category: "Academic videos", created: "2026-10-14",
      tags: ["axom:academic-panopto", `academic:owner:${academicBookmarkOwnerKey(owner.term, owner.course, owner.module)}`],
    }));
    const terms: Term[] = [{ id: "t2", name: "Term 2" }];
    const courses: Course[] = [
      { id: "bpm", termId: "t2", code: "BPM 501", name: "Core", files: 0, modules: [{ id: "nb2", name: "NB2" }] },
      { id: "elective", termId: "t2", code: "ELECTIVE", name: "Other", files: 0, modules: [{ id: "copy", name: "NB Block 2" }] },
    ];
    expect(academicResourcesForTrackerScope("Term 2/BPM 501/NB2/Week 1", links, terms, courses).map(item => item.id)).toEqual(["0"]);
    expect(academicResourcesForTrackerScope("Term 2/ELECTIVE/NB2/Week 1", links, terms, courses).map(item => item.id)).toEqual(["1"]);
    expect(academicResourcesForTrackerScope("Term 2/NB2/Week 1", links, terms, courses)).toEqual([]);
    expect(academicResourcesForTrackerScope("Term 5/GOER/Week 2", links, terms, courses)).toEqual([]);
    expect(academicResourcesForTrackerScope("Term 2", links, terms, courses)).toEqual([]);
  });


  it("uses learner-created NB2/NB3 folders as optional suggestions, never as verified school placement", () => {
    const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><DT><H3>SGU</H3>
      <DL><DT><H3>Term 2</H3><DL><DT><H3>NB3</H3><DL>
      <DT><A HREF="${VIDEO}">NB Lecture 65 - Synthetic topic</A></DL>
      </DL></DL></DL>`;
    const entries = parseBookmarkHtml(html);
    expect(entries[0].folderPath).toEqual(["SGU", "Term 2", "NB3"]);
    const [candidate] = indexAcademicBookmarks(entries, SGU_CURRICULUM).videos;
    expect(candidate).toMatchObject({
      assignment: "needs-course-review",
      suggestedOwnerKey: "term2/bpm501/nb3",
    });
    expect(candidate.candidates).toHaveLength(3);
    expect(candidate).not.toHaveProperty("week");
    const wrongTerm = indexAcademicBookmarks([{
      title: "NB Lecture 65", url: VIDEO, folderPath: ["Term 4", "NB3"],
    }], SGU_CURRICULUM).videos[0];
    expect(wrongTerm.suggestedOwnerKey).toBeUndefined();
    const twoFolders = indexAcademicBookmarks([{
      title: "NB Lecture 65", url: VIDEO, folderPath: ["Term 2", "NB2", "NB3"],
    }], SGU_CURRICULUM).videos[0];
    expect(twoFolders.suggestedOwnerKey).toBeUndefined();
  });


  it("proposes an exact existing tracker activity by module/course/kind/number, never by loose title", () => {
    const [video] = indexAcademicBookmarks([entry("NB Lecture 65 - Sensory Motor", VIDEO)], SGU_CURRICULUM).videos;
    const owner = video.candidates.find((candidate) => candidate.module === "NB3")!;
    const candidate = { id: "real-tracker-activity", path: "Term 2/BPM 501/NB3/Week 3",
      label: "NB Lecture 65 Synthetic topic", templateKey: "nb3|lecture|65", activity: "lecture" as const };
    const wrongCourse = { ...candidate, id: "different-course", path: "Term 2/ELECTIVE/NB3/Week 3" };
    const wrongTerm = { ...candidate, id: "different-term", path: "Term 4/BPM 501/NB3/Week 3" };
    const wrongKind = { ...candidate, id: "different-kind", activity: "dla" as const, templateKey: "nb3|dla|65" };
    const composite = { ...candidate, id: "compound", templateKey: "nb3|lecture|combined-65-66" };
    const legacy = { ...candidate, id: "unowned-legacy", path: "Term 2/NB3/Week 3" };
    expect(bookmarkActivityCandidates(video, owner, [
      wrongCourse, wrongTerm, wrongKind, composite, legacy, candidate,
    ])).toEqual([{ id: candidate.id, label: candidate.label, path: candidate.path }]);
    const resource = asActivityLinkedBookmarkResource(video, owner, candidate);
    expect(resource.tags).toContain("academic:tracker:real-tracker-activity");
    expect(resource.note).toMatch(/manually linked/i);
    expect(() => asActivityLinkedBookmarkResource(video, owner, wrongCourse)).toThrow(/no longer matches/);
  });

  it("holds an activity candidate for explicit human selection when two tracker rows share its key", () => {
    const [video] = indexAcademicBookmarks([entry("NCRS DLA 01 - Leg Swelling", VIDEO)], SGU_CURRICULUM).videos;
    const owner = video.candidates[0];
    const rows = ["Week 1", "Week 2"].map((week, i) => ({
      id: String(i), path: `Term 4/PPM 500/NCRS/${week}`, label: "NCRS DLA 01",
      templateKey: "ncrs|dla|1", activity: "dla" as const,
    }));
    expect(bookmarkActivityCandidates(video, owner, rows)).toHaveLength(2);
    expect(bookmarkActivityCandidates({ ...video, activityNumber: undefined }, owner, rows)).toEqual([]);
    expect(bookmarkActivityCandidates(video, { ...owner, key: "term5/ppm501/goer" }, rows)).toEqual([]);
  });

  it("rejects oversized user exports instead of parsing unbounded bookmark bodies", () => {
    expect(() => parseBookmarkHtml(" ".repeat(6_000_001))).toThrow(/6 MB/);
    const malformed = "<script>alert('unexpected execution')</script><A href='data:text/html,attack'>bad</A>";
    expect(indexAcademicBookmarks(parseBookmarkHtml(malformed), SGU_CURRICULUM).videos).toEqual([]);
  });
});
