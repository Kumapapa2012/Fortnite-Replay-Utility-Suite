import { Navigate, Route, Routes } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

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
import { suiteCoreApi } from "./lib/suiteCore";
import { DEFAULT_LANG } from "./contexts/LangContext";

function LangRedirect() {
  const { data, isLoading } = useQuery({
    queryKey: ["suite-config"],
    queryFn: suiteCoreApi.getConfig,
    staleTime: Infinity,
  });
  if (isLoading) return null;
  const lang = data?.uiLang ?? DEFAULT_LANG;
  return <Navigate to={`/${lang}/`} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LangRedirect />} />
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
        <Route path="*" element={<LangRedirect />} />
      </Route>
      <Route path="*" element={<LangRedirect />} />
    </Routes>
  );
}
