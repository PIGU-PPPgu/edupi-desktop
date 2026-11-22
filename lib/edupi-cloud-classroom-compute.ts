import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { activeBridgeIdentity } from "./edupi-bridge-manifest";
import { resolveEduPiCoreRoot } from "./edupi-core-root";
import type { ClassroomDomain, ClassroomInput, ClassroomReply, ClassroomStudent } from "./edupi-classroom-types";

export type CloudClassroomRoster = ClassroomStudent & { revision: number; profile_revision: number };
export type CloudClassroomReference = { id: string; domain: string; revision: number; input: Record<string, unknown>; result: Record<string, unknown> };
export type CloudClassroomComputed = {
  core_commit: string; roster: CloudClassroomRoster[]; references: CloudClassroomReference[];
  source_input: ClassroomInput; input: ClassroomInput; result: Record<string, unknown> | null; issues: unknown[]; unresolved?: unknown[];
};

/** Only the pinned pure engines run here. No Core store, runtime or teacher root
 * is opened; the child has read permission for code and no filesystem writes. */
export async function computeCloudClassroom(
  domain: ClassroomDomain, input: ClassroomInput, roster: CloudClassroomRoster[],
  references: CloudClassroomReference[] = [], signal?: AbortSignal,
): Promise<CloudClassroomComputed> {
  signal?.throwIfAborted();
  const identity = activeBridgeIdentity().runtime;
  const configured = process.env.EDUPI_CORE_ROOT;
  if (!configured) throw new Error("EDUPI_CORE_ROOT 未配置，不能计算云端班级方案。");
  const runtime = resolveEduPiCoreRoot({
    configuredRoot: configured, allowedRoot: process.env.EDUPI_CORE_ALLOWED_ROOT || dirname(configured),
    runtimeIdentity: identity, validationMode: process.env.EDUPI_CORE_VALIDATION_MODE === "bundled" ? "bundled" : "external",
  });
  if (!["grades", "seating", "duty"].includes(domain) || !input || typeof input !== "object") throw new Error("班级输入无效。");
  if (typeof input.title !== "string" || !input.title.trim() || input.title.length > 160
    || typeof input.class_name !== "string" || !input.class_name.trim() || input.class_name.length > 160) {
    throw new Error("请填写名称并选择班级。");
  }
  const selected = new Map(roster.map(student => [student.student_id, student]));
  if (selected.size !== roster.length || roster.length > 500) throw new Error("云端学生身份不唯一。");
  const check = (id: unknown) => {
    const student = typeof id === "string" ? selected.get(id) : undefined;
    if (!student || student.class_name !== input.class_name) throw new Error("参与学生必须来自当前云端班级的学生 ID。");
    return student;
  };
  const normalized = structuredClone(input);
  if (domain === "grades") {
    const grade = normalized as Extract<ClassroomInput, { subjects: unknown }>;
    if (!Array.isArray(grade.rows)) throw new Error("请提供带云端学生 ID 的成绩行。");
    for (const row of grade.rows) {
      const student = check(row.student_id);
      row.name = student.name;
      row.class_name = student.class_name;
    }
  } else {
    const plan = normalized as Extract<ClassroomInput, { student_ids: unknown }>;
    if (!Array.isArray(plan.student_ids)) throw new Error("请选择云端学生。");
    plan.student_ids.forEach(check);
    for (const id of Object.keys(plan.features || {})) check(id);
  }
  for (const reference of references) {
    if (reference.domain !== "grades" || reference.input.class_name !== input.class_name
      || !Number.isSafeInteger(reference.revision) || reference.revision < 1) throw new Error("引用考试身份无效。");
    for (const row of Array.isArray(reference.input.rows) ? reference.input.rows : []) check(row.student_id);
  }
  const filename = { grades: "grade", seating: "seating", duty: "duty" }[domain];
  const exported = { grades: "computeGrades", seating: "computeSeating", duty: "computeDuty" }[domain];
  const moduleURL = pathToFileURL(join(runtime.root, "scripts", "classroom", `${filename}.mjs`)).href;
  const code = `
    import { ${exported} as compute } from ${JSON.stringify(moduleURL)};
    let raw = ""; for await (const chunk of process.stdin) { raw += chunk; if (raw.length > 2097152) throw Error("input_limit"); }
    const { input, roster, context } = JSON.parse(raw);
    process.stdout.write(JSON.stringify(compute(input, roster, context)));
  `;
  const directory = await mkdtemp(join(tmpdir(), "edupi-cloud-classroom-"));
  try {
    const output = await new Promise<ClassroomReply>((resolve, reject) => {
      const child = spawn(process.execPath, ["--permission", `--allow-fs-read=${runtime.root}`, "--input-type=module", "-e", code], {
        cwd: directory, shell: false, env: { PATH: process.env.PATH, NODE_ENV: "production", LANG: "en_US.UTF-8", TZ: "Asia/Shanghai" },
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "", bytes = 0;
      const stop = (error: Error) => { child.kill("SIGKILL"); reject(error); };
      const timer = setTimeout(() => stop(new Error("班级计算超时，未保存方案。")), 15_000);
      const abort = () => stop(new Error("班级计算已取消。"));
      signal?.addEventListener("abort", abort, { once: true });
      child.stdout.on("data", chunk => { bytes += chunk.length; if (bytes > 4 * 1024 * 1024) stop(new Error("计算结果过大。")); else stdout += chunk; });
      child.stderr.resume();
      child.on("error", stop);
      child.on("close", status => {
        clearTimeout(timer); signal?.removeEventListener("abort", abort);
        if (status !== 0) return reject(new Error("Core 班级计算未完成，未保存方案。"));
        try { resolve(JSON.parse(stdout)); } catch { reject(new Error("Core 计算返回了无效结果。")); }
      });
      child.stdin.on("error", () => {});
      child.stdin.end(JSON.stringify({ input: normalized, roster, context: {
        baseline: references.find(item => item.id === ("baseline_id" in input ? input.baseline_id : undefined)),
        exam: references.find(item => item.id === ("exam_id" in input ? input.exam_id : undefined)),
      } }));
      if (signal?.aborted) abort();
    });
    if (!output.input || !Array.isArray(output.issues) || output.result !== null && (!output.result || typeof output.result !== "object")) {
      throw new Error("Core 计算结果格式无效。");
    }
    return { core_commit: runtime.coreCommit, roster: structuredClone(roster), references: structuredClone(references),
      source_input: normalized, input: output.input, result: output.result as Record<string, unknown> | null, issues: output.issues,
      ...(output.unresolved ? { unresolved: output.unresolved } : {}) };
  } finally { await rm(directory, { recursive: true, force: true }); }
}
