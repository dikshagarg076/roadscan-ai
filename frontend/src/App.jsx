import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  Upload, Camera, BarChart3, MapPin,
  CheckCircle, XCircle, Loader2, RefreshCw, Info
} from "lucide-react";
import "./App.css";

const API_BASE = process.env.REACT_APP_API_URL || "http://localhost:8000";

const SEVERITY = {
  Low:    { color: "#32CD32", bg: "rgba(50,205,50,0.12)",   border: "rgba(50,205,50,0.35)"   },
  Medium: { color: "#FFA500", bg: "rgba(255,165,0,0.12)",   border: "rgba(255,165,0,0.35)"   },
  High:   { color: "#DC3232", bg: "rgba(220,50,50,0.12)",   border: "rgba(220,50,50,0.35)"   },
};

const TABS = [
  { id: "upload",    label: "Detect",    Icon: Upload    },
  { id: "dashboard", label: "Dashboard", Icon: BarChart3 },
  { id: "map",       label: "Map",       Icon: MapPin    },
];

export default function App() {
  const [tab, setTab]           = useState("upload");
  const [result, setResult]     = useState(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);
  const [history, setHistory]   = useState([]);
  const [preview, setPreview]   = useState(null);
  const [dragging, setDragging] = useState(false);
  const [webcamOn, setWebcam]   = useState(false);

  const fileRef   = useRef();
  const videoRef  = useRef();
  const streamRef = useRef();
  const mapRef    = useRef();
  const leafletMap= useRef();

  const [userLoc, setUserLoc] = useState([28.6139, 77.2090]);

  useEffect(() => {
    navigator.geolocation?.getCurrentPosition(
      ({ coords }) => setUserLoc([coords.latitude, coords.longitude]),
      () => {}
    );
  }, []);

  useEffect(() => {
    if (tab !== "map" || leafletMap.current) return;
    const L = window.L;
    if (!L || !mapRef.current) return;
    const map = L.map(mapRef.current).setView(userLoc, 13);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors",
    }).addTo(map);
    leafletMap.current = map;
    plotAll(map, L, history);
  }, [tab]);

  useEffect(() => {
    if (leafletMap.current && window.L && history.length > 0) {
      plotAll(leafletMap.current, window.L, history);
    }
  }, [history]);

  function plotAll(map, L, scans) {
    scans.forEach((s) => {
      if (!s.location) return;
      const sev = s.result?.severity_breakdown;
      const color = sev?.High > 0 ? "#DC3232" : sev?.Medium > 0 ? "#FFA500" : "#32CD32";
      const icon = L.divIcon({
        className: "",
        html: `<div style="background:${color};width:14px;height:14px;border-radius:50%;border:2px solid #fff;box-shadow:0 0 6px rgba(0,0,0,.6)"></div>`,
        iconSize: [14, 14],
      });
      L.marker(s.location, { icon })
        .bindPopup(
          `<b>Pothole Detected</b><br/>
           Count: ${s.result?.total_count ?? 0}<br/>
           High: ${sev?.High ?? 0} &nbsp; Medium: ${sev?.Medium ?? 0} &nbsp; Low: ${sev?.Low ?? 0}<br/>
           <small>${new Date(s.ts).toLocaleString()}</small>`
        )
        .addTo(map);
    });
  }

  const runDetection = useCallback(async (formData, previewUrl) => {
    setError(null);
    setResult(null);
    setPreview(previewUrl);
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/detect`, { method: "POST", body: formData });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data = await res.json();
      setResult(data);
      navigator.geolocation?.getCurrentPosition(
        ({ coords }) => {
          const loc = [coords.latitude, coords.longitude];
          setHistory((h) => [...h, { result: data, location: loc, ts: Date.now() }]);
        },
        () => setHistory((h) => [...h, { result: data, location: null, ts: Date.now() }])
      );
    } catch (e) {
      setError(e.message || "Detection failed. Is the backend running on port 8000?");
    } finally {
      setLoading(false);
    }
  }, []);

  const onFileInput = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    runDetection(fd, URL.createObjectURL(file));
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (!file?.type.startsWith("image/")) { setError("Please drop an image file."); return; }
    const fd = new FormData();
    fd.append("file", file);
    runDetection(fd, URL.createObjectURL(file));
  };

  const startWebcam = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      videoRef.current.srcObject = stream;
      streamRef.current = stream;
      setWebcam(true);
    } catch { setError("Cannot access webcam."); }
  };

  const stopWebcam = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    setWebcam(false);
  };

  const captureFrame = async () => {
    const canvas = document.createElement("canvas");
    canvas.width  = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    canvas.getContext("2d").drawImage(videoRef.current, 0, 0);
    const b64 = canvas.toDataURL("image/jpeg");
    setError(null); setResult(null); setPreview(b64); setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/detect-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: b64 }),
      });
      const data = await res.json();
      setResult(data);
      setHistory((h) => [...h, { result: data, location: null, ts: Date.now() }]);
    } catch { setError("Capture failed."); }
    finally { setLoading(false); }
  };

  const stats = history.reduce(
    (a, s) => ({
      total:  a.total  + (s.result?.total_count ?? 0),
      scans:  a.scans  + 1,
      High:   a.High   + (s.result?.severity_breakdown?.High   ?? 0),
      Medium: a.Medium + (s.result?.severity_breakdown?.Medium ?? 0),
      Low:    a.Low    + (s.result?.severity_breakdown?.Low    ?? 0),
    }),
    { total: 0, scans: 0, High: 0, Medium: 0, Low: 0 }
  );

  return (
    <div className="app">
      <header className="header">
        <div className="header-inner">
          <div className="brand">
            <span className="brand-icon">🚧</span>
            <div>
              <h1 className="brand-title">RoadScan AI</h1>
              <p className="brand-sub">Pothole Detection System</p>
            </div>
          </div>
          <nav className="tabs">
            {TABS.map(({ id, label, Icon }) => (
              <button key={id} className={`tab-btn ${tab === id ? "active" : ""}`} onClick={() => setTab(id)}>
                <Icon size={15} />{label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="main">

        {tab === "upload" && (
          <div className="detect-layout">
            <div className="upload-panel">
              <h2 className="panel-title">Scan Road Surface</h2>

              <div
                className={`dropzone ${dragging ? "drag-over" : ""}`}
                onClick={() => fileRef.current.click()}
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
              >
                <Upload size={38} />
                <p>Drag & drop a road image</p>
                <span>or click to browse</span>
                <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFileInput} />
              </div>

              <div className="webcam-bar">
                {!webcamOn ? (
                  <button className="btn btn-outline" onClick={startWebcam}>
                    <Camera size={15} /> Use Webcam
                  </button>
                ) : (
                  <div className="webcam-controls">
                    <button className="btn btn-primary" onClick={captureFrame}>📸 Capture & Detect</button>
                    <button className="btn btn-ghost" onClick={stopWebcam}>Stop</button>
                  </div>
                )}
              </div>

              <video ref={videoRef} autoPlay playsInline className={`webcam-feed ${webcamOn ? "visible" : ""}`} />

              {error && (
                <div className="alert alert-error"><XCircle size={15} />{error}</div>
              )}

              {result?.demo_mode && (
                <div className="alert alert-info">
                  <Info size={15} />
                  <span><b>Demo mode</b> — place <code>best.pt</code> in <code>backend/models/</code> to use your trained model.</span>
                </div>
              )}
            </div>

            <div className="result-panel">
              {loading && (
                <div className="state-center">
                  <Loader2 size={44} className="spin" />
                  <p>Analysing road surface…</p>
                </div>
              )}

              {!loading && !preview && (
                <div className="state-center">
                  <span style={{ fontSize: 64 }}>🛣️</span>
                  <p>Upload an image to detect potholes</p>
                </div>
              )}

              {!loading && preview && (
                <div className="result-content">
                  <div className="image-wrapper">
                    <img src={result?.annotated_image || preview} alt="Result" className="result-img" />
                    {result && (
                      <div className="count-badge">{result.total_count} pothole{result.total_count !== 1 ? "s" : ""}</div>
                    )}
                  </div>

                  {result && result.detections.length > 0 && (
                    <div className="det-list">
                      <p className="det-header">Detections</p>
                      {result.detections.map((d, i) => (
                        <div key={i} className="det-item" style={{ borderColor: SEVERITY[d.severity]?.border, background: SEVERITY[d.severity]?.bg }}>
                          <span className="det-dot" style={{ background: SEVERITY[d.severity]?.color }} />
                          <span className="det-label">Pothole</span>
                          <div className="score-bar-wrap">
                            <div className="score-bar-track">
                              <div className="score-bar-fill" style={{ width: `${d.score}%`, background: SEVERITY[d.severity]?.color }} />
                            </div>
                            <span className="score-num" style={{ color: SEVERITY[d.severity]?.color }}>{d.score}/100</span>
                          </div>
                          <span className="det-sev" style={{ color: SEVERITY[d.severity]?.color }}>{d.severity}</span>
                          <span className="det-conf">{(d.confidence * 100).toFixed(0)}%</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {result && result.total_count === 0 && (
                    <div className="alert alert-success"><CheckCircle size={15} />No potholes detected — road looks good!</div>
                  )}

                  <button className="btn btn-ghost full-w" onClick={() => { setResult(null); setPreview(null); }}>
                    <RefreshCw size={13} /> Scan another image
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {tab === "dashboard" && (
          <div className="dashboard">
            <h2 className="panel-title">Detection Dashboard</h2>

            {history.length === 0 ? (
              <div className="state-center" style={{ marginTop: 80 }}>
                <span style={{ fontSize: 56 }}>📊</span>
                <p>No scans yet — detect some potholes first!</p>
                <button className="btn btn-primary" onClick={() => setTab("upload")}>Start Scanning</button>
              </div>
            ) : (
              <>
                <div className="kpi-grid">
                  <KPI value={stats.scans}  label="Total Scans"    color="#60a5fa" />
                  <KPI value={stats.total}  label="Total Potholes" color="#a78bfa" />
                  <KPI value={stats.High}   label="High Severity"  color="#DC3232" />
                  <KPI value={stats.Medium} label="Med Severity"   color="#FFA500" />
                  <KPI value={stats.Low}    label="Low Severity"   color="#32CD32" />
                  <KPI
                    value={stats.scans ? (stats.total / stats.scans).toFixed(1) : 0}
                    label="Avg / Scan"
                    color="#34d399"
                  />
                </div>

                <div className="chart-card">
                  <h3 className="chart-title">Severity Breakdown</h3>
                  <div className="bar-chart">
                    {["High", "Medium", "Low"].map((sev) => {
                      const count = stats[sev];
                      const pct   = stats.total ? (count / stats.total) * 100 : 0;
                      return (
                        <div key={sev} className="bar-row">
                          <span className="bar-label">{sev}</span>
                          <div className="bar-track">
                            <div className="bar-fill" style={{ width: `${pct}%`, background: SEVERITY[sev].color }} />
                          </div>
                          <span className="bar-count">{count}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="chart-card">
                  <h3 className="chart-title">Scan History</h3>
                  <table className="hist-table">
                    <thead>
                      <tr>
                        <th>#</th><th>Time</th><th>Potholes</th>
                        <th style={{ color: "#DC3232" }}>High</th>
                        <th style={{ color: "#FFA500" }}>Med</th>
                        <th style={{ color: "#32CD32" }}>Low</th>
                        <th>GPS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((s, i) => (
                        <tr key={i}>
                          <td>{i + 1}</td>
                          <td>{new Date(s.ts).toLocaleTimeString()}</td>
                          <td><b>{s.result?.total_count}</b></td>
                          <td style={{ color: "#DC3232" }}>{s.result?.severity_breakdown?.High}</td>
                          <td style={{ color: "#FFA500" }}>{s.result?.severity_breakdown?.Medium}</td>
                          <td style={{ color: "#32CD32" }}>{s.result?.severity_breakdown?.Low}</td>
                          <td>{s.location ? "📍" : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}

        {tab === "map" && (
          <div className="map-tab">
            <h2 className="panel-title">Damage Map</h2>
            {history.filter((s) => s.location).length === 0 && (
              <div className="alert alert-info" style={{ marginBottom: 16 }}>
                <MapPin size={15} />
                Allow location access when scanning — detected potholes will appear as colour-coded pins.
              </div>
            )}
            <div ref={mapRef} className="leaflet-map" />
          </div>
        )}

      </main>
    </div>
  );
}

function KPI({ value, label, color }) {
  return (
    <div className="kpi-card">
      <span className="kpi-val" style={{ color }}>{value}</span>
      <span className="kpi-label">{label}</span>
    </div>
  );
}
