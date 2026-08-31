import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const {
  EduPiRegistrationError,
  readEduPiRegistration,
  registerEduPi,
} = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./edupi-registration.ts");

async function fixture(run) {
  const directory = await mkdtemp(join(tmpdir(), "edupi-registration-"));
  const path = join(directory, "edupi-desktop", "registration.json");
  try {
    await run({ directory, path });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("a missing registration file means this installation is not registered", async () => {
  await fixture(async ({ path }) => {
    assert.deepEqual(readEduPiRegistration(path), { registered: false, registeredAt: null });
  });
});

test("the launch invite registers once without persisting the invite code", async () => {
  await fixture(async ({ path }) => {
    const registered = registerEduPi("  welcometoedupi  ", {
      path,
      now: new Date("2026-08-31T03:00:00.000Z"),
    });
    assert.deepEqual(registered, {
      registered: true,
      registeredAt: "2026-08-31T03:00:00.000Z",
    });
    assert.deepEqual(readEduPiRegistration(path), registered);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    const source = readFileSync(path, "utf8");
    assert.doesNotMatch(source, /welcometoedupi|invite/i);

    const repeated = registerEduPi("wrong-after-registration", { path });
    assert.deepEqual(repeated, registered);
  });
});

test("an invalid invite creates no registration state", async () => {
  await fixture(async ({ path }) => {
    assert.throws(
      () => registerEduPi("not-the-code", { path }),
      (error) => error instanceof EduPiRegistrationError && error.code === "invalid_invite",
    );
    assert.equal(existsSync(path), false);
  });
});

test("a corrupt registration file fails closed and is not overwritten", async () => {
  await fixture(async ({ directory, path }) => {
    const parent = join(directory, "edupi-desktop");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(parent, { recursive: true }));
    writeFileSync(path, "{broken", { mode: 0o600 });
    assert.throws(
      () => readEduPiRegistration(path),
      (error) => error instanceof EduPiRegistrationError && error.code === "corrupt_state",
    );
    assert.throws(() => registerEduPi("welcometoedupi", { path }), /注册状态/);
    assert.equal(readFileSync(path, "utf8"), "{broken");
  });
});

test("an invalid configured digest disables registration", async () => {
  await fixture(async ({ path }) => {
    const previous = process.env.EDUPI_INVITE_CODE_SHA256;
    process.env.EDUPI_INVITE_CODE_SHA256 = "not-a-sha256";
    try {
      assert.throws(
        () => registerEduPi("welcometoedupi", { path }),
        (error) => error instanceof EduPiRegistrationError && error.code === "validator_unavailable",
      );
    } finally {
      if (previous === undefined) delete process.env.EDUPI_INVITE_CODE_SHA256;
      else process.env.EDUPI_INVITE_CODE_SHA256 = previous;
    }
  });
});
