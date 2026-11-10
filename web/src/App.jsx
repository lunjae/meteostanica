import { useEffect, useMemo, useRef, useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'

const MAX_ROWS = 5000
const RANGES = [
  { key: '1h', label: '1 h', ms: 3600e3 },
  { key: '6h', label: '6 h', ms: 6 * 3600e3 },
  { key: '24h', label: '24 h', ms: 24 * 3600e3 },
  { key: 'sve', label: 'Sve', ms: Infinity },
]
const INTERVALS = [10, 30, 60, 300, 600]

// Granice kvaliteta vazduha po CO2 (ppm)
const CO2_ZONES = [
  { to: 800, label: 'Odličan vazduh', color: 'var(--ok)' },
  { to: 1000, label: 'Dobar vazduh', color: 'var(--good)' },
  { to: 1400, label: 'Slabo provetreno', color: 'var(--warn)' },
  { to: 2000, label: 'Otvori prozor', color: 'var(--bad)' },
]
const CO2_MIN = 400
const CO2_MAX = 2000

const num = (v, d = 1) => (v == null ? '–' : Number(v).toFixed(d))
const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
const hhmm = (t) => new Date(t).toLocaleTimeString('sr-RS', { hour: '2-digit', minute: '2-digit' })

function ago(sec) {
  if (sec < 5) return 'upravo sada'
  if (sec < 60) return `pre ${Math.floor(sec)} s`
  if (sec < 3600) return `pre ${Math.floor(sec / 60)} min`
  return `pre ${Math.floor(sec / 3600)} h`
}

function zoneFor(co2) {
  return CO2_ZONES.find((z) => co2 <= z.to) ?? CO2_ZONES[CO2_ZONES.length - 1]
}

function normalize(r) {
  return { ...r, t: new Date(r.time).getTime() }
}

export default function App() {
  const [sensors, setSensors] = useState([])
  const [sensor, setSensor] = useState(null)
  const [rows, setRows] = useState([])
  const [live, setLive] = useState(false)
  const [mqttOk, setMqttOk] = useState(null)
  const [range, setRange] = useState('6h')
  const [now, setNow] = useState(Date.now())
  const [intervalSent, setIntervalSent] = useState('')
  const sensorRef = useRef(null)

  sensorRef.current = sensor

  // sat za "pre X s"
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  // status servera i lista stanica
  useEffect(() => {
    let stop = false
    const load = () =>
      fetch('/api/status')
        .then((r) => r.json())
        .then((s) => {
          if (stop) return
          setMqttOk(s.mqtt_connected)
          setSensors(s.sensors ?? [])
          setSensor((cur) => cur ?? (s.sensors?.[0] ?? null))
        })
        .catch(() => !stop && setMqttOk(null))
    load()
    const id = setInterval(load, 15000)
    return () => { stop = true; clearInterval(id) }
  }, [])

  // istorija za izabranu stanicu
  useEffect(() => {
    if (sensor == null) return
    fetch(`/api/readings?sensor=${sensor}&limit=${MAX_ROWS}`)
      .then((r) => r.json())
      .then((list) => setRows((list ?? []).map(normalize)))
      .catch(() => setRows([]))
  }, [sensor])

  // nova merenja uzivo (SSE)
  useEffect(() => {
    const es = new EventSource('/api/stream')
    es.onopen = () => setLive(true)
    es.onerror = () => setLive(false)
    es.onmessage = (e) => {
      const r = normalize(JSON.parse(e.data))
      setSensors((s) => (s.includes(r.sensor_id) ? s : [...s, r.sensor_id].sort((a, b) => a - b)))
      setSensor((cur) => cur ?? r.sensor_id)
      if (r.sensor_id === sensorRef.current) {
        setRows((prev) => [...prev, r].slice(-MAX_ROWS))
      }
    }
    return () => es.close()
  }, [])

  const last = rows.length ? rows[rows.length - 1] : null
  const secAgo = last ? (now - last.t) / 1000 : null
  const stale = secAgo != null && secAgo > 180

  const visible = useMemo(() => {
    const span = RANGES.find((r) => r.key === range).ms
    if (!isFinite(span)) return rows
    const from = Date.now() - span
    return rows.filter((r) => r.t >= from)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, range, Math.floor(now / 30000)])

  const sendInterval = (sec) => {
    setIntervalSent('')
    fetch('/api/cmd', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sensor, cmd: `INTERVAL:${sec}` }),
    })
      .then((r) => setIntervalSent(r.ok ? `Poslato: ${sec} s` : 'Slanje nije uspelo'))
      .catch(() => setIntervalSent('Slanje nije uspelo'))
  }

  const status = !live
    ? { cls: 'off', text: 'Nema veze sa serverom' }
    : mqttOk === false
      ? { cls: 'off', text: 'Server ne vidi MQTT broker' }
      : stale
        ? { cls: 'warn', text: 'Stanica ne šalje podatke' }
        : { cls: 'on', text: 'Uživo' }

  return (
    <div className="page">
      <header className="top">
        <h1>Meteo stanica</h1>
        <div className="top-right">
          {sensors.length > 1 && (
            <label className="select">
              Stanica
              <select value={sensor ?? ''} onChange={(e) => setSensor(Number(e.target.value))}>
                {sensors.map((id) => <option key={id} value={id}>{id}</option>)}
              </select>
            </label>
          )}
          <div className={`status ${status.cls}`} role="status">
            <span className="dot" />
            <span>{status.text}</span>
            {last && <span className="muted"> · poslednje merenje {ago(secAgo)}</span>}
          </div>
        </div>
      </header>

      {!last ? (
        <section className="empty">
          <h2>Čekam prvo merenje</h2>
          <p>
            Server je pokrenut, ali stanica još nije poslala podatke. Proveri da li stanica
            šalje na topic <code>meteo/1/reading</code> i da je MQTT broker pokrenut.
          </p>
        </section>
      ) : (
        <>
          <section className="hero">
            <Co2 value={last.co2} />
            <dl className="readings">
              <Reading label="Temperatura" value={num(last.temp ?? last.temp_scd)} unit="°C" />
              <Reading label="Vlažnost vazduha" value={num(last.hum, 0)} unit="%" />
              {last.voda_mm != null && <Reading label="Nivo vode" value={num(last.voda_mm, 0)} unit="mm" />}
              {last.batt_percent != null && (
                <Reading
                  label="Baterija"
                  value={num(last.batt_percent, 0)}
                  unit="%"
                  note={last.voltage != null ? `${num(last.voltage, 2)} V` : null}
                />
              )}
            </dl>
          </section>

          <section className="charts">
            <div className="charts-head">
              <h2>Kretanje u vremenu</h2>
              <div className="seg" role="group" aria-label="Vremenski opseg">
                {RANGES.map((r) => (
                  <button key={r.key} className={range === r.key ? 'on' : ''} onClick={() => setRange(r.key)}>
                    {r.label}
                  </button>
                ))}
              </div>
            </div>

            <Chart title="CO₂" unit="ppm" data={visible}
              series={[{ key: 'co2', name: 'CO₂', color: 'var(--c-co2)' }]} />
            <Chart title="Temperatura i vlažnost" data={visible}
              series={[
                { key: 'temp', name: 'Temperatura (°C)', color: 'var(--c-temp)', axis: 'left' },
                { key: 'hum', name: 'Vlažnost (%)', color: 'var(--c-hum)', axis: 'right' },
              ]} />
            <Chart title="Nivo vode" unit="mm" data={visible}
              series={[{ key: 'voda_mm', name: 'Nivo vode (mm)', color: 'var(--c-water)' }]} />
            <Chart title="Baterija" unit="%" data={visible}
              series={[{ key: 'batt_percent', name: 'Baterija (%)', color: 'var(--c-batt)' }]} />
          </section>

          <footer className="foot">
            <label className="select">
              Interval slanja stanice
              <select defaultValue="" onChange={(e) => e.target.value && sendInterval(e.target.value)}>
                <option value="" disabled>izaberi…</option>
                {INTERVALS.map((s) => (
                  <option key={s} value={s}>{s < 60 ? `${s} s` : `${s / 60} min`}</option>
                ))}
              </select>
            </label>
            {intervalSent && <span className="muted">{intervalSent}</span>}
          </footer>
        </>
      )}
    </div>
  )
}

