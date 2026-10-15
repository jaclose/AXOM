import { describe,expect,it } from "vitest";
import { parsePdfImagesList } from "./sourceMediaInventory.mjs";
describe("PDF source raster inventory metadata only",()=>{
 it("counts image objects independently of alpha masks and keeps original page numbers",()=>{
  const value=[
   "page   num  type   width height color comp bpc  enc interp  object ID x-ppi y-ppi size ratio",
   "--------------------------------------------------------------------------------------------",
   "   3     0 image    368   365  rgb     3   8  jpeg   no     38  0    96    96 22.2K 5.6%",
   "   3     1 smask    368   365  gray    1   8  image  no     39  0    96    96 5K 2%",
   "   9     0 image   1200   800  rgb     3   8  jpeg   no     43  0   220   220 40.5K 3%",
  ].join("\n");
  const parsed=parsePdfImagesList(value,12);
  expect(parsed.embeddedRasterImageObjects).toBe(2);
  expect(parsed.auxiliaryMaskObjects).toBe(1);
  expect(parsed.pageNumbersWithRasterImages).toEqual([3,9]);
  expect(parsed.maxImageWidth).toBe(1200);
  expect(parsed.questionImageAssociationsConfirmed).toBe(0);
  expect(parsed.visualVectorFiguresNotEnumerated).toBe(true);
 });
 it("does not count impossible page/image values or pretend absence of images proves no visual figures",()=>{
  const parsed=parsePdfImagesList("header\n-----\n42 0 image 100 120 rgb 3 8 jpeg no 3 0\n1 0 image 0 100 rgb\n",5);
  expect(parsed.pageNumbersWithRasterImages).toEqual([]);
  expect(parsed.embeddedRasterImageObjects).toBe(0);
  expect(parsed.visualVectorFiguresNotEnumerated).toBe(true);
 });
});
