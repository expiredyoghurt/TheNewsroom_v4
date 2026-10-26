import { useEffect, useState } from "react";
import type { GradeStatusRes, ReflectGradeView, WritingGradeView } from "@newsroom/shared";
import { api } from "../../api";
import { Card, Tag } from "../../ui";

type G = GradeStatusRes<ReflectGradeView> | GradeStatusRes<WritingGradeView>;

/** Submissions are saved first and graded in the background: poll until the grade lands. */
export function useGrade(kind: "reflect" | "writing", attemptId: number | null): G | null {
  const [g, setG] = useState<G | null>(null);
  useEffect(() => {
    if (attemptId === null) return;
    let stop = false, timer: ReturnType<typeof setTimeout>;
    const tick = async (n: number) => {
      try {
        const r = await api(kind === "reflect" ? "reflectGrade" : "writingGrade", { params: { attemptId } });
        if (stop) return;
        setG(r);
        if (r.status === "pending" && n < 40) timer = setTimeout(() => tick(n + 1), 1500 + n * 100);
      } catch { /* a transient failure just stops polling; the pupil's work is already saved */ }
    };
    tick(0);
    return () => { stop = true; clearTimeout(timer); };
  }, [kind, attemptId]);
  return g;
}

export function GradeCard({ g }: { g: G | null }) {
  if (!g || g.status === "pending") return <Card><p>Your editor is reading your work…</p></Card>;
  const x = g.grade;
  if (!x) return null;
  return (
    <Card>
      <h3>{x.score} / {x.maxScore} {g.provisional ? <Tag tone="warn">Provisional</Tag> : null}</h3>
      {g.provisional ? <p className="muted">This was marked automatically. Your teacher may review it.</p> : null}
      <ul>{Object.entries(x.breakdown).map(([k, v]) => <li key={k}>{k.replace(/_/g, " ")}: {v}</li>)}</ul>
      {x.strengths.length ? <p><strong>Great:</strong> {x.strengths.join(" ")}</p> : null}
      {x.nextStep ? <p><strong>Next step:</strong> {x.nextStep}</p> : null}
    </Card>
  );
}
