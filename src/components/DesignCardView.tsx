import { useState } from "react";
import type { AuthContext, Card, FrameworkConfig, StepKey } from "@shared/types";
import { allLit, canEdit, litCount } from "@shared/util";
import * as api from "../api";
import { C } from "../theme";
import { CardShell } from "./CardShell";
import { Conversation } from "./Conversation";
import { FeedbackModal } from "./FeedbackModal";
import { Btn, ErrorBar, Modal } from "./primitives";

export function DesignCardView({
  card,
  fw,
  auth,
  serverStt,
  onCardChange,
  onPatch,
  onBack,
  currentStep,
  onStepFocus,
}: {
  card: Card;
  fw: FrameworkConfig;
  auth: AuthContext;
  serverStt: boolean;
  onCardChange: (c: Card) => void;
  onPatch: (p: Partial<Card>) => void;
  onBack: () => void;
  currentStep: StepKey | null;
  onStepFocus: (k: StepKey) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [showRecipe, setShowRecipe] = useState(false);
  const [showFb, setShowFb] = useState(false);

  const writable = canEdit(card, auth.user.id, auth.role);
  const lit = litCount(card, fw);
  const complete = allLit(card, fw);

  const makeRecipe = async () => {
    setBusy(true);
    setErr("");
    try {
      onCardChange(await api.generateRecipe(card.id));
      setShowRecipe(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "生成失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <CardShell
        card={card}
        fw={fw}
        auth={auth}
        currentStep={currentStep}
        onStepFocus={onStepFocus}
        onPatch={onPatch}
        onBack={onBack}
        sidebarExtra={
          <>
            <Btn
              onClick={() => void makeRecipe()}
              disabled={busy || !complete || !writable}
              tone={complete ? "accent" : "ghost"}
              title={
                complete
                  ? "生成可实践的配方"
                  : `${fw.steps.length} 个槽全亮才能导出配方,现在 ${lit}/${fw.steps.length}`
              }
            >
              {busy ? "生成中…" : complete ? "生成配方" : `生成配方 (${lit}/${fw.steps.length})`}
            </Btn>
            {card.recipe && <Btn onClick={() => setShowRecipe(true)}>查看配方</Btn>}
            {card.recipe && (
              <Btn
                onClick={() => setShowFb(true)}
                tone={card.feedback ? "accent" : "ghost"}
                disabled={!writable}
              >
                {card.feedback ? `实践反馈 ★${card.feedback.rating}` : "录入实践反馈"}
              </Btn>
            )}
            {err && <ErrorBar text={err} onClose={() => setErr("")} />}
          </>
        }
      >
        <Conversation
          card={card}
          fw={fw}
          auth={auth}
          serverStt={serverStt}
          onCardChange={onCardChange}
          onStepFocus={onStepFocus}
          emptyHint={`说一个起点就行 — 一组香气、一个画面、一句概念。\n从哪一步开始都可以,${fw.steps.length} 个槽会自己往回补。`}
        />
      </CardShell>

      {showRecipe && (
        <Modal onClose={() => setShowRecipe(false)} title="配方">
          <div
            style={{ fontSize: 13, color: C.bone, lineHeight: 1.95, whiteSpace: "pre-wrap" }}
          >
            {card.recipe}
          </div>
          <div style={{ marginTop: 18, display: "flex", gap: 8 }}>
            <Btn onClick={() => void navigator.clipboard.writeText(card.recipe)}>复制</Btn>
            <Btn onClick={() => downloadRecipe(card)}>导出 .md</Btn>
          </div>
        </Modal>
      )}

      {showFb && (
        <FeedbackModal
          card={card}
          onClose={() => setShowFb(false)}
          onSaved={(c) => {
            onCardChange(c);
            setShowFb(false);
          }}
        />
      )}
    </>
  );
}

function downloadRecipe(card: Card) {
  const blob = new Blob([`# ${card.name || "未命名"}\n\n${card.recipe}\n`], {
    type: "text/markdown;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${card.name || "配方"}.md`;
  a.click();
  URL.revokeObjectURL(url);
}
