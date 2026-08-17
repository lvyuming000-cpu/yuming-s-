import { useState } from "react";
import type { AuthContext } from "@shared/types";
import * as api from "../api";
import { setAuthToken } from "../api";
import { C, inputStyle, mono, serif } from "../theme";
import { Btn, ErrorBar, Mono } from "./primitives";

export function Login({ onDone }: { onDone: (a: AuthContext) => void }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async () => {
    if (!email.trim()) return;
    setBusy(true);
    setErr("");
    try {
      const auth = await api.login(email.trim(), name.trim(), workspaceName.trim());
      setAuthToken(auth.token);
      onDone(auth);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "登录失败");
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div style={{ width: "100%", maxWidth: 380 }}>
        <Mono style={{ fontSize: 9.5, color: C.dim, letterSpacing: "0.22em" }}>
          骨架 → 香气 → 呈现
        </Mono>
        <h1
          style={{
            fontFamily: serif,
            fontSize: 34,
            fontWeight: 400,
            margin: "10px 0 0",
            letterSpacing: "0.01em",
            lineHeight: 1.15,
            color: C.bone,
          }}
        >
          风味设计工作台
        </h1>
        <div style={{ fontSize: 12.5, color: C.muted, marginTop: 10, lineHeight: 1.8 }}>
          一张卡片 = 一个方案 = 一场可中断可续接的对话。
        </div>

        <div style={{ marginTop: 28, display: "flex", flexDirection: "column", gap: 10 }}>
          {err && <ErrorBar text={err} onClose={() => setErr("")} />}
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void submit()}
            placeholder="邮箱"
            autoFocus
            style={inputStyle}
          />
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void submit()}
            placeholder="你的名字(可留空)"
            style={inputStyle}
          />
          <input
            value={workspaceName}
            onChange={(e) => setWorkspaceName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void submit()}
            placeholder="团队名(首次登录时创建,可留空)"
            style={inputStyle}
          />
          <Btn tone="solid" onClick={() => void submit()} disabled={busy || !email.trim()}>
            {busy ? "进入中…" : "进入"}
          </Btn>
        </div>

        <div
          style={{
            marginTop: 22,
            fontSize: 10.5,
            color: C.dim,
            lineHeight: 1.8,
            fontFamily: mono,
          }}
        >
          开发级身份:凭邮箱直接进,没有密码。用于让团队共享的数据结构和权限模型先跑起来 ——
          上线前替换 server/auth.ts。
        </div>
      </div>
    </div>
  );
}
