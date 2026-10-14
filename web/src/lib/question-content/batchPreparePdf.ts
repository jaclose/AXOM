// Headless pre-review conversion of ordinary PDF questions.
// Figures/tables that require image rendering are NOT invented or represented
// as already present. Source PDF bytes travel separately in the private bundle.
import { sha256 } from "./assets";
import { draftsToQuestions } from "./fromDrafts";
import { assessBank } from "./assessBank";
import { parsePdfQuestions } from "../pdfQuestionImport";
import type { ImportPackage, PackageIssue } from "./package";

export interface PdfPreparedReview {
  pkg: ImportPackage;
  issues: PackageIssue[];
  sha256: string;
  detected: number;
  needsReview: number;
  unresolved: number;
  verifiedReady: 0;
  sourcePages: number;
  pageMapped: number;
  notes: string[];
}

export async function prepareRawPdfForReview(input: {
  filename: string;
  originalBytes: Uint8Array;
  fullText: string;
  pageTexts: readonly string[];
  expectedSha256?: string;
}): Promise<PdfPreparedReview> {
  const checksum = await sha256(input.originalBytes);
  const sha = checksum.slice(7);
  if (input.expectedSha256 && input.expectedSha256.replace(/^sha256:/,"")!==sha)
    throw new Error("The PDF bytes changed since inventory. This source must be rescanned before processing.");
  if (input.fullText.length > 10_000_000 || input.pageTexts.length > 1200)
    throw new Error("This PDF exceeds bounded extraction capacity. Split it before import; no partial bank is prepared.");
  const bankId = "pdf-" + sha.slice(0,20);
  const parsed = parsePdfQuestions(input.fullText, [...input.pageTexts]);
  const ids = parsed.drafts.map((draft,index)=>bankId+"-q"+String(draft.questionNumber??index+1).padStart(3,"0")
    +"-p"+String(index+1).padStart(4,"0"));
  const converted = draftsToQuestions(parsed.drafts,{media:[]},{
    bankId,sourceFilename:input.filename,method:"pdf-import",ids,
  });
  for(const question of converted.questions){
    question.provenance.sourceChecksum=checksum;
    question.provenance.notes="Headless source conversion; extracted PDF text and source-page references only. Original PDF required for image/figure/table and answer checks.";
    question.flags=[...(question.flags??[]),{
      type:"media_association_uncertain",
      message:"Headless source conversion has not rendered or verified this PDF's figures, tables or answer-marked pages. Inspect the original source before scored practice.",
    }];
    if(question.correctAnswer){
      question.flags.push({type:"answer_needs_review",
        message:"A text-extracted answer label is not independently verified against this original PDF's answer evidence. Check the original or official key."});
    }
  }
  const pkg:ImportPackage={
    manifest:{
      schemaVersion:1,
      course:{name:"UNMAPPED",term:0,week:0},
      bank:{id:bankId,title:input.filename.replace(/\.[^.]+$/,""),discipline:"Imported PDF"},
      source:{filename:input.filename,sourceWeekDeclared:false},
      questionsFile:"questions.json",assetsDirectory:"assets/",
    },
    questions:converted.questions,
  };
  const assessed=assessBank(pkg,converted.issues,[]);
  return{
    pkg,issues:assessed.issues,sha256:sha,detected:parsed.drafts.length,
    needsReview:assessed.counts["needs-review"],unresolved:assessed.counts.unresolved,
    verifiedReady:0,sourcePages:input.pageTexts.length,
    pageMapped:converted.questions.filter(q=>q.source.page!==undefined).length,
    notes:[
      ...parsed.notes,
      ...(input.fullText.trim()?[]:["PDF is scanned or has no extractable text; original retained for manual/OCR review."]),
      "No figures were rendered during headless processing; all candidates require source-media and answer verification.",
    ],
  };
}
