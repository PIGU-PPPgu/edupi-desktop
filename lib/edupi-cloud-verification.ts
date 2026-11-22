export const cloudRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

export class CloudReadbackError extends Error {
  constructor() { super("云端写入尚未通过重新读取核对，记录已保留。"); }
}
export class CloudReadbackConflictError extends CloudReadbackError {
  constructor() { super(); this.message = "云端对象已被其他入口更新，请核对同步冲突。"; }
}

export async function verifyCloudWrite(
  operation: string, body: Record<string, unknown>, result: Record<string, unknown>,
  workspaceId: string,
  read: (operation: string, body?: Record<string, unknown>) => Promise<Record<string, unknown>>,
): Promise<void> {
  const envelope = cloudRecord(body.envelope);
  const requestId = operation === "command" ? envelope?.request_id : body.request_id;
  if (result.ok !== true || result.operation !== operation || result.request_id !== requestId
    || result.external_send !== false) throw new CloudReadbackError();
  if (operation === "command") {
    const command = cloudRecord(envelope?.command);
    const receiptEnvelope = cloudRecord(result.receipt);
    const receipt = cloudRecord(receiptEnvelope?.payload);
    const target = cloudRecord(receipt?.target);
    const creating = command?.command_type === "create_task";
    const expectedTask = creating ? cloudRecord(command?.task) : null;
    const id = creating ? expectedTask?.task_id : command?.task_id;
    if (!command || !["create_task", "move_task_stage"].includes(String(command.command_type))
      || !receipt || receiptEnvelope?.schema_hash !== envelope?.schema_hash
      || receiptEnvelope?.contract_version !== envelope?.contract_version
      || receiptEnvelope?.request_id !== requestId || receiptEnvelope?.external_send !== false
      || receipt.command_id !== envelope?.message_id || receipt.request_id !== requestId
      || receipt.status !== (creating ? "accepted" : "modified") || receipt.external_send !== false
      || target?.target_kind !== "task" || target.target_id !== id
      || !Array.isArray(receipt.applied_ids) || receipt.applied_ids.length !== 1 || receipt.applied_ids[0] !== id
      || !Array.isArray(receipt.rejected_ids) || receipt.rejected_ids.length !== 0) throw new CloudReadbackError();
    const snapshot = await read("snapshot");
    const payload = cloudRecord(snapshot.payload);
    if (payload?.workspace_id !== workspaceId || !Array.isArray(payload.tasks)) throw new CloudReadbackError();
    const matches = payload.tasks.map(cloudRecord).filter(task => task?.task_id === id);
    const task = matches[0];
    if (task && Number(task.revision) > (creating ? 0 : Number(command.expected_revision) + 1)) throw new CloudReadbackConflictError();
    if (matches.length !== 1 || !task || task.stage !== (creating ? "todo" : command.to_stage)
      || task.revision !== (creating ? 0 : Number(command.expected_revision) + 1)
      || creating && (task.title !== expectedTask?.title || task.due_date !== expectedTask?.due_date
        || task.note !== expectedTask?.note)) throw new CloudReadbackError();
    return;
  }
  if (operation === "education-facts") {
    if (result.fact_id !== body.fact_id || result.action !== body.action) throw new CloudReadbackError();
    const expectedRevision = body.action === "capture" ? 0 : Number(body.expected_revision) + 1;
    const expectedStatus = body.action === "capture" ? "candidate" : body.action === "delete" ? "deleted"
      : body.action === "modify" ? "accepted" : body.action === "review"
        ? { accept: "accepted", reject: "rejected", hold: "held" }[String(body.decision)] : null;
    if (result.revision !== expectedRevision || expectedStatus && result.status !== expectedStatus) throw new CloudReadbackError();
    const response = await read("education-facts", { action: "read", fact_id: result.result_fact_id });
    const fact = cloudRecord(response.fact);
    if (fact?.workspace_id === workspaceId && fact.fact_id === result.result_fact_id
      && Number(fact.revision) > Number(result.revision)) throw new CloudReadbackConflictError();
    if (!fact || fact.workspace_id !== workspaceId || fact.fact_id !== result.result_fact_id
      || fact.revision !== result.revision || fact.status !== result.status
      || body.action === "capture" && (fact.value !== body.value || fact.predicate !== body.predicate)
      || body.action === "modify" && fact.value !== body.replacement_value) throw new CloudReadbackError();
    return;
  }
  if (operation === "material-metadata") {
    if (result.material_id !== body.material_id || result.action !== body.action) throw new CloudReadbackError();
    const response = await read("workspace-resources", { material_id: body.material_id });
    const history = cloudRecord(response.materialMetadataVersions);
    const snapshot = await read("snapshot");
    const payload = cloudRecord(snapshot.payload);
    if (payload?.workspace_id !== workspaceId || !Array.isArray(payload.materials)
      || !Array.isArray(history?.versions)) throw new CloudReadbackError();
    const version = history.versions.map(cloudRecord).find(row => row?.version_id === result.version_id
      && row?.request_id === requestId && row?.revision === result.revision);
    const material = payload.materials.map(cloudRecord).find(row => row?.material_id === body.material_id);
    const values = cloudRecord(version?.after_values);
    if (material && Number(material.metadata_revision) > Number(result.revision)) throw new CloudReadbackConflictError();
    if (!version || !material || material.metadata_revision !== result.revision || !values
      || Object.entries(values).some(([key, value]) => material[key] !== value)
      || body.action === "update" && Object.entries(cloudRecord(body.patch) || {})
        .some(([key, value]) => values[key] !== value)) throw new CloudReadbackError();
    return;
  }
  throw new CloudReadbackError();
}
