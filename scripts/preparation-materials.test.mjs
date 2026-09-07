import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import crypto from "node:crypto";
import JSZip from "jszip";
import { preparationMaterials, preparationClassContext } from "../desktop/preparation-materials.mjs";

test("preparation reads referenced material bodies rather than titles", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "edupi-prep-material-"));
  const root = path.join(temp,"data");
  try {
    await mkdir(path.join(root,".edupi/output"),{recursive:true});
    await writeFile(path.join(root,"lesson.md"),"# 教学重点\n移项时需检验等式两边。");
    await writeFile(path.join(root,"other.md"),"不相关材料");
    await writeFile(path.join(root,".edupi/output/material_candidates.json"),JSON.stringify({entries:[{id:"lesson",title:"教学材料",file_path:"lesson.md"},{id:"other",title:"其他",file_path:"other.md"}]}));
    const evidence = `material_${crypto.createHash("sha256").update("lesson").digest("hex").slice(0,32)}`;
    const result = await preparationMaterials(root,{evidence_ids:[evidence]});
    assert.equal(result.length,1);
    assert.match(result[0].text,/检验等式两边/);
    assert.equal(result[0].truncated,false);
    assert.deepEqual(await preparationMaterials(root,{evidence_ids:[]}),[]);
    await mkdir(path.join(root,".edupi/memory"),{recursive:true});
    await writeFile(path.join(root,".edupi/memory/timetable.json"),JSON.stringify({slots:[{id:"slot",subject:"数学",class_name:"703"}]}));
    assert.equal((await preparationClassContext(root,{evidence_ids:["slot"]},[{student_id:"a",class_name:"703"},{student_id:"b",class_name:"704"}])).registeredStudentCount,1);
    assert.equal((await preparationClassContext(root,{evidence_ids:["slot"]},[])).registeredStudentCount,0);
    assert.equal(await preparationClassContext(root,{evidence_ids:[]},[]),null);
    await writeFile(path.join(root,"lesson.md"),"字".repeat(13000));
    const bounded = await preparationMaterials(root,{material_id:"lesson"});
    assert.equal(bounded[0].text.length,12000); assert.equal(bounded[0].truncated,true);
  } finally { await rm(temp,{recursive:true,force:true}); }
});
test("referenced paths cannot escape the configured workspace", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "edupi-prep-scope-"));
  const root = path.join(temp,"data");
  try {
    await mkdir(path.join(root,".edupi/output"),{recursive:true});
    await writeFile(path.join(temp,"outside.md"),"outside");
    await symlink(path.join(temp,"outside.md"),path.join(root,"linked.md"));
    await writeFile(path.join(root,".edupi/output/material_candidates.json"),JSON.stringify({entries:[{id:"a",title:"a",file_path:"linked.md"}]}));
    const result = await preparationMaterials(root,{material_id:"a"});
    assert.equal(result[0].text,undefined); assert.equal(result[0].unavailable,"材料无法读取");
  } finally { await rm(temp,{recursive:true,force:true}); }
});
test("Word source is extracted into readable preparation content", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "edupi-prep-word-"));
  try {
    await mkdir(path.join(temp,".edupi/output"),{recursive:true});
    const zip = new JSZip();
    zip.file("[Content_Types].xml",'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    zip.file("_rels/.rels",'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    zip.file("word/document.xml",'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>使用橙色方格纸进行折叠验证。</w:t></w:r></w:p></w:body></w:document>');
    await writeFile(path.join(temp,"lesson.docx"),await zip.generateAsync({type:"nodebuffer"}));
    await writeFile(path.join(temp,".edupi/output/material_candidates.json"),JSON.stringify({entries:[{id:"word",title:"课前材料",file_path:"lesson.docx"}]}));
    const result = await preparationMaterials(temp,{material_id:"word"});
    assert.match(result[0].text,/橙色方格纸/);
  } finally { await rm(temp,{recursive:true,force:true}); }
});
