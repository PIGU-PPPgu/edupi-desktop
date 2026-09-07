import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import PptxGenJS from "../vendor/pptxgenjs/pptxgen.cjs";
import { presentationText, pdfText } from "../desktop/preparation-source-text.mjs";

test("PPT reads text in presentation order and decodes XML entities", async () => {
  const ppt = new PptxGenJS();
  ppt.addSlide().addText("先圈 & 再折",{x:1,y:1,w:4,h:1});
  ppt.addSlide().addText("绿色方格纸",{x:1,y:1,w:4,h:1});
  const bytes = await ppt.write({outputType:"nodebuffer"});
  assert.match(await presentationText(bytes),/第1页\n先圈 & 再折\n第2页\n绿色方格纸/);
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file("ppt/presentation.xml").async("string");
  const slides = xml.match(/<p:sldId\s[^>]+\/>/g);
  zip.file("ppt/presentation.xml",xml.replace(slides.join(""),slides.reverse().join("")));
  assert.match(await presentationText(await zip.generateAsync({type:"nodebuffer"})),/第1页\n绿色方格纸\n第2页\n先圈 & 再折/);
  await assert.rejects(()=>presentationText(Buffer.from("invalid")));
});

test("PDF text extraction uses actual PDF bytes", async t => {
  const stream="BT /F1 12 Tf 72 720 Td (Green grid paper) Tj ET";
  const objects=["<< /Type /Catalog /Pages 2 0 R >>","<< /Type /Pages /Kids [3 0 R] /Count 1 >>","<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>","<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let pdf="%PDF-1.4\n"; const offsets=[0];
  objects.forEach((object,index)=>{offsets.push(Buffer.byteLength(pdf));pdf+=`${index+1} 0 obj\n${object}\nendobj\n`;});
  const xref=Buffer.byteLength(pdf);
  pdf+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset=>String(offset).padStart(10,"0")+" 00000 n \n").join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  try { assert.match(await pdfText(Buffer.from(pdf)),/Green grid paper/); }
  catch(error){if(error.code==="ENOENT")t.skip("pdftotext unavailable on this host");else throw error;}
});
