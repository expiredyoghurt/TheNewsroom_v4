import { Link, Navigate, useParams } from "react-router-dom";
import { HOME_STATIONS, stationArticles, type HomeStation } from "@newsroom/shared";
import { useApi } from "../../api";
import { ART, SectionIcon } from "../../components/Art";
import { Async, Card, Page, Tag } from "../../ui";

const TITLES: Record<HomeStation, { title: string; blurb: string }> = {
  newsstand: { title: "Newsstand", blurb: "Read the story. No tasks, no marks." },
  investigation: { title: "Investigation Desk", blurb: "Find the facts. Test the evidence. Follow the story back to the article." },
  opinion: { title: "Opinion Desk", blurb: "Think and respond. There is no single right answer, only good thinking." },
  writing: { title: "Writing Desk", blurb: "Write your own report on the story." },
  editor: { title: "Editor’s Desk", blurb: "Polish a draft you have already written." },
  todaysStory: { title: "Today's Story", blurb: "" },
};

export default function StationPage() {
  const { station } = useParams();
  const hub = useApi("hub");
  if (!station || !(HOME_STATIONS as readonly string[]).includes(station) || station === "todaysStory") return <Navigate to="/pupil" replace />;
  const st = station as HomeStation;
  return (
    <Page title={TITLES[st].title}>
      <p><Link to="/pupil">← Back to The Newsroom</Link></p>
      {st === "investigation" ? <img src={ART.corkboard} alt="Investigation corkboard with pinned evidence" className="banner" /> : null}
      <p>{TITLES[st].blurb}</p>
      <Async s={hub}>{(h) => {
        const entries = stationArticles(h.articles, st);
        if (entries.length === 0) return <Card><p>Nothing here yet. Your teacher can open more stories for your class.</p></Card>;
        return <>{entries.map(({ article: a, done }) => (
          <Card key={a.articleId}>
            <h3><SectionIcon section={a.section} size={16} /> {a.title} {done ? <Tag tone="good">Done ✓</Tag> : null}</h3>
            <p className="muted">{a.section ?? "News"} · {a.publishDate}</p>
            <div className="stations">
              {st === "newsstand" ? <Link className="station" to={`/pupil/read/${a.articleId}`}>Read</Link> : null}
              {st === "investigation" ? <>
                {a.tasks.comprehension && a.access?.questionTypes.includes("comprehension") ? <Link className={`station ${a.tasks.comprehension.passed ? "done" : ""}`} to={`/pupil/task/${a.tasks.comprehension.taskId}`}>Evidence hunt</Link> : null}
                {a.tasks.vocabulary && a.access?.questionTypes.includes("vocabulary") ? <Link className={`station ${a.tasks.vocabulary.passed ? "done" : ""}`} to={`/pupil/task/${a.tasks.vocabulary.taskId}`}>Word in context</Link> : null}</> : null}
              {st === "opinion" && a.tasks.reflect ? <Link className="station" to={`/pupil/reflect/${a.tasks.reflect.taskId}`}>Think &amp; Respond</Link> : null}
              {(st === "writing" || st === "editor") ? <Link className="station" to={`/pupil/writing/${a.articleId}`}>{st === "editor" ? "Edit my draft" : a.writing?.attemptsCount ? "Write again" : "Start writing"}</Link> : null}
            </div>
          </Card>))}</>;
      }}</Async>
    </Page>
  );
}
