// Local, metadata-only embedded raster inventory for academic PDFs.
// Does not extract, duplicate or expose any image bytes or source wording.
import { execFileSync } from "node:child_process";

export function parsePdfImagesList(text, totalPages) {
  const items=[];
  const lines=text.split(/\r?\n/).slice(2);
  for(const row of lines){
    const fields=row.trim().split(/\s+/);
    if(fields.length<6)continue;
    const [pageText,numberText,kind,widthText,heightText]=fields;
    const [page,index,width,height]=[pageText,numberText,widthText,heightText].map(Number);
    if(!Number.isSafeInteger(page)||page<1||totalPages>0&&page>totalPages
      ||!Number.isSafeInteger(index)||index<0||!Number.isSafeInteger(width)||width<1
      ||!Number.isSafeInteger(height)||height<1)continue;
    if(!["image","smask","mask","stencil"].includes(kind))continue;
    items.push({page,index,kind,width,height});
  }
  const imageObjects=items.filter(item=>item.kind==="image").length;
  const auxiliaryMasks=items.length-imageObjects;
  return {
    complete:true,
    embeddedRasterImageObjects:imageObjects,
    auxiliaryMaskObjects:auxiliaryMasks,
    pageNumbersWithRasterImages:[...new Set(items.filter(item=>item.kind==="image").map(item=>item.page))].sort((a,b)=>a-b),
    maxImageWidth:Math.max(0,...items.filter(item=>item.kind==="image").map(item=>item.width)),
    maxImageHeight:Math.max(0,...items.filter(item=>item.kind==="image").map(item=>item.height)),
    questionImageAssociationsConfirmed:0,
    visualVectorFiguresNotEnumerated:true,
  };
}
export function inventoryPdfRasterObjects(filename, totalPages) {
  try{
    const result=execFileSync("pdfimages",["-list",filename],{
      timeout:20_000,maxBuffer:1024*1024,encoding:"utf8",
    });
    return parsePdfImagesList(result,totalPages);
  }catch(error){
    return {
      complete:false,embeddedRasterImageObjects:0,auxiliaryMaskObjects:0,
      pageNumbersWithRasterImages:[],questionImageAssociationsConfirmed:0,
      visualVectorFiguresNotEnumerated:true,
      reason:error instanceof Error?error.message.slice(0,140):"Raster inventory unavailable.",
    };
  }
}
