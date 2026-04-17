import { useState, useEffect, useRef, useCallback } from "react";

// ── Config ─────────────────────────────────────────────────────────────────
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
const get  = p     => api("GET",  p);
const post = (p,b) => api("POST", p, b);

// ── Gateway WebSocket ──────────────────────────────────────────────────────
function useGateway() {
  const [events,   setEvents]   = useState([]);
  const [services, setServices] = useState({});
  const [live,     setLive]     = useState(false);
  const cbs   = useRef({});
  const wsRef = useRef(null);

  const on = useCallback((type, cb) => {
    cbs.current[type] = cbs.current[type] || [];
    cbs.current[type].push(cb);
    return () => { cbs.current[type] = (cbs.current[type]||[]).filter(x=>x!==cb); };
  }, []);

  useEffect(() => {
    let sock;
    const connect = () => {
      sock = new WebSocket(WS);
      wsRef.current = sock;
      sock.onopen  = () => { setLive(true); sock.send(JSON.stringify({type:"request_snapshot"})); };
      sock.onclose = () => { setLive(false); wsRef.current=null; setTimeout(connect,3000); };
      sock.onerror = () => sock.close();
      sock.onmessage = e => {
        const ev = JSON.parse(e.data);
        if (!ev.type || ev.type==="pong") return;
        if (ev.type==="service_health") { setServices(ev.payload); return; }
        setEvents(p => [ev,...p].slice(0,120));
        [...(cbs.current[ev.type]||[]),...(cbs.current["*"]||[])].forEach(cb=>cb(ev));
      };
    };
    connect();
    const ping = setInterval(()=> wsRef.current?.readyState===1 && wsRef.current.send(JSON.stringify({type:"ping"})), 20000);
    return () => { clearInterval(ping); sock?.close(); };
  }, []);

  return { live, events, services, on };
}

function useToast() {
  const [toasts, setToasts] = useState([]);
  const add = useCallback((msg, type="ok") => {
    const id = Date.now();
    setToasts(p=>[...p,{id,msg,type}]);
    setTimeout(()=>setToasts(p=>p.filter(x=>x.id!==id)), 4500);
  }, []);
  return {toasts, add};
}

