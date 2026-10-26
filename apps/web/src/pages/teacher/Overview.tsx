import { Link } from "react-router-dom";
import { useApi } from "../../api";
import { Async, Card, Page } from "../../ui";

export default function Overview() {
  const d = useApi("dashboard");
  const g = useApi("gradingStats", { query: { days: 7 } });
  return (
    <Page title="Overview">
      <Async s={d}>{(x) => (
        <div className="grid">
          {x.classes.map((c) => <Card key={c.id}><h3>{c.name}</h3><p>{c.pupils} pupils · {c.assignments} active assignments</p></Card>)}
          <Card><h3>Articles</h3><p>{x.articles.active} published · {x.articles.drafts} drafts</p><Link to="/teacher/articles">Manage</Link></Card>
          <Card><h3>To review</h3><p>{x.flaggedReviews} flagged submissions</p><Link to="/teacher/review">Open the queue</Link></Card>
        </div>)}</Async>
      <h2>AI grading health (last 7 days)</h2>
      <Async s={g}>{(s) => s.total === 0 ? <p className="muted">No gradings yet.</p> : (
        <Card>
          <p><strong>{s.fallbackPercent}%</strong> of {s.total} gradings used the non-AI fallback{s.fallbackPercent > 20 ? " — check the AI provider keys." : "."}</p>
          <p className="muted">Average time {s.avgLatencyMs} ms · {s.byProvider.map((p) => `${p.provider}: ${p.count}`).join(" · ")}</p>
        </Card>)}</Async>
    </Page>
  );
}
