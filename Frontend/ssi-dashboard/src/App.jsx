import { useState, useEffect, useRef, useCallback } from "react";

const GW = "http://localhost:8888";
const WS = "ws://localhost:8888/ws";

async function api(method, path, body) {
  const r = await fetch(`${GW}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await r.json().catch(() => ({ detail: r.statusText }));
  if (!r.ok) throw new Error(data.detail || JSON.stringify(data).slice(0, 120));
  return data;
}
const get  = p    => api("GET",  p);
const post = (p, b) => api("POST", p, b);

// ── WebSocket gateway hook ────────────────────────────────────────────────
function useGateway() {
  const [events,   setEvents]   = useState([]);
  const [services, setServices] = useState({});
  const [live,     setLive]     = useState(false);
  const cbs   = useRef({});
  const wsRef = useRef(null);

  const on = useCallback((type, cb) => {
    cbs.current[type] = cbs.current[type] || [];
    cbs.current[type].push(cb);
    return () => { cbs.current[type] = (cbs.current[type] || []).filter(x => x !== cb); };
  }, []);

  useEffect(() => {
    let sock;
    const connect = () => {
      sock = new WebSocket(WS);
      wsRef.current = sock;
      sock.onopen  = () => { setLive(true); sock.send(JSON.stringify({ type: "request_snapshot" })); };
      sock.onclose = () => { setLive(false); wsRef.current = null; setTimeout(connect, 3000); };
      sock.onerror = () => sock.close();
      sock.onmessage = e => {
        const ev = JSON.parse(e.data);
        if (!ev.type || ev.type === "pong") return;
        if (ev.type === "service_health") { setServices(ev.payload); return; }
        setEvents(p => [ev, ...p].slice(0, 120));
        [...(cbs.current[ev.type] || []), ...(cbs.current["*"] || [])].forEach(cb => cb(ev));
      };
    };
    connect();
    const ping = setInterval(() => wsRef.current?.readyState === 1 && wsRef.current.send(JSON.stringify({ type: "ping" })), 20000);
    return () => { clearInterval(ping); sock?.close(); };
  }, []);

  return { live, events, services, on };
}

function useToast() {
  const [toasts, setToasts] = useState([]);
  const add = useCallback((msg, type = "ok") => {
    const id = Date.now();
    setToasts(p => [...p, { id, msg, type }]);
    setTimeout(() => setToasts(p => p.filter(x => x.id !== id)), 4500);
  }, []);
  return { toasts, add };
}

// ── Design tokens ─────────────────────────────────────────────────────────
const S = `
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=Space+Mono:wght@400;700&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#06090f;--bg1:#0b1017;--bg2:#101822;--bg3:#16212e;--bg4:#1d2d3f;
  --teal:#0af0c0;--amber:#ffb830;--red:#ff4560;--blue:#3d8eff;--purple:#9d6fff;--green:#22c55e;
  --t0:#dff0ea;--t1:#7aada0;--t2:#3d6860;
  --line:rgba(10,240,192,0.1);--line2:rgba(10,240,192,0.2);
  --sans:'Space Grotesk',sans-serif;--mono:'Space Mono',monospace}
body{background:var(--bg);color:var(--t0);font-family:var(--sans);min-height:100vh;font-size:14px}
body::before{content:'';position:fixed;inset:0;pointer-events:none;z-index:0;
  background-image:linear-gradient(rgba(10,240,192,0.015) 1px,transparent 1px),linear-gradient(90deg,rgba(10,240,192,0.015) 1px,transparent 1px);
  background-size:40px 40px}
.nav{display:flex;align-items:center;border-bottom:1px solid var(--line2);background:rgba(11,16,23,0.96);backdrop-filter:blur(8px);position:sticky;top:0;z-index:200;overflow-x:auto}
.nav-logo{padding:0 18px;font-size:12px;font-weight:700;letter-spacing:0.15em;color:var(--teal);border-right:1px solid var(--line2);height:48px;display:flex;align-items:center;gap:8px;white-space:nowrap}
.nav-logo span{color:var(--t2);font-weight:400}
.tab{padding:0 16px;height:48px;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;cursor:pointer;color:var(--t2);background:none;border:none;font-family:var(--sans);border-bottom:2px solid transparent;position:relative;top:1px;transition:all 0.15s;white-space:nowrap;font-weight:600}
.tab:hover{color:var(--t1)}.tab.on{color:var(--teal);border-bottom-color:var(--teal)}
.ws-pill{margin-left:auto;padding:0 16px;display:flex;align-items:center;gap:8px;font-size:10px;white-space:nowrap}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}
.live-dot{width:7px;height:7px;border-radius:50%;background:var(--teal);box-shadow:0 0 7px var(--teal);animation:pulse 2s infinite}
.dead-dot{width:7px;height:7px;border-radius:50%;background:var(--t2)}
.lay{display:grid;grid-template-columns:268px 1fr;min-height:calc(100vh - 48px);position:relative;z-index:1}
.sb{border-right:1px solid var(--line);background:var(--bg1);overflow-y:auto;max-height:calc(100vh - 48px)}
.main{overflow-y:auto;max-height:calc(100vh - 48px);padding:22px}
.card{background:var(--bg2);border:1px solid var(--line);border-radius:8px;overflow:hidden;margin-bottom:12px}
.ch{padding:10px 14px;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;gap:8px}
.ct{font-size:9px;letter-spacing:0.13em;text-transform:uppercase;color:var(--t1);font-weight:700;white-space:nowrap}
.cb{padding:14px}
/* credential strip */
.cred{background:var(--bg2);border:1px solid var(--line);border-radius:7px;padding:12px 14px;margin-bottom:8px;cursor:pointer;transition:all .15s;position:relative;overflow:hidden}
.cred::before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--teal);opacity:.6}
.cred:hover{border-color:var(--line2);background:var(--bg3)}.cred.on{border-color:var(--teal);background:var(--bg3)}
.cred::before{background:var(--teal)}
.offer-card{border-color:rgba(255,184,48,.35);background:rgba(255,184,48,.04)}
.offer-card::before{background:var(--amber)}
/* badges */
.badge{display:inline-block;padding:2px 8px;font-size:9px;letter-spacing:.1em;border-radius:3px;font-weight:700;text-transform:uppercase}
.bg{background:rgba(10,240,192,.1);color:var(--teal);border:1px solid rgba(10,240,192,.25)}
.br{background:rgba(255,69,96,.1);color:var(--red);border:1px solid rgba(255,69,96,.25)}
.ba{background:rgba(255,184,48,.1);color:var(--amber);border:1px solid rgba(255,184,48,.25)}
.bb{background:rgba(61,142,255,.1);color:var(--blue);border:1px solid rgba(61,142,255,.25)}
.bp{background:rgba(157,111,255,.1);color:var(--purple);border:1px solid rgba(157,111,255,.25)}
/* buttons */
.btn{padding:8px 16px;font-size:10px;letter-spacing:.12em;text-transform:uppercase;font-family:var(--sans);border-radius:5px;cursor:pointer;border:1px solid;transition:all .15s;font-weight:700;display:inline-flex;align-items:center;gap:6px}
.btn-p{background:var(--teal);color:var(--bg);border-color:var(--teal)}.btn-p:hover{background:#00ffe0;box-shadow:0 0 18px rgba(10,240,192,.3)}.btn-p:disabled{opacity:.35;cursor:not-allowed}
.btn-g{background:transparent;color:var(--t1);border-color:var(--line2)}.btn-g:hover{border-color:var(--teal);color:var(--teal)}.btn-g:disabled{opacity:.35;cursor:not-allowed}
.btn-d{background:transparent;color:var(--red);border-color:rgba(255,69,96,.25)}.btn-d:hover{background:rgba(255,69,96,.08)}
.btn-a{background:rgba(255,184,48,.15);color:var(--amber);border-color:var(--amber)}.btn-a:hover{background:rgba(255,184,48,.25)}
.btn-sm{padding:5px 11px;font-size:9px}
/* form */
.f{margin-bottom:11px}
.lbl{display:block;font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:var(--t2);margin-bottom:5px}
.inp{width:100%;background:var(--bg1);border:1px solid var(--line2);border-radius:5px;padding:8px 11px;font-size:11px;color:var(--t0);font-family:var(--mono);outline:none;transition:border-color .15s}
.inp:focus{border-color:var(--teal)}
.sel{width:100%;background:var(--bg1);border:1px solid var(--line2);border-radius:5px;padding:8px 11px;font-size:11px;color:var(--t0);font-family:var(--sans);outline:none}
.ta{width:100%;background:var(--bg1);border:1px solid var(--line2);border-radius:5px;padding:8px 11px;font-size:10px;color:var(--t1);font-family:var(--mono);outline:none;resize:vertical;min-height:70px}
/* table */
.tbl{width:100%;border-collapse:collapse;font-size:11px}
.tbl th{text-align:left;padding:7px 10px;color:var(--t2);font-size:9px;letter-spacing:.1em;text-transform:uppercase;border-bottom:1px solid var(--line)}
.tbl td{padding:8px 10px;border-bottom:1px solid rgba(10,240,192,.04);color:var(--t1);vertical-align:top}
.tbl tr:hover td{background:var(--bg3)}
/* misc */
.col2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.col3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px}
.flex{display:flex}.gap8{gap:8px}.gap12{gap:12px}.ic{align-items:center}.jb{justify-content:space-between}.wrap{flex-wrap:wrap}
.mb8{margin-bottom:8px}.mb12{margin-bottom:12px}.mb16{margin-bottom:16px}.mb20{margin-bottom:20px}
.pt{font-size:17px;font-weight:700;margin-bottom:3px}.ps{font-size:10px;color:var(--t2);margin-bottom:18px}
.tc{color:var(--teal)}.rc{color:var(--red)}.ac{color:var(--amber)}.bc{color:var(--blue)}.mut{color:var(--t2);font-size:10px}
.mono{font-family:var(--mono)}.trunc{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.chip{font-size:9px;padding:2px 6px;background:var(--bg4);border:1px solid var(--line);border-radius:3px;color:var(--t1);margin:2px}
.jbox{background:var(--bg1);border:1px solid var(--line);border-radius:5px;padding:10px;font-size:9px;font-family:var(--mono);color:var(--t1);overflow-y:auto;white-space:pre-wrap;word-break:break-all}
.jbox .jk{color:var(--teal)}.jbox .jv{color:var(--t0)}
/* 2FA code */
.code-box{background:linear-gradient(135deg,rgba(10,240,192,.05),rgba(61,142,255,.05));border:1px solid var(--line2);border-radius:12px;padding:22px;text-align:center;position:relative;overflow:hidden}
.code-big{font-size:46px;font-family:var(--mono);font-weight:700;letter-spacing:.35em;color:var(--teal);text-shadow:0 0 24px rgba(10,240,192,.4);margin:10px 0}
/* step indicator */
.steps{display:flex;gap:0;margin-bottom:20px}
.step{flex:1;padding:8px 12px;text-align:center;font-size:9px;letter-spacing:.1em;text-transform:uppercase;border:1px solid var(--line);background:var(--bg2);color:var(--t2);font-weight:600;position:relative}
.step:not(:last-child)::after{content:'›';position:absolute;right:-10px;top:50%;transform:translateY(-50%);color:var(--t2);z-index:1}
.step.done{background:rgba(10,240,192,.08);border-color:var(--teal);color:var(--teal)}
.step.active{background:rgba(255,184,48,.08);border-color:var(--amber);color:var(--amber)}
/* event stream */
.evlist{max-height:260px;overflow-y:auto}
.ev{display:flex;gap:10px;padding:6px 0;border-bottom:1px solid var(--line);font-size:10px;align-items:flex-start}
.ev-t{color:var(--t2);min-width:54px;font-family:var(--mono)}.ev-n{min-width:150px;font-weight:700}
.ev-p{color:var(--t1);word-break:break-all;flex:1}
.ev-cred .ev-n{color:var(--teal)}.ev-proof .ev-n{color:var(--blue)}.ev-rev .ev-n{color:var(--red)}.ev-conn .ev-n{color:var(--purple)}.ev-other .ev-n{color:var(--t2)}
/* svc rows */
.svc{display:flex;align-items:center;gap:7px;padding:4px 0;font-size:10px}
.svc-n{color:var(--t1);flex:1}.svc-p{font-family:var(--mono);font-size:9px;color:var(--t2)}
/* spinner */
@keyframes spin{to{transform:rotate(360deg)}}
.sp{width:12px;height:12px;border:2px solid var(--line2);border-top-color:var(--teal);border-radius:50%;animation:spin .7s linear infinite;display:inline-block}
/* toasts */
.toasts{position:fixed;bottom:20px;right:20px;z-index:9999;display:flex;flex-direction:column;gap:7px;max-width:340px}
.toast{background:var(--bg3);border:1px solid var(--line2);border-left:3px solid var(--teal);border-radius:6px;padding:10px 14px;font-size:11px;animation:tin .2s ease}
.toast.err{border-left-color:var(--red)}.toast.warn{border-left-color:var(--amber)}
@keyframes tin{from{transform:translateX(20px);opacity:0}to{transform:translateX(0);opacity:1}}
::-webkit-scrollbar{width:5px;height:5px}::-webkit-scrollbar-track{background:var(--bg1)}
::-webkit-scrollbar-thumb{background:var(--bg4);border-radius:3px}
.section-sep{font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:var(--t2);padding:10px 12px 4px;font-weight:700}
.inv-box{background:var(--bg1);border:1px solid var(--line2);border-radius:5px;padding:10px;font-size:9px;font-family:var(--mono);color:var(--teal);word-break:break-all;margin-top:8px;max-height:80px;overflow-y:auto}
`;

// ── Helpers ────────────────────────────────────────────────────────────────
const ts = t => new Date(t * 1000).toLocaleTimeString();
function Sp() { return <span className="sp" />; }
function Jv({ data, maxH = 180 }) {
  if (!data) return null;
  const h = JSON.stringify(data, null, 2)
    .replace(/"([^"]+)":/g, '<span class="jk">"$1":</span>')
    .replace(/: "([^"]*)"([,\n]|$)/g, ': <span class="jv">"$1"</span>$2')
    .replace(/: (\d[\d.]*)/g, ': <span class="jv">$1</span>');
  return <div className="jbox" style={{ maxHeight: maxH }} dangerouslySetInnerHTML={{ __html: h }} />;
}
function evClass(t) {
  if (!t) return "ev-other";
  if (t.includes("cred") || t.includes("schema")) return "ev-cred";
  if (t.includes("proof") || t.includes("verif")) return "ev-proof";
  if (t.includes("revoc")) return "ev-rev";
  if (t.includes("conn") || t.includes("invit")) return "ev-conn";
  return "ev-other";
}

// ── Service sidebar ────────────────────────────────────────────────────────
function Svcs({ services }) {
  const MAP = { accumulator:":8080", verification_gateway:":4000", governance:":3000", von_ledger:":8000", rekor:":3100", issuer_agent:":8001", holder_agent:":8031" };
  return (
    <div style={{ padding: "6px 12px 12px" }}>
      <div className="section-sep" style={{ padding: "4px 0 6px" }}>Services</div>
      {Object.entries(MAP).map(([n, p]) => {
        const up = services[n]?.up;
        return (
          <div key={n} className="svc">
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: up ? "var(--teal)" : "var(--t2)", boxShadow: up ? "0 0 6px var(--teal)" : "none", animation: up ? "pulse 2s infinite" : "none", flexShrink: 0 }} />
            <span className="svc-n">{n.replace(/_/g, " ")}</span>
            <span className="svc-p">{p}</span>
          </div>
        );
      })}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// HOLDER — shows real wallet + incoming offers + can present
// ════════════════════════════════════════════════════════════════════════
function Holder({ gw, toast }) {
  const [creds,     setCreds]   = useState([]);
  const [offers,    setOffers]  = useState([]);
  const [proofReqs, setProofReqs] = useState([]);
  const [sel,       setSel]     = useState(null);
  const [invText,   setInvText] = useState("");
  const [loading,   setLoad]    = useState({});

  const reload = async () => {
    try { setCreds((await get("/holder/credentials")).results || []); } catch {}
    try { setOffers((await get("/holder/credential-offers")).results || []); } catch {}
    try { setProofReqs((await get("/holder/proof-requests")).results || []); } catch {}
  };

  useEffect(() => { reload(); }, []);
  useEffect(() => gw.on("credential_issued",  () => setTimeout(reload, 2500)), []);
  useEffect(() => gw.on("proof_event",        () => setTimeout(reload, 1500)), []);
  useEffect(() => gw.on("snapshot_wallet",    e  => { if (e.payload.results) setCreds(e.payload.results); }), []);

  const acceptOffer = async id => {
    setLoad(p => ({ ...p, [id]: true }));
    try { await post("/holder/accept-offer/" + id); toast.add("Credential request sent to issuer"); setTimeout(reload, 3000); }
    catch (e) { toast.add(e.message, "err"); }
    setLoad(p => ({ ...p, [id]: false }));
  };

  const joinNetwork = async () => {
    let inv;
    const raw = invText.trim();
    if (raw.startsWith("http")) {
      inv = raw;
    } else {
      try { 
        const clean = raw.replace(/^```[a-z]*\s*/i, "").replace(/```\s*$/, "").trim();
        inv = JSON.parse(clean); 
      } catch(e) { 
        toast.add("Input must be valid JSON or an invitation URL", "warn"); 
        return; 
      }
    }
    setLoad(p => ({ ...p, join: true }));
    try {
      await post("/holder/receive-invitation", { invitation: inv });
      toast.add("Invitation accepted — connection being established");
      setInvText("");
      setTimeout(reload, 3000);
    } catch (e) { toast.add(e.message, "err"); }
    setLoad(p => ({ ...p, join: false }));
  };

  const selCred = creds.find(c => c.referent === sel);

  return (
    <div className="lay">
      {/* sidebar */}
      <div className="sb">
        <div style={{ padding: "14px 12px 10px", borderBottom: "1px solid var(--line)", marginBottom: 8 }}>
          <div className="pt" style={{ fontSize: 13 }}>My Wallet</div>
          <div className="mut">{creds.length} credential{creds.length !== 1 ? "s" : ""}</div>
        </div>

        {/* join network */}
        <div style={{ padding: "0 12px 12px", borderBottom: "1px solid var(--line)", marginBottom: 8 }}>
          <div className="section-sep" style={{ padding: "0 0 6px" }}>Connect to Issuer</div>
          <textarea className="ta" rows={3} placeholder='Paste invitation JSON from Issuer tab…' value={invText} onChange={e => setInvText(e.target.value)} />
          <button className="btn btn-g btn-sm" style={{ width: "100%", marginTop: 6 }} onClick={joinNetwork} disabled={loading.join || !invText.trim()}>
            {loading.join ? <Sp /> : "Join Network"}
          </button>
        </div>

        {/* pending proof requests */}
        {proofReqs.length > 0 && (
          <div style={{ padding: "0 12px 10px", borderBottom: "1px solid var(--line)", marginBottom: 8 }}>
            <div className="section-sep" style={{ padding: "0 0 6px" }}>
              <span className="ac">⚡ Proof Requests ({proofReqs.length})</span>
            </div>
            {proofReqs.map((r, i) => {
              const rec = r.pres_ex_record || r;
              const id = rec.pres_ex_id || rec.presentation_exchange_id;
              return (
                <div key={id || i} style={{ background: "rgba(255,184,48,.06)", border: "1px solid rgba(255,184,48,.2)", borderRadius: 6, padding: "10px 12px", marginBottom: 6 }}>
                  <div style={{ fontSize: 10, color: "var(--amber)", marginBottom: 4 }}>
                    RP is requesting: {Object.keys(rec.presentation_request?.requested_attributes || {}).join(", ") || "credentials"}
                  </div>
                  <div style={{ fontSize: 9, color: "var(--t2)", marginBottom: 8 }}>
                    nonce: {rec.presentation_request?.nonce?.slice(0, 16)}…
                  </div>
                  <ProofSender pres_ex_id={id} toast={toast} gw={gw} onDone={reload} />
                </div>
              );
            })}
          </div>
        )}

        {/* pending offers */}
        {offers.length > 0 && (
          <div style={{ padding: "0 12px 10px", borderBottom: "1px solid var(--line)", marginBottom: 8 }}>
            <div className="section-sep" style={{ padding: "0 0 6px" }}>
              <span className="tc">📨 Credential Offers ({offers.length})</span>
            </div>
            {offers.map((o, i) => {
              const rec = o.cred_ex_record || o;
              const id  = rec.cred_ex_id;
              const prev = rec.cred_preview || rec.by_format?.cred_offer?.indy?.credential_proposal;
              return (
                <div key={id || i} className="cred offer-card">
                  <div style={{ fontSize: 9, color: "var(--amber)", marginBottom: 3 }}>New Offer</div>
                  <div style={{ fontSize: 10, marginBottom: 6, color: "var(--t0)" }}>
                    {prev?.attributes?.map(a => a.name).join(", ") || "credentials"}
                  </div>
                  <button className="btn btn-a btn-sm" onClick={() => acceptOffer(id)} disabled={loading[id]}>
                    {loading[id] ? <Sp /> : "Accept"}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* credentials */}
        <div className="section-sep">Credentials ({creds.length})</div>
        <div style={{ padding: "0 10px" }}>
          {creds.length === 0 && <div className="mut" style={{ padding: "14px 0" }}>No credentials yet. Accept an offer above.</div>}
          {creds.map(c => (
            <div key={c.referent} className={`cred ${sel === c.referent ? "on" : ""}`} onClick={() => setSel(c.referent)}>
              <div style={{ fontSize: 9, color: "var(--teal)", letterSpacing: ".1em", textTransform: "uppercase", marginBottom: 3 }}>
                {c.schema_id?.split(":").slice(-2).join(":") || "Credential"}
              </div>
              <div style={{ fontSize: 9, color: "var(--t2)", marginBottom: 5 }} className="trunc">{c.referent}</div>
              <div style={{ display: "flex", flexWrap: "wrap" }}>
                {Object.keys(c.attrs || {}).map(k => <span key={k} className="chip">{k}</span>)}
              </div>
            </div>
          ))}
        </div>
        <div style={{ padding: "10px 12px" }}>
          <button className="btn btn-g btn-sm" style={{ width: "100%" }} onClick={reload}>↻ Refresh</button>
        </div>
      </div>

      {/* main */}
      <div className="main">
        {!selCred ? (
          <div style={{ height: 300, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, opacity: .4 }}>
            <div style={{ fontSize: 38 }}>⬡</div>
            <div style={{ fontSize: 12 }}>Select a credential to view details and build a VP</div>
          </div>
        ) : <CredDetail cred={selCred} toast={toast} />}
      </div>
    </div>
  );
}

function ProofSender({ pres_ex_id, toast, gw, onDone }) {
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      await post("/holder/send-proof", { pres_ex_id, self_attested: {}, requested_attrs: {} });
      toast.add("Proof sent to verifier ✓");
      setTimeout(onDone, 2000);
    } catch (e) { toast.add(e.message, "err"); }
    setBusy(false);
  };
  return (
    <button className="btn btn-p btn-sm" onClick={send} disabled={busy}>
      {busy ? <Sp /> : "Present Credentials"}
    </button>
  );
}

function CredDetail({ cred, toast }) {
  const attrs = cred.attrs || {};
  const [sel,   setSel]   = useState(() => Object.keys(attrs));
  const [nonce, setNonce] = useState("");
  const [zkp,   setZkp]   = useState(null);
  const [pred,  setPred]  = useState(null);
  const [vp,    setVp]    = useState(null);
  const [pa,    setPa]    = useState(Object.keys(attrs)[0] || "");
  const [pv,    setPv]    = useState("18");
  const [busy,  setBusy]  = useState("");

  const toggle = k => setSel(p => p.includes(k) ? p.filter(x => x !== k) : [...p, k]);

  const getZKP = async () => {
    if (!nonce) { toast.add("Paste the RP nonce first", "warn"); return; }
    setBusy("z");
    try {
      const h = btoa(cred.referent).replace(/[+/=]/g, "x").slice(0, 44);
      const r = await fetch("http://localhost:8080/zkp/create-non-membership-proof", {
        method: "POST", headers: { "Content-Type": "application/json", "x-api-key": "dev-key-1" },
        body: JSON.stringify({ cred_hash: h, nonce }),
      });
      if (!r.ok) throw new Error(await r.text());
      const d = await r.json();
      setZkp(d.proof);
      toast.add("ZKP non-membership proof ready");
    } catch (e) { toast.add(e.message, "err"); }
    setBusy("");
  };

  const getPred = async () => {
    if (!nonce || !pa) { toast.add("Enter nonce and pick an attribute", "warn"); return; }
    const val = parseFloat(attrs[pa]);
    if (isNaN(val)) { toast.add(`${pa} is not numeric — predicate requires a number`, "warn"); return; }
    setBusy("p");
    try {
      const r = await fetch("http://localhost:8080/zkp/create-predicate-proof", {
        method: "POST", headers: { "Content-Type": "application/json", "x-api-key": "dev-key-1" },
        body: JSON.stringify({ attribute_name: pa, attribute_value: Math.round(val * 100), predicate: ">=", threshold: Math.round(parseFloat(pv) * 100), nonce }),
      });
      if (!r.ok) throw new Error(await r.text());
      const d = await r.json();
      if (!d.valid) throw new Error(d.error || "Predicate not satisfied");
      setPred(d);
      toast.add(`Predicate: ${pa} ≥ ${pv} (actual value hidden)`);
    } catch (e) { toast.add(e.message, "err"); }
    setBusy("");
  };

  const buildVP = () => {
    const disclosed = {};
    sel.forEach(k => { if (attrs[k] !== undefined) disclosed[k] = attrs[k]; });
    setVp({
      "@type": "VerifiablePresentation",
      holder: `did:sov:${cred.referent?.slice(0, 16)}`,
      nonce,
      disclosed_attributes: sel,
      revealed_values: disclosed,
      zkp_revocation_proof: zkp ? { proof_hash: zkp.proof_hash?.slice(0, 16) + "…", epoch: zkp.accumulator_epoch, _note: "Full proof available" } : null,
      predicate_proof: pred ? { attribute: pred.attribute, predicate: `${pred.predicate} ${pred.threshold}` } : null,
      created_at: new Date().toISOString(),
    });
    toast.add(`VP built — ${sel.length}/${Object.keys(attrs).length} attrs disclosed`);
  };

  return (
    <>
      <div className="flex ic jb mb16">
        <div>
          <div className="pt">{cred.schema_id?.split(":").slice(-2, -1)[0]?.replace(/_/g, " ") || "Credential"}</div>
          <div className="ps mono" style={{ fontSize: 10 }}>{cred.referent}</div>
        </div>
        <span className="badge bg">ACTIVE</span>
      </div>
      <div className="col2">
        <div>
          <div className="card">
            <div className="ch"><span className="ct">Selective Disclosure</span><span className="mut">{sel.length}/{Object.keys(attrs).length} revealed</span></div>
            <div className="cb">
              <div className="mut mb8">Check = reveal to verifier. Uncheck = hidden.</div>
              {Object.entries(attrs).map(([k, v]) => (
                <label key={k} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", cursor: "pointer", fontSize: 11, borderBottom: "1px solid var(--line)" }} onClick={() => toggle(k)}>
                  <input type="checkbox" checked={sel.includes(k)} onChange={() => {}} style={{ accentColor: "var(--teal)", width: 14, height: 14 }} />
                  <span style={{ flex: 1 }}>{k}</span>
                  {sel.includes(k) ? <span style={{ color: "var(--t0)", fontSize: 10 }}>{String(v).slice(0, 22)}</span> : <span className="badge ba" style={{ fontSize: 8 }}>HIDDEN</span>}
                </label>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="ch"><span className="ct">Predicate ZKP</span></div>
            <div className="cb">
              <div className="mut mb8">Prove attribute ≥ threshold without revealing the actual value:</div>
              <div className="flex gap8 ic mb8">
                <select className="sel" value={pa} onChange={e => setPa(e.target.value)} style={{ flex: 1 }}>
                  {Object.keys(attrs).map(k => <option key={k}>{k}</option>)}
                </select>
                <span className="mut">≥</span>
                <input className="inp" type="number" value={pv} onChange={e => setPv(e.target.value)} style={{ width: 70 }} />
              </div>
              <button className="btn btn-g btn-sm" onClick={getPred} disabled={busy === "p" || !nonce}>
                {busy === "p" ? <Sp /> : "Prove Predicate"}
              </button>
              {pred?.valid && <div style={{ marginTop: 8 }}><span className="badge bg">READY</span> <span className="mut">{pred.attribute} ≥ {pred.threshold} · value hidden</span></div>}
            </div>
          </div>
        </div>

        <div>
          <div className="card">
            <div className="ch"><span className="ct">ZKP Revocation Proof</span></div>
            <div className="cb">
              <div className="mut mb8">Proves credential is NOT revoked. Verifier never sees your credential hash — only mathematical witness (a, d).</div>
              <div className="f">
                <label className="lbl">RP Challenge Nonce</label>
                <input className="inp" placeholder="Paste nonce from the Relying Party tab…" value={nonce} onChange={e => setNonce(e.target.value)} />
              </div>
              <button className="btn btn-g btn-sm" onClick={getZKP} disabled={busy === "z" || !nonce}>
                {busy === "z" ? <Sp /> : "Generate ZKP Proof"}
              </button>
              {zkp && (
                <div style={{ marginTop: 10 }}>
                  <div className="flex ic gap8 mb8">
                    <span className="badge bg">PROOF READY</span>
                    <span className="mut">epoch {zkp.accumulator_epoch}</span>
                  </div>
                  <Jv data={{ witness_a: zkp.witness_a?.slice(0, 18) + "…", witness_d: zkp.witness_d?.slice(0, 18) + "…", proof_hash: zkp.proof_hash?.slice(0, 18) + "…" }} maxH={100} />
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <div className="ch"><span className="ct">Build VP to Present</span></div>
            <div className="cb">
              <button className="btn btn-p" style={{ width: "100%", marginBottom: 10 }} onClick={buildVP}>
                Build Verifiable Presentation
              </button>
              {vp && (
                <>
                  <div className="flex ic gap8 mb8">
                    <span className="badge bg">VP READY</span>
                    <span className="mut">{vp.disclosed_attributes.length} attrs · {zkp ? "ZKP ✓" : ""} {pred ? "pred ✓" : ""}</span>
                  </div>
                  <Jv data={vp} maxH={150} />
                  <button className="btn btn-g btn-sm" style={{ marginTop: 8 }} onClick={() => { try { navigator.clipboard.writeText(JSON.stringify(vp, null, 2)); } catch {} toast.add("VP copied"); }}>
                    Copy VP JSON
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════
// ISSUER — setup (invitation + schema + cred-def) + issue + revoke
// ════════════════════════════════════════════════════════════════════════
function IssuerTab({ gw, toast }) {
  const [tab, setTab] = useState("setup");   // "setup" | "issue" | "records"

  return (
    <div className="lay">
      <div className="sb">
        <div style={{ padding: "14px 12px 10px", borderBottom: "1px solid var(--line)", marginBottom: 8 }}>
          <div className="pt" style={{ fontSize: 13 }}>Issuer Agent</div>
          <div className="mut">Government / University</div>
        </div>
        {["setup", "issue", "records"].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            display: "block", width: "100%", textAlign: "left", padding: "10px 16px",
            fontSize: 10, letterSpacing: ".1em", textTransform: "uppercase",
            color: tab === t ? "var(--teal)" : "var(--t2)",
            background: tab === t ? "rgba(10,240,192,.07)" : "none",
            border: "none", cursor: "pointer", fontFamily: "var(--sans)", fontWeight: 700,
          }}>
            {t === "setup" ? "① Setup & Connect" : t === "issue" ? "② Issue Credential" : "③ Records & Revoke"}
          </button>
        ))}
      </div>
      <div className="main">
        {tab === "setup"   && <IssuerSetup   toast={toast} gw={gw} />}
        {tab === "issue"   && <IssuerIssue   toast={toast} gw={gw} />}
        {tab === "records" && <IssuerRecords toast={toast} gw={gw} />}
      </div>
    </div>
  );
}

function IssuerSetup({ toast, gw }) {
  const [invitation, setInvitation] = useState(null);
  const [conns,  setConns]  = useState([]);
  const [schemas, setSchemas] = useState([]);
  const [defs,    setDefs]   = useState([]);
  const [busy,    setBusy]   = useState("");

  // Schema form
  const [sName, setSName] = useState("Degree_Schema");
  const [sVer,  setSVer]  = useState("1.0");
  const [sAttrs,setSAttrs]= useState("name, degree, university, gpa, date_issued");
  // Cred-def form
  const [defSchema, setDefSchema] = useState("");
  const [defTag,    setDefTag]    = useState("default");

  const reload = async () => {
    try { setConns((await get("/issuer/connections")).results || []); } catch {}
    try { setSchemas((await get("/issuer/schemas-full")).schemas || []); } catch {}
    try { setDefs((await get("/issuer/credential-definitions")).credential_definition_ids || []); } catch {}
  };

  useEffect(() => { reload(); }, []);
  useEffect(() => gw.on("connection_event", () => setTimeout(reload, 2000)), []);

  const createInvitation = async () => {
    setBusy("inv");
    try {
      const d = await post("/issuer/create-invitation");
      setInvitation(d);
      toast.add("Invitation created — copy to Holder tab");
    } catch (e) { toast.add(e.message, "err"); }
    setBusy("");
  };

  const publishSchema = async () => {
    const attrs = sAttrs.split(",").map(a => a.trim()).filter(Boolean);
    if (!sName || attrs.length === 0) { toast.add("Schema name and at least one attribute required", "warn"); return; }
    setBusy("schema");
    try {
      const d = await post("/issuer/publish-schema", { schema_name: sName, schema_version: sVer, attributes: attrs });
      toast.add(`Schema published: ${d.schema_id}`);
      setDefSchema(d.schema_id);
      await reload();
    } catch (e) { toast.add(e.message, "err"); }
    setBusy("");
  };

  const publishCredDef = async () => {
    const sid = defSchema || schemas[0]?.id;
    if (!sid) { toast.add("Select a schema first", "warn"); return; }
    setBusy("def");
    try {
      const d = await post("/issuer/publish-cred-def", { schema_id: sid, tag: defTag });
      toast.add(`Cred def published: ${d.credential_definition_id}`);
      await reload();
    } catch (e) { toast.add(e.message, "err"); }
    setBusy("");
  };

  return (
    <>
      <div className="pt">Setup & Connect</div>
      <div className="ps">Do these steps once before issuing credentials.</div>

      <div className="col2">
        {/* Step 1: Connection */}
        <div>
          <div className="card">
            <div className="ch"><span className="ct">Step 1 — Create Invitation</span></div>
            <div className="cb">
              <div className="mut mb8">Generate an OOB invitation. The Holder pastes this JSON into their Holder tab to connect.</div>
              <button className="btn btn-p" style={{ width: "100%" }} onClick={createInvitation} disabled={busy === "inv"}>
                {busy === "inv" ? <Sp /> : "Generate Invitation"}
              </button>
              {invitation && (
                <>
                  <div className="inv-box">{JSON.stringify(invitation.invitation)}</div>
                  <button className="btn btn-g btn-sm" style={{ marginTop: 6 }}
                    onClick={() => { try { navigator.clipboard.writeText(JSON.stringify(invitation.invitation)); } catch {} toast.add("Invitation JSON copied"); }}>
                    Copy Invitation JSON
                  </button>
                </>
              )}
              {conns.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <div className="mut mb8">Active connections ({conns.filter(c => c.state === "active" || c.state === "completed").length}):</div>
                  {conns.slice(0, 5).map(c => (
                    <div key={c.connection_id} className="flex ic gap8" style={{ padding: "4px 0", fontSize: 10 }}>
                      <span className={`badge ${c.state === "active" || c.state === "completed" ? "bg" : "ba"}`}>{c.state}</span>
                      <span className="trunc" style={{ flex: 1 }}>{c.their_label || c.connection_id.slice(0, 20)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Step 2: Schema */}
        <div>
          <div className="card">
            <div className="ch"><span className="ct">Step 2 — Publish Schema</span></div>
            <div className="cb">
              <div className="mut mb8">Define the attributes your credentials will contain. Written to the Indy ledger permanently.</div>
              <div className="f"><label className="lbl">Schema Name</label><input className="inp" value={sName} onChange={e => setSName(e.target.value)} /></div>
              <div className="f"><label className="lbl">Version</label><input className="inp" value={sVer} onChange={e => setSVer(e.target.value)} style={{ width: 80 }} /></div>
              <div className="f"><label className="lbl">Attributes (comma-separated)</label><input className="inp" value={sAttrs} onChange={e => setSAttrs(e.target.value)} /></div>
              <button className="btn btn-p" style={{ width: "100%" }} onClick={publishSchema} disabled={busy === "schema"}>
                {busy === "schema" ? <Sp /> : "Publish to Ledger"}
              </button>
              {schemas.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <div className="mut mb4">Published schemas:</div>
                  {schemas.map(s => <div key={s.id} style={{ fontSize: 9, color: "var(--teal)", marginBottom: 2 }}>{s.id}</div>)}
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <div className="ch"><span className="ct">Step 3 — Publish Cred Def</span></div>
            <div className="cb">
              <div className="mut mb8">Credential definition ties your keys to a schema. Required before issuing credentials.</div>
              <div className="f">
                <label className="lbl">Schema ID</label>
                <select className="sel" value={defSchema} onChange={e => setDefSchema(e.target.value)}>
                  <option value="">— select schema —</option>
                  {schemas.map(s => <option key={s.id} value={s.id}>{s.name || s.id}</option>)}
                </select>
              </div>
              <div className="f"><label className="lbl">Tag</label><input className="inp" value={defTag} onChange={e => setDefTag(e.target.value)} style={{ width: 120 }} /></div>
              <button className="btn btn-p" style={{ width: "100%" }} onClick={publishCredDef} disabled={busy === "def"}>
                {busy === "def" ? <Sp /> : "Publish Cred Def"}
              </button>
              {defs.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <div className="mut mb4">Published cred defs:</div>
                  {defs.map(d => <div key={d} style={{ fontSize: 9, color: "var(--teal)", marginBottom: 2 }}>{d}</div>)}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 4 }}>
        <button className="btn btn-g btn-sm" onClick={reload}>↻ Refresh all</button>
      </div>
    </>
  );
}

function IssuerIssue({ toast, gw }) {
  const [conns, setConns] = useState([]);
  const [defs,  setDefs]  = useState([]);
  const [schemas, setSchemas] = useState([]);
  const [connId, setConnId] = useState("");
  const [defId,  setDefId]  = useState("");
  const [selSchema, setSelSchema] = useState(null);
  const [attrFields, setAttrFields] = useState([{ name: "", value: "" }]);
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    try { setConns((await get("/issuer/connections")).results?.filter(c => c.state === "active" || c.state === "completed") || []); } catch {}
    try {
      const dList = (await get("/issuer/credential-definitions")).credential_definition_ids || [];
      setDefs(dList);
      if (dList.length === 1 && !defId) setDefId(dList[0]);
    } catch {}
    try { setSchemas((await get("/issuer/schemas-full")).schemas || []); } catch {}
  };

  useEffect(() => { reload(); }, []);
  useEffect(() => gw.on("cred_def_published", () => setTimeout(reload, 1500)), []);
  useEffect(() => gw.on("connection_event",   () => setTimeout(reload, 1500)), []);

  // When cred def selected, auto-fill attribute fields from schema
  const onDefChange = async (did) => {
    setDefId(did);
    // Extract schema_id from cred_def_id (format: issuerDID:3:CL:seqNo:tag)
    const parts = did.split(":");
    if (parts.length >= 4) {
      const seqNo = parts[3];
      const match = schemas.find(s => s.seqNo === parseInt(seqNo) || s.id?.includes(`:${seqNo}:`));
      if (match?.attrNames) {
        setAttrFields(match.attrNames.map(n => ({ name: n, value: "" })));
        setSelSchema(match);
      }
    }
  };

  const addAttr = () => setAttrFields(p => [...p, { name: "", value: "" }]);
  const setAttr = (i, k, v) => setAttrFields(p => p.map((f, j) => j === i ? { ...f, [k]: v } : f));
  const removeAttr = i => setAttrFields(p => p.filter((_, j) => j !== i));

  const issue = async () => {
    if (!connId) { toast.add("Select a connection (active holder)", "warn"); return; }
    if (!defId)  { toast.add("Select a credential definition", "warn"); return; }
    const attrs = {};
    attrFields.forEach(f => { if (f.name.trim()) attrs[f.name.trim()] = f.value; });
    if (Object.keys(attrs).length === 0) { toast.add("Add at least one attribute value", "warn"); return; }
    setBusy(true);
    try {
      await post("/issuer/issue", { connection_id: connId, cred_def_id: defId, attributes: attrs });
      toast.add("Credential offer sent to holder's wallet");
    } catch (e) { toast.add(e.message, "err"); }
    setBusy(false);
  };

  return (
    <>
      <div className="pt">Issue Credential</div>
      <div className="ps">Send a credential offer to a connected holder. They will see it in their wallet.</div>
      <div className="col2">
        <div>
          <div className="card">
            <div className="ch"><span className="ct">Recipient & Template</span></div>
            <div className="cb">
              <div className="f">
                <label className="lbl">Holder Connection</label>
                <select className="sel" value={connId} onChange={e => setConnId(e.target.value)}>
                  <option value="">— select connected holder —</option>
                  {conns.map(c => <option key={c.connection_id} value={c.connection_id}>{c.their_label || c.their_did?.slice(0, 20) || c.connection_id.slice(0, 20)}</option>)}
                </select>
                {conns.length === 0 && <div className="mut" style={{ marginTop: 6 }}>No active connections — do Step 1 in the Setup tab first.</div>}
              </div>
              <div className="f">
                <label className="lbl">Credential Definition</label>
                <select className="sel" value={defId} onChange={e => onDefChange(e.target.value)}>
                  <option value="">— select cred def —</option>
                  {defs.map(d => <option key={d} value={d}>{d.split(":").slice(-2).join(":")}</option>)}
                </select>
                {defs.length === 0 && <div className="mut" style={{ marginTop: 6 }}>No cred defs — do Steps 2 & 3 in Setup first.</div>}
              </div>
              <button className="btn btn-g btn-sm" onClick={reload}>↻ Refresh</button>
            </div>
          </div>
        </div>

        <div>
          <div className="card">
            <div className="ch"><span className="ct">Attribute Values</span></div>
            <div className="cb">
              {attrFields.map((f, i) => (
                <div key={i} className="flex gap8 mb8 ic">
                  <input className="inp" style={{ flex: 1 }} placeholder="attribute name" value={f.name} onChange={e => setAttr(i, "name", e.target.value)} />
                  <input className="inp" style={{ flex: 1 }} placeholder="value" value={f.value} onChange={e => setAttr(i, "value", e.target.value)} />
                  {attrFields.length > 1 && <button className="btn btn-d btn-sm" onClick={() => removeAttr(i)} style={{ padding: "5px 8px" }}>×</button>}
                </div>
              ))}
              <div className="flex gap8">
                <button className="btn btn-g btn-sm" onClick={addAttr}>+ Add attr</button>
              </div>
            </div>
          </div>
          <button className="btn btn-p" style={{ width: "100%", marginTop: 4 }} onClick={issue} disabled={busy}>
            {busy ? <Sp /> : "Send Credential Offer"}
          </button>
          <div className="mut" style={{ marginTop: 8 }}>Holder will see this in their Wallet tab → Credential Offers section.</div>
        </div>
      </div>
    </>
  );
}

function IssuerRecords({ toast, gw }) {
  const [issued, setIssued] = useState([]);
  const [busy, setBusy] = useState({});

  const reload = async () => {
    try { setIssued((await get("/issuer/issued")).results || []); } catch {}
  };
  useEffect(() => { reload(); }, []);
  useEffect(() => gw.on("credential_issued", () => setTimeout(reload, 2000)), []);

  const revoke = async id => {
    setBusy(p => ({ ...p, [id]: true }));
    try {
      await post("/issuer/revoke", { cred_ex_id: id });
      toast.add("Revocation submitted — requires k-of-n governance votes", "warn");
      setTimeout(reload, 1500);
    } catch (e) { toast.add(e.message, "err"); }
    setBusy(p => ({ ...p, [id]: false }));
  };

  return (
    <>
      <div className="pt">Issued Credential Records</div>
      <div className="ps">All credential exchanges. Revoke requires 3-of-5 validator signatures — one click here is not sufficient alone.</div>
      <div className="card">
        <div className="cb" style={{ padding: 0 }}>
          <table className="tbl">
            <thead><tr><th>Exchange ID</th><th>Connection</th><th>Cred Def</th><th>State</th><th></th></tr></thead>
            <tbody>
              {issued.length === 0 && <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--t2)", padding: 20 }}>No records yet</td></tr>}
              {issued.map((row, i) => {
                const r = row.cred_ex_record || row;
                const id = r.cred_ex_id || String(i);
                const cdId = (r.by_format?.cred_offer?.indy?.cred_def_id || r.cred_def_id || "—").split(":").slice(-2).join(":");
                return (
                  <tr key={id}>
                    <td className="mono trunc" style={{ fontSize: 9, maxWidth: 130 }}>{id.slice(0, 18)}…</td>
                    <td style={{ fontSize: 9 }} className="trunc">{r.connection_id?.slice(0, 14) || "—"}</td>
                    <td style={{ fontSize: 9 }} className="trunc">{cdId}</td>
                    <td><span className={`badge ${r.state === "credential_acked" || r.state === "done" ? "bg" : r.state === "abandoned" ? "br" : "ba"}`}>{r.state}</span></td>
                    <td>
                      {(r.state === "credential_acked" || r.state === "done") && (
                        <button className="btn btn-d btn-sm" onClick={() => revoke(id)} disabled={busy[id]}>
                          {busy[id] ? <Sp /> : "Revoke"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <button className="btn btn-g btn-sm" onClick={reload}>↻ Refresh</button>
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════
// RELYING PARTY — 2FA challenge → proof request → result
// ════════════════════════════════════════════════════════════════════════
function RPTab({ gw, toast }) {
  const [step,    setStep]    = useState(0);   // 0=idle 1=challenged 2=requested 3=done
  const [chal,    setChal]    = useState(null);
  const [conns,   setConns]   = useState([]);
  const [connId,  setConnId]  = useState("");
  const [attrs,   setAttrs]   = useState("degree, university");
  const [result,  setResult]  = useState(null);
  const [timer,   setTimer]   = useState(0);
  const [polling, setPolling] = useState(false);
  const [busy,    setBusy]    = useState("");
  const timerRef = useRef(null);
  const pollRef  = useRef(null);

  const loadConns = async () => {
    try {
      const all = (await get("/verifier/connections")).results || [];
      setConns(all.filter(c => c.state === "active" || c.state === "completed"));
    } catch {}
  };
  useEffect(() => { loadConns(); }, []);
  useEffect(() => gw.on("connection_event", () => setTimeout(loadConns, 2000)), []);

  // When ACA-Py fires a proof event, auto-poll
  useEffect(() => gw.on("proof_event", e => {
    const ex = e.payload?.presentation_exchange_id;
    if (chal?.exchange_id && ex === chal.exchange_id) pollResult(ex);
  }), [chal]);

  const issueChallenge = async () => {
    setBusy("ch"); setResult(null); setStep(0);
    try {
      const d = await post("/verifier/challenge");
      setChal({ ...d, exchange_id: null });
      setStep(1);
      setTimer(300);
      clearInterval(timerRef.current);
      timerRef.current = setInterval(() => setTimer(t => { if (t <= 1) { clearInterval(timerRef.current); return 0; } return t - 1; }), 1000);
      toast.add(`Challenge issued — code: ${d.code}`);
    } catch (e) { toast.add(e.message, "err"); }
    setBusy("");
  };

  const sendRequest = async () => {
    if (!chal) return;
    if (!connId) { toast.add("Select the holder's connection", "warn"); return; }
    const reqAttrs = {};
    attrs.split(",").map(a => a.trim()).filter(Boolean).forEach((a, i) => { reqAttrs[`attr_${i}`] = { name: a }; });
    setBusy("req");
    try {
      const d = await post("/verifier/request-proof", { connection_id: connId, nonce: chal.nonce, requested_attributes: reqAttrs, name: `Verify — ${chal.code}` });
      setChal(prev => ({ ...prev, exchange_id: d.presentation_exchange_id }));
      setStep(2); setPolling(true);
      toast.add("Proof request sent — waiting for holder");
      clearInterval(pollRef.current);
      let n = 0;
      pollRef.current = setInterval(async () => {
        if (++n > 40) { clearInterval(pollRef.current); setPolling(false); return; }
        if (d.presentation_exchange_id) await pollResult(d.presentation_exchange_id);
      }, 3000);
    } catch (e) { toast.add(e.message, "err"); }
    setBusy("");
  };

  const pollResult = async id => {
    try {
      const d = await get(`/verifier/result/${id}`);
      if (d.state === "verified" || d.state === "done" || d.state === "abandoned" || (d.verified !== undefined && d.verified !== null)) {
        clearInterval(pollRef.current); setPolling(false);
        setResult(d); setStep(3);
        if (d.verified === "true" || d.verified === true) toast.add("✓ Verification successful!");
        else toast.add("✗ Verification failed", "err");
      }
    } catch {}
  };

  const reset = () => { setStep(0); setChal(null); setResult(null); setPolling(false); clearInterval(pollRef.current); clearInterval(timerRef.current); };

  const STEPS = ["Idle", "Challenged", "Requested", "Done"];

  return (
    <div className="lay">
      <div className="sb">
        <div style={{ padding: "0 12px 10px", borderBottom: "1px solid var(--line)", marginBottom: 10 }}>
          <div className="section-sep" style={{ padding: "0 0 6px" }}>Connect Holder</div>
          <button className="btn btn-a btn-sm" style={{ width: "100%" }} onClick={async () => {
            const d = await post("/verifier/invitation");
            if (d.invitation) {
              try { await navigator.clipboard.writeText(JSON.stringify(d.invitation_url || d.invitation)); } catch {}
              toast.add("Invitation copied! Paste in 'Connect to Issuer' box in My Wallet");
            }
          }}>+ Invite Wallet to Verifier</button>
        </div>

        <div style={{ padding: "0 12px 12px", borderBottom: "1px solid var(--line)", marginBottom: 8 }}>
          <div className="f">
            <label className="lbl">Holder Connection</label>
            <select className="sel" value={connId} onChange={e => setConnId(e.target.value)}>
              <option value="">— select holder —</option>
              {conns.map(c => <option key={c.connection_id} value={c.connection_id}>{c.their_label || c.their_did?.slice(0, 18) || c.connection_id.slice(0, 18)}</option>)}
            </select>
            {conns.length === 0 && <div className="mut" style={{ marginTop: 5 }}>No connections. Issuer must connect first.</div>}
          </div>
          <div className="f">
            <label className="lbl">Requested Attributes</label>
            <input className="inp" value={attrs} onChange={e => setAttrs(e.target.value)} placeholder="degree, university, name" />
          </div>

          <button className="btn btn-p" style={{ width: "100%", marginBottom: 7 }} onClick={issueChallenge} disabled={busy === "ch" || step > 0}>
            {busy === "ch" ? <Sp /> : "① Issue Challenge"}
          </button>
          <button className="btn btn-g" style={{ width: "100%", marginBottom: 7 }} onClick={sendRequest} disabled={busy === "req" || step !== 1}>
            {busy === "req" ? <Sp /> : "② Request Proof"}
          </button>
          <button className="btn btn-d btn-sm" style={{ width: "100%" }} onClick={reset}>↺ Reset</button>
        </div>

        {/* history */}
        {result && (
          <div style={{ padding: "0 12px" }}>
            <div className="section-sep">Last Result</div>
            <div className="flex ic gap8" style={{ padding: "6px 0" }}>
              <span className={`badge ${result.verified === "true" || result.verified === true ? "bg" : "br"}`}>
                {result.verified === "true" || result.verified === true ? "VERIFIED" : "FAILED"}
              </span>
              <span className="mut">{new Date().toLocaleTimeString()}</span>
            </div>
          </div>
        )}
      </div>

      <div className="main">
        <div className="pt">2FA-Style Identity Verification</div>
        <div className="ps">Challenge → Holder presents VP → VG verifies ZKP + issuer sig → k-of-n threshold token issued to RP</div>

        {/* step indicator */}
        <div className="steps mb20">
          {["Challenge", "Send Request", "Holder Presents", "Token Issued"].map((s, i) => (
            <div key={s} className={`step ${step > i ? "done" : step === i ? "active" : ""}`}>{s}</div>
          ))}
        </div>

        {/* main content per step */}
        {step === 0 && (
          <div style={{ textAlign: "center", padding: "60px 0", opacity: .4 }}>
            <div style={{ fontSize: 40 }}>◈</div>
            <div style={{ marginTop: 10, fontSize: 12 }}>Click "① Issue Challenge" to begin</div>
          </div>
        )}

        {step >= 1 && chal && (
          <div className="col2">
            <div>
              {/* 2FA code display */}
              <div className="code-box mb12">
                <div className="mut">Show this code to the Holder (like a 2FA display)</div>
                <div className="code-big">{chal.code}</div>
                {timer > 0 && <div className="mut">Expires in {Math.floor(timer / 60)}:{String(timer % 60).padStart(2, "0")}</div>}
                <div className="flex ic gap8" style={{ justifyContent: "center", marginTop: 10, flexWrap: "wrap" }}>
                  <span className={`badge ${step === 1 ? "ba" : step === 2 ? "bb" : "bg"}`}>
                    {step === 1 ? "WAITING FOR REQUEST" : step === 2 ? polling ? "⏳ WAITING FOR HOLDER" : "REQUESTED" : "COMPLETE"}
                  </span>
                  {chal.exchange_id && <span className="badge bb">{chal.exchange_id.slice(0, 12)}…</span>}
                </div>
              </div>

              {/* Full nonce for holder to paste */}
              <div className="card">
                <div className="ch"><span className="ct">Full Nonce → Holder Wallet</span></div>
                <div className="cb">
                  <div className="mut mb8">The Holder copies this into the "ZKP Revocation Proof" field in their Wallet tab:</div>
                  <div style={{ background: "var(--bg1)", border: "1px solid var(--line)", borderRadius: 5, padding: 8, fontSize: 9, fontFamily: "var(--mono)", wordBreak: "break-all", color: "var(--teal)" }}>
                    {chal.nonce}
                  </div>
                  <button className="btn btn-g btn-sm" style={{ marginTop: 7 }} onClick={() => { try { navigator.clipboard.writeText(chal.nonce); } catch {} toast.add("Nonce copied"); }}>
                    Copy Nonce
                  </button>
                </div>
              </div>
            </div>

            <div>
              {/* Instructions panel */}
              <div className="card mb12" style={{ borderColor: "rgba(61,142,255,.25)" }}>
                <div className="ch"><span className="ct bc">Holder's Steps</span></div>
                <div className="cb">
                  <div style={{ fontSize: 11 }}>
                    {[
                      "Switch to the Holder Wallet tab",
                      "Select a credential",
                      "Paste the nonce, Generate ZKP, then Build VP",
                      "CRITICAL: Come back here and click '② Request Proof'",
                      "THEN check 'Proof Requests' in the Holder sidebar",
                      "Click 'Present Credentials' on the incoming request",
                    ].map((s, i) => (
                      <div key={i} style={{ display: "flex", gap: 8, padding: "4px 0", borderBottom: "1px solid var(--line)", background: i === 3 && step === 1 ? "rgba(255,184,48,.1)" : "none" }}>
                        <span style={{ color: "var(--teal)", fontWeight: 700, minWidth: 16 }}>{i + 1}.</span>
                        <span style={{ color: i === 3 && step === 1 ? "var(--amber)" : "var(--t1)" }}>{s}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Result */}
              {result && (
                <div className="card" style={{ borderColor: result.verified === "true" || result.verified === true ? "rgba(10,240,192,.3)" : "rgba(255,69,96,.3)" }}>
                  <div className="ch">
                    <span className="ct">{result.verified === "true" || result.verified === true ? "✓ Verification Result" : "✗ Failed"}</span>
                    <span className={`badge ${result.verified === "true" || result.verified === true ? "bg" : "br"}`}>{result.state}</span>
                  </div>
                  <div className="cb">
                    {result.presentation?.requested_proof?.revealed_attrs && Object.keys(result.presentation.requested_proof.revealed_attrs).length > 0 ? (
                      <>
                        <div className="mut mb8">Revealed attributes:</div>
                        {Object.entries(result.presentation.requested_proof.revealed_attrs).map(([k, v]) => (
                          <div key={k} className="flex jb" style={{ padding: "4px 0", borderBottom: "1px solid var(--line)", fontSize: 11 }}>
                            <span className="mut">{k}</span>
                            <span>{v.raw || JSON.stringify(v)}</span>
                          </div>
                        ))}
                      </>
                    ) : <div className="mut">No attributes in result</div>}
                    {result.threshold_token && (
                      <div style={{ marginTop: 10 }}>
                        <div className="mut mb8">Threshold token ({result.threshold_token.claim?.signature_count || "?"}-of-n):</div>
                        <div style={{ fontSize: 9, fontFamily: "var(--mono)", color: "var(--blue)", wordBreak: "break-all" }}>{result.threshold_token.token?.slice(0, 64)}…</div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// DB INSPECTOR
// ════════════════════════════════════════════════════════════════════════
function DBTab({ gw, toast, services, events }) {
  const [sec, setSec]   = useState("acc");
  const [data, setData] = useState({});
  const [busy, setBusy] = useState(false);

  const SECS = [
    { id: "acc",    l: "Accumulator" },
    { id: "audit",  l: "Audit Log" },
    { id: "fraud",  l: "Fraud Alerts" },
    { id: "rekor",  l: "Transparency Log" },
    { id: "ledger", l: "VDR Ledger" },
    { id: "events", l: "Live Events" },
  ];

  const loadSec = async s => {
    setBusy(true);
    try {
      if (s === "acc") {
        const d = await fetch(`${GW}/accumulator/state`, { headers: { "x-api-key": "dev-key-1" } }).then(r => r.json());
        setData(p => ({ ...p, acc: d }));
      } else if (s === "audit") {
        const d = await fetch(`${GW}/accumulator/log`, { headers: { "x-api-key": "dev-key-1" } }).then(r => r.json());
        setData(p => ({ ...p, audit: (d.log || []).slice().reverse().slice(0, 60) }));
      } else if (s === "fraud") {
        const d = await fetch(`${GW}/accumulator/alerts`, { headers: { "x-api-key": "dev-key-1" } }).then(r => r.json());
        setData(p => ({ ...p, fraud: d.alerts || [] }));
      } else if (s === "rekor") {
        const d = await fetch(`${GW}/transparency/log?limit=15`).then(r => r.json());
        setData(p => ({ ...p, rekor: d }));
      } else if (s === "ledger") {
        const d = await fetch(`${GW}/ledger/transactions`).then(r => r.json());
        setData(p => ({ ...p, ledger: d }));
      }
    } catch (e) { toast.add(e.message, "err"); }
    setBusy(false);
  };

  useEffect(() => { loadSec(sec); }, [sec]);
  useEffect(() => gw.on("accumulator_update", e => { if (sec === "acc") setData(p => ({ ...p, acc: e.payload })); }), [sec]);
  useEffect(() => gw.on("snapshot_accumulator", e => setData(p => ({ ...p, acc: e.payload }))), []);

  const upCount = Object.values(services).filter(s => s?.up).length;

  return (
    <div className="lay">
      <div className="sb">
        <div style={{ padding: "14px 12px 10px", borderBottom: "1px solid var(--line)", marginBottom: 8 }}>
          <div className="pt" style={{ fontSize: 13 }}>DB Inspector</div>
          <div className="mut">{upCount}/{Object.keys(services).length} services live</div>
        </div>
        <div style={{ padding: "0 8px 10px", borderBottom: "1px solid var(--line)", marginBottom: 8 }}>
          {SECS.map(s => (
            <button key={s.id} onClick={() => setSec(s.id)} style={{
              display: "block", width: "100%", textAlign: "left", padding: "9px 10px",
              fontSize: 10, letterSpacing: ".09em", textTransform: "uppercase",
              color: sec === s.id ? "var(--teal)" : "var(--t2)",
              background: sec === s.id ? "rgba(10,240,192,.07)" : "none",
              border: "none", cursor: "pointer", fontFamily: "var(--sans)", fontWeight: 700, borderRadius: 4,
            }}>
              {s.l}
              {s.id === "fraud" && (data.fraud?.length || 0) > 0 && <span className="badge br" style={{ marginLeft: 7, fontSize: 8 }}>{data.fraud.length}</span>}
            </button>
          ))}
        </div>
        <Svcs services={services} />
        <div style={{ padding: "6px 12px" }}>
          <button className="btn btn-g btn-sm" style={{ width: "100%" }} onClick={() => loadSec(sec)} disabled={busy}>
            {busy ? <Sp /> : "↻ Refresh"}
          </button>
        </div>
      </div>

      <div className="main">
        {sec === "acc" && data.acc && (
          <>
            <div className="pt">Accumulator State</div>
            <div className="ps">A = g^(p₁·p₂·…·pₖ) mod n — RSA dynamic accumulator, live from service</div>
            <div className="col3 mb16">
              <div className="card" style={{ textAlign: "center", padding: 16 }}><div style={{ fontSize: 28, fontWeight: 700, color: "var(--teal)" }}>{data.acc.epoch}</div><div className="mut">Epoch</div></div>
              <div className="card" style={{ textAlign: "center", padding: 16 }}><div style={{ fontSize: 28, fontWeight: 700, color: "var(--teal)" }}>{data.acc.member_count}</div><div className="mut">Members</div></div>
              <div className="card" style={{ textAlign: "center", padding: 16 }}><div style={{ fontSize: 18, fontWeight: 700, color: "var(--green)" }}>ACTIVE</div><div className="mut">Status</div></div>
            </div>
            <div className="card"><div className="ch"><span className="ct">Accumulator Root A</span></div><div className="cb"><div className="jbox" style={{ maxHeight: 70 }}>{data.acc.accumulator}</div></div></div>
            {data.acc.log_tail?.length > 0 && (
              <div className="card">
                <div className="ch"><span className="ct">Recent Ops</span></div>
                <div className="cb" style={{ padding: 0 }}>
                  <table className="tbl">
                    <thead><tr><th>Epoch</th><th>Op</th><th>Time</th></tr></thead>
                    <tbody>{data.acc.log_tail.map((e, i) => (
                      <tr key={i}><td className="mono">{e.epoch}</td><td style={{ color: e.operation === "ADD" ? "var(--teal)" : "var(--red)" }}>{e.operation}</td><td style={{ color: "var(--t2)" }}>{ts(e.timestamp)}</td></tr>
                    ))}</tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}

        {sec === "audit" && (
          <>
            <div className="pt">Audit Log</div>
            <div className="ps">Append-only — every ADD and REVOKE permanently recorded</div>
            <div className="card">
              <div className="ch"><span className="ct">Operations ({(data.audit || []).length})</span><span className="badge bg">APPEND-ONLY</span></div>
              <div className="cb" style={{ padding: 0 }}>
                <table className="tbl">
                  <thead><tr><th>Epoch</th><th>Op</th><th>Element</th><th>Time</th><th>Acc Prefix</th></tr></thead>
                  <tbody>
                    {(data.audit || []).length === 0 && <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--t2)", padding: 16 }}>No entries</td></tr>}
                    {(data.audit || []).map((e, i) => (
                      <tr key={i}>
                        <td className="mono">{e.epoch}</td>
                        <td style={{ color: e.operation === "ADD" ? "var(--teal)" : "var(--red)" }}>{e.operation}</td>
                        <td className="mono" style={{ fontSize: 9 }}>{e.element_prefix}</td>
                        <td style={{ fontSize: 9, color: "var(--t2)" }}>{ts(e.timestamp)}</td>
                        <td className="mono" style={{ fontSize: 9 }}>{e.accumulator_prefix}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {sec === "fraud" && (
          <>
            <div className="pt">Fraud Alerts</div>
            <div className="ps">Rapid revocation · nonce replay · double presentation detector</div>
            {(data.fraud || []).length === 0 ? (
              <div style={{ textAlign: "center", padding: 60, opacity: .4 }}><div style={{ fontSize: 40 }}>✓</div><div style={{ marginTop: 8 }}>No fraud alerts</div></div>
            ) : (data.fraud || []).map((a, i) => (
              <div key={i} className="card mb8" style={{ borderColor: a.severity === "HIGH" || a.severity === "CRITICAL" ? "rgba(255,69,96,.3)" : "rgba(255,184,48,.3)" }}>
                <div className="cb">
                  <div className="flex ic gap8 mb8">
                    <span className={`badge ${a.severity === "HIGH" || a.severity === "CRITICAL" ? "br" : "ba"}`}>{a.severity}</span>
                    <span style={{ fontWeight: 700 }}>{a.event_type}</span>
                    <span className="mut">{ts(a.timestamp)}</span>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--t1)" }}>{a.description}</div>
                </div>
              </div>
            ))}
          </>
        )}

        {sec === "rekor" && (
          <>
            <div className="pt">Transparency Log (Rekor)</div>
            <div className="ps">Merkle-tree — every verification permanently hashed</div>
            {data.rekor ? (
              <>
                <div className="col2 mb16">
                  <div className="card" style={{ textAlign: "center", padding: 16 }}><div style={{ fontSize: 28, fontWeight: 700, color: "var(--blue)" }}>{data.rekor.tree_size || 0}</div><div className="mut">Tree Size</div></div>
                  <div className="card" style={{ textAlign: "center", padding: 16 }}><div style={{ fontSize: 18, fontWeight: 700, color: "var(--green)" }}>ACTIVE</div><div className="mut">Log Status</div></div>
                </div>
                <div className="card">
                  <div className="ch"><span className="ct">Recent Entries</span></div>
                  <div className="cb" style={{ padding: 0 }}>
                    <table className="tbl">
                      <thead><tr><th>Index</th><th>Data</th></tr></thead>
                      <tbody>
                        {(data.rekor.entries || []).length === 0 && <tr><td colSpan={2} style={{ textAlign: "center", color: "var(--t2)", padding: 16 }}>No entries yet</td></tr>}
                        {(data.rekor.entries || []).map((e, i) => (
                          <tr key={i}><td className="mono">{e.index}</td><td style={{ fontSize: 9 }} className="trunc">{JSON.stringify(e.data).slice(0, 100)}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            ) : <div className="mut">Loading…</div>}
          </>
        )}

        {sec === "ledger" && (
          <>
            <div className="pt">VDR Ledger (Hyperledger Indy)</div>
            <div className="ps">4-node RBFT consensus — DIDs, schemas, credential definitions</div>
            <div className="card">
              <div className="cb" style={{ padding: 0 }}>
                <table className="tbl">
                  <thead><tr><th>Seq#</th><th>Type</th><th>From DID</th><th>Time</th></tr></thead>
                  <tbody>
                    {!(data.ledger?.data?.length) && <tr><td colSpan={4} style={{ textAlign: "center", color: "var(--t2)", padding: 16 }}>No transactions or ledger unreachable</td></tr>}
                    {(data.ledger?.data || []).map((tx, i) => (
                      <tr key={i}>
                        <td className="mono">{tx.seqNo || i}</td>
                        <td>{tx.txn?.type || tx.type || "—"}</td>
                        <td className="mono trunc" style={{ fontSize: 9, maxWidth: 140 }}>{tx.txn?.metadata?.from || "—"}</td>
                        <td style={{ fontSize: 9, color: "var(--t2)" }}>{tx.txnMetadata?.txnTime ? new Date(tx.txnMetadata.txnTime * 1000).toLocaleString() : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {sec === "events" && (
          <>
            <div className="pt">Live Event Stream</div>
            <div className="ps">Real-time WebSocket events from all services — nothing simulated</div>
            <div className="card">
              <div className="ch"><span className="ct">Events ({events.length})</span><span className="badge bg" style={{ animation: "pulse 2s infinite" }}>LIVE</span></div>
              <div className="cb">
                <div className="evlist">
                  {events.length === 0 && <div className="mut" style={{ padding: "10px 0" }}>Waiting for events…</div>}
                  {events.map((e, i) => (
                    <div key={i} className={`ev ${evClass(e.type)}`}>
                      <span className="ev-t">{ts(e.timestamp)}</span>
                      <span className="ev-n">{e.type}</span>
                      <span className="ev-p">{JSON.stringify(e.payload).slice(0, 90)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// ROOT
// ════════════════════════════════════════════════════════════════════════
export default function App() {
  const [tab, setTab] = useState("holder");
  const toast = useToast();
  const gw    = useGateway();

  const TABS = [
    { id: "holder", l: "Holder Wallet" },
    { id: "issuer", l: "Issuer" },
    { id: "rp",     l: "Relying Party" },
    { id: "db",     l: "DB Inspector" },
  ];

  return (
    <>
      <style>{S}</style>
      <nav className="nav">
        <div className="nav-logo">
          <span>SSI</span><span>/DID</span>
        </div>
        {TABS.map(t => <button key={t.id} className={`tab ${tab === t.id ? "on" : ""}`} onClick={() => setTab(t.id)}>{t.l}</button>)}
        <div className="ws-pill">
          {gw.live ? <span className="live-dot" /> : <span className="dead-dot" />}
          <span style={{ fontSize: 10, color: gw.live ? "var(--teal)" : "var(--t2)" }}>{gw.live ? "LIVE" : "RECONNECTING"}</span>
          <span style={{ color: "var(--t2)", fontSize: 10, marginLeft: 12 }}>ITS 2026</span>
        </div>
      </nav>

      {tab === "holder" && <Holder gw={gw} toast={toast} />}
      {tab === "issuer" && <IssuerTab gw={gw} toast={toast} />}
      {tab === "rp"     && <RPTab gw={gw} toast={toast} />}
      {tab === "db"     && <DBTab gw={gw} toast={toast} services={gw.services} events={gw.events} />}

      <div className="toasts">
        {toast.toasts.map(t => (
          <div key={t.id} className={`toast ${t.type}`}>{t.msg}</div>
        ))}
      </div>
    </>
  );
}