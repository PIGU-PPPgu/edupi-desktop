import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const model = await jiti.import("../lib/edupi-material-schedule.ts");
const time = await jiti.import("../lib/edupi-calendar-form-time.ts");
const sourceModel = await jiti.import("../lib/edupi-docx-chapter-suggestion.ts");
const source = readFileSync(new URL("./EduPiMaterialScheduleProposal.tsx", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const jsx = (type, props, key) => ({ type, props: props || {}, key });
const nodes = node => Array.isArray(node) ? node.flatMap(nodes) : node?.props ? [node, ...nodes(node.props.children)] : [];
const text = node => typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(text).join("") : node?.props ? text(node.props.children) : "";
const hash = value => `sha256:${value.repeat(64)}`;
const read = () => ({ version: 1, root_ref: hash("a"), owner_id: "owner-synthetic", source: { material_id: "material-synthetic", source_hash: hash("b"), metadata_revision: 2, relative_path: "synthetic.ics" },
  status: "ready", options: { default_time_zone: null, window_start: null, window_end: null, max_occurrences: 200 },
  events: [{ event_id: "event-synthetic", date: "2026-10-15", end_date: null, name: "合成事项", type: "meeting", confidence: "inferred", notes: null, location: "合成场地",
    time_interval: { start: "2026-10-15T01:00+00:00", end: "2026-10-15T02:00+00:00", time_zone: "UTC" } }],
  issues: [], evidence: [], parse_fingerprint: hash("c"), read_only: true, automatic_import: false, external_send: false });
const receipt = value => ({ receiptId: "receipt-synthetic", ownerCommandId: "owner-command-hash", rootRef: value.root_ref, ownerId: value.owner_id,
  materialId: value.source.material_id, sourceHash: value.source.source_hash, metadataRevision: value.source.metadata_revision, parseFingerprint: value.parse_fingerprint,
  status: "accepted", appliedIds: value.events.map(event => event.event_id), createdAt: "2026-10-15T00:00:00.000Z", calendarState: "matching" });
const adopted = () => { const value = read(); return { ...value, adoptionReceipt: receipt(value) }; };
const tick = () => new Promise(resolve => setImmediate(resolve));

function mount() {
  const slots = [], listeners = new Set(), reads = [], applies = [], confirmations = [], pendingReads = [], pendingApplies = [], pendingConfirmations = [], calls = [], notifications = [], commits = [];
  let cursor = 0, dirty = false, effects = [], tree;
  const document = { body: { name: "body" }, documentElement: { name: "html" }, activeElement: null,
    addEventListener(name, callback) { assert.equal(name, "focusin"); listeners.add(callback); },
    removeEventListener(name, callback) { assert.equal(name, "focusin"); listeners.delete(callback); } };
  document.activeElement = document.body;
  const root = { name: "details", ownerDocument: document, isConnected: true, open: false, contains: target => Boolean(target?.isConnected && target.scope === root) };
  const element = name => ({ name, scope: root, ownerDocument: document, isConnected: true, disabled: false,
    focus(options) { assert.ok(this.isConnected && !this.disabled && root.open, `${name} must be connected, visible and enabled`); document.activeElement = this; calls.push({ name, options }); for (const listener of listeners) listener({ target: this }); } });
  const reload = element("reload"), adopt = element("adopt"), summary = element("summary");
  const props = { materialId: "material-synthetic", metadataRevision: 2, onApplied() { notifications.push("applied"); } };
  const same = (a, b) => a?.length === b?.length && a.every((value, index) => Object.is(value, b[index]));
  const react = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial; return [slots[index], value => { const next = typeof value === "function" ? value(slots[index]) : value; if (!Object.is(next, slots[index])) { slots[index] = next; dirty = true; } }]; },
    useRef(initial) { const index = cursor++; slots[index] ??= { current: initial }; return slots[index]; },
    useCallback(value, deps) { const index = cursor++; if (!same(slots[index]?.deps, deps)) slots[index] = { value, deps }; return slots[index].value; },
    useEffect(create, deps) { const index = cursor++, prior = slots[index]; if (!same(prior?.deps, deps)) { slots[index] = { deps }; effects.push(() => { prior?.cleanup?.(); slots[index].cleanup = create(); }); } },
  };
  const exports = {};
  vm.runInNewContext(code, { exports, AbortController, require(name) {
    if (name === "react") return react;
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "fragment" };
    if (name === "./EduPiActionIcon") return { EduPiPagination() {} };
    if (name === "@/lib/edupi-calendar-form-time") return time;
    if (name === "@/lib/edupi-docx-chapter-suggestion") return sourceModel;
    if (name === "@/lib/edupi-material-schedule") return { ...model,
      readMaterialSchedule(materialId, _fetch, _headers, signal) { reads.push({ materialId, signal }); return new Promise((resolve, reject) => pendingReads.push({ resolve, reject, signal })); },
      applyMaterialSchedule(capture) { applies.push(capture); return new Promise((resolve, reject) => pendingApplies.push({ resolve, reject, capture })); } };
    assert.equal(name, "@/lib/desktop-native"); return { confirmMaterialScheduleNative(count) { confirmations.push(count); return new Promise(resolve => pendingConfirmations.push(resolve)); } };
  } });
  const f = { root, props, document, reload, adopt, summary, reads, applies, confirmations, calls, listeners, pendingReads, notifications, commits,
    find(predicate) { return nodes(tree).find(predicate); },
    render() {
      let count = 0;
      do {
        assert.ok(count++ < 20, "effects settle"); cursor = 0; dirty = false; effects = []; tree = exports.EduPiMaterialScheduleProposal(props);
        if (tree.props.ref) tree.props.ref.current = root;
        const present = new Set([summary]);
        for (const node of nodes(tree).filter(node => node.type === "button")) {
          const target = text(node) === "重新读取" ? reload : ["确认采用", "采用中…"].includes(text(node)) ? adopt : null;
          if (!target) continue;
          present.add(target); target.isConnected = root.isConnected; target.disabled = Boolean(node.props.disabled);
          if (node.props.ref) node.props.ref.current = target;
        }
        for (const target of [reload, adopt, summary]) {
          if (!present.has(target)) target.isConnected = false;
          if (document.activeElement === target && (!target.isConnected || target.disabled)) document.activeElement = document.body;
        }
        commits.push({ text: text(tree), adoptDisabled: adopt.disabled });
        effects.splice(0).forEach(run => run());
      } while (dirty);
      return tree;
    },
    toggle(open) { root.open = open; tree.props.onToggle({ currentTarget: root }); f.render(); },
    click(label, focus = true) { const node = f.find(node => node.type === "button" && text(node) === label); assert.ok(node && !node.props.disabled, `enabled button ${label}`); const target = label === "重新读取" ? reload : adopt;
      if (focus) target.focus({ preventScroll: false }); calls.length = 0; node.props.onClick({ currentTarget: target }); f.render(); },
    finishRead(value = read(), error, index = 0) { const pending = pendingReads.splice(index, 1)[0]; assert.ok(pending); if (error) pending.reject(error); else pending.resolve(structuredClone(value)); },
    finishConfirmation(value) { assert.ok(pendingConfirmations.length); pendingConfirmations.shift()(value); },
    finishApply(error) { const pending = pendingApplies.shift(); assert.ok(pending); if (error) pending.reject(error); else pending.resolve({ version: 1, material_id: pending.capture.materialId,
      parse_fingerprint: pending.capture.expectedParseFingerprint, command_id: pending.capture.commandId, receipt_id: "receipt-post-result", status: "accepted", reason_code: null, applied_ids: ["event-synthetic"], rejected_ids: [], replayed: false, automatic_import: false, external_send: false }); },
    move(target = { name: "outside", isConnected: true }) { document.activeElement = target; for (const listener of listeners) listener({ target }); return target; },
    async settle() { for (let i = 0; i < 5; i++) { await tick(); if (dirty) f.render(); } },
    async ready(value = read()) { f.toggle(true); f.finishRead(value); await f.settle(); calls.length = 0; },
    text() { return text(tree); },
    unmount() { root.isConnected = false; for (const slot of slots) slot?.cleanup?.(); },
  };
  f.render(); return f;
}

