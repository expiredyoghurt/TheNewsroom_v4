import { useParams } from "react-router-dom";
import { AuthImg, useApi } from "../../api";
import { Async, Page } from "../../ui";
import { SectionIcon } from "../../components/Art";

export default function ArticlePage() {
  const { articleId } = useParams();
  const s = useApi("readArticle", { params: { articleId: articleId! } }, [articleId]);
  return (
    <Page title="Newsstand">
      <Async s={s}>{(a) => (
        <article className="article">
          <h2>{a.title}</h2>
          <p className="muted"><SectionIcon section={a.section} size={14} /> {a.sourceName} · {a.publishDate}{a.section ? ` · ${a.section}` : ""}</p>
          {a.hasImage ? <AuthImg route="articleImage" articleId={a.id} alt={`The newspaper page for ${a.title}`} className="page-photo" /> : null}
          {a.fullText.split("\n").map((p, i) => <p key={i}>{p}</p>)}
        </article>
      )}</Async>
    </Page>
  );
}
