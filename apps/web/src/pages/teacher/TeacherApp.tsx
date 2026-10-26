import { NavLink, Route, Routes, useNavigate } from "react-router-dom";
import { api, setSession } from "../../api";
import Overview from "./Overview";
import Classes from "./Classes";
import Assignments from "./Assignments";
import Articles from "./Articles";
import Review from "./Review";
import Progress from "./Progress";

export default function TeacherApp() {
  const nav = useNavigate();
  return (
    <div className="shell">
      <nav className="top">
        <strong>The Newsroom · Staff</strong>
        <NavLink to="/teacher" end>Overview</NavLink><NavLink to="/teacher/classes">Classes</NavLink><NavLink to="/teacher/articles">Articles</NavLink>
        <NavLink to="/teacher/assignments">Assignments</NavLink><NavLink to="/teacher/progress">Progress</NavLink><NavLink to="/teacher/review">Review</NavLink>
        <span className="spacer" /><button onClick={async () => { await api("logout").catch(() => {}); setSession(null); nav("/", { replace: true }); }}>Log out</button>
      </nav>
      <main><Routes>
        <Route index element={<Overview />} /><Route path="classes" element={<Classes />} /><Route path="articles" element={<Articles />} />
        <Route path="assignments" element={<Assignments />} /><Route path="progress" element={<Progress />} /><Route path="review" element={<Review />} />
      </Routes></main>
    </div>
  );
}