test("new mounts and rereads recover a formal adoption receipt without a POST", async () => {
  for (let i = 0; i < 2; i++) {
    const f = mount(); await f.ready(adopted());
    assert.match(f.text(), /已采用\s*1\s*项安排/); assert.equal(f.adopt.disabled, true); assert.equal(f.applies.length, 0);
    f.click("重新读取"); assert.equal(f.document.activeElement, f.document.body);
    f.finishRead(adopted()); await f.settle();
    assert.equal(f.document.activeElement, f.reload); assert.deepEqual(f.calls.map(x => x.name), ["reload"]);
    assert.equal(f.adopt.disabled, true); assert.equal(f.applies.length, 0); assert.equal(f.listeners.size, 0); f.unmount();
  }
});

test("read failure retains a verified adoption fact and recovers focus to retry", async () => {
  const f = mount(); await f.ready(adopted()); f.click("重新读取"); f.finishRead(null, new Error("offline")); await f.settle();
  assert.match(f.text(), /已采用\s*1\s*项安排/); assert.match(f.text(), /安排读取未确认/);
  assert.equal(f.document.activeElement, f.reload); assert.equal(f.adopt.disabled, true); assert.equal(f.applies.length, 0); assert.equal(f.listeners.size, 0);
});

test("a changed calendar is historical adoption, not a current fully-valid schedule claim", async () => {
  const value = adopted(); value.adoptionReceipt.calendarState = "needs_review";
  const f = mount(); await f.ready(value);
  assert.match(f.text(), /待核对/); assert.match(f.text(), /已采用\s*1\s*项安排，日程待核对/);
  assert.equal(f.adopt.disabled, true); assert.doesNotMatch(f.text(), /已确认/);
});

