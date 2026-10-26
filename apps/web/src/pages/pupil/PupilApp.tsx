import { NavLink, Route, Routes, useNavigate } from "react-router-dom";
import { api, setSession, useApi } from "../../api";
import { Async } from "../../ui";
import Hub from "./Hub";
import Pressroom from "./Pressroom";
import StationPage from "./StationPage";
import { RankBadge } from "../../components/Art";
import ArticlePage from "./ArticlePage";
import TaskPage from "./TaskPage";
import ReflectPage from "./ReflectPage";
import WritingPage from "./WritingPage";
import { Wall, Rankings, Goat } from "./Boards";

export default function PupilApp() {
  const me = useApi("pupilProfile");
  const nav = useNavigate();
  async function logout() { await api("logout").catch(() => {}); setSession(null); nav("/", { replace: true }); }
  return (
    <div className="shell">
      <nav className="top">
        <strong>The Newsroom</strong>
        <NavLink to="/pupil" end>Pressroom</NavLink><NavLink to="/pupil/wall">My wall</NavLink><NavLink to="/pupil/rankings">Class</NavLink><NavLink to="/pupil/goat">Today's Story</NavLink>
        <span className="spacer" />
        <Async s={me}>{(m) => <span className="muted"><RankBadge level={m.level} size={22} /> {m.firstName} · Lv {m.level} {m.title} · {m.xp} XP</span>}</Async>
        <button onClick={logout}>Log out</button>
      </nav>
      <main>
        <Routes>
          <Route index element={<Pressroom />} /><Route path="stories" element={<Hub />} /><Route path="station/:station" element={<StationPage />} />
          <Route path="read/:articleId" element={<ArticlePage />} />
          <Route path="task/:taskId" element={<TaskPage onXp={me.reload} />} />
          <Route path="reflect/:taskId" element={<ReflectPage onXp={me.reload} />} />
          <Route path="writing/:articleId" element={<WritingPage onXp={me.reload} />} />
          <Route path="wall" element={<Wall />} /><Route path="rankings" element={<Rankings />} /><Route path="goat" element={<Goat />} />
        </Routes>
      </main>
    </div>
  );
}
