import { Link } from "react-router-dom";
import type { HubArticle } from "@newsroom/shared";
import { AuthImg, useApi } from "../../api";
import { Async, Card, Page, Tag } from "../../ui";
import { SectionIcon } from "../../components/Art";

function Station({ to, label, done }: { to: string; label: string; done?: boolean }) {
  return <Link className={`station ${done ? "done" : ""}`} to={to}>{done ? "✓ " : ""}{label}</Link>;
}

function ArticleCard({ a }: { a: HubArticle }) {
  const st = new Set(a.access?.stations ?? []);
  return (
    <Card className={a.locked ? "locked" : ""}>
      {a.hasThumbnail ? <AuthImg route="thumbnail" articleId={a.articleId} alt="" className="thumb" /> : null}
      <h3><SectionIcon section={a.section} size={16} /> {a.title}</h3>
      <p className="muted">{a.section ?? "News"} · {a.publishDate} {a.published ? <Tag tone="good">Published ★</Tag> : null}</p>
      {a.locked ? <p><Tag tone="warn">Locked</Tag> {a.locked.message}</p> : (
        <div className="stations">
          <Station to={`/pupil/read/${a.articleId}`} label="Newsstand" />
          {st.has("investigation") && a.tasks.comprehension ? <Station to={`/pupil/task/${a.tasks.comprehension.taskId}`} label="Comprehension" done={a.tasks.comprehension.passed} /> : null}
          {st.has("investigation") && a.tasks.vocabulary ? <Station to={`/pupil/task/${a.tasks.vocabulary.taskId}`} label="Vocabulary" done={a.tasks.vocabulary.passed} /> : null}
          {st.has("opinion") && a.tasks.reflect ? <Station to={`/pupil/reflect/${a.tasks.reflect.taskId}`} label="Opinion Desk" done={a.tasks.reflect.passed} /> : null}
          {st.has("writing") && a.writing ? <Station to={`/pupil/writing/${a.articleId}`} label={a.writing.attemptsCount > 0 && st.has("editor") ? "Editor's Desk" : "Writing Desk"} done={a.writing.passed} /> : null}
        </div>
      )}
    </Card>
  );
}

export default function Hub() {
  const hub = useApi("hub");
  return (
    <Page title="Every story">
      <Async s={hub}>{(h) => h.articles.length === 0 ? <p>No stories yet. Check back soon!</p> : <div className="grid">{h.articles.map((a) => <ArticleCard key={a.articleId} a={a} />)}</div>}</Async>
    </Page>
  );
}
