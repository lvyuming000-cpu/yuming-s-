import { useEffect, useState } from "react";
import type { AuthContext, WorkspaceRole } from "@shared/types";
import * as api from "../api";
import { C, inputStyle, mono } from "../theme";
import { Btn, ErrorBar, Modal, Mono, SectionLabel } from "./primitives";

/* 团队面板(§6.4)。成员、角色、共享说明。 */

export function TeamPanel({
  auth,
  onClose,
}: {
  auth: AuthContext;
  onClose: () => void;
}) {
  const [members, setMembers] = useState<api.MemberRow[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<WorkspaceRole>("editor");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = () => void api.getMembers().then(setMembers).catch(() => {});
  useEffect(load, []);

  const add = async () => {
    if (!email.trim()) return;
    setBusy(true);
    setErr("");
    try {
      await api.addMember(email.trim(), role);
      setEmail("");
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "添加失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal onClose={onClose} title={`团队 · ${auth.workspace.name}`}>
      {err && (
        <div style={{ marginBottom: 14 }}>
          <ErrorBar text={err} onClose={() => setErr("")} />
        </div>
      )}

      <div style={{ fontSize: 11.5, color: C.dim, lineHeight: 1.8, marginBottom: 20 }}>
        团队共享的是三样东西:框架配置、参考库(scope 为「团队共享」的条目)、
        以及设为「团队可见 / 可编辑」的卡片。
        「双份鲜没有咸激活会浑浊」这类判断是可复用的团队资产,比一整份方案文档有用。
      </div>

      <SectionLabel>成员 / {members.length}</SectionLabel>
      <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
        {members.map((m) => (
          <div
            key={m.userId}
            style={{
              display: "flex",
              gap: 10,
              alignItems: "center",
              border: `1px solid ${C.edgeSoft}`,
              borderRadius: 2,
              padding: "8px 11px",
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, color: C.bone }}>
                {m.user?.name ?? "(未知)"}
                {m.userId === auth.user.id && (
                  <Mono style={{ fontSize: 9.5, color: C.tea, marginLeft: 8 }}>你</Mono>
                )}
              </div>
              <Mono style={{ fontSize: 10.5, color: C.dim }}>{m.user?.email}</Mono>
            </div>
            <Mono style={{ fontSize: 10.5, color: C.muted }}>{roleLabel(m.role)}</Mono>
          </div>
        ))}
      </div>

      {auth.role === "admin" && (
        <div style={{ marginTop: 20 }}>
          <SectionLabel>加人</SectionLabel>
          <div style={{ display: "flex", gap: 8, marginTop: 9 }}>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void add()}
              placeholder="邮箱"
              style={inputStyle}
            />
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as WorkspaceRole)}
              style={{
                ...inputStyle,
                width: "auto",
                fontFamily: mono,
                fontSize: 11.5,
              }}
            >
              <option value="editor">编辑</option>
              <option value="admin">管理员</option>
              <option value="viewer">只读</option>
            </select>
            <Btn onClick={() => void add()} disabled={busy || !email.trim()}>
              加入
            </Btn>
          </div>
          <div style={{ fontSize: 11, color: C.dim, lineHeight: 1.7, marginTop: 9 }}>
            管理员可改框架和成员;编辑可开卡、写库、改框架;只读只能看。
          </div>
        </div>
      )}

      <div
        style={{
          marginTop: 24,
          paddingTop: 16,
          borderTop: `1px solid ${C.edgeSoft}`,
          fontSize: 11,
          color: C.dim,
          lineHeight: 1.8,
        }}
      >
        当前身份层是开发级的(凭邮箱直接进,无密码验证),用于让权限模型和数据结构先跑起来。
        上线前需要替换成真实身份提供方 —— 服务端只需要换 <code style={{ fontFamily: mono }}>server/auth.ts</code>。
      </div>
    </Modal>
  );
}

function roleLabel(r: WorkspaceRole): string {
  return r === "admin" ? "管理员" : r === "editor" ? "编辑" : "只读";
}
