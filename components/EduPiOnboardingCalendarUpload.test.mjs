import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { calendarAdoptionMatches, materialIntakeAccepted } = await createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true }).import("./EduPiOnboardingCalendarUpload.tsx");

test("material intake accepts the route's receipt-only response without a data field", () => {
  const response = { receipt: { status: "accepted" }, materialReceivedOnly: true, materialScheduleProposal: { status: "proposed" } };
  assert.equal(materialIntakeAccepted(response), true);
  assert.equal(materialIntakeAccepted({ ...response, receipt: { status: "modified" } }), true);
  assert.equal(materialIntakeAccepted({ ...response, receipt: { status: "held" } }), false);
  assert.equal(materialIntakeAccepted({ ...response, materialReceivedOnly: false }), false);
  assert.equal(materialIntakeAccepted({ materialReceivedOnly: true }), false);
});

test("onboarding only offers completion after accepted schedule IDs appear in the reread calendar", () => {
  const result = { status: "accepted", applied_ids: ["synthetic-event"] };
  assert.equal(calendarAdoptionMatches(result, [{ id: "synthetic-event" }]), true);
  assert.equal(calendarAdoptionMatches({ ...result, applied_ids: ["synthetic-event", "second-event"] }, [{ id: "synthetic-event" }]), false);
  assert.equal(calendarAdoptionMatches(result, [{ id: "different-event" }]), false);
  assert.equal(calendarAdoptionMatches({ ...result, status: "held" }, [{ id: "synthetic-event" }]), false);
  assert.equal(calendarAdoptionMatches({ ...result, applied_ids: [] }, [{ id: "synthetic-event" }]), false);
});
