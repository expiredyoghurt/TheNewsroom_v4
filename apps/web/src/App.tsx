// Code-split by role: a pupil session never downloads the teacher or parent bundles.
import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { getSession } from "./api";
import { Loading } from "./ui";
import Login from "./pages/Login";

const PupilApp = lazy(() => import("./pages/pupil/PupilApp"));
const TeacherApp = lazy(() => import("./pages/teacher/TeacherApp"));
const ParentApp = lazy(() => import("./pages/parent/ParentApp"));

export default function App() {
  const s = getSession();
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/" element={s ? <Navigate to={`/${s.kind}`} replace /> : <Login />} />
        <Route path="/pupil/*" element={s?.kind === "pupil" ? <PupilApp /> : <Navigate to="/" replace />} />
        <Route path="/teacher/*" element={s?.kind === "teacher" ? <TeacherApp /> : <Navigate to="/" replace />} />
        <Route path="/parent/*" element={s?.kind === "parent" ? <ParentApp /> : <Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
