// src/components/charts/RiskTop5Bar.jsx
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell, CartesianGrid } from 'recharts';

const bandColor = (band) => {
  switch ((band || '').toLowerCase()) {
    case 'low': return '#22c55e';
    case 'medium': return '#eab308';
    case 'high': return '#f97316';
    case 'critical': return '#ef4444';
    default: return '#94a3b8'; // unknown
  }
};

function formatTick(v) {
  const n = Number(v);
  return Number.isFinite(n) ? `${n}` : '';
}

function Tip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload;
  return (
    <div className="rounded-md border bg-white p-2 shadow text-sm">
      <div className="font-medium">{label}</div>
      <div>Visits: <span className="font-semibold">{p.visits}</span></div>
      <div>Risk: <span className="font-semibold">{p.riskScore}</span>/100</div>
      <div>Band: <span className="font-semibold">{p.band}</span></div>
    </div>
  );
}

export default function RiskTop5Bar({ data = [] }) {
  return (
    <div className="w-full h-72">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 10, right: 12, bottom: 8, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="hostname" tickFormatter={(t) => t?.length > 12 ? t.slice(0, 12) + '…' : t} />
          <YAxis domain={[0, 100]} tickFormatter={formatTick} />
          <Tooltip content={<Tip />} />
          <Bar dataKey="riskScore">
            {data.map((d, i) => (
              <Cell key={`c-${i}`} fill={bandColor(d.band)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