test("nullable receipt permits explicit confirmation but never triggers automatic adoption", async () => {
  const f = mount(); await f.ready({ ...read(), adoptionReceipt: null });
  assert.match(f.text(), /待确认/); assert.doesNotMatch(f.text(), /从未采用/);
  assert.equal(f.adopt.disabled, false); assert.equal(f.applies.length, 0); assert.equal(f.confirmations.length, 0);
});

test("canceling native adoption returns to its enabled button with no write", async () => {
  const f = mount(); await f.ready(); f.click("确认采用");
  assert.equal(f.adopt.disabled, true); assert.equal(f.document.activeElement, f.document.body);
  f.finishConfirmation(false); await f.settle();
  assert.equal(f.document.activeElement, f.adopt); assert.equal(f.applies.length, 0); assert.equal(f.listeners.size, 0);
});

test("accepted adoption waits for the final DOM then focuses reread instead of its disabled action", async () => {
  const f = mount(); await f.ready(); f.click("确认采用"); f.finishConfirmation(true); await f.settle();
  assert.equal(f.applies.length, 1); assert.equal(f.calls.length, 0);
  f.finishApply(); await f.settle();
  assert.match(f.text(), /已采用\s*1\s*项安排/); assert.equal(f.document.activeElement, f.reload);
  assert.equal(f.adopt.disabled, true); assert.deepEqual(f.calls.map(x => x.name), ["reload"]); assert.deepEqual(f.notifications, ["applied"]);
});

test("failed adoption requires a fresh proof and focuses its connected reread action", async () => {
  const f = mount(); await f.ready(); f.click("确认采用"); f.finishConfirmation(true); await f.settle(); f.finishApply(new Error("unconfirmed")); await f.settle();
  assert.equal(f.document.activeElement, f.reload); assert.equal(f.adopt.disabled, true); assert.match(f.text(), /读取未确认/); assert.equal(f.listeners.size, 0);
});

test("read, canceled adoption and successful adoption never steal focus moved during the request", async () => {
  for (const kind of ["read", "cancel", "apply"]) {
    const f = mount(); await f.ready(); f.click(kind === "read" ? "重新读取" : "确认采用"); f.move(); f.document.activeElement = f.document.body;
    if (kind === "read") f.finishRead();
    else { f.finishConfirmation(kind === "apply"); await f.settle(); if (kind === "apply") f.finishApply(); }
    await f.settle(); assert.equal(f.document.activeElement, f.document.body, kind); assert.deepEqual(f.calls, [], kind); assert.equal(f.listeners.size, 0);
  }
});

test("collapse, material change and disconnect abandon pending focus and old read data", async () => {
  for (const kind of ["collapse", "material", "metadata", "disconnect"]) {
    const f = mount(); await f.ready(); f.click("重新读取");
    if (kind === "collapse") f.toggle(false);
    if (kind === "material") { f.props.materialId = "another-material"; f.render(); }
    if (kind === "metadata") { f.props.metadataRevision = 3; f.render(); }
    if (kind === "disconnect") f.root.isConnected = false;
    f.finishRead(adopted()); await f.settle();
    assert.deepEqual(f.calls, [], kind); assert.equal(f.listeners.size, 0, kind);
    if (["material", "metadata"].includes(kind)) { assert.doesNotMatch(f.text(), /已采用/); assert.equal(f.adopt.disabled, true); }
  }
});