// ── CSS ────────────────────────────────────────────────────────────────────
const S = `
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=Space+Mono:wght@400;700&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#06090f;--bg1:#0b1017;--bg2:#101822;--bg3:#16212e;--bg4:#1d2d3f;
  --teal:#0af0c0;--amber:#ffb830;--red:#ff4560;--blue:#3d8eff;--green:#22c55e;
  --t0:#dff0ea;--t1:#7aada0;--t2:#3d6860;
  --line:rgba(10,240,192,0.1);--line2:rgba(10,240,192,0.2);
  --sans:'Space Grotesk',sans-serif;--mono:'Space Mono',monospace;
}
body{background:var(--bg);color:var(--t0);font-family:var(--sans);min-height:100vh;font-size:14px}
body::before{content:'';position:fixed;inset:0;pointer-events:none;z-index:0;
  background-image:linear-gradient(rgba(10,240,192,.015) 1px,transparent 1px),linear-gradient(90deg,rgba(10,240,192,.015) 1px,transparent 1px);
  background-size:40px 40px}
/* nav */
.nav{display:flex;align-items:center;border-bottom:1px solid var(--line2);background:rgba(11,16,23,.96);backdrop-filter:blur(8px);position:sticky;top:0;z-index:200;overflow-x:auto}
.nav-logo{padding:0 18px;font-size:12px;font-weight:700;letter-spacing:.15em;color:var(--teal);border-right:1px solid var(--line2);height:48px;display:flex;align-items:center;gap:8px;white-space:nowrap}
.nav-logo span{color:var(--t2);font-weight:400}
.tab{padding:0 16px;height:48px;font-size:10px;letter-spacing:.12em;text-transform:uppercase;cursor:pointer;color:var(--t2);background:none;border:none;font-family:var(--sans);border-bottom:2px solid transparent;position:relative;top:1px;transition:all .15s;white-space:nowrap;font-weight:600}
.tab:hover{color:var(--t1)}.tab.on{color:var(--teal);border-bottom-color:var(--teal)}
.ws-pill{margin-left:auto;padding:0 16px;display:flex;align-items:center;gap:8px;font-size:10px;white-space:nowrap}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}
.live-dot{width:7px;height:7px;border-radius:50%;background:var(--teal);box-shadow:0 0 7px var(--teal);animation:pulse 2s infinite}
.dead-dot{width:7px;height:7px;border-radius:50%;background:var(--t2)}
/* layout */
.lay{display:grid;grid-template-columns:268px 1fr;min-height:calc(100vh - 48px);position:relative;z-index:1}
.sb{border-right:1px solid var(--line);background:var(--bg1);overflow-y:auto;max-height:calc(100vh - 48px)}
.main{overflow-y:auto;max-height:calc(100vh - 48px);padding:22px}
/* cards */
.card{background:var(--bg2);border:1px solid var(--line);border-radius:8px;overflow:hidden;margin-bottom:12px}
.ch{padding:10px 14px;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;gap:8px}
.ct{font-size:9px;letter-spacing:.13em;text-transform:uppercase;color:var(--t1);font-weight:700;white-space:nowrap}
.cb{padding:14px}
/* cred strip */
.cred{background:var(--bg2);border:1px solid var(--line);border-radius:7px;padding:12px 14px;margin-bottom:8px;cursor:pointer;transition:all .15s;position:relative;overflow:hidden}
.cred::before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--teal);opacity:.6}
.cred:hover{border-color:var(--line2);background:var(--bg3)}.cred.on{border-color:var(--teal);background:var(--bg3)}
.offer-card{border-color:rgba(255,184,48,.35);background:rgba(255,184,48,.04)}
.offer-card::before{background:var(--amber)}
/* badges */
.badge{display:inline-block;padding:2px 8px;font-size:9px;letter-spacing:.1em;border-radius:3px;font-weight:700;text-transform:uppercase}
.bg{background:rgba(10,240,192,.1);color:var(--teal);border:1px solid rgba(10,240,192,.25)}
.br{background:rgba(255,69,96,.1);color:var(--red);border:1px solid rgba(255,69,96,.25)}
.ba{background:rgba(255,184,48,.1);color:var(--amber);border:1px solid rgba(255,184,48,.25)}
.bb{background:rgba(61,142,255,.1);color:var(--blue);border:1px solid rgba(61,142,255,.25)}
/* buttons */
.btn{padding:8px 16px;font-size:10px;letter-spacing:.12em;text-transform:uppercase;font-family:var(--sans);border-radius:5px;cursor:pointer;border:1px solid;transition:all .15s;font-weight:700;display:inline-flex;align-items:center;gap:6px}
.btn-p{background:var(--teal);color:var(--bg);border-color:var(--teal)}.btn-p:hover{background:#00ffe0;box-shadow:0 0 18px rgba(10,240,192,.3)}.btn-p:disabled{opacity:.35;cursor:not-allowed}
.btn-g{background:transparent;color:var(--t1);border-color:var(--line2)}.btn-g:hover{border-color:var(--teal);color:var(--teal)}.btn-g:disabled{opacity:.35;cursor:not-allowed}
.btn-d{background:transparent;color:var(--red);border-color:rgba(255,69,96,.25)}.btn-d:hover{background:rgba(255,69,96,.08)}
.btn-a{background:rgba(255,184,48,.15);color:var(--amber);border-color:var(--amber)}.btn-a:hover{background:rgba(255,184,48,.25)}
.btn-xl{padding:14px 32px;font-size:12px;letter-spacing:.15em;border-radius:6px}
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
/* misc layout */
.col2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.col3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px}
.flex{display:flex}.gap8{gap:8px}.gap12{gap:12px}.ic{align-items:center}.jb{justify-content:space-between}
.mb8{margin-bottom:8px}.mb12{margin-bottom:12px}.mb16{margin-bottom:16px}.mb20{margin-bottom:20px}
.pt{font-size:17px;font-weight:700;margin-bottom:3px}.ps{font-size:10px;color:var(--t2);margin-bottom:18px}
.tc{color:var(--teal)}.rc{color:var(--red)}.ac{color:var(--amber)}.bc{color:var(--blue)}.mut{color:var(--t2);font-size:10px}
.mono{font-family:var(--mono)}.trunc{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.chip{font-size:9px;padding:2px 6px;background:var(--bg4);border:1px solid var(--line);border-radius:3px;color:var(--t1);margin:2px}
.jbox{background:var(--bg1);border:1px solid var(--line);border-radius:5px;padding:10px;font-size:9px;font-family:var(--mono);color:var(--t1);overflow-y:auto;white-space:pre-wrap;word-break:break-all}
.jbox .jk{color:var(--teal)}.jbox .jv{color:var(--t0)}
.section-sep{font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:var(--t2);padding:10px 12px 4px;font-weight:700}
.inv-box{background:var(--bg1);border:1px solid var(--line2);border-radius:5px;padding:10px;font-size:9px;font-family:var(--mono);color:var(--teal);word-break:break-all;margin-top:8px;max-height:80px;overflow-y:auto}
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
/* svc */
.svc{display:flex;align-items:center;gap:7px;padding:4px 0;font-size:10px}
.svc-n{color:var(--t1);flex:1}.svc-p{font-family:var(--mono);font-size:9px;color:var(--t2)}
/* event stream */
.evlist{max-height:260px;overflow-y:auto}
.ev{display:flex;gap:10px;padding:6px 0;border-bottom:1px solid var(--line);font-size:10px;align-items:flex-start}
.ev-t{color:var(--t2);min-width:54px;font-family:var(--mono)}.ev-n{min-width:150px;font-weight:700}
.ev-p{color:var(--t1);word-break:break-all;flex:1}
.ev-cred .ev-n{color:var(--teal)}.ev-proof .ev-n{color:var(--blue)}.ev-rev .ev-n{color:var(--red)}.ev-conn .ev-n{color:var(--purple)}.ev-other .ev-n{color:var(--t2)}

/* ── PORTAL UI (RP) ────────────────────────────────────────────────────── */
.portal-wrap{min-height:calc(100vh - 48px);background:linear-gradient(135deg,#06090f 0%,#0d1520 50%,#06090f 100%);display:flex;flex-direction:column;position:relative;z-index:1;overflow:hidden}
.portal-wrap::before{content:'';position:absolute;inset:0;background:radial-gradient(ellipse 80% 50% at 50% 0%,rgba(10,240,192,.06) 0%,transparent 70%);pointer-events:none}
/* Portal top bar */
.portal-bar{padding:14px 28px;border-bottom:1px solid var(--line2);background:rgba(11,16,23,.8);backdrop-filter:blur(12px);display:flex;align-items:center;justify-content:space-between}
.portal-brand{font-size:15px;font-weight:700;color:var(--t0);letter-spacing:.05em;display:flex;align-items:center;gap:10px}
.portal-brand-icon{width:32px;height:32px;background:linear-gradient(135deg,var(--teal),var(--blue));border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:16px}
.portal-brand-sub{font-size:9px;color:var(--t2);font-weight:400;display:block;letter-spacing:.08em}
.portal-status{font-size:10px;color:var(--t2);display:flex;align-items:center;gap:6px}
/* Portal body states */
.portal-body{flex:1;display:flex;align-items:center;justify-content:center;padding:40px 20px}
.portal-card{background:rgba(16,24,34,.85);border:1px solid var(--line2);border-radius:16px;padding:40px;max-width:480px;width:100%;text-align:center;backdrop-filter:blur(16px);box-shadow:0 24px 80px rgba(0,0,0,.5)}
.portal-card h1{font-size:22px;font-weight:700;margin-bottom:6px;color:var(--t0)}
.portal-card p{font-size:12px;color:var(--t2);margin-bottom:28px;line-height:1.6}
/* QR code */
.qr-wrap{width:180px;height:180px;margin:0 auto 20px;background:white;border-radius:10px;padding:10px;position:relative}
.qr-wrap img{width:100%;height:100%;border-radius:4px}
.qr-overlay{position:absolute;inset:0;background:rgba(11,16,23,.85);border-radius:10px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;cursor:pointer;transition:opacity .2s}
.qr-overlay:hover{background:rgba(11,16,23,.7)}
/* Pipeline steps */
.pipeline{display:flex;flex-direction:column;gap:0;text-align:left;margin:16px 0}
.pipe-step{display:flex;align-items:flex-start;gap:14px;padding:12px 0;border-bottom:1px solid var(--line);position:relative}
.pipe-step:last-child{border-bottom:none}
.pipe-dot{width:28px;height:28px;border-radius:50%;border:2px solid var(--line2);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0;transition:all .3s}
.pipe-dot.wait{color:var(--t2)}
.pipe-dot.active{border-color:var(--amber);color:var(--amber);box-shadow:0 0 12px rgba(255,184,48,.3);animation:pulse 1.5s infinite}
.pipe-dot.done{background:var(--teal);border-color:var(--teal);color:var(--bg)}
.pipe-dot.fail{background:var(--red);border-color:var(--red);color:white}
.pipe-info{flex:1}
.pipe-label{font-size:12px;font-weight:600;color:var(--t0);margin-bottom:2px}
.pipe-detail{font-size:10px;color:var(--t2)}
.pipe-detail.active{color:var(--amber)}.pipe-detail.done{color:var(--teal)}
/* Success state */
.portal-success{text-align:center}
.success-icon{width:70px;height:70px;background:linear-gradient(135deg,rgba(10,240,192,.15),rgba(34,197,94,.15));border:2px solid var(--teal);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:30px;margin:0 auto 20px}
.success-attrs{background:var(--bg3);border:1px solid var(--line);border-radius:8px;padding:14px;text-align:left;margin:16px 0}
.success-attr-row{display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--line);font-size:11px}
.success-attr-row:last-child{border-bottom:none}
.success-attr-row span:first-child{color:var(--t2)}.success-attr-row span:last-child{color:var(--t0);font-weight:600}
.token-pill{background:rgba(61,142,255,.1);border:1px solid rgba(61,142,255,.25);border-radius:20px;padding:5px 12px;font-size:9px;color:var(--blue);font-family:var(--mono);display:inline-block;margin-top:10px}
/* Proof request notification (Holder) */
.proof-req-banner{background:linear-gradient(135deg,rgba(255,184,48,.08),rgba(255,184,48,.04));border:1px solid rgba(255,184,48,.4);border-radius:10px;padding:16px;margin-bottom:10px;position:relative;overflow:hidden}
.proof-req-banner::before{content:'';position:absolute;left:0;top:0;bottom:0;width:4px;background:var(--amber)}
.proof-req-portal{font-size:11px;font-weight:700;color:var(--t0);margin-bottom:4px}
.proof-req-asking{font-size:10px;color:var(--t2);margin-bottom:10px}
.proof-req-attrs{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:12px}
`;

// ── Helpers ─────────────────────────────────────────────────────────────────
const ts = t => new Date(t*1000).toLocaleTimeString();
function Sp() { return <span className="sp"/>; }
function Jv({data,maxH=180}) {
  if (!data) return null;
  const h = JSON.stringify(data,null,2)
    .replace(/"([^"]+)":/g,'<span class="jk">"$1":</span>')
    .replace(/: "([^"]*)"([,\n]|$)/g,': <span class="jv">"$1"</span>$2')
    .replace(/: (\d[\d.]*)/g,': <span class="jv">$1</span>');
  return <div className="jbox" style={{maxHeight:maxH}} dangerouslySetInnerHTML={{__html:h}}/>;
}
function evClass(t) {
  if (!t) return "ev-other";
  if (t.includes("cred")||t.includes("schema")) return "ev-cred";
  if (t.includes("proof")||t.includes("verif")) return "ev-proof";
  if (t.includes("revoc")) return "ev-rev";
  if (t.includes("conn")||t.includes("invit")) return "ev-conn";
  return "ev-other";
}
function Svcs({services}) {
  const MAP={accumulator:":8080",verification_gateway:":4000",governance:":3000",von_ledger:":8000",rekor:":3100",issuer_agent:":8001",holder_agent:":8031"};
  return (
    <div style={{padding:"6px 12px 12px"}}>
      <div className="section-sep" style={{padding:"4px 0 6px"}}>Services</div>
      {Object.entries(MAP).map(([n,p])=>{
        const up=services[n]?.up;
        return <div key={n} className="svc">
          <span style={{width:7,height:7,borderRadius:"50%",background:up?"var(--teal)":"var(--t2)",boxShadow:up?"0 0 6px var(--teal)":"none",animation:up?"pulse 2s infinite":"none",flexShrink:0}}/>
          <span className="svc-n">{n.replace(/_/g," ")}</span>
          <span className="svc-p">{p}</span>
        </div>;
      })}
    </div>
  );
}

