import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export async function preparationClassContext(root, candidate) {
  const read = async name => { try { return JSON.parse(await readFile(path.join(root,".edupi/memory",name),"utf8")); } catch (error) { if (error.code === "ENOENT") return null; throw error; } };
  const timetable = await read("timetable.json");
  const ids = new Set(candidate.evidence_ids || []);
  const slots = (timetable?.slots || []).filter(slot => ids.has(slot.id || slot.slot_id));
  if (slots.length !== 1) return null;
  const slot = slots[0];
  const profiles = await read("student_profiles.json");
  let deleted;
  try { deleted = JSON.parse(await readFile(path.join(root,".edupi/output/entity_delete_state.json"),"utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const deletedStudents = new Set((deleted?.records || []).filter(item => item.target_kind === "student").map(item => item.target_id));
  const count = profiles ? Object.entries(profiles.students || {}).filter(([name, student]) => !deletedStudents.has(name) && student.class_name === slot.class_name).length : null;
  return { subject: slot.subject, className: slot.class_name, registeredStudentCount: count, note: "已登记人数仅表示系统中的档案数量，不等于全班实际人数；未提供的资料不能断言不存在。" };
}

export async function preparationMaterials(root, candidate) {
  const canonicalRoot = await realpath(root);
  let entries;
  try { entries = JSON.parse(await readFile(path.join(root, ".edupi/output/material_candidates.json"), "utf8")).entries; }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
  const evidence = new Set(candidate.evidence_ids || []);
  const selected = (Array.isArray(entries) ? entries : []).filter(item => candidate.material_id === item.id || evidence.has(`material_${crypto.createHash("sha256").update(String(item.id)).digest("hex").slice(0,32)}`)).slice(0,5);
  return Promise.all(selected.map(async item => {
    const source = { id: item.id, title: item.title, path: item.file_path };
    try {
      if (typeof item.file_path !== "string" || path.isAbsolute(item.file_path)) throw new Error("path");
      const file = await realpath(path.resolve(canonicalRoot, item.file_path));
      const relative = path.relative(canonicalRoot, file);
      if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("path");
      const info = await stat(file);
      if (!info.isFile() || info.size > 10 * 1024 * 1024) throw new Error("size");
      const bytes = await readFile(file);
      let text;
      const extension = path.extname(file).toLowerCase();
      if ([".md", ".txt", ".csv"].includes(extension)) text = bytes.toString("utf8");
      else if (extension === ".docx") {
        const mammoth = await import("mammoth");
        text = (await (mammoth.default || mammoth).extractRawText({ buffer: bytes })).value;
      } else return { ...source, unavailable: "此格式尚未提取正文" };
      return { ...source, text: text.slice(0,12000), truncated: text.length > 12000 };
    } catch { return { ...source, unavailable: "材料无法读取" }; }
  }));
}
