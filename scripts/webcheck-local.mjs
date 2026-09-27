import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const catalogPath = resolve(projectRoot, "frontend/public/vacancies.json");
const webcheckPath = resolve(projectRoot, "tools/webcheck/dist/cli.js");
const originalCatalog = await readFile(catalogPath);
let exitCode = 1;
let launchError;

try {
  exitCode = await new Promise((resolveExit, reject) => {
    const child = spawn(process.execPath, [webcheckPath, "audit", "--ci"], {
      cwd: projectRoot,
      stdio: "inherit",
    });
    const forwardInterrupt = (signal) => child.kill(signal);
    process.once("SIGINT", forwardInterrupt);
    process.once("SIGTERM", forwardInterrupt);
    child.once("error", reject);
    child.once("close", (code) => {
      process.removeListener("SIGINT", forwardInterrupt);
      process.removeListener("SIGTERM", forwardInterrupt);
      resolveExit(code ?? 1);
    });
  });
} catch (error) {
  launchError = error;
} finally {
  try {
    await writeFile(catalogPath, originalCatalog);
  } catch (error) {
    console.error("Could not restore frontend/public/vacancies.json after WebCheck:", error);
    exitCode = 1;
  }
}

if (launchError) {
  console.error("Could not start WebCheck:", launchError);
}
process.exitCode = exitCode;
