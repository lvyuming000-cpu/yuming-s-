import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

/* ============================================================
   回归测试:.env 必须真的被读取。
   ------------------------------------------------------------
   这一条是补的。第一版写了 .env.example、README 也教用户去填,
   但代码里没有任何地方加载它 —— 用户填完 key 依然跑不起来。
   在子进程里跑,避免污染当前进程的 process.env。
   ============================================================ */

import { execFileSync } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "..");

function runInDir(dir: string, env: NodeJS.ProcessEnv = {}): string {
  const probe = path.join(dir, "probe.mjs");
  fs.writeFileSync(
    probe,
    `import ${JSON.stringify(path.join(ROOT, "server/env.ts"))};\n` +
      `console.log(JSON.stringify({key: process.env.ANTHROPIC_API_KEY ?? null, model: process.env.ANTHROPIC_MODEL ?? null}));\n`,
  );
  return execFileSync(
    process.execPath,
    ["--import", path.join(ROOT, "node_modules/tsx/dist/loader.mjs"), probe],
    { cwd: dir, encoding: "utf8", env: { ...process.env, ...env, ANTHROPIC_API_KEY: "", ANTHROPIC_MODEL: "", ...env } },
  );
}

function tmpdir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "fw-env-"));
}

test(".env 里的值会被灌进 process.env", () => {
  const dir = tmpdir();
  fs.writeFileSync(
    path.join(dir, ".env"),
    "# 注释行\nANTHROPIC_API_KEY=sk-ant-from-dotenv\nANTHROPIC_MODEL=claude-opus-5\n",
  );
  const out = JSON.parse(runInDir(dir).trim());
  assert.equal(out.key, "sk-ant-from-dotenv", ".env 里的 key 必须被读到");
  assert.equal(out.model, "claude-opus-5");
});

test("没有 .env 时不报错,只是读不到值", () => {
  const dir = tmpdir();
  const out = JSON.parse(runInDir(dir).trim());
  assert.ok(!out.key, "没有 .env 就不该有 key");
});

test("真实环境变量优先于 .env,不被覆盖", () => {
  const dir = tmpdir();
  fs.writeFileSync(path.join(dir, ".env"), "ANTHROPIC_MODEL=claude-opus-5\n");
  const out = JSON.parse(runInDir(dir, { ANTHROPIC_MODEL: "claude-sonnet-5" }).trim());
  assert.equal(out.model, "claude-sonnet-5", "显式环境变量必须赢");
});

test("带引号的值会被去引号", () => {
  const dir = tmpdir();
  fs.writeFileSync(path.join(dir, ".env"), 'ANTHROPIC_API_KEY="sk-ant-quoted"\n');
  const out = JSON.parse(runInDir(dir).trim());
  assert.equal(out.key, "sk-ant-quoted");
});
