#!/usr/bin/env node
/* ============================================================
   npm run setup —— 交互式生成 .env
   ------------------------------------------------------------
   存在的理由:目标用户不是工程师。让人手动改一个以点开头的隐藏
   文件,在 macOS 上还会撞上 Gatekeeper 拦截,是不合理的门槛。
   这个脚本问一句、写一个文件,不需要碰编辑器。
   ============================================================ */

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";

const ROOT = process.cwd();
const ENV = path.join(ROOT, ".env");
const EXAMPLE = path.join(ROOT, ".env.example");

const rl = readline.createInterface({ input: stdin, output: stdout });

function setKey(text, key, value) {
  const line = `${key}=${value}`;
  const re = new RegExp(`^#?\\s*${key}=.*$`, "m");
  return re.test(text) ? text.replace(re, line) : `${text.trim()}\n${line}\n`;
}

try {
  if (!fs.existsSync(EXAMPLE)) {
    console.error("✗ 找不到 .env.example,确认你在项目文件夹里运行这个命令。");
    process.exit(1);
  }

  if (fs.existsSync(ENV)) {
    const ans = (await rl.question("已经有 .env 了。覆盖它吗?(y/N) ")).trim().toLowerCase();
    if (ans !== "y" && ans !== "yes") {
      console.log("没动它。要改就直接再跑一次这个命令。");
      process.exit(0);
    }
  }

  console.log("");
  console.log("需要一个 Anthropic API key(在 console.anthropic.com 建,要先绑卡)。");
  console.log("粘贴进来后按回车。留空就跳过,之后再跑一次这个命令补上。");
  console.log("");

  const key = (await rl.question("ANTHROPIC_API_KEY: ")).trim();

  let text = fs.readFileSync(EXAMPLE, "utf8");
  if (key) {
    if (!key.startsWith("sk-ant-")) {
      console.log("");
      console.log("⚠ 这串不像 Anthropic 的 key(正常是 sk-ant- 开头)。还是先写进去了,");
      console.log("  如果启动后推演报 401,回来重跑这个命令换一个。");
    }
    text = setKey(text, "ANTHROPIC_API_KEY", key);
  } else {
    console.log("");
    console.log("⚠ 没填 key。卡片能开、参考库能记,但 AI 推演会返回 503。");
  }

  fs.writeFileSync(ENV, text, { mode: 0o600 });

  console.log("");
  console.log("✓ 已生成 .env");
  console.log("");
  console.log("下一步:");
  console.log("  npm run dev");
  console.log("然后浏览器打开 http://localhost:5173");
  console.log("");
} finally {
  rl.close();
}
