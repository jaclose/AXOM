/** Node-only academic PDF raster metadata — never question/image correctness proof.
 * Declaration matches sourceMediaInventory.mjs without duplicating parsing logic. */
export interface PdfSourceRasterInventory {
  complete: boolean;
  embeddedRasterImageObjects: number;
  auxiliaryMaskObjects: number;
  pageNumbersWithRasterImages: number[];
  questionImageAssociationsConfirmed: 0;
  visualVectorFiguresNotEnumerated: true;
  maxImageWidth?: number;
  maxImageHeight?: number;
  reason?: string;
}
export function parsePdfImagesList(
  text: string,
  totalPages: number,
): PdfSourceRasterInventory & {
  complete: true;
  maxImageWidth: number;
  maxImageHeight: number;
};
export function inventoryPdfRasterObjects(
  filename: string,
  totalPages: number,
): PdfSourceRasterInventory;
