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
  if (operation === "students") {
    const { verifyCloudStudentWrite } = await import("./edupi-cloud-students-verification.ts");
    return verifyCloudStudentWrite(body, result, workspaceId, read);
  }
  if (operation === "classroom") {
    const { verifyCloudClassroomWrite } = await import("./edupi-cloud-classroom-verification");
    return verifyCloudClassroomWrite(body, result, workspaceId, read);
  }
  if (operation === "entities") {
    const target = cloudRecord(result.target);
    if (result.workspace_id !== workspaceId || result.action !== body.action
      || !target || target.kind !== body.kind || target.id !== body.id
      || result.target_fingerprint !== body.expected_fingerprint) throw new CloudReadbackError();
    const response = await read("entities", { action: "read", kind: body.kind, id: body.id });
    const state = cloudRecord(response.state);
    if (response.workspace_id !== workspaceId || response.tombstone_revision !== result.tombstone_revision
      || state?.deleted !== (body.action === "delete")) throw new CloudReadbackConflictError();
    return;
  }
  if (operation === "student-events") {
    const receipt = cloudRecord(result.record);
    const response = await read(operation, { action: "read_event", event_id: body.event_id });
    const event = cloudRecord(response.record);
    if (!receipt || !event || response.workspace_id !== workspaceId
      || result.action !== body.action || receipt.id !== body.event_id || event.id !== body.event_id
      || event.revision !== Number(body.expected_revision) + 1 || receipt.revision !== event.revision
      || event.deleted_at !== receipt.deleted_at || event.summary !== receipt.summary
      || event.topic !== receipt.topic || event.observed_on !== receipt.observed_on
      || body.action === "delete_event" && typeof event.deleted_at !== "string"
      || body.action === "update_event" && (event.deleted_at !== null
        || body.summary !== undefined && event.summary !== String(body.summary).trim()
        || event.topic !== (typeof body.topic === "string" ? body.topic.trim() || null : null)
        || event.observed_on !== (body.observed_on ?? null))) throw new CloudReadbackConflictError();
    return;
  }
  if (operation === "sessions") {
    if (result.action !== body.action || result.workspace_id !== workspaceId && body.action === "create") throw new CloudReadbackError();
    const response = await read("sessions", { action: "read", session_id: body.session_id });
    const session = cloudRecord(response.session);
    if (response.workspace_id !== workspaceId || !session || session.session_id !== body.session_id) throw new CloudReadbackError();
    if (body.action === "enqueue") {
      const request = Array.isArray(response.requests) ? response.requests.map(cloudRecord)
        .find(row => row?.request_id === requestId) : null;
      const messages = Array.isArray(response.messages) ? response.messages.map(cloudRecord) : [];
      if (!request || JSON.stringify(canonical(request.command)) !== JSON.stringify(canonical(body.command))
        || !messages.some(row => row && row.request_id === requestId
          && cloudRecord(row.message)?.content === cloudRecord(body.command)?.message)) throw new CloudReadbackError();
    } else if (body.action === "create") {
      if (session.title !== body.title || session.thinking_level !== body.thinking_level
        || JSON.stringify(canonical(session.model)) !== JSON.stringify(canonical(body.model))) throw new CloudReadbackConflictError();
    } else if (body.action === "delete") {
      if (typeof session.deleted_at !== "string") throw new CloudReadbackError();
    } else if (body.action === "rename" || body.action === "configure") {
      if (session.revision !== result.revision || body.action === "rename" && session.title !== body.title
        || body.model !== undefined && JSON.stringify(canonical(session.model)) !== JSON.stringify(canonical(body.model))
        || body.thinking_level !== undefined && session.thinking_level !== body.thinking_level) throw new CloudReadbackConflictError();
    } else if (body.action === "cancel") {
      if (Array.isArray(response.requests) && response.requests.map(cloudRecord)
        .some(row => ["queued", "claimed", "running"].includes(String(row?.status)))) throw new CloudReadbackError();
    } else throw new CloudReadbackError();
    return;
  }
  if (operation === "command") {
    const command = cloudRecord(envelope?.command);
    const receiptEnvelope = cloudRecord(result.receipt);
    const receipt = cloudRecord(receiptEnvelope?.payload);
    const target = cloudRecord(receipt?.target);
    const creating = command?.command_type === "create_task";
    const intake = command?.command_type === "import_calendar"
      || command?.command_type === "import_timetable"
      || command?.command_type === "intake_material";
    if (intake) {
      if (!command || !receipt || !receiptEnvelope
        || receiptEnvelope.schema_hash !== envelope?.schema_hash
        || receiptEnvelope.contract_version !== envelope?.contract_version
        || receiptEnvelope.request_id !== requestId
        || receiptEnvelope.external_send !== false
        || receipt.command_id !== envelope?.message_id
        || receipt.request_id !== requestId
        || receipt.status !== "accepted"
        || receipt.external_send !== false
        || !Array.isArray(receipt.rejected_ids)
        || receipt.rejected_ids.length !== 0) throw new CloudReadbackError();
      const source = cloudRecord(command.source);
      const expectedTargetKind = command.command_type === "intake_material" ? "material_intake"
        : command.command_type === "import_calendar" ? "calendar_import" : "timetable_import";
      if (target?.target_kind !== expectedTargetKind
        || command.command_type !== "intake_material" && target.target_id !== source?.source_id
        || command.command_type === "intake_material" && target.target_id !== cloudRecord(command.material)?.material_id) {
        throw new CloudReadbackError();
      }
      const snapshot = await read("snapshot");
      const payload = cloudRecord(snapshot.payload);
      if (payload?.workspace_id !== workspaceId) throw new CloudReadbackError();
      if (command.command_type === "import_calendar" || command.command_type === "import_timetable") {
        const field = command.command_type === "import_calendar" ? "calendar" : "timetable";
        const expectedItems = command.command_type === "import_calendar" ? command.events : command.slots;
        const actualItems = Array.isArray(payload[field]) ? payload[field].map(cloudRecord).filter(Boolean) : [];
        if (!Array.isArray(expectedItems) || expectedItems.some((item) => {
          const raw = cloudRecord(item);
          const id = raw?.event_id || raw?.slot_id;
          return !actualItems.some(candidate => (candidate?.id || candidate?.event_id || candidate?.slot_id) === id);
        })) throw new CloudReadbackError();
      } else {
        const material = cloudRecord(command.material);
        const actual = Array.isArray(payload.materials)
          ? payload.materials.map(cloudRecord).find(item => item?.material_id === material?.material_id)
          : null;
        if (!actual || actual.source_hash !== material?.source_hash
          || actual.title !== material?.title || !actual.storage_object_key) throw new CloudReadbackError();
      }
      return;
    }
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

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  const object = cloudRecord(value);
  return object ? Object.fromEntries(Object.keys(object).sort().map(key => [key, canonical(object[key])])) : value;
}
