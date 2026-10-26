import { AuthImg, useApi } from "../../api";
import { Async, Page } from "../../ui";
import { ART, RankBadge } from "../../components/Art";

export function Wall() {
  const s = useApi("wall");
  return <Page title="My wall"><Async s={s}>{(w) => w.badges.length === 0 ? <p>Finish a story to pin it here.</p> : <div className="wall-grid">{w.badges.map((b) => (
    <div key={b.articleId} className="wall-card"><div className="wall-card__thumb-wrap">{b.hasThumbnail ? <AuthImg route="thumbnail" articleId={b.articleId} alt={b.title} className="thumb" /> : <div className="thumb img-placeholder" />}<img src={ART.stamp} alt="Published" className="wall-card__stamp" loading="lazy" /></div><div className="wall-card__title">{b.title}</div><div className="wall-card__date">{new Date(b.awardedAt).toLocaleDateString()}</div></div>))}</div>}</Async></Page>;
}

export function Rankings() {
  const s = useApi("rankings");
  return <Page title="My class"><Async s={s}>{(r) => (
    <table><thead><tr><th>#</th><th>Reporter</th><th>Level</th><th>XP</th><th>Tasks</th><th>Badges</th></tr></thead>
      <tbody>{r.roster.map((e) => <tr key={e.studentId} className={e.isYou ? "you" : ""}><td>{e.indexNumber}</td><td>{e.firstName} {e.lastName[0]}.</td><td><RankBadge level={e.level} size={24} /> {e.level ?? "–"}</td><td>{e.xp ?? "–"}</td><td>{e.tasksCompleted}</td><td>{e.badgesCount}</td></tr>)}</tbody></table>)}</Async></Page>;
}

export function Goat() {
  const s = useApi("goat");
  return <Page title="Greatest Of All Time"><img src={ART.podium} alt="Winner's podium" className="podium" /><p className="muted center">Top reporters across the whole school, by level and XP.</p><Async s={s}>{(g) => (
    <ol className="goat">{g.goat.map((e) => <li key={e.studentId} className={e.isYou ? "you" : ""}><RankBadge level={e.level} size={24} /> {e.firstName} {e.lastName[0]}. — Level {e.level} · {e.xp} XP · {e.badgesCount} ★</li>)}</ol>)}</Async></Page>;
}
