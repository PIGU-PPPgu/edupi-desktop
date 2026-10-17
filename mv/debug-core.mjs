import path from "node:path";
import { createJiti } from "jiti";
const root = process.env.DEMO_ROOT, coreRoot = process.env.CORE, dataRoot = path.join(root, "teacher-data");
Object.assign(process.env, { NODE_ENV: "development", PI_OFFLINE: "1", PI_CODING_AGENT_DIR: path.join(root, "pi-agent"), PI_DESKTOP_STATE_DIR: path.join(root, "desktop-state"),
  EDUPI_DESKTOP_ISOLATED_CANARY: "1", EDUPI_CORE_ROOT: coreRoot, EDUPI_CORE_ALLOWED_ROOT: path.dirname(coreRoot), EDUPI_DATA_ROOT: dataRoot, EDUPI_DATA_ALLOWED_ROOT: root, EDUPI_PROJECT_ROOT: dataRoot,
  EDUPI_HOME: path.join(dataRoot, ".edupi"), EDUPI_MEMORY_DIR: path.join(dataRoot, ".edupi", "memory"), EDUPI_OUTPUT_DIR: path.join(dataRoot, ".edupi", "output"), EDUPI_LOCK_DIR: path.join(dataRoot, ".edupi", "locks"),
  EDUPI_REGISTRATION_FILE: path.join(root, "pi-agent", "edupi-registration.json") });
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { resolveEduPiBridgeRoots, readEduPiEducationSnapshot } = await jiti.import("../lib/edupi-core-snapshot.ts");
try { const r = await readEduPiEducationSnapshot({ roots: resolveEduPiBridgeRoots() }); console.log("snapshot ok", Object.keys(r)); } catch (e) { console.log("SNAPSHOT ERR", e?.code, e?.message, e?.cause?.message ?? ""); }
