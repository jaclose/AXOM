// ===========================================================================
// Browser only: a tagged PDF file into package questions and the picture
// files they name. Reads the file with pdf.js, converts it, then draws each
// page that has a picture once and cuts the pictures out of that drawing.
//
// A file with no structure tags is not read here: the caller falls back to
// the existing PDF import (`pdfToQuestions`).
// ===========================================================================
import browserPdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { describeAssets } from "../assets";
import { loadTaggedPdf } from "./loadTaggedPdf";
import type { PdfConversionDefaults } from "./pdfToQuestions";
import { planRenders } from "./renderPlan";
import { readTaggedPage } from "./taggedPdf";
import { taggedPdfToQuestions, type RenderRequest, type TaggedConversion } from "./taggedPdfToQuestions";

type PdfJs = typeof import("pdfjs-dist");

export type TaggedPdfImport =
  | { tagged: false; creator?: string }
  | (TaggedConversion & {
      tagged: true;
      creator?: string;
      slides: boolean;
      /** One file for each picture a question names, under the asset's file name. */
      files: File[];
      /** Pictures that could not be drawn, in plain words. */
      warnings: string[];
    });

/** Draws each page once and cuts its pictures out. Returns PNG bytes by asset id. */
export async function drawPictures(pdfjs: PdfJs, data: Uint8Array, renders: ReadonlyMap<string, RenderRequest>): Promise<{ pictures: Map<string, Uint8Array>; warnings: string[] }> {
  const pictures = new Map<string, Uint8Array>();
  const warnings: string[] = [];
  if (renders.size === 0) return { pictures, warnings };
  const task = pdfjs.getDocument({ data });
  const doc = await task.promise;
  try {
    const sizes = new Map<number, { width: number; height: number }>();
    for (const page of new Set([...renders.values()].map((request) => request.page))) {
      const viewport = (await doc.getPage(page)).getViewport({ scale: 1 });
      sizes.set(page, { width: viewport.width, height: viewport.height });
    }
    for (const plan of planRenders(renders, sizes)) {
      const page = await doc.getPage(plan.page);
      const viewport = page.getViewport({ scale: plan.scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext("2d");
      if (!context) {
        warnings.push(`Page ${plan.page}: this browser could not draw the page, so its pictures were not cut out.`);
        continue;
      }
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      for (const cut of plan.cuts) {
        const piece = document.createElement("canvas");
        piece.width = Math.min(cut.width, canvas.width - cut.left);
        piece.height = Math.min(cut.height, canvas.height - cut.top);
        piece.getContext("2d")?.drawImage(canvas, cut.left, cut.top, piece.width, piece.height, 0, 0, piece.width, piece.height);
        const blob = await new Promise<Blob | null>((resolve) => piece.toBlob(resolve, "image/png"));
        if (blob) pictures.set(cut.assetId, new Uint8Array(await blob.arrayBuffer()));
        else warnings.push(`Page ${plan.page}: one picture could not be saved.`);
      }
      // Give the page's pixels back at once: a deck can have dozens of these.
      canvas.width = 0;
      canvas.height = 0;
    }
  } finally {
    await doc.cleanup();
    await task.destroy();
  }
  return { pictures, warnings };
}

export async function taggedPdfFileToQuestions(buffer: ArrayBuffer, defaults: PdfConversionDefaults): Promise<TaggedPdfImport> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = browserPdfWorkerUrl;
  // pdf.js takes the bytes it is given, so each opening of the file gets its own copy.
  const loaded = await loadTaggedPdf(pdfjs, new Uint8Array(buffer.slice(0)));
  if (!loaded.tagged) return { tagged: false, ...(loaded.creator ? { creator: loaded.creator } : {}) };
  const converted = taggedPdfToQuestions({ pages: loaded.pages.map(readTaggedPage) }, defaults);
  const { pictures, warnings } = await drawPictures(pdfjs, new Uint8Array(buffer.slice(0)), converted.renders);
  // Each asset takes the size, weight and checksum of the picture that was drawn for it.
  const named = await describeAssets(converted.questions, (asset) => pictures.get(asset.id));
  const files = [...named.entries()].map(([name, bytes]) => new File([bytes as BlobPart], name, { type: "image/png" }));
  return { ...converted, tagged: true, slides: loaded.slides, ...(loaded.creator ? { creator: loaded.creator } : {}), files, warnings };
}
