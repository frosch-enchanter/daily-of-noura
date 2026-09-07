import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import {
  Droplet,
  Milk,
  Baby,
  Moon,
  Sun,
  Ruler,
  Weight,
  CircleDot,
  Play,
  Pause,
  Plus,
  MessageCircle,
  Trash2,
} from 'lucide-react';
import { db } from './firebase';
import {
  collection,
  addDoc,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  orderBy,
} from 'firebase/firestore';

const INK = '#2E2A26';
const CREAM = '#FBF6EE';
const CLAY = '#C97B5A';
const SAGE = '#7C9473';
const SKY = '#6E92A8';
const SAND = '#E8DCC8';

const LOG_TYPES = [
  { key: 'pipis', label: 'Pipis', icon: Droplet, color: SKY },
  { key: 'pup', label: 'Pup', icon: CircleDot, color: '#B0793F' },
  { key: 'susu', label: 'Minum susu', icon: Milk, color: CLAY },
  { key: 'popok', label: 'Ganti popok', icon: Baby, color: SAGE },
  { key: 'asi', label: 'Perah ASI', icon: Milk, color: '#A97CA8' },
  { key: 'tidur', label: 'Tidur', icon: Moon, color: '#4E5D6C' },
  { key: 'tummy', label: 'Tummy time', icon: Sun, color: '#D4A24C' },
];

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function nowTime() {
  const d = new Date();
  return d.toTimeString().slice(0, 5);
}
function fmtDateID(s) {
  const d = new Date(s + 'T00:00:00');
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
}

const seedLogs = [
  { id: 1, type: 'susu', date: todayStr(), time: '06:10', note: '120 ml' },
  { id: 2, type: 'popok', date: todayStr(), time: '06:20', note: '' },
  { id: 3, type: 'tidur', date: todayStr(), time: '07:00', note: '1j 30m' },
  { id: 4, type: 'pipis', date: todayStr(), time: '09:15', note: '' },
  { id: 5, type: 'tummy', date: todayStr(), time: '10:00', note: '10 menit' },
];

const seedGrowth = [
  { date: '2026-04-07', month: 'Lahir', weight: 3.2, height: 49, head: 34 },
  { date: '2026-05-07', month: '1 bln', weight: 4.3, height: 53, head: 37 },
  { date: '2026-06-07', month: '2 bln', weight: 5.2, height: 56, head: 39 },
  { date: '2026-07-07', month: '3 bln', weight: 6.0, height: 59, head: 40.5 },
  { date: '2026-08-07', month: '4 bln', weight: 6.7, height: 62, head: 41.5 },
  { date: '2026-09-07', month: '5 bln', weight: 7.3, height: 64, head: 42.3 },
];

const NOISE_TRACKS = [
  { key: 'white', label: 'White noise', freq: null, type: 'white' },
  { key: 'rain', label: 'Suara hujan', freq: 200, type: 'rain' },
  { key: 'womb', label: 'Suara rahim (womb)', freq: 90, type: 'womb' },
  { key: 'fan', label: 'Kipas angin', freq: 120, type: 'fan' },
];

