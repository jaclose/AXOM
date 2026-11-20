import { describe, expect, it } from "vitest";
import { containsPrivateCommunityEmail, containsPrivateCommunityPhone, containsUnverifiedCommunityAttestation, containsUnverifiedCommunityCitation, isCommunitySubjectKeyword, mergeReviewedCommunityKeywords } from "./communityReviewedKeywords";

describe("explicitly reviewed Community AI keywords", () => {
  it("preserves authored tags and adds only canonical, unique reviewed keywords", () => {
    const authored = ["Anatomy", "tunica media"];
    const result = mergeReviewedCommunityKeywords(authored, "Tunica media; Vascular  Smooth Muscle, histology, HISTOLOGY");
    expect(result).toEqual(["Anatomy", "tunica media", "vascular smooth muscle", "histology"]);
    expect(authored).toEqual(["Anatomy", "tunica media"]);
  });

  it("rejects overlong or excessive proposals instead of silently truncating or dropping tags", () => {
    expect(() => mergeReviewedCommunityKeywords([], "x".repeat(65))).toThrow(/64 characters/);
    expect(() => mergeReviewedCommunityKeywords([], Array(9).fill("keyword").join(","))).toThrow(/eight/);
    expect(() => mergeReviewedCommunityKeywords(Array.from({ length: 100 }, (_, i) => `tag-${i}`), "new tag"))
      .toThrow(/maximum 100/);
  });

  it("allows a full question's existing tags to remain unchanged when all reviewed proposals are duplicates", () => {
    const original = Array.from({ length: 100 }, (_, i) => `tag-${i}`);
    expect(mergeReviewedCommunityKeywords(original, "tag-1")).toEqual(original);
    expect(mergeReviewedCommunityKeywords(original, " ")).toEqual(original);
  });
  it.each([
    "visual:intent:histology",
    "rights:approved",
    "source:reviewed",
    "license:cc-by",
    "moderation:approved",
    "answer-key:verified",
    "https://example.edu/article",
    "Arterial reference https://example.edu/case",
    "https://example.edu/case?token=DEMO_NOT_SECRET",
  ])("rejects reserved publication metadata and citation references (%s)", keyword => {
    expect(() => mergeReviewedCommunityKeywords(["original"], keyword))
      .toThrow(/subject phrases.*publication metadata/i);
  });

  it.each([
    ["zero-width rights attestation", "rig\u200Bhts:approved"],
    ["word-joiner source review", "source\u2060:reviewed"],
    ["zero-width visual-intent claim", "visual\u200D:intent:histology"],
    ["bidi-hidden moderation claim", "moderation\u202E:approved"],
    ["fullwidth rights attestation", "ＲＩＧＨＴＳ：approved"],
    ["zero-width web citation", "https\u200B://example.edu/clinical"],
    ["fullwidth web citation", "ｈｔｔｐｓ：／／example.edu/clinical"],
    ["hidden private file URI", "file\u200B:///Users/student/private.pdf"],
    ["deprecated bidi hidden rights claim", "rights\u206A:approved"],
    ["Arabic letter mark hidden source claim", "source\u061C:reviewed"],
    ["deprecated bidi only subject tag", "\u206A"],

    ["invisible-only subject tag", "\u200B\uFEFF"],
  ])("rejects unicode-disguised publication evidence or reference: %s", (_label, keyword) => {
    const authored = ["original", "rights:reviewed"];
    expect(() => mergeReviewedCommunityKeywords(authored, keyword))
      .toThrow(/subject phrases.*publication metadata/i);
    expect(authored).toEqual(["original", "rights:reviewed"]);
  });

  it("preserves legitimate clinical and non-Latin subject phrases with joining marks", () => {
    expect(mergeReviewedCommunityKeywords(["author"], "CD4/CD8, بافت\u200Cشناسی"))
      .toEqual(["author", "cd4/cd8", "بافت\u200Cشناسی"]);
  });

  it.each([
    ["scheme-less source domain", "Review example.edu/source"],
    ["www hostname", "www.example.org/arterial-case"],
    ["unlabeled DOI", "10.1234/artery.2026"],
    ["labeled DOI", "DOI: 10.1000/vascular.2026"],
    ["PubMed identifier", "PMID: 12345678"],
    ["PubMed Central identifier", "PMC1234567"],
    ["fullwidth DOI", "１０．１２３４／source"],
    ["zero-width obfuscated PMID", "PM\u200BID: 12345678"],
    ["joiner-disguised PMID", "PM\u200DID: 12345678"],
    ["word-joiner DOI", "10.1234\u2060/arterial-study"],
    ["deprecated bidi hidden DOI", "10.1234\u206A/arterial-study"],
  ])("keeps a proposed %s out of reviewed subject keywords", (_label, keyword) => {
    const authored = ["histology", "source:reviewed"];
    expect(() => mergeReviewedCommunityKeywords(authored, keyword))
      .toThrow(/subject phrases.*citations/i);
    expect(authored).toEqual(["histology", "source:reviewed"]);
  });

  it.each([
    ["medical .health TLD", "Reviewed rationale https://reference.example.health/artery"],
    ["developer .dev TLD", "Citation https://research.example.dev/vessels"],
    ["fullwidth medical HTTPS URL", "Source ｈｔｔｐｓ：／／reference.example.health/artery"],
    ["zero-width split HTTPS scheme", "Source https\u200B://reference.example.health/artery"],
    ["an IP-hosted HTTP URL", "Source http://192.0.2.42/teaching"],
  ])("detects unverified AI citation links regardless of %s", (_label, value) => {
    expect(containsUnverifiedCommunityCitation(value)).toBe(true);
    expect(isCommunitySubjectKeyword(value)).toBe(false);
  });

  it.each([
    ["UTF-8 escaped fullwidth URL punctuation", "Reference https%EF%BC%9A%EF%BC%8F%EF%BC%8Fexample.health%2Fvessel"],
    ["percent-escaped URL", "Reference https%3A%2F%2Fexample.health%2Fvessel"],
    ["double percent-escaped URL", "Reference https%253A%252F%252Fexample.health%2Fvessel"],
    ["numeric HTML entity URL", "Reference https&#58;&#47;&#47;example.health/vessel"],
    ["named HTML entity URL", "Reference https&colon;&sol;&sol;example.health/vessel"],
    ["encoded PubMed identifier", "PM%49D%3A%2012345678"],
  ])("detects %s before generated citation or keyword publication", (_label, value) => {
    expect(containsUnverifiedCommunityCitation(value)).toBe(true);
    expect(isCommunitySubjectKeyword(value)).toBe(false);
    expect(() => mergeReviewedCommunityKeywords(["histology"], value))
      .toThrow(/subject phrases.*publication metadata/i);
  });

  it.each(["CD4/CD8", "E. coli", "10.2 kPa", "type 1 diabetes (autoimmune)"])(
    "does not mistake clinical notation for a generated URL citation: %s", value => {
      expect(containsUnverifiedCommunityCitation(value)).toBe(false);
    },
  );

  it("retains clinical shorthand and species names that are not source citations", () => {
    expect(mergeReviewedCommunityKeywords(["anatomy"], "CD4/CD8; E. coli; IL-10; 10.2 kPa"))
      .toEqual(["anatomy", "cd4/cd8", "e. coli", "il-10", "10.2 kpa"]);
  });

  it.each([
    ["semicolon-delimited rights claim", "vascular histology; rights:approved"],
    ["comma-delimited source claim", "histology, source:reviewed"],
    ["Unicode line-separated moderation claim", "vascular tone\u2028moderation:approved"],
    ["Unicode paragraph-separated approval claim", "anatomy\u2029approval:granted"],
    ["embedded line break", "histology\nsource:reviewed"],
    ["compound ordinary subject phrases", "histology; anatomy"],
  ])("rejects compound AI subject proposals before review: %s", (_label, term) => {
    expect(isCommunitySubjectKeyword(term)).toBe(false);
  });

  it.each([
    ["space-embedded rights claim", "vascular histology rights:approved"],
    ["parenthesized source claim", "tunica media (source:reviewed)"],
    ["dash-embedded licensing claim", "pathology-license:cc-by"],
    ["tab-separated moderation claim", "histology\tmoderation:approved"],
    ["vertical-tab source claim", "histology\u000bsource:reviewed"],
    ["record-separator rights claim", "histology\u001crights:approved"],
    ["DEL-separated approval claim", "histology\u007fapproval:granted"],
  ])("rejects embedded evidence or control-separated keyword claims: %s", (_label, term) => {
    expect(isCommunitySubjectKeyword(term)).toBe(false);
    expect(() => mergeReviewedCommunityKeywords(["original"], term))
      .toThrow(/subject phrases.*publication metadata/i);
  });

  it.each([
    "source evidence verified",
    "rights approved",
    "license cleared",
    "academic review completed",
    "answer-key confirmed",
    "approved for community publication",
    "reviewed by faculty",
    "rig\u200Bhts approved",
    "ＲＩＧＨＴＳ　ＡＰＰＲＯＶＥＤ",
  ])("holds unsupported approval claim in a proposed subject keyword (%s)", keyword => {
    const original = ["histology", "rights:reviewed"];
    expect(containsUnverifiedCommunityAttestation(keyword)).toBe(true);
    expect(isCommunitySubjectKeyword(keyword)).toBe(false);
    expect(() => mergeReviewedCommunityKeywords(original, keyword))
      .toThrow(/subject phrases.*publication metadata/i);
    expect(original).toEqual(["histology", "rights:reviewed"]);
  });

  it.each([
    ["UTF-8 escaped fullwidth colon", "rights%EF%BC%9Aapproved"],
    ["nested UTF-8 escaped fullwidth colon", "source%25EF%25BC%259Averified"],
    ["percent-escaped source status", "source%3Areviewed"],
    ["double-escaped rights status", "rights%253Aapproved"],
    ["numeric HTML source attestation", "source&#58;verified"],
    ["named HTML academic approval", "academic&nbsp;review&nbsp;completed"],
    ["percent-escaped natural language attestation", "rights%20approved"],
  ])("blocks %s in AI and publisher approval claims", (_label, value) => {
    expect(containsUnverifiedCommunityAttestation(value)).toBe(true);
    expect(isCommunitySubjectKeyword(value)).toBe(false);
    expect(() => mergeReviewedCommunityKeywords(["histology"], value))
      .toThrow(/subject phrases.*publication metadata/i);
  });

  it.each([
    ["entity semicolon in source metadata", "histology; source&#58;verified"],
    ["nested ampersand in rights approval", "anatomy, rights&amp;#58;approved"],
    ["entity semicolons in an unverified URL", "vessel physiology; https&#58;&#47;&#47;example.health/study"],
    ["named-entity academic status", "academic&nbsp;review&nbsp;completed; histology"],
  ])("preflights %s before splitting reviewed tags", (_label, input) => {
    const authored = ["vascular physiology"];
    expect(() => mergeReviewedCommunityKeywords(authored, input))
      .toThrow(/subject phrases.*publication metadata/i);
    expect(authored).toEqual(["vascular physiology"]);
  });

  it.each([
    ["escaped visual metadata", "visual%3Aintent%3Ahistology"],
    ["escaped license status", "license&colon;cc-by"],
    ["escaped nested moderation", "moderation%253Aapproved"],
    ["escaped subject separator", "histology%2Csource%3Areviewed"],
  ])("refuses encoded reserved keyword metadata: %s", (_label, value) => {
    expect(isCommunitySubjectKeyword(value)).toBe(false);
  });

  it.each([
    "caf%C3%A9%20au%20lait",
    "vascular%20smooth%20muscle",
    "10%20kPa",
    "E. coli",
    "right coronary artery",
  ])("retains benign clinical subject phrases containing encoded text (%s)", value => {
    expect(containsUnverifiedCommunityAttestation(value)).toBe(false);
    expect(containsUnverifiedCommunityCitation(value)).toBe(false);
    expect(isCommunitySubjectKeyword(value)).toBe(true);
  });

  it.each([
    "right coronary artery",
    "source of calcium",
    "systematic review",
    "histology: vessel layers",
    "CD4/CD8",
    "E. coli",
  ])("preserves an ordinary clinical subject, not approval evidence (%s)", keyword => {
    expect(containsUnverifiedCommunityAttestation(keyword)).toBe(false);
    expect(isCommunitySubjectKeyword(keyword)).toBe(true);
  });

  it.each([
    "professor@school.health",
    "fac\u200Bulty@school.museum",
    "ｆａｃｕｌｔｙ＠school.health",
    "contact number: +1 (865) 555-0199",
    "telephone: +44 20 7946 0958",
    "Call me at 865 555 0199",
    "ＰＨＯＮＥ：８６５５５５０１２４",
    "p\u200Bhone: 865-555-0124",
  ])("refuses a contact email or labeled telephone in a public reviewed keyword: %s", term => {
    const authored = ["histology", "rights:reviewed"];
    expect(isCommunitySubjectKeyword(term)).toBe(false);
    expect(() => mergeReviewedCommunityKeywords(authored, term))
      .toThrow(/publication metadata, citations or private references/i);
    expect(authored).toEqual(["histology", "rights:reviewed"]);
  });

  it.each([
    ["UTF-8 escaped fullwidth at sign", "lecturer%EF%BC%A0school.health"],
    ["nested UTF-8 escaped fullwidth at sign", "lecturer%25EF%25BC%25A0school.health"],
    ["UTF-8 escaped fullwidth domain dot", "lecturer%40school%EF%BC%8Ehealth"],
    ["malformed neighboring UTF-8 byte", "lecturer%FF%EF%BC%A0school.health"],
    ["plain source-query email", "https://example.edu/paper?q=lecturer@school.health"],
    ["percent-encoded at sign", "https://example.edu/paper?q=lecturer%40school.health"],
    ["percent-encoded dot", "https://example.edu/paper?q=lecturer%40school%2Ehealth"],
    ["doubly encoded contact", "https://example.edu/paper?q=lecturer%2540school%252Ehealth"],
    ["triply encoded contact", "https://example.edu/paper?q=lecturer%252540school.health"],
    ["malformed neighboring escape", "https://example.edu/paper?q=lecturer%40school.health%ZZ"],
    ["fullwidth and escaped contact", "ｌｅｃｔｕｒｅｒ％４０school.health"],
  ])("rejects a source/contact email concealed in %s", (_label, value) => {
    expect(containsPrivateCommunityEmail(value)).toBe(true);
  });

  it.each([
    ["decimal numeric email", "lecturer&#64;school.edu"],
    ["hex-encoded email and domain dot", "lecturer&#x40;school&#46;edu"],
    ["named HTML email entities", "lecturer&commat;school&period;edu"],
    ["nested HTML ampersand", "lecturer&amp;#64;school.edu"],
    ["percent-escaped numeric entity", "lecturer%26%2364%3Bschool.edu"],
  ])("rejects a public email hidden with %s", (_label, value) => {
    expect(containsPrivateCommunityEmail(value)).toBe(true);
    expect(isCommunitySubjectKeyword(value)).toBe(false);
  });

  it.each([
    ["numeric-escaped contact prefix", "Call&#32;me&#32;at&#32;&#43;1&#32;(865)&#32;555-0199"],
    ["named-entity phone label", "Phone&colon;&nbsp;(865)&nbsp;555-0199"],
  ])("rejects a public phone hidden with %s", (_label, value) => {
    expect(containsPrivateCommunityPhone(value)).toBe(true);
    expect(isCommunitySubjectKeyword(value)).toBe(false);
  });

  it.each([
    "https://example.edu/case?ref=alpha&amp;beta=gamma",
    "A&amp;B receptor signaling",
    "Blood pressure 120&#47;80 mmHg",
  ])("preserves clinical notation and public citations containing safe HTML entities: %s", value => {
    expect(containsPrivateCommunityEmail(value)).toBe(false);
    expect(containsPrivateCommunityPhone(value)).toBe(false);
  });

  it.each([
    "Phone%EF%BC%9A%20%2B1%20865-555-0199",
    "phone%3A%20%2B1%20%28865%29%20555-0199",
    "Call%2520me%2520at%2520865-555-0199",
  ])("rejects a percent-encoded labeled contact telephone: %s", value => {
    expect(containsPrivateCommunityPhone(value)).toBe(true);
  });

  it.each([
    "https://example.edu/paper?term=alpha%3Abeta&name=%C3%A9tude",
    "https://example.edu/@editor/chapter",
    "https://example.edu/paper#author@university",
    "Call 911 for anaphylaxis",
    "CD4/CD8 blood pressure 120/80 mmHg",
  ])("preserves public citations and benign clinical notation without contact details: %s", value => {
    expect(containsPrivateCommunityEmail(value)).toBe(false);
    expect(containsPrivateCommunityPhone(value)).toBe(false);
  });

  it.each([
    "CD4/CD8: T cell subsets",
    "HLA-B27 and A@B notation",
    "E. coli",
    "Call 911 in anaphylaxis",
    "contact dermatitis type IV",
    "cell: 10.2 kPa",
    "blood pressure 120/80 mmHg",
    "histology arterial media",
  ])("retains clinical subject tags without private contact cues: %s", term => {
    expect(isCommunitySubjectKeyword(term)).toBe(true);
  });

  it("keeps normal clinical phrases with punctuation and joining marks", () => {
    expect(isCommunitySubjectKeyword("type 1 diabetes (autoimmune)")).toBe(true);
    expect(isCommunitySubjectKeyword("histology: vessel layers")).toBe(true);
    expect(isCommunitySubjectKeyword("CD4/CD8: T cell subsets")).toBe(true);
    expect(isCommunitySubjectKeyword("بافت\u200Cشناسی")).toBe(true);
  });

  it.each(["arterial histology", "CD4/CD8", "E. coli", "بافت\u200Cشناسی"])(
    "retains a single legitimate subject phrase: %s", term => {
      expect(isCommunitySubjectKeyword(term)).toBe(true);
    },
  );

  it("preserves existing legacy metadata without letting AI proposals create more", () => {
    const original = ["visual:intent:anatomy", "rights:reviewed", "CD4/CD8"];
    expect(mergeReviewedCommunityKeywords(original, "Histology: vessel layers, CD4/CD8"))
      .toEqual([...original, "histology: vessel layers"]);
    expect(original).toEqual(["visual:intent:anatomy", "rights:reviewed", "CD4/CD8"]);
  });


});