function Co2({ value }) {
  if (value == null) {
    return (
      <div className="co2">
        <div className="co2-label">Ugljen-dioksid</div>
        <div className="co2-value"><span className="big">–</span></div>
        <p className="muted">Senzor CO₂ nije poslao vrednost.</p>
      </div>
    )
  }
  const zone = zoneFor(value)
  const pos = clamp((value - CO2_MIN) / (CO2_MAX - CO2_MIN), 0, 1) * 100
  let prev = CO2_MIN
  const segs = CO2_ZONES.map((z) => {
    const w = ((z.to - prev) / (CO2_MAX - CO2_MIN)) * 100
    prev = z.to
    return { ...z, w }
  })
  return (
    <div className="co2">
      <div className="co2-label">Ugljen-dioksid</div>
      <div className="co2-value">
        <span className="big" style={{ color: zone.color }}>{Math.round(value)}</span>
        <span className="unit">ppm</span>
      </div>
      <div className="co2-zone" style={{ color: zone.color }}>{zone.label}</div>
      <div className="scale" aria-hidden="true">
        <div className="bar">
          {segs.map((s) => <i key={s.to} style={{ width: `${s.w}%`, background: s.color }} />)}
        </div>
        <span className="marker" style={{ left: `${pos}%` }} />
        <div className="ticks"><span>400</span><span>1000</span><span>2000</span></div>
      </div>
    </div>
  )
}

function Reading({ label, value, unit, note }) {
  return (
    <div className="reading">
      <dt>{label}</dt>
      <dd>
        <span className="v">{value}</span>
        <span className="u">{unit}</span>
        {note && <span className="note">{note}</span>}
      </dd>
    </div>
  )
}

function Chart({ title, unit, series, data }) {
  const has = series.some((s) => data.some((d) => d[s.key] != null))
  if (!has) return null
  const twoAxes = series.some((s) => s.axis === 'right')
  const axisStyle = { fill: 'var(--muted)', fontSize: 12 }
  return (
    <div className="chart">
      <h3>{title}{unit && <span className="muted"> ({unit})</span>}</h3>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data} margin={{ top: 6, right: 8, left: -12, bottom: 0 }}>
          <CartesianGrid stroke="var(--line)" vertical={false} />
          <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']}
            tickFormatter={hhmm} tick={axisStyle} stroke="var(--line)" minTickGap={48} />
          <YAxis yAxisId="left" tick={axisStyle} stroke="var(--line)" domain={['auto', 'auto']} width={48} />
          {twoAxes && (
            <YAxis yAxisId="right" orientation="right" tick={axisStyle} stroke="var(--line)"
              domain={['auto', 'auto']} width={40} />
          )}
          <Tooltip
            labelFormatter={(t) => new Date(t).toLocaleString('sr-RS')}
            formatter={(v, name) => [v == null ? '–' : Number(v).toFixed(1), name]}
            contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 6, color: 'var(--ink)' }}
          />
          {series.map((s) => (
            <Line key={s.key} yAxisId={s.axis ?? 'left'} type="monotone" dataKey={s.key} name={s.name}
              stroke={s.color} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
