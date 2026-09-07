import { resolveEduPiBridgeRoots } from "./edupi-core-snapshot";
import { runCoreProcess } from "./edupi-core-process-client";
import { generatedArtifactsRequest } from "./edupi-generated-artifacts";
import { readFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";

type Job = { job_id: string; title: string; instructions: string; status: string; job_type: string };
type JobResponse = { ok: boolean; job?: Job | null; projection: { jobs: Job[] } };
const shared = globalThis as typeof globalThis & { __edupiJobs?: Map<string, () => Promise<void>>; __edupiJobPump?: boolean };
const active = shared.__edupiJobs ||= new Map<string, () => Promise<void>>();

export async function backgroundJobRequest(action?: string, fields: Record<string, unknown> = {}) {
  const roots = resolveEduPiBridgeRoots();
  const result = await runCoreProcess<JobResponse>({ ...roots, timeoutMs: 10000, request: { protocol: "edupi-desktop-bridge", protocol_version: 1, producer: "edupi-desktop", request_id: crypto.randomUUID(), operation: "agent-computer", action, ...fields } });
  if (!result.ok) throw new Error("后台任务操作失败");
  return result;
}

export async function cancelBackgroundJob(id: string) {
  await active.get(id)?.();
  return backgroundJobRequest("cancel", { job_id: id });
}

export async function pumpBackgroundJobs() {
  if (shared.__edupiJobPump || active.size >= 2) return;
  shared.__edupiJobPump = true;
  try {
    while (active.size < 2) {
      const { job } = await backgroundJobRequest("claim", { owner_pid: process.pid });
      if (!job) break;
      try {
        const roots = resolveEduPiBridgeRoots();
        const { startHarnessSession } = await import("./harness/runtime");
        const { session, realSessionId } = await startHarnessSession(`background-${job.job_id}`, "", roots.dataRoot.root, { toolNames: ["read", "write", "edit", "bash", "find", "ls", "edupi_make_ppt"] });
        let settled = false;
        let unsubscribe = () => {};
        const finish = async (ok: boolean) => {
          if (settled) return;
          settled = true; clearTimeout(timeout); clearInterval(cancellationCheck); unsubscribe();
          try {
            const candidates = ok ? (await generatedArtifactsRequest("list")).artifacts?.filter(file => file.session_id === realSessionId) || [] : [];
            const files = [];
            for (const file of candidates) {
              if (file.available === false) continue;
              const extension = path.extname(file.relative_path).toLowerCase();
              if (job.job_type === "ppt" && extension !== ".pptx") continue;
              if (file.size_bytes <= 0 || file.size_bytes > 50 * 1024 * 1024) continue;
              if ([".pptx", ".docx", ".xlsx"].includes(extension)) {
                try {
                  const zip = await JSZip.loadAsync(await readFile(path.resolve(roots.dataRoot.root, file.relative_path)));
                  const main = extension === ".pptx" ? "ppt/presentation.xml" : extension === ".docx" ? "word/document.xml" : "xl/workbook.xml";
                  if (!zip.file("[Content_Types].xml") || !zip.file(main)) continue;
                } catch { continue; }
              }
              files.push(file);
            }
            if (files.length) await backgroundJobRequest("complete", { job_id: job.job_id, artifacts: files.map(file => ({ artifact_id: file.artifact_id, kind: file.relative_path.split(".").at(-1), relative_path: file.relative_path })) });
            else await backgroundJobRequest("fail", { job_id: job.job_id });
          } finally { active.delete(job.job_id); void pumpBackgroundJobs().catch(() => {}); }
        };
        const timeout = setTimeout(() => { void session.send({ type: "abort" }); void finish(false).catch(() => {}); }, 20 * 60_000);
        const cancellationCheck = setInterval(() => { void backgroundJobRequest().then(result => { if (result.projection.jobs.find(item => item.job_id === job.job_id)?.status === "canceled") void active.get(job.job_id)?.(); }).catch(() => {}); }, 10000);
        active.set(job.job_id, async () => { settled = true; clearTimeout(timeout); clearInterval(cancellationCheck); unsubscribe(); await session.send({ type: "abort" }); active.delete(job.job_id); });
        unsubscribe = session.onEvent(event => { if (event.type === "prompt_done") void finish(true).catch(() => {}); if (event.type === "prompt_error") void finish(false).catch(() => {}); });
        await session.send({ type: "prompt", message: `后台任务：${job.title}\n${job.instructions}\n\n请直接执行。将最终文件保存到 .edupi/output/agent-computer/${job.job_id}/，结束前检查文件存在。不要创建其他任务。` });
      } catch { active.delete(job.job_id); await backgroundJobRequest("fail", { job_id: job.job_id }); }
    }
  } finally { shared.__edupiJobPump = false; }
}