test("old read completion cannot release a newer scope read or focus its controls", async () => {
  const f = mount(); f.toggle(true); f.props.metadataRevision = 3; f.render();
  assert.equal(f.pendingReads.length, 2);
  f.finishRead(adopted(), null, 0); await f.settle(); assert.equal(f.adopt.disabled, true); assert.deepEqual(f.calls, []);
  const newer = read(); newer.source.metadata_revision = 3; newer.parse_fingerprint = hash("d");
  f.finishRead(newer); await f.settle(); assert.equal(f.adopt.disabled, false); assert.doesNotMatch(f.text(), /已采用/);
});

test("proof change replaces old adoption and a reused component does not flash another material receipt", async () => {
  const f = mount(); await f.ready(adopted()); f.props.materialId = "material-other"; f.render();
  assert.doesNotMatch(f.text(), /已采用/); assert.equal(f.adopt.disabled, true);
  const other = read(); other.source.material_id = "material-other"; other.parse_fingerprint = hash("e");
  f.finishRead(other); await f.settle(); assert.equal(f.adopt.disabled, false);
});

test("wall-clock schedule lines show the date and time zone once without browser conversion", async () => {
  const f = mount(); await f.ready(); const value = f.text();
  assert.match(value, /2026-10-15 · 合成事项 · 01:00—02:00 UTC · 合成场地/);
  assert.doesNotMatch(value, /T01:00|\+00:00/);
  assert.equal(value.match(/2026-10-15/g)?.length, 1); assert.equal(value.match(/UTC/g)?.length, 1);
});

test("unmount clears request listeners before any old promise can finish", async () => {
  const f = mount(); await f.ready(); f.click("重新读取"); assert.ok(f.listeners.size); f.unmount(); assert.equal(f.listeners.size, 0);
  f.finishRead(adopted()); await f.settle(); assert.deepEqual(f.calls, []);
});

test("a fast reread or canceled confirmation still waits for its enabled DOM commit", async () => {
  for (const kind of ["read", "cancel"]) {
    const f = mount(); await f.ready();
    const label = kind === "read" ? "重新读取" : "确认采用", target = kind === "read" ? f.reload : f.adopt;
    const node = f.find(node => node.type === "button" && text(node) === label);
    target.focus({ preventScroll: false }); f.calls.length = 0;
    node.props.onClick({ currentTarget: target });
    if (kind === "read") f.finishRead(); else f.finishConfirmation(false);
    await f.settle();
    assert.equal(f.document.activeElement, target, kind); assert.deepEqual(f.calls.map(call => call.name), [target.name], kind); assert.equal(f.listeners.size, 0);
  }
});

test("a native click from body does not need the browser to have focused its trigger", async () => {
  const f = mount(); await f.ready(); f.document.activeElement = f.document.body;
  f.click("重新读取", false); f.finishRead(); await f.settle();
  assert.equal(f.document.activeElement, f.reload); assert.deepEqual(f.calls.map(call => call.name), ["reload"]);
});

test("an unknown failed reread disables stale parse authority until a verified retry completes", async () => {
  const f = mount(); await f.ready(); f.click("重新读取"); f.finishRead(null, new Error("unavailable")); await f.settle();
  assert.match(f.text(), /待核对/); assert.equal(f.adopt.disabled, true);
  f.click("重新读取"); f.finishRead(); await f.settle(); assert.equal(f.adopt.disabled, false); assert.equal(f.applies.length, 0);
});

test("a current server proof can advance an older parent projection without becoming stuck", async () => {
  const f = mount(), newer = adopted(); newer.source.metadata_revision = 3; newer.parse_fingerprint = hash("d"); newer.adoptionReceipt = receipt(newer);
  await f.ready(newer);
  assert.equal(f.props.metadataRevision, 2, "the parent has not yet projected the newer material version");
  assert.match(f.text(), /已采用\s*1\s*项安排/); assert.equal(f.adopt.disabled, true);
  f.props.metadataRevision = 3; f.render(); f.finishRead(newer); await f.settle();
  assert.match(f.text(), /已采用\s*1\s*项安排/); assert.equal(f.applies.length, 0);
});