function useNoisePlayer() {
  const ctxRef = useRef(null);
  const nodesRef = useRef({});
  const [playing, setPlaying] = useState(null);
  const [volume, setVolume] = useState(0.5);

  const stop = () => {
    const nodes = nodesRef.current;
    if (nodes.source) {
      try {
        nodes.source.stop();
      } catch (e) {}
    }
    if (nodes.gain) nodes.gain.disconnect();
    nodesRef.current = {};
    setPlaying(null);
  };

  const play = (track) => {
    stop();
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!ctxRef.current) ctxRef.current = new AudioCtx();
    const ctx = ctxRef.current;
    if (ctx.state === 'suspended') ctx.resume();

    const bufferSize = 2 * ctx.sampleRate;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let lastOut = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      lastOut = (lastOut + 0.02 * white) / 1.02;
      data[i] = lastOut * 3.5;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    const filter = ctx.createBiquadFilter();
    if (track.type === 'rain') {
      filter.type = 'highpass';
      filter.frequency.value = 800;
    } else if (track.type === 'womb') {
      filter.type = 'lowpass';
      filter.frequency.value = 300;
    } else if (track.type === 'fan') {
      filter.type = 'bandpass';
      filter.frequency.value = 500;
      filter.Q.value = 0.7;
    } else {
      filter.type = 'allpass';
    }

    const gain = ctx.createGain();
    gain.gain.value = volume;

    source.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    source.start();

    nodesRef.current = { source, gain, filter };
    setPlaying(track.key);
  };

  useEffect(() => {
    if (nodesRef.current.gain) nodesRef.current.gain.gain.value = volume;
  }, [volume]);

  useEffect(() => () => stop(), []);

  return { playing, play, stop, volume, setVolume };
}

