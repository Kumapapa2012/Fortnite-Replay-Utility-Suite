import { Navigate, Route, Routes } from "react-router-dom";

import { LangLayout } from "./components/Layout";
import { Dashboard } from "./pages/Dashboard";
import { LogStream } from "./pages/LogStream";
import { MatchLibrary } from "./pages/MatchLibrary";
import { MatchDetail } from "./pages/MatchDetail";
import { ReplayList } from "./pages/ReplayList";
import { ReplayDetail } from "./pages/ReplayDetail";
import { ReplayMap } from "./pages/ReplayMap";
import { Videos } from "./pages/Videos";
import { Settings } from "./pages/Settings";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/ja/" replace />} />
      <Route path="/:lang" element={<LangLayout />}>
        <Route index element={<Dashboard />} />
        <Route path="replays" element={<ReplayList />} />
        <Route path="replays/:id" element={<ReplayDetail />} />
        <Route path="replays/:id/map" element={<ReplayMap />} />
        <Route path="matches" element={<MatchLibrary />} />
        <Route path="matches/:id" element={<MatchDetail />} />
        <Route path="videos" element={<Videos />} />
        <Route path="logs" element={<LogStream />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/ja/" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/ja/" replace />} />
    </Routes>
  );
}