test("parent metadata catch-up keeps the verified server receipt when the required reread fails", async () => {
  const f = mount(), newer = adopted(); newer.source.metadata_revision = 3; newer.parse_fingerprint = hash("d"); newer.adoptionReceipt = receipt(newer);
  await f.ready(newer);
  f.commits.length = 0; f.props.metadataRevision = 3; f.render();
  assert.ok(f.commits.every(commit => /已采用\s*1\s*项安排/.test(commit.text) && commit.adoptDisabled), "no catch-up commit erases the verified fact or authorizes writing");
  assert.equal(f.reads.length, 2, "catch-up still invalidates authority and requests a fresh read");
  assert.match(f.text(), /已采用\s*1\s*项安排/, "the same verified version remains a historical fact while reading");
  assert.equal(f.adopt.disabled, true);
  f.finishRead(null, new Error("offline")); await f.settle();
  assert.match(f.text(), /已采用\s*1\s*项安排/); assert.match(f.text(), /安排读取未确认/);
  assert.equal(f.adopt.disabled, true); assert.equal(f.applies.length, 0); assert.equal(f.confirmations.length, 0); assert.deepEqual(f.calls, []);
});

test("parent catch-up retains a local accepted fact but never retains stale write authority", async () => {
  const f = mount(), newer = read(); newer.source.metadata_revision = 3; newer.parse_fingerprint = hash("d");
  await f.ready(newer); f.click("确认采用"); f.finishConfirmation(true); await f.settle(); f.finishApply(); await f.settle();
  assert.match(f.text(), /已采用\s*1\s*项安排/);
  f.calls.length = 0; f.commits.length = 0; f.props.metadataRevision = 3; f.render();
  assert.ok(f.commits.every(commit => /已采用\s*1\s*项安排/.test(commit.text) && commit.adoptDisabled));
  f.finishRead(null, new Error("offline")); await f.settle();
  assert.match(f.text(), /已采用\s*1\s*项安排/); assert.equal(f.adopt.disabled, true); assert.equal(f.applies.length, 1); assert.deepEqual(f.calls, []);

  const unadopted = mount(); await unadopted.ready(newer); assert.equal(unadopted.adopt.disabled, false);
  unadopted.commits.length = 0; unadopted.props.metadataRevision = 3; unadopted.render(); assert.equal(unadopted.adopt.disabled, true);
  assert.ok(unadopted.commits.every(commit => commit.adoptDisabled), "the prior proof cannot authorize even the first catch-up commit");
  unadopted.finishRead(null, new Error("offline")); await unadopted.settle(); assert.equal(unadopted.adopt.disabled, true);
  unadopted.click("重新读取"); unadopted.finishRead(newer); await unadopted.settle();
  assert.equal(unadopted.adopt.disabled, false); assert.equal(unadopted.applies.length, 0);
});

test("a different or backwards parent version cannot inherit an adoption fact during a failed read", async () => {
  for (const metadataRevision of [1, 4]) {
    const f = mount(), newer = adopted(); newer.source.metadata_revision = 3; newer.parse_fingerprint = hash("d"); newer.adoptionReceipt = receipt(newer);
    await f.ready(newer); f.commits.length = 0; f.props.metadataRevision = metadataRevision; f.render();
    assert.ok(f.commits.every(commit => !/已采用/.test(commit.text) && commit.adoptDisabled), "an incompatible version cannot flash the previous adoption");
    assert.doesNotMatch(f.text(), /已采用/, `parent metadata ${metadataRevision} is not the verified version`);
    f.finishRead(null, new Error("offline")); await f.settle();
    assert.doesNotMatch(f.text(), /已采用/); assert.equal(f.adopt.disabled, true); assert.equal(f.applies.length, 0);
  }
});

test("a catch-up reread with a different root, owner or source never inherits a local accepted fact", async () => {
  for (const field of ["root_ref", "owner_id", "source_hash"]) {
    const f = mount(), newer = read(); newer.source.metadata_revision = 3; newer.parse_fingerprint = hash("d");
    await f.ready(newer); f.click("确认采用"); f.finishConfirmation(true); await f.settle(); f.finishApply(); await f.settle();
    f.props.metadataRevision = 3; f.render();
    const other = structuredClone(newer);
    if (field === "source_hash") other.source.source_hash = hash("e");
    else other[field] = field === "root_ref" ? hash("e") : "owner-other";
    f.finishRead(other); await f.settle();
    assert.doesNotMatch(f.text(), /已采用/, field); assert.equal(f.adopt.disabled, false, field); assert.equal(f.applies.length, 1);
  }
});

test("a successful local apply keeps its verified fact if the subsequent read is unavailable", async () => {
  const f = mount(); await f.ready(); f.click("确认采用"); f.finishConfirmation(true); await f.settle(); f.finishApply(); await f.settle();
  f.click("重新读取"); f.finishRead(null, new Error("unavailable")); await f.settle();
  assert.match(f.text(), /已采用\s*1\s*项安排/); assert.equal(f.adopt.disabled, true); assert.equal(f.applies.length, 1);
});
