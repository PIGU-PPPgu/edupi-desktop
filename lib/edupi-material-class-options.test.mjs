import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { materialClassOptions, materialClassLabel, hasUnboundSameNameClass } = await createJiti(import.meta.url).import("./edupi-material-class-options.ts");

test("materials use canonical IDs for same-name classes and do not duplicate the legacy label", () => {
  const options = materialClassOptions([
    { class_id: "class-7-1", class_name: "七一班" },
    { class_id: "class-7-2", class_name: "七一班" },
  ], ["七一班", "八一班"]);
  assert.deepEqual(options, [
    { value: "class-7-1", label: "七一班 · class-7-1" },
    { value: "class-7-2", label: "七一班 · class-7-2" },
    { value: "八一班", label: "八一班" },
  ]);
  assert.equal(options.some(option => option.value === "七一班"), false);
  assert.equal(hasUnboundSameNameClass([
    { class_id: "class-7-1", class_name: "七一班" },
    { class_name: "七一班" },
  ]), true);
  assert.equal(hasUnboundSameNameClass([{ class_id: "class-7-1", class_name: "七一班" }]), false);
});

test("unique canonical class labels omit their ID without changing the option value", () => {
  assert.deepEqual(materialClassOptions([
    { class_id: "class-one", class_name: "一班" },
    { class_id: "class-one", class_name: "一班" },
    { class_id: "class-two", class_name: "二班" },
    { class_id: "class-unnamed" },
  ], ["一班", "二班", "三班"]), [
    { value: "class-one", label: "一班" },
    { value: "class-two", label: "二班" },
    { value: "class-unnamed", label: "class-unnamed" },
    { value: "三班", label: "三班" },
  ]);
});

test("class display mapping uses exact identity and retains unresolved values", () => {
  const options = materialClassOptions([{ class_id: "class-one", class_name: "一班" }], []);
  assert.equal(materialClassLabel("class-one", options), "一班");
  assert.equal(materialClassLabel("class-one-extra", options), "class-one-extra");
  assert.equal(materialClassLabel("未知班级", options), "未知班级");
  assert.equal(materialClassLabel(null, options), null);
});
