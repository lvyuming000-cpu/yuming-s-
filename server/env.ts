import fs from "node:fs";
import path from "node:path";

/* ============================================================
   .env 加载
   ------------------------------------------------------------
   必须在任何其他模块之前被 import —— server/ai.ts 在模块作用域读
   process.env.ANTHROPIC_MODEL 等常量,晚一步就读不到了。
   所以 server/index.ts 的第一行是 import "./env.js"。

   零依赖,自己解析,不用 process.loadEnvFile:后者在不同 Node 版本
   上对「已存在的变量」处理不一致,而这里的优先级规则要可预测。

   优先级:真实环境变量 > .env。但空字符串算「没设」——
   导出了一个空的 ANTHROPIC_API_KEY 是常见的坑,不该因此屏蔽 .env。
   ============================================================ */

const ENV_FILE = path.resolve(process.cwd(), process.env.ENV_FILE ?? ".env");

function isUnset(key: string): boolean {
  const v = process.env[key];
  return v === undefined || v === "";
}

export function parseEnv(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!key) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export function loadEnv(file: string = ENV_FILE): void {
  if (!fs.existsSync(file)) return; // 没有 .env 就只用真实环境变量
  let parsed: Record<string, string>;
  try {
    parsed = parseEnv(fs.readFileSync(file, "utf8"));
  } catch (e) {
    console.warn(
      `[env] 读不了 ${file},已跳过:`,
      e instanceof Error ? e.message : e,
    );
    return;
  }
  for (const [key, value] of Object.entries(parsed)) {
    if (isUnset(key)) process.env[key] = value;
  }
}

loadEnv();
