import type { CSSProperties } from "react";
import { Link, useNavigate } from "react-router-dom";
import { stationBadge, type HomeStation } from "@newsroom/shared";
import { useApi } from "../../api";
import { ART } from "../../components/Art";
import { ErrorBox } from "../../ui";

// Hotspot boxes are percentages OF THE ARTWORK (carried over unchanged from v3.0, where they were
// checked against the scene image; the WebP keeps the original 1536x1024 so they still hold). Nothing ties them to the image programmatically: if the art
// changes, re-check them by eye. v4 fixes one thing: the badge text now follows the pupil's effective rules.
const HOTSPOTS: { key: HomeStation; label: string; box: CSSProperties }[] = [
  { key: "newsstand", label: "1. Newsstand — Read", box: { left: "2%", top: "14%", width: "30%", height: "32%" } },
  { key: "investigation", label: "2. Investigation Desk — Find", box: { left: "69%", top: "14%", width: "30%", height: "32%" } },
  { key: "todaysStory", label: "Today's Story — GOAT Board", box: { left: "32%", top: "34%", width: "34%", height: "15%" } },
  { key: "opinion", label: "3. Opinion Desk — Think & Respond", box: { left: "32%", top: "50%", width: "34%", height: "37%" } },
  { key: "writing", label: "4. Writing Desk — Write", box: { left: "1%", top: "48%", width: "30%", height: "36%" } },
  { key: "editor", label: "5. Editor’s Desk — Edit & Publish", box: { left: "68%", top: "48%", width: "31%", height: "36%" } },
];

export default function Pressroom() {
  const hub = useApi("hub");
  const nav = useNavigate();
  const articles = hub.data?.articles ?? [];
  const badge = (s: HomeStation) => (hub.data ? stationBadge(articles, s) : "");
  const go = (s: HomeStation) => nav(s === "todaysStory" ? "/pupil/goat" : `/pupil/station/${s}`);
  return (
    <div className="newsroom-home">
      <div className="newsroom-heading"><h1>The Newsroom</h1><p>Read → Find → Think → Write → Edit → Publish</p></div>
      {hub.error ? <ErrorBox error={hub.error} /> : null}
      <div className="pressroom-scene">
        <img src={ART.scene} alt="The Newsroom with six clickable journalism workstations" className="pressroom-scene__img" width={1536} height={1024} fetchPriority="high" />
        {HOTSPOTS.map((h) => (
          <button key={h.key} className="hotspot" style={h.box} onClick={() => go(h.key)} aria-label={h.label}>
            <span className="hotspot__label">{h.label}</span><span className="hotspot__badge">{badge(h.key)}</span>
          </button>
        ))}
      </div>
      {/* Legend on large screens (touch devices never see :hover labels); the ONLY navigation under 600px. */}
      <nav className="pressroom-stations" aria-label="Newsroom stations">
        {HOTSPOTS.map((h) => <button key={h.key} className="pressroom-stations__item" onClick={() => go(h.key)}><span>{h.label}</span><span className="pressroom-stations__badge">{badge(h.key)}</span></button>)}
      </nav>
      <div className="cycle-strip"><span>📰 Read</span><span>🔎 Find evidence</span><span>💭 Think</span><span>✍️ Write</span><span>🖨️ Edit</span></div>
      <p className="muted center">Each story may use a shorter loop. <Link to="/pupil/stories">See every story</Link></p>
    </div>
  );
}