export default function App() {
  const [tab, setTab] = useState('log');
  const [logs, setLogs] = useState([]);
  const [growth, setGrowth] = useState(seedGrowth);
  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [showAdd, setShowAdd] = useState(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const noise = useNoisePlayer();

  // Sinkron real-time dari Firestore: koleksi "logs" dan "growth"
  useEffect(() => {
    const logsQuery = query(collection(db, 'logs'), orderBy('date', 'desc'));
    const unsubLogs = onSnapshot(logsQuery, (snap) => {
      setLogs(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });

    const growthQuery = query(collection(db, 'growth'), orderBy('date', 'asc'));
    const unsubGrowth = onSnapshot(growthQuery, (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      if (rows.length > 0) setGrowth(rows); // pakai data seed sampai ada data asli
    });

    return () => {
      unsubLogs();
      unsubGrowth();
    };
  }, []);

  const dayLogs = useMemo(
    () =>
      logs
        .filter((l) => l.date === selectedDate)
        .sort((a, b) => a.time.localeCompare(b.time)),
    [logs, selectedDate]
  );

  const addLog = async (type) => {
    await addDoc(collection(db, 'logs'), {
      type,
      date: selectedDate,
      time: nowTime(),
      note: noteDraft,
    });
    setNoteDraft('');
    setShowAdd(null);
  };

  const removeLog = async (id) => {
    await deleteDoc(doc(db, 'logs', id));
  };

  const counts = useMemo(() => {
    const c = {};
    LOG_TYPES.forEach((t) => (c[t.key] = 0));
    dayLogs.forEach((l) => (c[l.type] = (c[l.type] || 0) + 1));
    return c;
  }, [dayLogs]);

  const latest = growth[growth.length - 1];

  return (
    <div
      style={{
        background: CREAM,
        minHeight: '100vh',
        color: INK,
        fontFamily: "'Iowan Old Style','Palatino Linotype',Georgia,serif",
      }}
    >
      <style>{`
        * { box-sizing: border-box; }
        button { font-family: inherit; cursor: pointer; }
        input, textarea { font-family: inherit; }
        ::selection { background: ${SAND}; }
      `}</style>

      <div
        style={{ maxWidth: 860, margin: '0 auto', padding: '28px 20px 100px' }}
      >
        <header
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            marginBottom: 22,
            borderBottom: `1px solid ${SAND}`,
            paddingBottom: 16,
          }}
        >
          <div>
            <div
              style={{
                fontSize: 12,
                letterSpacing: 1,
                color: CLAY,
                marginBottom: 4,
              }}
            >
              tumbuh kembang
            </div>
            <h1 style={{ margin: 0, fontSize: 30, fontWeight: 500 }}>
              Si Kecil
            </h1>
          </div>
          <div style={{ textAlign: 'right', fontSize: 13, color: '#6b6559' }}>
            {latest.weight} kg &middot; {latest.height} cm
            <br />
            lingkar kepala {latest.head} cm
          </div>
        </header>

        <nav
          style={{
            display: 'flex',
            gap: 6,
            marginBottom: 24,
            flexWrap: 'wrap',
          }}
        >
          {[
            ['log', 'Catatan harian'],
            ['growth', 'Grafik tumbuh'],
            ['noise', 'White noise'],
            ['wa', 'Lewat WhatsApp'],
          ].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              style={{
                padding: '8px 16px',
                borderRadius: 20,
                border: `1px solid ${tab === key ? INK : SAND}`,
                background: tab === key ? INK : 'transparent',
                color: tab === key ? CREAM : INK,
                fontSize: 14,
              }}
            >
              {label}
            </button>
          ))}
        </nav>

        {tab === 'log' && (
          <div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                marginBottom: 18,
              }}
            >
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                style={{
                  border: `1px solid ${SAND}`,
                  borderRadius: 8,
                  padding: '6px 10px',
                  background: 'white',
                  fontSize: 14,
                }}
              />
              <span style={{ fontSize: 14, color: '#8a8272' }}>
                {fmtDateID(selectedDate)} &middot; {dayLogs.length} catatan
              </span>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill,minmax(120px,1fr))',
                gap: 10,
                marginBottom: 26,
              }}
            >
              {LOG_TYPES.map((t) => {
                const Icon = t.icon;
                const isOpen = showAdd === t.key;
                return (
                  <div key={t.key}>
                    <button
                      onClick={() => {
                        setShowAdd(isOpen ? null : t.key);
                        setNoteDraft('');
                      }}
                      style={{
                        width: '100%',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'flex-start',
                        gap: 8,
                        padding: '14px 12px',
                        borderRadius: 14,
                        border: `1px solid ${isOpen ? t.color : SAND}`,
                        background: isOpen ? `${t.color}14` : 'white',
                        textAlign: 'left',
                      }}
                    >
                      <Icon size={18} color={t.color} />
                      <div style={{ fontSize: 13.5 }}>{t.label}</div>
                      <div style={{ fontSize: 12, color: '#9a9384' }}>
                        {counts[t.key] || 0}x hari ini
                      </div>
                    </button>
                    {isOpen && (
                      <div
                        style={{
                          marginTop: 6,
                          padding: 10,
                          background: 'white',
                          border: `1px solid ${SAND}`,
                          borderRadius: 10,
                        }}
                      >
                        <input
                          autoFocus
                          value={noteDraft}
                          onChange={(e) => setNoteDraft(e.target.value)}
                          placeholder="Catatan (opsional)"
                          style={{
                            width: '100%',
                            border: `1px solid ${SAND}`,
                            borderRadius: 6,
                            padding: '6px 8px',
                            fontSize: 13,
                            marginBottom: 8,
                          }}
                        />
                        <button
                          onClick={() => addLog(t.key)}
                          style={{
                            width: '100%',
                            background: t.color,
                            color: 'white',
                            border: 'none',
                            borderRadius: 6,
                            padding: '7px 0',
                            fontSize: 13,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 6,
                          }}
                        >
                          <Plus size={14} /> Simpan {t.label.toLowerCase()}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <h3
              style={{
                fontSize: 16,
                fontWeight: 500,
                marginBottom: 10,
                color: '#5a544a',
              }}
            >
              Riwayat hari ini
            </h3>
            {dayLogs.length === 0 ? (
              <div
                style={{ color: '#9a9384', fontSize: 14, padding: '20px 0' }}
              >
                Belum ada catatan untuk tanggal ini.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {dayLogs.map((l) => {
                  const meta = LOG_TYPES.find((t) => t.key === l.type);
                  const Icon = meta.icon;
                  return (
                    <div
                      key={l.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        padding: '10px 12px',
                        background: 'white',
                        border: `1px solid ${SAND}`,
                        borderRadius: 10,
                      }}
                    >
                      <div
                        style={{ fontSize: 13, color: '#8a8272', width: 44 }}
                      >
                        {l.time}
                      </div>
                      <Icon size={16} color={meta.color} />
                      <div style={{ flex: 1, fontSize: 14 }}>
                        {meta.label}
                        {l.note ? ` — ${l.note}` : ''}
                      </div>
                      <button
                        onClick={() => removeLog(l.id)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#c0392b',
                          opacity: 0.6,
                        }}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {tab === 'growth' && (
          <div>
            <GrowthSection growth={growth} setGrowth={setGrowth} />
          </div>
        )}

        {tab === 'noise' && (
          <div>
            <p
              style={{
                fontSize: 14,
                color: '#6b6559',
                marginBottom: 20,
                maxWidth: 480,
              }}
            >
              Putar suara latar untuk membantu si kecil tidur. Suara dibuat
              langsung di peramban, tidak perlu file audio.
            </p>
            <div style={{ display: 'grid', gap: 10, maxWidth: 420 }}>
              {NOISE_TRACKS.map((tr) => {
                const active = noise.playing === tr.key;
                return (
                  <button
                    key={tr.key}
                    onClick={() => (active ? noise.stop() : noise.play(tr))}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 14,
                      padding: '14px 16px',
                      borderRadius: 12,
                      border: `1px solid ${active ? SKY : SAND}`,
                      background: active ? `${SKY}18` : 'white',
                      textAlign: 'left',
                    }}
                  >
                    <div
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: '50%',
                        background: active ? SKY : SAND,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'white',
                        flexShrink: 0,
                      }}
                    >
                      {active ? <Pause size={15} /> : <Play size={15} />}
                    </div>
                    <div style={{ fontSize: 14.5 }}>{tr.label}</div>
                  </button>
                );
              })}
            </div>
            {noise.playing && (
              <div style={{ marginTop: 22, maxWidth: 420 }}>
                <label style={{ fontSize: 13, color: '#8a8272' }}>Volume</label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={noise.volume}
                  onChange={(e) => noise.setVolume(parseFloat(e.target.value))}
                  style={{ width: '100%' }}
                />
              </div>
            )}
          </div>
        )}

        {tab === 'wa' && (
          <div style={{ maxWidth: 520 }}>
            <div
              style={{
                display: 'flex',
                gap: 10,
                alignItems: 'center',
                marginBottom: 14,
              }}
            >
              <MessageCircle size={20} color={SAGE} />
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 500 }}>
                Catat lewat WhatsApp
              </h3>
            </div>
            <p style={{ fontSize: 14, color: '#6b6559', lineHeight: 1.6 }}>
              Kirim pesan singkat ke nomor bot dan otomatis tercatat di sini,
              contoh format:
            </p>
            <div
              style={{
                background: 'white',
                border: `1px solid ${SAND}`,
                borderRadius: 10,
                padding: 14,
                fontSize: 13.5,
                lineHeight: 2,
                marginTop: 8,
              }}
            >
              <div>
                <b>pipis</b> — catat pipis jam sekarang
              </div>
              <div>
                <b>pup 14:20</b> — catat pup jam 14:20
              </div>
              <div>
                <b>susu 120ml</b> — catat minum susu + jumlah
              </div>
              <div>
                <b>popok</b> — catat ganti popok
              </div>
              <div>
                <b>asi 80ml</b> — catat perah ASI
              </div>
              <div>
                <b>tidur mulai</b> / <b>tidur bangun</b> — catat siklus tidur
              </div>
              <div>
                <b>tummy 10 menit</b> — catat tummy time
              </div>
              <div>
                <b>bb 6.7 tb 62 lk 41.5</b> — catat berat/tinggi/lingkar kepala
              </div>
            </div>
            <p
              style={{
                fontSize: 13,
                color: '#9a9384',
                marginTop: 14,
                lineHeight: 1.6,
              }}
            >
              Catatan: bot WhatsApp perlu server terpisah (WhatsApp Business API
              atau layanan seperti Twilio/Fonnte) yang meneruskan pesan ke
              aplikasi ini. Bagian dashboard ini siap menerima data itu —
              sambungkan endpoint-nya saat backend sudah ada.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function GrowthSection({ growth, setGrowth }) {
  const [form, setForm] = useState({
    date: todayStr(),
    month: '',
    weight: '',
    height: '',
    head: '',
  });

  const addPoint = async () => {
    if (!form.weight || !form.height || !form.head) return;
    await addDoc(collection(db, 'growth'), {
      date: form.date,
      month: form.month || fmtDateID(form.date),
      weight: parseFloat(form.weight),
      height: parseFloat(form.height),
      head: parseFloat(form.head),
    });
    // onSnapshot di App akan otomatis update grafik
    setForm({ date: todayStr(), month: '', weight: '', height: '', head: '' });
  };

  const charts = [
    { key: 'weight', label: 'Berat badan (kg)', color: CLAY, icon: Weight },
    { key: 'height', label: 'Tinggi badan (cm)', color: SAGE, icon: Ruler },
    { key: 'head', label: 'Lingkar kepala (cm)', color: SKY, icon: CircleDot },
  ];

  return (
    <div>
      {charts.map((c) => {
        const Icon = c.icon;
        return (
          <div key={c.key} style={{ marginBottom: 30 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: 8,
              }}
            >
              <Icon size={16} color={c.color} />
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 500 }}>
                {c.label}
              </h3>
            </div>
            <div
              style={{
                background: 'white',
                border: `1px solid ${SAND}`,
                borderRadius: 12,
                padding: '14px 10px 4px',
              }}
            >
              <ResponsiveContainer width="100%" height={190}>
                <LineChart
                  data={growth}
                  margin={{ top: 5, right: 16, left: -14, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke={SAND} />
                  <XAxis
                    dataKey="month"
                    tick={{ fontSize: 11, fill: '#8a8272' }}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#8a8272' }}
                    domain={['auto', 'auto']}
                  />
                  <Tooltip
                    contentStyle={{
                      fontSize: 12,
                      borderRadius: 8,
                      border: `1px solid ${SAND}`,
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey={c.key}
                    stroke={c.color}
                    strokeWidth={2.5}
                    dot={{ r: 3.5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        );
      })}

      <div
        style={{
          background: 'white',
          border: `1px solid ${SAND}`,
          borderRadius: 12,
          padding: 16,
        }}
      >
        <h3 style={{ margin: '0 0 10px', fontSize: 15, fontWeight: 500 }}>
          Tambah pengukuran baru
        </h3>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit,minmax(110px,1fr))',
            gap: 8,
          }}
        >
          <input
            type="date"
            value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
            style={inputStyle}
          />
          <input
            placeholder="Label (mis. 6 bln)"
            value={form.month}
            onChange={(e) => setForm({ ...form, month: e.target.value })}
            style={inputStyle}
          />
          <input
            placeholder="Berat (kg)"
            value={form.weight}
            onChange={(e) => setForm({ ...form, weight: e.target.value })}
            style={inputStyle}
          />
          <input
            placeholder="Tinggi (cm)"
            value={form.height}
            onChange={(e) => setForm({ ...form, height: e.target.value })}
            style={inputStyle}
          />
          <input
            placeholder="Lingkar kepala (cm)"
            value={form.head}
            onChange={(e) => setForm({ ...form, head: e.target.value })}
            style={inputStyle}
          />
        </div>
        <button
          onClick={addPoint}
          style={{
            marginTop: 10,
            background: INK,
            color: CREAM,
            border: 'none',
            borderRadius: 8,
            padding: '9px 18px',
            fontSize: 13.5,
          }}
        >
          Simpan pengukuran
        </button>
      </div>
    </div>
  );
}

const inputStyle = {
  border: `1px solid ${SAND}`,
  borderRadius: 8,
  padding: '8px 10px',
  fontSize: 13,
};
