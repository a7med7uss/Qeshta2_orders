import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const modules = [...html.matchAll(/<script\s+type=["']module["']\s*>([\s\S]*?)<\/script>/gi)];

test("واجهة الطلب تحتوي على module script واحد قابل للتحليل", () => {
  assert.equal(modules.length, 1, "Expected exactly one module script");
  const result = spawnSync(process.execPath, ["--check", "--input-type=module"], {
    input: modules[0][1],
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout || "JavaScript syntax check failed");
});

test("معالج إرسال الطلب async ويستخدم fetch منتظراً", () => {
  assert.match(modules[0][1], /async\s+function\s+submit\s*\(/);
  assert.match(modules[0][1], /await\s+fetch\(["']\/api\/order["']/);
});
