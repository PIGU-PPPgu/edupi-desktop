import JSZip from "jszip";
import { DOMParser } from "@xmldom/xmldom";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { validateOfficeArchive } from "./office-archive.mjs";

const execFileAsync = promisify(execFile);
const parseXml = text => new DOMParser({ errorHandler: { warning() {}, error() { throw new Error("Invalid Office XML"); }, fatalError() { throw new Error("Invalid Office XML"); } } }).parseFromString(text, "text/xml");

export async function presentationText(bytes) {
  validateOfficeArchive(bytes);
  const zip = await JSZip.loadAsync(bytes);
  const read = async name => { const file = zip.file(name); if (!file) throw new Error("Missing presentation part"); return parseXml(await file.async("string")); };
  const presentation = await read("ppt/presentation.xml");
  const relationships = await read("ppt/_rels/presentation.xml.rels");
  const targets = new Map(Array.from(relationships.getElementsByTagNameNS("*", "Relationship")).filter(item => item.getAttribute("TargetMode") !== "External").map(item => [item.getAttribute("Id"), item.getAttribute("Target")]));
  const pages = Array.from(presentation.getElementsByTagNameNS("*", "sldId"));
  let text = "";
  for (const [index, page] of pages.entries()) {
    const id = Array.from(page.attributes).find(attribute => attribute.localName === "id" && attribute.namespaceURI)?.value;
    const target = targets.get(id);
    if (!target) throw new Error("Missing slide reference");
    const name = target.startsWith("/") ? target.slice(1) : path.posix.normalize(`ppt/${target}`);
    const slide = await read(name);
    const paragraphs = Array.from(slide.getElementsByTagNameNS("*", "p")).map(paragraph => Array.from(paragraph.getElementsByTagNameNS("*", "t")).map(run => run.textContent || "").join("")).filter(Boolean);
    if (paragraphs.length) text += `第${index + 1}页\n${paragraphs.join("\n")}\n`;
    if (text.length > 12000) break;
  }
  return text;
}

export async function pdfText(bytes) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "edupi-preparation-pdf-"));
  try {
    const file = path.join(directory,"source.pdf");
    await writeFile(file,bytes,{mode:0o600});
    const {stdout} = await execFileAsync("pdftotext",["-layout","-enc","UTF-8",file,"-"],{encoding:"utf8",timeout:20000,maxBuffer:2*1024*1024});
    return stdout;
  } finally { await rm(directory,{recursive:true,force:true}); }
}
