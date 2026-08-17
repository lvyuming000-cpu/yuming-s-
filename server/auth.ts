import type { NextFunction, Request, Response } from "express";
import type { User, Workspace, WorkspaceRole } from "../shared/types.js";
import { sessions, users, workspaces } from "./store.js";

/* ============================================================
   身份层(§6.4)
   ------------------------------------------------------------
   ⚠️ 这是开发级身份,不是生产级认证:凭邮箱直接换 token,没有密码、
   没有邮件验证、没有 SSO。它存在的目的是让「谁拥有这张卡、谁封的步、
   哪些库条目是团队共享的」这套数据结构和权限判定现在就跑起来 ——
   规格 §6.4 的要求是数据结构现在就按多人设计。

   上线前替换成真实身份提供方(SSO / OAuth),只需要替换本文件:
   下游拿到的都是 AuthedRequest.auth,与认证方式无关。
   ============================================================ */

export interface AuthedRequest extends Request {
  auth?: {
    user: User;
    workspace: Workspace;
    role: WorkspaceRole;
    token: string;
  };
}

export function readToken(req: Request): string | null {
  const header = req.header("authorization");
  if (header?.startsWith("Bearer ")) return header.slice(7).trim();
  return null;
}

export function requireAuth(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
): void {
  const token = readToken(req);
  if (!token) {
    res.status(401).json({ error: "未登录" });
    return;
  }
  const session = sessions.byToken(token);
  if (!session) {
    res.status(401).json({ error: "会话已失效,请重新登录" });
    return;
  }
  const user = users.byId(session.userId);
  const workspace = workspaces.byId(session.workspaceId);
  if (!user || !workspace) {
    res.status(401).json({ error: "会话指向的用户或团队不存在" });
    return;
  }
  const role = workspaces.roleOf(workspace.id, user.id);
  if (!role) {
    res.status(403).json({ error: "你已不在这个团队里" });
    return;
  }
  req.auth = { user, workspace, role, token };
  next();
}

/** 框架配置是团队级共享资源,修改需要权限(§6.4) */
export function requireRole(...allowed: WorkspaceRole[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    if (!req.auth) {
      res.status(401).json({ error: "未登录" });
      return;
    }
    if (!allowed.includes(req.auth.role)) {
      res.status(403).json({
        error: `需要 ${allowed.join(" 或 ")} 权限,你当前是 ${req.auth.role}`,
      });
      return;
    }
    next();
  };
}