// ── QR code (via Google Charts API — works offline via URL) ─────────────────
function QRCode({data, size=160}) {
  const url = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(data)}&bgcolor=ffffff&color=0a0f1a`;
  return <img src={url} width={size} height={size} alt="QR" style={{borderRadius:4}} onError={e=>{e.target.style.display="none"}} />;
}

// ════════════════════════════════════════════════════════════════════════════
// HOLDER TAB
// ════════════════════════════════════════════════════════════════════════════
function Holder({gw, toast}) {
  const [creds,     setCreds]    = useState([]);
  const [offers,    setOffers]   = useState([]);
  const [proofReqs, setProofReqs]= useState([]);
  const [sel,       setSel]      = useState(null);
  const [invText,   setInvText]  = useState("");
  const [loading,   setLoad]     = useState({});

  const reload = async () => {
    try { setCreds((await get("/holder/credentials")).results||[]); } catch{}
    try { setOffers((await get("/holder/credential-offers")).results||[]); } catch{}
    try { setProofReqs((await get("/holder/proof-requests")).results||[]); } catch{}
  };

  useEffect(()=>{ reload(); },[]);
  useEffect(()=>gw.on("credential_issued",()=>setTimeout(reload,2500)),[]);
  useEffect(()=>gw.on("proof_event",()=>setTimeout(reload,800)),[]);
  useEffect(()=>gw.on("snapshot_wallet",e=>{ if(e.payload.results) setCreds(e.payload.results); }),[]);
  // Auto-refresh when portal fires proof_requested event
  useEffect(()=>gw.on("proof_requested",()=>setTimeout(reload,1200)),[]);

  const acceptOffer = async id => {
    setLoad(p=>({...p,[id]:true}));
    try { await post("/holder/accept-offer/"+id); toast.add("Credential accepted"); setTimeout(reload,3000); }
    catch(e){ toast.add(e.message,"err"); }
    setLoad(p=>({...p,[id]:false}));
  };

  const joinNetwork = async () => {
    let inv; const raw=invText.trim();
    if (raw.startsWith("http")) { inv=raw; }
    else { try { inv=JSON.parse(raw.replace(/^```[a-z]*\s*/i,"").replace(/```\s*$/,"").trim()); } catch { toast.add("Paste invitation JSON or URL","warn"); return; } }
    setLoad(p=>({...p,join:true}));
    try { await post("/holder/receive-invitation",{invitation:inv}); toast.add("Connected — establishing DIDComm channel"); setInvText(""); setTimeout(reload,3000); }
    catch(e){ toast.add(e.message,"err"); }
    setLoad(p=>({...p,join:false}));
  };

  const presentProof = async (id) => {
    setLoad(p=>({...p,[id]:true}));
    try {
      await post("/holder/send-proof",{pres_ex_id:id,self_attested:{},requested_attrs:{}});
      toast.add("Credentials presented ✓");
      setTimeout(reload,1500);
    } catch(e){ toast.add(e.message,"err"); }
    setLoad(p=>({...p,[id]:false}));
  };

  const selCred = creds.find(c=>c.referent===sel);

  return (
    <div className="lay">
      <div className="sb">
        <div style={{padding:"14px 12px 10px",borderBottom:"1px solid var(--line)",marginBottom:8}}>
          <div className="pt" style={{fontSize:13}}>My Wallet</div>
          <div className="mut">{creds.length} credential{creds.length!==1?"s":""}</div>
        </div>

        {/* Join issuer */}
        <div style={{padding:"0 12px 12px",borderBottom:"1px solid var(--line)",marginBottom:8}}>
          <div className="section-sep" style={{padding:"0 0 6px"}}>Connect to Issuer</div>
          <textarea className="ta" rows={3} placeholder="Paste invitation JSON from Issuer → Setup tab…" value={invText} onChange={e=>setInvText(e.target.value)}/>
          <button className="btn btn-g btn-sm" style={{width:"100%",marginTop:6}} onClick={joinNetwork} disabled={loading.join||!invText.trim()}>
            {loading.join?<Sp/>:"Connect"}
          </button>
        </div>

        {/* Proof requests — the main simplification */}
        {proofReqs.length>0 && (
          <div style={{padding:"0 12px 10px",borderBottom:"1px solid var(--line)",marginBottom:8}}>
            <div className="section-sep" style={{padding:"0 0 8px",color:"var(--amber)"}}>
              ⚡ Pending Requests ({proofReqs.length})
            </div>
            {proofReqs.map((r,i)=>{
              const rec = r.pres_ex_record||r;
              const id  = rec.pres_ex_id||rec.presentation_exchange_id;
              const reqAttrs = Object.values(rec.presentation_request?.requested_attributes||{}).map(a=>a.name);
              return (
                <div key={id||i} className="proof-req-banner">
                  <div className="proof-req-portal">🌐 SIDAK Portal</div>
                  <div className="proof-req-asking">Requesting proof of identity:</div>
                  <div className="proof-req-attrs">
                    {reqAttrs.length>0 ? reqAttrs.map(a=><span key={a} className="chip">{a}</span>) : <span className="chip">credentials</span>}
                  </div>
                  <button className="btn btn-a" style={{width:"100%"}} onClick={()=>presentProof(id)} disabled={loading[id]}>
                    {loading[id]?<Sp/>:"✓ Approve & Present"}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Credential offers */}
        {offers.length>0 && (
          <div style={{padding:"0 12px 10px",borderBottom:"1px solid var(--line)",marginBottom:8}}>
            <div className="section-sep" style={{padding:"0 0 6px",color:"var(--teal)"}}>📨 Offers ({offers.length})</div>
            {offers.map((o,i)=>{
              const rec=o.cred_ex_record||o;
              const id=rec.cred_ex_id;
              const prev=rec.cred_preview||rec.by_format?.cred_offer?.indy?.credential_proposal;
              return (
                <div key={id||i} className="cred offer-card">
                  <div style={{fontSize:9,color:"var(--amber)",marginBottom:3}}>New Credential</div>
                  <div style={{fontSize:10,marginBottom:6,color:"var(--t0)"}}>{prev?.attributes?.map(a=>a.name).join(", ")||"credentials"}</div>
                  <button className="btn btn-a btn-sm" onClick={()=>acceptOffer(id)} disabled={loading[id]}>
                    {loading[id]?<Sp/>:"Accept"}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Credentials */}
        <div className="section-sep">Credentials ({creds.length})</div>
        <div style={{padding:"0 10px"}}>
          {creds.length===0 && <div className="mut" style={{padding:"14px 0"}}>No credentials yet.</div>}
          {creds.map(c=>(
            <div key={c.referent} className={`cred ${sel===c.referent?"on":""}`} onClick={()=>setSel(c.referent)}>
              <div style={{fontSize:9,color:"var(--teal)",letterSpacing:".1em",textTransform:"uppercase",marginBottom:3}}>{c.schema_id?.split(":").slice(-2).join(":")}</div>
              <div style={{fontSize:9,color:"var(--t2)",marginBottom:5}} className="trunc">{c.referent}</div>
              <div style={{display:"flex",flexWrap:"wrap"}}>{Object.keys(c.attrs||{}).map(k=><span key={k} className="chip">{k}</span>)}</div>
            </div>
          ))}
        </div>
        <div style={{padding:"10px 12px"}}>
          <button className="btn btn-g btn-sm" style={{width:"100%"}} onClick={reload}>↻ Refresh</button>
        </div>
      </div>

      <div className="main">
        {!selCred ? (
          <div style={{height:300,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:10,opacity:.4}}>
            <div style={{fontSize:38}}>⬡</div>
            <div style={{fontSize:12}}>Select a credential to view details, build ZKPs, or present manually</div>
          </div>
        ) : <CredDetail cred={selCred} toast={toast}/>}
      </div>
    </div>
  );
}

function CredDetail({cred, toast}) {
  const attrs=cred.attrs||{};
  const [sel,setSel]=useState(()=>Object.keys(attrs));
  const [nonce,setNonce]=useState("");
  const [zkp,setZkp]=useState(null);
  const [pred,setPred]=useState(null);
  const [vp,setVp]=useState(null);
  const [pa,setPa]=useState(Object.keys(attrs)[0]||"");
  const [pv,setPv]=useState("18");
  const [busy,setBusy]=useState("");
  const toggle=k=>setSel(p=>p.includes(k)?p.filter(x=>x!==k):[...p,k]);
  const getZKP=async()=>{
    if(!nonce){toast.add("Enter nonce","warn");return;}
    setBusy("z");
    try {
      const h=btoa(cred.referent).replace(/[+/=]/g,"x").slice(0,44);
      const r=await fetch("http://localhost:8080/zkp/create-non-membership-proof",{method:"POST",headers:{"Content-Type":"application/json","x-api-key":"dev-key-1"},body:JSON.stringify({cred_hash:h,nonce})});
      if(!r.ok) throw new Error(await r.text());
      const d=await r.json(); setZkp(d.proof); toast.add("ZKP proof ready");
    } catch(e){toast.add(e.message,"err");}
    setBusy("");
  };
  const buildVP=()=>{
    const disclosed={};
    sel.forEach(k=>{if(attrs[k]!==undefined)disclosed[k]=attrs[k];});
    setVp({"@type":"VerifiablePresentation",nonce,disclosed_attributes:sel,revealed_values:disclosed,zkp_revocation_proof:zkp?{proof_hash:zkp.proof_hash?.slice(0,16)+"…",epoch:zkp.accumulator_epoch}:null,created_at:new Date().toISOString()});
    toast.add(`VP built — ${sel.length}/${Object.keys(attrs).length} attrs`);
  };
  return (
    <>
      <div className="flex ic jb mb16">
        <div><div className="pt">{cred.schema_id?.split(":").slice(-2,-1)[0]?.replace(/_/g," ")||"Credential"}</div><div className="ps mono" style={{fontSize:10}}>{cred.referent}</div></div>
        <span className="badge bg">ACTIVE</span>
      </div>
      <div className="col2">
        <div>
          <div className="card">
            <div className="ch"><span className="ct">Selective Disclosure</span><span className="mut">{sel.length}/{Object.keys(attrs).length}</span></div>
            <div className="cb">
              {Object.entries(attrs).map(([k,v])=>(
                <label key={k} style={{display:"flex",alignItems:"center",gap:8,padding:"5px 0",cursor:"pointer",fontSize:11,borderBottom:"1px solid var(--line)"}} onClick={()=>toggle(k)}>
                  <input type="checkbox" checked={sel.includes(k)} onChange={()=>{}} style={{accentColor:"var(--teal)",width:14,height:14}}/>
                  <span style={{flex:1}}>{k}</span>
                  {sel.includes(k)?<span style={{color:"var(--t0)",fontSize:10}}>{String(v).slice(0,22)}</span>:<span className="badge ba" style={{fontSize:8}}>HIDDEN</span>}
                </label>
              ))}
            </div>
          </div>
        </div>
        <div>
          <div className="card">
            <div className="ch"><span className="ct">ZKP Revocation (manual)</span></div>
            <div className="cb">
              <div className="mut mb8">For thesis demo — paste nonce from RP tab to prove non-revocation:</div>
              <div className="f"><label className="lbl">Nonce</label><input className="inp" placeholder="Paste nonce…" value={nonce} onChange={e=>setNonce(e.target.value)}/></div>
              <button className="btn btn-g btn-sm" onClick={getZKP} disabled={busy==="z"||!nonce}>{busy==="z"?<Sp/>:"Generate ZKP"}</button>
              {zkp && <div style={{marginTop:8}}><span className="badge bg">READY</span> <span className="mut">epoch {zkp.accumulator_epoch}</span></div>}
            </div>
          </div>
          <div className="card">
            <div className="ch"><span className="ct">Build VP (manual)</span></div>
            <div className="cb">
              <button className="btn btn-p" style={{width:"100%",marginBottom:8}} onClick={buildVP}>Build Verifiable Presentation</button>
              {vp && <><Jv data={vp} maxH={120}/><button className="btn btn-g btn-sm" style={{marginTop:6}} onClick={()=>{try{navigator.clipboard.writeText(JSON.stringify(vp,null,2));}catch{}toast.add("VP copied");}}>Copy</button></>}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// ISSUER TAB (unchanged from previous version)
// ════════════════════════════════════════════════════════════════════════════
function IssuerTab({gw,toast}) {
  const [sub,setSub]=useState("setup");
  return (
    <div className="lay">
      <div className="sb">
        <div style={{padding:"14px 12px 10px",borderBottom:"1px solid var(--line)",marginBottom:8}}>
          <div className="pt" style={{fontSize:13}}>Issuer Agent</div><div className="mut">Government / University</div>
        </div>
        {["setup","issue","records"].map(t=>(
          <button key={t} onClick={()=>setSub(t)} style={{display:"block",width:"100%",textAlign:"left",padding:"10px 16px",fontSize:10,letterSpacing:".1em",textTransform:"uppercase",color:sub===t?"var(--teal)":"var(--t2)",background:sub===t?"rgba(10,240,192,.07)":"none",border:"none",cursor:"pointer",fontFamily:"var(--sans)",fontWeight:700}}>
            {t==="setup"?"① Setup & Connect":t==="issue"?"② Issue Credential":"③ Records & Revoke"}
          </button>
        ))}
      </div>
      <div className="main">
        {sub==="setup"  && <IssuerSetup  toast={toast} gw={gw}/>}
        {sub==="issue"  && <IssuerIssue  toast={toast} gw={gw}/>}
        {sub==="records"&& <IssuerRecords toast={toast} gw={gw}/>}
      </div>
    </div>
  );
}
function IssuerSetup({toast,gw}) {
  const [inv,setInv]=useState(null);const [conns,setConns]=useState([]);const [schemas,setSchemas]=useState([]);const [defs,setDefs]=useState([]);const [busy,setBusy]=useState("");
  const [sName,setSName]=useState("Degree_Schema");const [sVer,setSVer]=useState("1.0");const [sAttrs,setSAttrs]=useState("name, degree, university, gpa, date_issued");
  const [defSchema,setDefSchema]=useState("");const [defTag,setDefTag]=useState("default");
  const reload=async()=>{
    try{setConns((await get("/issuer/connections")).results||[]);}catch{}
    try{setSchemas((await get("/issuer/schemas-full")).schemas||[]);}catch{}
    try{setDefs((await get("/issuer/credential-definitions")).credential_definition_ids||[]);}catch{}
  };
  useEffect(()=>{reload();},[]);
  useEffect(()=>gw.on("connection_event",()=>setTimeout(reload,2000)),[]);
  return (
    <>
      <div className="pt">Setup & Connect</div><div className="ps">Do these steps once before issuing credentials.</div>
      <div className="col2">
        <div>
          <div className="card">
            <div className="ch"><span className="ct">Step 1 — Create Invitation</span></div>
            <div className="cb">
              <div className="mut mb8">Generate an OOB invitation for the holder wallet.</div>
              <button className="btn btn-p" style={{width:"100%"}} onClick={async()=>{setBusy("inv");try{const d=await post("/issuer/create-invitation");setInv(d);toast.add("Invitation created");}catch(e){toast.add(e.message,"err");}setBusy("");}} disabled={busy==="inv"}>{busy==="inv"?<Sp/>:"Generate Invitation"}</button>
              {inv&&<><div className="inv-box">{JSON.stringify(inv.invitation)}</div><button className="btn btn-g btn-sm" style={{marginTop:6}} onClick={()=>{try{navigator.clipboard.writeText(JSON.stringify(inv.invitation));}catch{}toast.add("Copied");}}>Copy Invitation JSON</button></>}
              {conns.length>0&&<div style={{marginTop:10}}><div className="mut mb8">Connections:</div>{conns.slice(0,5).map(c=><div key={c.connection_id} className="flex ic gap8" style={{padding:"4px 0",fontSize:10}}><span className={`badge ${c.state==="active"||c.state==="completed"?"bg":"ba"}`}>{c.state}</span><span className="trunc" style={{flex:1}}>{c.their_label||c.connection_id.slice(0,20)}</span></div>)}</div>}
            </div>
          </div>
        </div>
        <div>
          <div className="card">
            <div className="ch"><span className="ct">Step 2 — Publish Schema</span></div>
            <div className="cb">
              <div className="f"><label className="lbl">Schema Name</label><input className="inp" value={sName} onChange={e=>setSName(e.target.value)}/></div>
              <div className="f"><label className="lbl">Version</label><input className="inp" value={sVer} onChange={e=>setSVer(e.target.value)} style={{width:80}}/></div>
              <div className="f"><label className="lbl">Attributes</label><input className="inp" value={sAttrs} onChange={e=>setSAttrs(e.target.value)}/></div>
              <button className="btn btn-p" style={{width:"100%"}} onClick={async()=>{const attrs=sAttrs.split(",").map(a=>a.trim()).filter(Boolean);setBusy("schema");try{const d=await post("/issuer/publish-schema",{schema_name:sName,schema_version:sVer,attributes:attrs});toast.add(`Schema: ${d.schema_id}`);setDefSchema(d.schema_id);await reload();}catch(e){toast.add(e.message,"err");}setBusy("");}} disabled={busy==="schema"}>{busy==="schema"?<Sp/>:"Publish to Ledger"}</button>
              {schemas.length>0&&<div style={{marginTop:8}}>{schemas.map(s=><div key={s.id} style={{fontSize:9,color:"var(--teal)",marginBottom:2}}>{s.id}</div>)}</div>}
            </div>
          </div>
          <div className="card">
            <div className="ch"><span className="ct">Step 3 — Publish Cred Def</span></div>
            <div className="cb">
              <div className="f"><label className="lbl">Schema</label><select className="sel" value={defSchema} onChange={e=>setDefSchema(e.target.value)}><option value="">— select —</option>{schemas.map(s=><option key={s.id} value={s.id}>{s.name||s.id}</option>)}</select></div>
              <div className="f"><label className="lbl">Tag</label><input className="inp" value={defTag} onChange={e=>setDefTag(e.target.value)} style={{width:120}}/></div>
              <button className="btn btn-p" style={{width:"100%"}} onClick={async()=>{const sid=defSchema||schemas[0]?.id;if(!sid){toast.add("Select schema","warn");return;}setBusy("def");try{const d=await post("/issuer/publish-cred-def",{schema_id:sid,tag:defTag});toast.add(`Cred def: ${d.credential_definition_id}`);await reload();}catch(e){toast.add(e.message,"err");}setBusy("");}} disabled={busy==="def"}>{busy==="def"?<Sp/>:"Publish Cred Def"}</button>
              {defs.length>0&&<div style={{marginTop:8}}>{defs.map(d=><div key={d} style={{fontSize:9,color:"var(--teal)",marginBottom:2}}>{d}</div>)}</div>}
            </div>
          </div>
        </div>
      </div>
      <button className="btn btn-g btn-sm" onClick={reload}>↻ Refresh all</button>
    </>
  );
}
function IssuerIssue({toast,gw}) {
  const [conns,setConns]=useState([]);const [defs,setDefs]=useState([]);const [connId,setConnId]=useState("");const [defId,setDefId]=useState("");const [attrFields,setAttrFields]=useState([{name:"",value:""}]);const [busy,setBusy]=useState(false);
  const reload=async()=>{
    try{setConns((await get("/issuer/connections")).results?.filter(c=>c.state==="active"||c.state==="completed")||[]);}catch{}
    try{const dl=(await get("/issuer/credential-definitions")).credential_definition_ids||[];setDefs(dl);if(dl.length===1&&!defId)setDefId(dl[0]);}catch{}
  };
  useEffect(()=>{reload();},[]);
  useEffect(()=>gw.on("cred_def_published",()=>setTimeout(reload,1500)),[]);
  useEffect(()=>gw.on("connection_event",()=>setTimeout(reload,1500)),[]);
  const issue=async()=>{
    if(!connId){toast.add("Select connection","warn");return;}if(!defId){toast.add("Select cred def","warn");return;}
    const attrs={};attrFields.forEach(f=>{if(f.name.trim())attrs[f.name.trim()]=f.value;});
    if(Object.keys(attrs).length===0){toast.add("Add attributes","warn");return;}
    setBusy(true);try{await post("/issuer/issue",{connection_id:connId,cred_def_id:defId,attributes:attrs});toast.add("Credential offer sent");}catch(e){toast.add(e.message,"err");}setBusy(false);
  };
  return (
    <>
      <div className="pt">Issue Credential</div><div className="ps">Send a credential offer to a connected holder.</div>
      <div className="col2">
        <div className="card"><div className="ch"><span className="ct">Recipient</span></div><div className="cb">
          <div className="f"><label className="lbl">Connection</label><select className="sel" value={connId} onChange={e=>setConnId(e.target.value)}><option value="">— select —</option>{conns.map(c=><option key={c.connection_id} value={c.connection_id}>{c.their_label||c.connection_id.slice(0,20)}</option>)}</select>{conns.length===0&&<div className="mut" style={{marginTop:5}}>No active connections. Do Setup first.</div>}</div>
          <div className="f"><label className="lbl">Credential Def</label><select className="sel" value={defId} onChange={e=>setDefId(e.target.value)}><option value="">— select —</option>{defs.map(d=><option key={d} value={d}>{d.split(":").slice(-2).join(":")}</option>)}</select>{defs.length===0&&<div className="mut" style={{marginTop:5}}>No cred defs. Do Setup first.</div>}</div>
          <button className="btn btn-g btn-sm" onClick={reload}>↻ Refresh</button>
        </div></div>
        <div>
          <div className="card"><div className="ch"><span className="ct">Attribute Values</span></div><div className="cb">
            {attrFields.map((f,i)=>(
              <div key={i} className="flex gap8 mb8 ic">
                <input className="inp" style={{flex:1}} placeholder="name" value={f.name} onChange={e=>setAttrFields(p=>p.map((x,j)=>j===i?{...x,name:e.target.value}:x))}/>
                <input className="inp" style={{flex:1}} placeholder="value" value={f.value} onChange={e=>setAttrFields(p=>p.map((x,j)=>j===i?{...x,value:e.target.value}:x))}/>
                {attrFields.length>1&&<button className="btn btn-d btn-sm" onClick={()=>setAttrFields(p=>p.filter((_,j)=>j!==i))} style={{padding:"5px 8px"}}>×</button>}
              </div>
            ))}
            <button className="btn btn-g btn-sm" onClick={()=>setAttrFields(p=>[...p,{name:"",value:""}])}>+ attr</button>
          </div></div>
          <button className="btn btn-p" style={{width:"100%",marginTop:4}} onClick={issue} disabled={busy}>{busy?<Sp/>:"Send Credential Offer"}</button>
          <div className="mut" style={{marginTop:8}}>Holder sees this in Wallet → Offers.</div>
        </div>
      </div>
    </>
  );
}
function IssuerRecords({toast,gw}) {
  const [issued,setIssued]=useState([]);const [busy,setBusy]=useState({});
  const reload=async()=>{try{setIssued((await get("/issuer/issued")).results||[]);}catch{}};
  useEffect(()=>{reload();},[]);
  useEffect(()=>gw.on("credential_issued",()=>setTimeout(reload,2000)),[]);
  return (
    <>
      <div className="pt">Issued Records</div><div className="ps">Revoke requires 3-of-5 governance votes.</div>
      <div className="card"><div className="cb" style={{padding:0}}>
        <table className="tbl"><thead><tr><th>ID</th><th>Connection</th><th>Cred Def</th><th>State</th><th></th></tr></thead>
        <tbody>
          {issued.length===0&&<tr><td colSpan={5} style={{textAlign:"center",color:"var(--t2)",padding:20}}>No records</td></tr>}
          {issued.map((row,i)=>{const r=row.cred_ex_record||row;const id=r.cred_ex_id||String(i);const cdId=(r.by_format?.cred_offer?.indy?.cred_def_id||r.cred_def_id||"—").split(":").slice(-2).join(":");
          return <tr key={id}><td className="mono trunc" style={{fontSize:9,maxWidth:130}}>{id.slice(0,18)}…</td><td style={{fontSize:9}}>{r.connection_id?.slice(0,14)||"—"}</td><td style={{fontSize:9}}>{cdId}</td><td><span className={`badge ${r.state==="credential_acked"||r.state==="done"?"bg":r.state==="abandoned"?"br":"ba"}`}>{r.state}</span></td>
          <td>{(r.state==="credential_acked"||r.state==="done")&&<button className="btn btn-d btn-sm" onClick={async()=>{setBusy(p=>({...p,[id]:true}));try{await post("/issuer/revoke",{cred_ex_id:id});toast.add("Revocation submitted","warn");setTimeout(reload,1500);}catch(e){toast.add(e.message,"err");}setBusy(p=>({...p,[id]:false}));}} disabled={busy[id]}>{busy[id]?<Sp/>:"Revoke"}</button>}</td></tr>;
          })}
        </tbody></table>
      </div></div>
      <button className="btn btn-g btn-sm" onClick={reload}>↻ Refresh</button>
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// RELYING PARTY — portal UI + QR + auto pipeline
// ════════════════════════════════════════════════════════════════════════════

const PIPELINE_STEPS = [
  { key:"challenge",  label:"Challenge Issued",        detail:"Cryptographic nonce generated" },
  { key:"sent",       label:"Proof Request Sent",       detail:"DIDComm → Holder wallet" },
  { key:"received",   label:"Holder Presenting",        detail:"Holder sending credentials…" },
  { key:"zkp",        label:"ZKP Revocation Check",     detail:"Accumulator non-membership proof" },
  { key:"verify",     label:"Signature Verification",   detail:"Issuer DID resolved on Indy ledger" },
  { key:"threshold",  label:"Threshold Token Issued",   detail:"k-of-n validator signatures" },
];

function RPTab({gw, toast}) {
  // Portal state: idle | qr | waiting | verifying | success | fail
  const [phase,     setPhase]    = useState("idle");
  const [challenge, setChallenge]= useState(null);
  const [conns,     setConns]    = useState([]);
  const [connId,    setConnId]   = useState("");
  const [reqAttrs,  setReqAttrs] = useState("degree,university");
  const [result,    setResult]   = useState(null);
  const [pipeState, setPipeState]= useState({});   // key → "wait"|"active"|"done"|"fail"
  const [busy,      setBusy]     = useState("");
  const pollRef = useRef(null);
  const timerRef= useRef(null);
  const [timer, setTimer]= useState(300);

  const loadConns = async () => {
    try {
      const all=(await get("/verifier/connections")).results||[];
      setConns(all.filter(c=>c.state==="active"||c.state==="completed"));
    } catch {}
  };
  useEffect(()=>{ loadConns(); },[]);
  useEffect(()=>gw.on("connection_event",()=>setTimeout(loadConns,2000)),[]);

  // Listen for proof events to advance pipeline
  useEffect(()=>gw.on("proof_event",async e=>{
    const st=e.payload?.state||e.payload?.topic;
    if (st==="presentation-received"||st==="presentation_received") {
      setPipeState(p=>({...p,received:"done",zkp:"active"}));
    }
    if (st==="verified") {
      setPipeState(p=>({...p,received:"done",zkp:"done",verify:"done",threshold:"active"}));
      if (challenge?.exchange_id) {
        setTimeout(()=>pollResult(challenge.exchange_id),1500);
      }
    }
  }),[challenge]);

  const pipeSet=(key,val)=>setPipeState(p=>({...p,[key]:val}));

  const startVerification = async () => {
    if (!connId) { toast.add("Select holder connection first","warn"); return; }
    setBusy("start");
    // Reset state
    setPhase("qr"); setResult(null);
    setPipeState({challenge:"active"});

    try {
      // Issue challenge
      const ch = await post("/verifier/challenge");
      setChallenge({...ch, exchange_id:null});
      pipeSet("challenge","done");
      setTimer(300);
      clearInterval(timerRef.current);
      timerRef.current=setInterval(()=>setTimer(t=>{if(t<=1){clearInterval(timerRef.current);return 0;}return t-1;}),1000);

      // Short pause for QR display, then auto-send
      setTimeout(async()=>{
        try {
          pipeSet("sent","active");
          const attrs={};
          reqAttrs.split(",").map(a=>a.trim()).filter(Boolean).forEach((a,i)=>{attrs[`attr_${i}`]={name:a};});
          const d=await post("/verifier/request-proof",{connection_id:connId,nonce:ch.nonce,requested_attributes:attrs,name:`SIDAK Verification — ${ch.code}`});
          setChallenge(prev=>({...prev,exchange_id:d.presentation_exchange_id}));
          pipeSet("sent","done"); pipeSet("received","active");
          setPhase("waiting");
          toast.add("Proof request sent — waiting for holder to approve");
          // Start polling
          clearInterval(pollRef.current);
          let n=0;
          pollRef.current=setInterval(async()=>{
            if(++n>60){clearInterval(pollRef.current);return;}
            if(d.presentation_exchange_id) await pollResult(d.presentation_exchange_id);
          },2000);
        } catch(e){ toast.add(e.message,"err"); setBusy(""); }
      }, 1500);
    } catch(e){ toast.add(e.message,"err"); setPhase("idle"); }
    setBusy("");
  };

  const pollResult = async (exchangeId) => {
    try {
      const d=await get(`/verifier/result/${exchangeId}`);
      if (d.state==="verified"||(d.verified!==undefined&&d.verified!==null)) {
        clearInterval(pollRef.current);
        const ok=d.verified==="true"||d.verified===true;
        setPipeState({challenge:"done",sent:"done",received:"done",zkp:"done",verify:"done",threshold:ok?"done":"fail"});
        if (ok) {
          // Fetch threshold token if not yet in result
          let tokenData=d.threshold_token;
          if (!tokenData) {
            try {
              const t=await get(`/verifier/result/${exchangeId}`);
              tokenData=t.threshold_token;
            } catch {}
          }
          setResult({...d,threshold_token:tokenData});
          setPhase("success");
          toast.add("✓ Identity verified — welcome!");
        } else {
          setResult(d); setPhase("fail");
          toast.add("Verification failed","err");
        }
      }
    } catch {}
  };

  const reset=()=>{
    setPhase("idle"); setChallenge(null); setResult(null); setPipeState({});
    clearInterval(pollRef.current); clearInterval(timerRef.current);
  };

  const qrData = challenge ? `sidak://verify?nonce=${challenge.nonce}&code=${challenge.code}&portal=SIDAK` : "sidak://pending";

  return (
    <div className="portal-wrap">
      {/* Portal top bar */}
      <div className="portal-bar">
        <div className="portal-brand">
          <div className="portal-brand-icon">🏛</div>
          <div>
            SIDAK
            <span className="portal-brand-sub">Sistem Identitas Digital — Akses Keamanan</span>
          </div>
        </div>
        <div className="portal-status">
          <span className={`${gw.live?"live-dot":"dead-dot"}`}/>
          {gw.live?"LIVE":"RECONNECTING"}
        </div>
      </div>

      {/* Setup bar (hidden in success state) */}
      {phase!=="success" && (
        <div style={{background:"rgba(11,16,23,.6)",borderBottom:"1px solid var(--line)",padding:"8px 24px",display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
          <select className="sel" style={{maxWidth:220}} value={connId} onChange={e=>setConnId(e.target.value)}>
            <option value="">— select holder connection —</option>
            {conns.map(c=><option key={c.connection_id} value={c.connection_id}>{c.their_label||c.connection_id.slice(0,20)}</option>)}
          </select>
          <input className="inp" style={{maxWidth:260,flex:1}} placeholder="Requested attrs: degree,university,name" value={reqAttrs} onChange={e=>setReqAttrs(e.target.value)}/>
          {phase!=="idle" && <button className="btn btn-d btn-sm" onClick={reset}>↺ Reset</button>}
          {conns.length===0 && <span className="mut">No connections — holder must connect via Issuer Setup first</span>}
          {/* Invite holder to verifier */}
          <button className="btn btn-g btn-sm" onClick={async()=>{
            try{
              const d=await post("/verifier/invitation");
              const inv=d.invitation_url||JSON.stringify(d.invitation);
              try{navigator.clipboard.writeText(inv);}catch{}
              toast.add("Verifier invitation copied! Paste in Holder → Connect section");
            }catch(e){toast.add(e.message,"err");}
          }}>+ Invite Wallet</button>
        </div>
      )}

      {/* Main portal body */}
      <div className="portal-body">

        {/* ── IDLE ── */}
        {phase==="idle" && (
          <div className="portal-card">
            <div style={{fontSize:40,marginBottom:16}}>🏛</div>
            <h1>Identity Verification Required</h1>
            <p>SIDAK uses Self-Sovereign Identity technology. Your credentials are verified directly from your digital wallet — no data is stored on this server.</p>
            <button className="btn btn-p btn-xl" onClick={startVerification} disabled={busy==="start"||!connId} style={{width:"100%",marginBottom:16}}>
              {busy==="start"?<><Sp/>Initiating…</>:"Verify My Identity →"}
            </button>
            {!connId && <div className="mut" style={{fontSize:10,textAlign:"center"}}>Select a holder connection in the setup bar above</div>}
            <div style={{marginTop:20,display:"flex",gap:16,justifyContent:"center",flexWrap:"wrap"}}>
              {["🔒 Zero-knowledge proof","⛓ Blockchain-anchored","👁 No data stored"].map(f=>(
                <div key={f} style={{fontSize:10,color:"var(--t2)",display:"flex",alignItems:"center",gap:4}}>{f}</div>
              ))}
            </div>
          </div>
        )}

        {/* ── QR + WAITING ── */}
        {(phase==="qr"||phase==="waiting") && challenge && (
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:24,maxWidth:820,width:"100%"}}>
            {/* Left: QR + code */}
            <div className="portal-card" style={{display:"flex",flexDirection:"column",alignItems:"center"}}>
              <div style={{fontSize:11,letterSpacing:".1em",textTransform:"uppercase",color:"var(--t2)",marginBottom:12}}>
                {phase==="qr"?"Scan with Wallet App":"Waiting for Wallet…"}
              </div>
              <div className="qr-wrap">
                <QRCode data={qrData} size={160}/>
              </div>
              <div style={{fontSize:12,color:"var(--t2)",marginBottom:6}}>or use browser wallet below</div>
              <div style={{fontSize:36,fontFamily:"var(--mono)",fontWeight:700,letterSpacing:".35em",color:"var(--teal)",textShadow:"0 0 20px rgba(10,240,192,.4)",margin:"8px 0"}}>
                {challenge.code}
              </div>
              {timer>0 && <div className="mut">Expires in {Math.floor(timer/60)}:{String(timer%60).padStart(2,"0")}</div>}
              {phase==="waiting" && (
                <div style={{marginTop:16,display:"flex",alignItems:"center",gap:8,fontSize:11,color:"var(--amber)"}}>
                  <span className="sp" style={{borderTopColor:"var(--amber)"}}/>Waiting for holder to approve…
                </div>
              )}
              <div style={{marginTop:16,fontSize:10,color:"var(--t2)",background:"var(--bg3)",border:"1px solid var(--line)",borderRadius:5,padding:"8px 10px",fontFamily:"var(--mono)",wordBreak:"break-all",maxWidth:"100%"}}>
                {challenge.nonce?.slice(0,32)}…
              </div>
              <button className="btn btn-g btn-sm" style={{marginTop:8}} onClick={()=>{try{navigator.clipboard.writeText(challenge.nonce);}catch{}toast.add("Nonce copied for Holder → ZKP field");}}>
                Copy Nonce (for manual ZKP)
              </button>
            </div>

            {/* Right: pipeline */}
            <div className="portal-card">
              <div style={{fontSize:11,letterSpacing:".1em",textTransform:"uppercase",color:"var(--t2)",marginBottom:16}}>Verification Pipeline</div>
              <div className="pipeline">
                {PIPELINE_STEPS.map(step=>{
                  const st=pipeState[step.key]||"wait";
                  return (
                    <div key={step.key} className="pipe-step">
                      <div className={`pipe-dot ${st}`}>
                        {st==="done"?"✓":st==="fail"?"✗":st==="active"?"●":"○"}
                      </div>
                      <div className="pipe-info">
                        <div className="pipe-label">{step.label}</div>
                        <div className={`pipe-detail ${st}`}>
                          {st==="active"?step.detail+" …":st==="done"?"Complete":st==="fail"?"Failed":step.detail}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{marginTop:12,fontSize:10,color:"var(--t2)",borderTop:"1px solid var(--line)",paddingTop:10}}>
                The holder needs to:<br/>
                1. Go to <strong style={{color:"var(--teal)"}}>Holder Wallet</strong> tab<br/>
                2. Click <strong style={{color:"var(--amber)"}}>Approve &amp; Present</strong> on the incoming request
              </div>
            </div>
          </div>
        )}

        {/* ── SUCCESS ── */}
        {phase==="success" && result && (
          <div className="portal-card portal-success" style={{maxWidth:500}}>
            <div className="success-icon">✓</div>
            <h1 style={{color:"var(--teal)"}}>Identity Verified</h1>
            <p>Welcome! Your credentials have been cryptographically verified.</p>

            {result.presentation?.requested_proof?.revealed_attrs && Object.keys(result.presentation.requested_proof.revealed_attrs).length>0 && (
              <div className="success-attrs">
                <div className="mut mb8">Verified attributes:</div>
                {Object.entries(result.presentation.requested_proof.revealed_attrs).map(([k,v])=>(
                  <div key={k} className="success-attr-row">
                    <span>{k}</span>
                    <span>{v.raw||JSON.stringify(v)}</span>
                  </div>
                ))}
              </div>
            )}

            {result.threshold_token && (
              <div className="token-pill">
                🔐 {result.threshold_token.claim?.signature_count||"k"}-of-n threshold token • verified
              </div>
            )}

            <div style={{marginTop:24,display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              <button className="btn btn-p" style={{width:"100%",padding:"12px"}} onClick={()=>toast.add("Redirecting to main portal… (demo)")}>
                Enter Portal →
              </button>
              <button className="btn btn-g btn-sm" style={{width:"100%",padding:"12px"}} onClick={reset}>
                New Verification
              </button>
            </div>

            {result.threshold_token && (
              <div style={{marginTop:16}}>
                <details>
                  <summary style={{fontSize:10,color:"var(--t2)",cursor:"pointer"}}>View threshold token</summary>
                  <div className="jbox" style={{marginTop:8,maxHeight:80,fontSize:8}}>{result.threshold_token.token}</div>
                </details>
              </div>
            )}
          </div>
        )}

        {/* ── FAIL ── */}
        {phase==="fail" && (
          <div className="portal-card" style={{maxWidth:400}}>
            <div style={{fontSize:40,marginBottom:16}}>✗</div>
            <h1 style={{color:"var(--red)"}}>Verification Failed</h1>
            <p>Your credentials could not be verified. This may be because the credential has been revoked or the proof is invalid.</p>
            <button className="btn btn-g" style={{width:"100%",marginTop:20}} onClick={reset}>Try Again</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// DB INSPECTOR
// ════════════════════════════════════════════════════════════════════════════
function DBTab({gw, toast, services, events}) {
  const [sec,setSec]=useState("acc");
  const [data,setData]=useState({});
  const [busy,setBusy]=useState(false);
  const SECS=[{id:"acc",l:"Accumulator"},{id:"audit",l:"Audit Log"},{id:"fraud",l:"Fraud Alerts"},{id:"rekor",l:"Transparency Log"},{id:"ledger",l:"VDR Ledger"},{id:"events",l:"Live Events"}];
  const loadSec=async s=>{
    setBusy(true);
    try {
      if(s==="acc"){const d=await fetch(`${GW}/accumulator/state`,{headers:{"x-api-key":"dev-key-1"}}).then(r=>r.json());setData(p=>({...p,acc:d}));}
      else if(s==="audit"){const d=await fetch(`${GW}/accumulator/log`,{headers:{"x-api-key":"dev-key-1"}}).then(r=>r.json());setData(p=>({...p,audit:(d.log||[]).slice().reverse().slice(0,60)}));}
      else if(s==="fraud"){const d=await fetch(`${GW}/accumulator/alerts`,{headers:{"x-api-key":"dev-key-1"}}).then(r=>r.json());setData(p=>({...p,fraud:d.alerts||[]}));}
      else if(s==="rekor"){const d=await fetch(`${GW}/transparency/log?limit=15`).then(r=>r.json());setData(p=>({...p,rekor:d}));}
      else if(s==="ledger"){const d=await fetch(`${GW}/ledger/transactions`).then(r=>r.json());setData(p=>({...p,ledger:d}));}
    }catch(e){toast.add(e.message,"err");}
    setBusy(false);
  };
  useEffect(()=>{loadSec(sec);},[sec]);
  useEffect(()=>gw.on("accumulator_update",e=>{if(sec==="acc")setData(p=>({...p,acc:e.payload}));}),[sec]);
  useEffect(()=>gw.on("snapshot_accumulator",e=>setData(p=>({...p,acc:e.payload}))),[]);
  const upCount=Object.values(services).filter(s=>s?.up).length;
  return (
    <div className="lay">
      <div className="sb">
        <div style={{padding:"14px 12px 10px",borderBottom:"1px solid var(--line)",marginBottom:8}}>
          <div className="pt" style={{fontSize:13}}>DB Inspector</div><div className="mut">{upCount}/{Object.keys(services).length} services live</div>
        </div>
        <div style={{padding:"0 8px 10px",borderBottom:"1px solid var(--line)",marginBottom:8}}>
          {SECS.map(s=><button key={s.id} onClick={()=>setSec(s.id)} style={{display:"block",width:"100%",textAlign:"left",padding:"9px 10px",fontSize:10,letterSpacing:".09em",textTransform:"uppercase",color:sec===s.id?"var(--teal)":"var(--t2)",background:sec===s.id?"rgba(10,240,192,.07)":"none",border:"none",cursor:"pointer",fontFamily:"var(--sans)",fontWeight:700,borderRadius:4}}>
            {s.l}{s.id==="fraud"&&(data.fraud?.length||0)>0&&<span className="badge br" style={{marginLeft:7,fontSize:8}}>{data.fraud.length}</span>}
          </button>)}
        </div>
        <Svcs services={services}/>
        <div style={{padding:"6px 12px"}}>
          <button className="btn btn-g btn-sm" style={{width:"100%"}} onClick={()=>loadSec(sec)} disabled={busy}>{busy?<Sp/>:"↻ Refresh"}</button>
        </div>
      </div>
      <div className="main">
        {sec==="acc"&&data.acc&&<>
          <div className="pt">Accumulator State</div><div className="ps">A = g^(p₁·p₂·…·pₖ) mod n</div>
          <div className="col3 mb16">
            {[["Epoch",data.acc.epoch],["Members",data.acc.member_count],["Status","ACTIVE"]].map(([l,v])=>(
              <div key={l} className="card" style={{textAlign:"center",padding:16}}><div style={{fontSize:28,fontWeight:700,color:"var(--teal)"}}>{v}</div><div className="mut">{l}</div></div>
            ))}
          </div>
          <div className="card"><div className="ch"><span className="ct">Root A</span></div><div className="cb"><div className="jbox" style={{maxHeight:70}}>{data.acc.accumulator}</div></div></div>
          {data.acc.log_tail?.length>0&&<div className="card"><div className="ch"><span className="ct">Recent Ops</span></div><div className="cb" style={{padding:0}}><table className="tbl"><thead><tr><th>Epoch</th><th>Op</th><th>Time</th></tr></thead><tbody>{data.acc.log_tail.map((e,i)=><tr key={i}><td className="mono">{e.epoch}</td><td style={{color:e.operation==="ADD"?"var(--teal)":"var(--red)"}}>{e.operation}</td><td style={{color:"var(--t2)"}}>{ts(e.timestamp)}</td></tr>)}</tbody></table></div></div>}
        </>}
        {sec==="audit"&&<>
          <div className="pt">Audit Log</div><div className="ps">Append-only — every ADD and REVOKE recorded</div>
          <div className="card"><div className="ch"><span className="ct">Operations ({(data.audit||[]).length})</span><span className="badge bg">APPEND-ONLY</span></div><div className="cb" style={{padding:0}}>
            <table className="tbl"><thead><tr><th>Epoch</th><th>Op</th><th>Element</th><th>Time</th></tr></thead><tbody>
              {(data.audit||[]).length===0&&<tr><td colSpan={4} style={{textAlign:"center",color:"var(--t2)",padding:16}}>No entries</td></tr>}
              {(data.audit||[]).map((e,i)=><tr key={i}><td className="mono">{e.epoch}</td><td style={{color:e.operation==="ADD"?"var(--teal)":"var(--red)"}}>{e.operation}</td><td className="mono" style={{fontSize:9}}>{e.element_prefix}</td><td style={{fontSize:9,color:"var(--t2)"}}>{ts(e.timestamp)}</td></tr>)}
            </tbody></table>
          </div></div>
        </>}
        {sec==="fraud"&&<>
          <div className="pt">Fraud Alerts</div><div className="ps">Rapid revocation · replay · double presentation</div>
          {(data.fraud||[]).length===0?<div style={{textAlign:"center",padding:60,opacity:.4}}><div style={{fontSize:40}}>✓</div><div style={{marginTop:8}}>No alerts</div></div>:
          (data.fraud||[]).map((a,i)=><div key={i} className="card mb8" style={{borderColor:a.severity==="HIGH"||a.severity==="CRITICAL"?"rgba(255,69,96,.3)":"rgba(255,184,48,.3)"}}><div className="cb"><div className="flex ic gap8 mb8"><span className={`badge ${a.severity==="HIGH"||a.severity==="CRITICAL"?"br":"ba"}`}>{a.severity}</span><span style={{fontWeight:700}}>{a.event_type}</span><span className="mut">{ts(a.timestamp)}</span></div><div style={{fontSize:11,color:"var(--t1)"}}>{a.description}</div></div></div>)}
        </>}
        {sec==="rekor"&&<>
          <div className="pt">Transparency Log</div><div className="ps">Merkle-tree — every verification hashed</div>
          {data.rekor?<>
            <div className="col2 mb16">
              {[["Tree Size",data.rekor.tree_size||0],["Status","ACTIVE"]].map(([l,v])=><div key={l} className="card" style={{textAlign:"center",padding:16}}><div style={{fontSize:28,fontWeight:700,color:"var(--blue)"}}>{v}</div><div className="mut">{l}</div></div>)}
            </div>
            <div className="card"><div className="ch"><span className="ct">Entries</span></div><div className="cb" style={{padding:0}}><table className="tbl"><thead><tr><th>Index</th><th>Data</th></tr></thead><tbody>
              {(data.rekor.entries||[]).length===0&&<tr><td colSpan={2} style={{textAlign:"center",color:"var(--t2)",padding:16}}>No entries yet</td></tr>}
              {(data.rekor.entries||[]).map((e,i)=><tr key={i}><td className="mono">{e.index}</td><td style={{fontSize:9}} className="trunc">{JSON.stringify(e.data).slice(0,100)}</td></tr>)}
            </tbody></table></div></div>
          </>:<div className="mut">Loading…</div>}
        </>}
        {sec==="ledger"&&<>
          <div className="pt">VDR Ledger (Hyperledger Indy)</div><div className="ps">4-node RBFT — DIDs, schemas, cred defs</div>
          <div className="card"><div className="cb" style={{padding:0}}><table className="tbl"><thead><tr><th>Seq#</th><th>Type</th><th>From DID</th><th>Time</th></tr></thead><tbody>
            {!(data.ledger?.data?.length)&&<tr><td colSpan={4} style={{textAlign:"center",color:"var(--t2)",padding:16}}>No transactions or ledger unreachable</td></tr>}
            {(data.ledger?.data||[]).map((tx,i)=><tr key={i}><td className="mono">{tx.seqNo||i}</td><td>{tx.txn?.type||tx.type||"—"}</td><td className="mono trunc" style={{fontSize:9,maxWidth:140}}>{tx.txn?.metadata?.from||"—"}</td><td style={{fontSize:9,color:"var(--t2)"}}>{tx.txnMetadata?.txnTime?new Date(tx.txnMetadata.txnTime*1000).toLocaleString():"—"}</td></tr>)}
          </tbody></table></div></div>
        </>}
        {sec==="events"&&<>
          <div className="pt">Live Event Stream</div><div className="ps">Real-time WebSocket — nothing simulated</div>
          <div className="card"><div className="ch"><span className="ct">Events ({events.length})</span><span className="badge bg" style={{animation:"pulse 2s infinite"}}>LIVE</span></div><div className="cb">
            <div className="evlist">
              {events.length===0&&<div className="mut" style={{padding:"10px 0"}}>Waiting…</div>}
              {events.map((e,i)=><div key={i} className={`ev ${evClass(e.type)}`}><span className="ev-t">{ts(e.timestamp)}</span><span className="ev-n">{e.type}</span><span className="ev-p">{JSON.stringify(e.payload).slice(0,90)}</span></div>)}
            </div>
          </div></div>
        </>}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// ROOT
// ════════════════════════════════════════════════════════════════════════════
export default function App() {
  const [tab, setTab] = useState("rp");   // start on RP to demo the portal first
  const toast = useToast();
  const gw    = useGateway();
  const TABS  = [{id:"holder",l:"Holder Wallet"},{id:"issuer",l:"Issuer"},{id:"rp",l:"SIDAK Portal"},{id:"db",l:"DB Inspector"}];
  return (
    <>
      <style>{S}</style>
      <nav className="nav">
        <div className="nav-logo"><span>SSI</span><span>/DID</span></div>
        {TABS.map(t=><button key={t.id} className={`tab ${tab===t.id?"on":""}`} onClick={()=>setTab(t.id)}>{t.l}</button>)}
        <div className="ws-pill">
          {gw.live?<span className="live-dot"/>:<span className="dead-dot"/>}
          <span style={{fontSize:10,color:gw.live?"var(--teal)":"var(--t2)"}}>{gw.live?"LIVE":"RECONNECTING"}</span>
          <span style={{color:"var(--t2)",fontSize:10,marginLeft:12}}>ITS 2026</span>
        </div>
      </nav>
      {tab==="holder"&&<Holder gw={gw} toast={toast}/>}
      {tab==="issuer"&&<IssuerTab gw={gw} toast={toast}/>}
      {tab==="rp"    &&<RPTab gw={gw} toast={toast}/>}
      {tab==="db"    &&<DBTab gw={gw} toast={toast} services={gw.services} events={gw.events}/>}
      <div className="toasts">
        {toast.toasts.map(t=><div key={t.id} className={`toast ${t.type}`}>{t.msg}</div>)}
      </div>
    </>
  );
}