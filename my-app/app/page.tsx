"use client";

import { useState, useEffect } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import WindTurbineScene from "./components/WindTurbineModel";

// --- INFLUXDB CLOUD CREDENTIALS ---
const INFLUX_URL = "https://eu-central-1-1.aws.cloud2.influxdata.com/api/v2/query?org=BBD";
const INFLUX_TOKEN = "S00vfLTsHtpgVh7NsHnJSdjBDxy8SZcEkewHpwnB99sbbqTI-jAST2K45xzno8nCxHqrv2b8vWGmYKmdfv4zbw==";

const fluxQuery = `
  from(bucket: "turbine_data")
    |> range(start: -60s)
    |> filter(fn: (r) => r._measurement == "vibration")
    |> last()
`;

export default function WindTurbineDashboard() {
  // --- STATE MANAGEMENT ---
  const [angle, setAngle] = useState(0);              // Rankinis tikslinis kampas (žingsninis)
  const [turbineSpeed, setTurbineSpeed] = useState(0); // DC variklio greitis (0-255)
  const [vibrationData, setVibrationData] = useState<any[]>([]);
  const [liveWindAngle, setLiveWindAngle] = useState(0); // Gyvi AS5600 jutiklio duomenys

  // NAUJA: Autopiloto būsenos valdymas (pagal nutylėjimą įjungtas)
  const [isAutoYaw, setIsAutoYaw] = useState(true);

  // Anomalijų aptikimo būsenos valdymas
  const [anomalyDetected, setAnomalyDetected] = useState(false);
  const VIBRATION_THRESHOLD = 2.5; // Kritinis slenkstis m/s² (galite koreguoti pagal testus)

  // Svarbu: įsitikinkite, kad IP sutampa su ESP32 nurodytu adresu!
  const espIP = "192.168.68.111";

  // ==========================================
  // HARDWARE COMMAND FUNCTIONS (Sending to ESP32)
  // ==========================================

  // NAUJA: Funkcija valdyti ESP32 autopilotą
  const toggleAutopilot = async (checked: boolean) => {
    setIsAutoYaw(checked);
    try {
      await fetch(`http://${espIP}/setAutoYaw?state=${checked}`);
    } catch (error) {
      console.error("Ryšio klaida (Autopilot):", error);
    }
  };

  const sendAngleToESP = async (value: number) => {
    try {
      await fetch(`http://${espIP}/setAngle?val=${value}`);
    } catch (error) {
      console.error("Ryšio klaida (Kryptis):", error);
    }
  };

  const sendSpeedToESP = async (value: number) => {
    try {
      await fetch(`http://${espIP}/setMainMotor?speed=${value}`);
    } catch (error) {
      console.error("Ryšio klaida (Greitis):", error);
    }
  };

  // ==========================================
  // LOCAL TELEMETRY (Live AS5600 Polling)
  // ==========================================
  useEffect(() => {
    const fetchLiveSensors = async () => {
      try {
        const response = await fetch(`http://${espIP}/getSensorData`);
        if (response.ok) {
          const data = await response.json();
          setLiveWindAngle(data.windAngle);
        }
      } catch (error) {
        // Nutildoma klaida, jei ESP32 persikrauna
      }
    };

    const localInterval = setInterval(fetchLiveSensors, 1000);
    return () => clearInterval(localInterval);
  }, []);

  // ==========================================
  // CLOUD TELEMETRY PIPELINE (Reading from AWS)
  // ==========================================
  useEffect(() => {
    const fetchVibration = async () => {
      try {
        const response = await fetch(INFLUX_URL, {
          method: 'POST',
          headers: {
            'Authorization': `Token ${INFLUX_TOKEN}`,
            'Content-Type': 'application/vnd.flux',
            'Accept': 'application/csv'
          },
          body: fluxQuery
        });

        const csvData = await response.text();
        let latestData = { x: 0, y: 0, z: 0 };

        const lines = csvData.split('\n');
        lines.forEach(line => {
          const cols = line.split(',');
          for (let i = 0; i < cols.length; i++) {
            if (cols[i] === 'accelX') latestData.x = parseFloat(cols[i - 1]);
            if (cols[i] === 'accelY') latestData.y = parseFloat(cols[i - 1]);
            if (cols[i] === 'accelZ') latestData.z = parseFloat(cols[i - 1]);
          }
        });

        if (latestData.z !== 0 || latestData.x !== 0) {
          const hasXAnomaly = Math.abs(latestData.x) > VIBRATION_THRESHOLD;
          const hasYAnomaly = Math.abs(latestData.y) > VIBRATION_THRESHOLD;

          if (hasXAnomaly || hasYAnomaly) {
            setAnomalyDetected(true);
            setTurbineSpeed(0);   
            sendSpeedToESP(0);    
          }

          const newDataPoint = {
            time: new Date().toLocaleTimeString('en-GB', { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
            x: Number(latestData.x.toFixed(2)),
            y: Number(latestData.y.toFixed(2)),
            z: Number(latestData.z.toFixed(2))
          };
          setVibrationData(prevData => [...prevData.slice(-19), newDataPoint]);
        }
      } catch (error) {
        // Nutildoma klaida, jei debesijos serveris neatsako
      }
    };

    const interval = setInterval(fetchVibration, 2000);
    return () => clearInterval(interval);
  }, []);

useEffect(() => {
    // Check if the browser supports notifications
    if ("Notification" in window) {
      // If we haven't asked for permission yet, ask now
      if (Notification.permission === "default") {
        Notification.requestPermission();
      }
    }
  }, []);

  // ==========================================
  // TRIGGER DESKTOP ALERT
  // ==========================================
  useEffect(() => {
    if (anomalyDetected) {
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification("⚠️ TURBINE EMERGENCY!", {
          body: `Critical vibration detected (> ${VIBRATION_THRESHOLD} m/s²). Auto-shutdown initiated.`,
          icon: "https://cdn-icons-png.flaticon.com/512/564/564246.png", // Just a warning triangle icon
          requireInteraction: true // Keeps the notification on screen until the user dismisses it
        });
      }
    }
  }, [anomalyDetected]);

  // ==========================================
  // UI RENDER
  // ==========================================
  return (
    <div className="min-h-screen bg-slate-900 text-white p-6 md:p-12">
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* HEADER */}
        <header className="flex flex-col md:flex-row items-center justify-between pb-6 border-b border-slate-800 gap-4">
          <h1 className="text-3xl font-extrabold text-cyan-400">
            Wind Turbine Digital Twin
          </h1>
          <div className="flex gap-4">
            <div className="text-sm px-4 py-2 bg-slate-800 rounded-full border border-slate-700 text-cyan-400 font-mono flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              ESP32: {espIP}
            </div>
          </div>
        </header>

        {/* ANOMALIJOS SKYDELIS */}
        {anomalyDetected && (
          <div className="bg-red-950/40 border-2 border-red-500 text-red-200 p-6 rounded-2xl flex flex-col md:flex-row items-center justify-between gap-4 animate-pulse shadow-[0_0_25px_rgba(239,68,68,0.15)]">
            <div className="flex items-center gap-4">
              <span className="relative flex h-4 w-4">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-4 w-4 bg-red-500"></span>
              </span>
              <div>
                <h3 className="font-bold text-red-400 text-lg">⚠️ UŽFIKSUOTA MECHANINĖ ANOMALIJA!</h3>
                <p className="text-sm text-slate-400 mt-1">
                  Vibracijos lygis viršijo kritinę ribą ({VIBRATION_THRESHOLD} m/s²). Skaitmeninis dvynys automatiškai aktyvavo apsauginį režimą ir sustabdė turbinos rotorių.
                </p>
              </div>
            </div>
            <button
              onClick={() => setAnomalyDetected(false)}
              className="w-full md:w-auto px-5 py-2 bg-red-600 hover:bg-red-500 text-white font-bold text-sm rounded-xl transition-all shadow-md active:scale-95"
            >
              Anuliuoti klaidą ir atstatyti darbą
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* 3D VIZUALIZACIJA */}
          <div className="lg:col-span-2 space-y-4">
            <h2 className="text-xl font-semibold text-slate-300">
              Live 3D Twin
            </h2>
            <WindTurbineScene angle={liveWindAngle} />
          </div>

          {/* VALDYMO PULTAS (CONTROL PANEL) */}
          <div className="bg-slate-800 p-8 rounded-2xl shadow-2xl border border-slate-700 flex flex-col items-center">
            
            {/* LIVE WIND SENSOR READOUT */}
            <div className="w-full flex flex-col items-center mb-8 pb-8 border-b border-slate-700">
              <h3 className="text-sm font-bold tracking-widest text-slate-400 uppercase mb-4">
                Faktinė Vėjo Kryptis (AS5600)
              </h3>
              <div className="relative w-24 h-24 rounded-full border-4 border-slate-600 flex items-center justify-center bg-slate-900">
                <div
                  className="absolute w-1 h-12 bg-cyan-400 origin-bottom rounded-full transition-transform duration-500 ease-out"
                  style={{ transform: `rotate(${liveWindAngle}deg) translateY(-50%)` }}
                ></div>
                <span className="relative z-10 text-xl font-bold text-white bg-slate-900/80 px-2 rounded">
                  {Math.round(liveWindAngle)}°
                </span>
              </div>
            </div>

            <h3 className="text-xl font-bold mb-6 text-center text-emerald-400">
              Krypties Valdymas
            </h3>
            
            {/* AUTOPILOTO JUNGIKLIS (NAUJA) */}
            <div className="w-full flex items-center justify-between mb-6 bg-slate-900/50 p-4 rounded-xl border border-slate-700">
              <label className="text-sm font-bold text-cyan-400 uppercase tracking-widest cursor-pointer flex items-center gap-3 w-full select-none">
                <input
                  type="checkbox"
                  checked={isAutoYaw}
                  onChange={(e) => toggleAutopilot(e.target.checked)}
                  className="w-5 h-5 accent-cyan-500 cursor-pointer"
                />
                Autopilot (Sekti Vėją)
              </label>
              <div className={`px-3 py-1 rounded text-xs font-bold transition-colors ${isAutoYaw ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/50' : 'bg-slate-700 text-slate-400 border border-transparent'}`}>
                {isAutoYaw ? 'ON' : 'OFF'}
              </div>
            </div>

            {/* STEPPER CONTROL (YAW/DIRECTION) */}
            {/* Pridėta 'opacity' klasė: jei autopilotas įjungtas, slankiklis patamsėja */}
            <div className={`flex flex-col items-center gap-6 w-full transition-opacity duration-300 ${isAutoYaw ? 'opacity-40' : 'opacity-100'}`}>
              <div className="w-full space-y-2 text-center">
                <label className="text-xs uppercase tracking-widest text-slate-500">
                  Target Jėgainės Kryptis
                </label>
                <div className="flex w-full items-center gap-4">
                  <span className="text-sm font-mono text-slate-400">0°</span>
                  <input
                    type="range"
                    min="0"
                    max="360"
                    value={angle}
                    onChange={(e) => {
                      setAngle(parseInt(e.target.value));
                      // Jei vartotojas pajudina slankiklį, automatiškai išjungiame autopilotą UI lygiu
                      if (isAutoYaw) setIsAutoYaw(false);
                    }}
                    onMouseUp={() => sendAngleToESP(angle)}
                    className="w-full h-3 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                  />
                  <span className="text-sm font-mono text-slate-400">360°</span>
                </div>
                <div className="text-cyan-400 font-mono font-bold mt-2">Target: {angle}°</div>
              </div>
            </div>

            {/* DC MOTOR CONTROL (TURBINE RPM/PWM) */}
            <div className="w-full mt-10 pt-8 border-t border-slate-700 flex flex-col items-center">
              <label className="text-xs uppercase tracking-widest text-slate-500 mb-4">
                Turbinos Greitis (PWM)
              </label>
              
              <div className="flex w-full items-center gap-4">
                <span className="text-sm font-mono text-slate-400">0</span>
                <input
                  type="range"
                  min="0"
                  max="255"
                  value={turbineSpeed}
                  disabled={anomalyDetected}
                  onChange={(e) => setTurbineSpeed(parseInt(e.target.value))}
                  onMouseUp={() => sendSpeedToESP(turbineSpeed)}
                  className={`w-full h-3 rounded-lg appearance-none cursor-pointer accent-emerald-500 ${anomalyDetected ? 'bg-slate-800 cursor-not-allowed opacity-50' : 'bg-slate-700'}`}
                />
                <span className="text-sm font-mono text-slate-400">255</span>
              </div>
              <div className="text-center mt-2 text-emerald-400 font-mono text-lg">
                PWR: {Math.round((turbineSpeed / 255) * 100)}%
              </div>

              {/* EMERGENCY STOP BUTTON */}
              <button
                onClick={() => {
                  setTurbineSpeed(0);
                  sendSpeedToESP(0);
                }}
                className="mt-6 w-full py-3 rounded-lg font-bold text-sm bg-red-600/20 border border-red-500/50 hover:bg-red-500 text-red-200 hover:text-white transition-all shadow-[0_0_15px_rgba(239,68,68,0.2)]"
              >
                EMERGENCY STOP
              </button>
            </div>

          </div>
        </div>

        {/* CLOUD VIBRATION TELEMETRY */}
        <div className="bg-slate-800 p-8 rounded-2xl shadow-2xl border border-slate-700 mt-8">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-xl font-bold text-cyan-400">AWS InfluxDB Telemetry</h3>
            <div className="flex items-center gap-2">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
              </span>
              <span className="text-xs text-slate-400 font-mono">LIVE SYNC</span>
            </div>
          </div>
          
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={vibrationData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="time" stroke="#94a3b8" fontSize={12} />
                <YAxis stroke="#94a3b8" />
                <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }} />
                <Line type="monotone" dataKey="x" stroke="#ef4444" strokeWidth={2} dot={false} name="X-Axis (m/s²)" />
                <Line type="monotone" dataKey="y" stroke="#3b82f6" strokeWidth={2} dot={false} name="Y-Axis (m/s²)" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

      </div>
    </div>
  );
}