import { useNavigate } from "react-router-dom";
import { api, setSession, useApi } from "../../api";
import { Async, Page } from "../../ui";
import { RankBadge } from "../../components/Art";

export default function ParentApp() {
  const s = useApi("parentClass");
  const nav = useNavigate();
  return (
    <div className="shell"><nav className="top"><strong>The Newsroom · Parent view</strong><span className="spacer" />
      <button onClick={async () => { await api("logout").catch(() => {}); setSession(null); nav("/", { replace: true }); }}>Log out</button></nav>
      <main><Page title="Class progress"><Async s={s}>{(c) => (
        <table><thead><tr><th>Reporter</th>{c.rankingsEnabled ? <><th>Level</th><th>XP</th></> : null}<th>Tasks done</th><th>Badges</th><th>Retries</th></tr></thead>
          <tbody>{c.roster.map((r) => <tr key={r.displayName}><td>{r.displayName}</td>{c.rankingsEnabled ? <><td><RankBadge level={r.level} size={24} /> {r.level}</td><td>{r.xp}</td></> : null}<td>{r.tasksCompleted}</td><td>{r.badgesCount}</td><td>{r.retries}</td></tr>)}</tbody></table>)}</Async></Page></main></div>
  );
}
