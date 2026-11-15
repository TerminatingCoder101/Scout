import { useId } from "react";
import type { Point } from "./types";

export default function Radar({
  points,
  active,
  angle,
}: {
  points: Point[];
  active: boolean;
  angle?: number;
}) {
  const uid = useId().replace(/:/g, "");
  const center = { x: 360, y: 325 };
  const scale = 1.38;
  const radius = 280;
  const current = angle ?? points.at(-1)?.angle_deg ?? 90;
  const xy = (a: number, r: number) => ({
    x: center.x - Math.cos((a * Math.PI) / 180) * Math.min(r * scale, radius),
    y: center.y - Math.sin((a * Math.PI) / 180) * Math.min(r * scale, radius),
  });
  const tip = xy(current, 210);
  return (
    <svg
      className="radar-svg"
      viewBox="0 0 720 375"
      role="img"
      aria-label={`Polar radar with ${points.length} measured angles${active ? ", scanning" : ""}`}
    >
      <defs>
        <radialGradient id={uid + "bg"}>
          <stop offset="0%" stopColor="#255b35" stopOpacity=".20" />
          <stop offset="100%" stopColor="#172b21" stopOpacity="0" />
        </radialGradient>
        <filter id={uid + "glow"}>
          <feGaussianBlur stdDeviation="3" />
        </filter>
        <linearGradient id={uid + "beam"}>
          <stop stopColor="#b6f18b" stopOpacity="0" />
          <stop offset="100%" stopColor="#b6f18b" stopOpacity=".7" />
        </linearGradient>
      </defs>
      <path d="M80 325 A280 280 0 0 1 640 325 Z" fill={`url(#${uid}bg)`} />
      {[70, 140, 210, 280].map((r, i) => (
        <g key={r}>
          <path
            d={`M${360 - r} 325 A${r} ${r} 0 0 1 ${360 + r} 325`}
            className="radar-grid"
          />
          <text x={365 + r * 0.71} y={320 - r * 0.71} className="radar-label">
            {(i + 1) * 50} cm
          </text>
        </g>
      ))}
      {[0, 30, 60, 90, 120, 150, 180].map((a) => {
        const p = xy(a, 203);
        const t = xy(a, 221);
        return (
          <g key={a}>
            <line x1="360" y1="325" x2={p.x} y2={p.y} className="radar-grid" />
            <text
              x={t.x}
              y={t.y - 8}
              textAnchor="middle"
              className="radar-label"
            >
              {a}°
            </text>
          </g>
        );
      })}
      <line x1="55" y1="325" x2="665" y2="325" stroke="#35473b" />
      {points
        .filter((p) => p.distance_cm !== null)
        .map((p, i) => {
          const pos = xy(p.angle_deg, p.distance_cm!);
          const warn = p.spread_cm > 3 || p.valid_pings < 8;
          return (
            <g key={i}>
              <title>{`${p.angle_deg}° · ${p.distance_cm} cm · ${warn ? "uncertain return" : "consistent return"}; not an object label`}</title>
              <circle
                cx={pos.x}
                cy={pos.y}
                r="8"
                fill={warn ? "#ef827c" : "#b7ec8c"}
                opacity=".35"
                filter={`url(#${uid}glow)`}
              />
              <circle
                cx={pos.x}
                cy={pos.y}
                r={warn ? 4.5 : 3}
                fill={warn ? "#ef827c" : "#b7ec8c"}
              />
            </g>
          );
        })}
      {points.length > 0 && (
        <line
          x1="360"
          y1="325"
          x2={tip.x}
          y2={tip.y}
          stroke="#b6f18b"
          strokeOpacity={active ? ".65" : ".18"}
          strokeWidth="1"
        />
      )}
      <circle cx="360" cy="325" r="14" fill="#bceaa0" opacity=".1" />
      <circle cx="360" cy="325" r="5" fill="#c3eda8" />
      <text x="360" y="355" textAnchor="middle" className="radar-origin">
        SCOUT / SENSOR ORIGIN
      </text>
      {points.length === 0 && (
        <g>
          <rect
            x="247"
            y="176"
            width="226"
            height="66"
            rx="9"
            fill="#141e18"
            stroke="#344335"
          />
          <text
            x="360"
            y="202"
            textAnchor="middle"
            className="radar-empty-title"
          >
            Ready to read the room.
          </text>
          <text x="360" y="224" textAnchor="middle" className="radar-label">
            Start an inspection to map the space
          </text>
        </g>
      )}
    </svg>
  );
}
