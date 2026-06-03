import { useState, useEffect, useMemo, useCallback } from "react";

/* ─── Persistence ─── */
const SK = "apexj-v2";
const load = (key, def) => { try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : def; } catch { return def; } };
const save = (key, val) => { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} };

/* ─── Constants ─── */
const SETUPS = ["ORB","VWAP Pullback","Breakout","Reversal","Momentum","Earnings","Gap & Go","Swing","Scalp","Other"];
const ASSET_TYPES = ["stock","option","crypto","futures","forex"];
const SIDES = ["long","short"];
const OPTION_TYPES = ["call","put"];
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const TODAY = new Date().toISOString().split("T")[0];

/* ─── Helpers ─── */
const uid = () => Math.random().toString(36).slice(2,10);
const clamp = (v,mn,mx) => Math.min(mx,Math.max(mn,v));

function calcPnL(t) {
  if (!t) return null;
  const fees = parseFloat(t.fees)||0;
  if (t.assetType === "option") {
    const p = parseFloat(t.premium), ep = parseFloat(t.exitPremium), c = parseFloat(t.contracts);
    if (!p||!ep||!c) return null;
    return (t.side==="long"?(ep-p):(p-ep))*c*100 - fees;
  }
  const entry = parseFloat(t.entryPrice), exit = parseFloat(t.exitPrice), qty = parseFloat(t.qty);
  if (!entry||!exit||!qty) return null;
  const mult = t.assetType==="futures"?(parseFloat(t.tickMult)||1):1;
  return (t.side==="long"?(exit-entry):(entry-exit))*qty*mult - fees;
}
function calcCost(t) {
  if (t.assetType==="option") return (parseFloat(t.premium)||0)*(parseFloat(t.contracts)||0)*100;
  return (parseFloat(t.entryPrice)||0)*(parseFloat(t.qty)||0);
}
function calcPct(t) { const p=calcPnL(t), c=calcCost(t); return (!p||!c)?null:(p/c)*100; }
function calcRR(t) {
  const e=parseFloat(t.entryPrice),sl=parseFloat(t.stopLoss),tp=parseFloat(t.takeProfit);
  if(!e||!sl||!tp) return null;
  const r=Math.abs(e-sl), rw=Math.abs(tp-e);
  return r?rw/r:null;
}
function holdTime(t) {
  if(!t.entryTime||!t.exitTime) return null;
  const [eh,em]=t.entryTime.split(":").map(Number);
  const [xh,xm]=t.exitTime.split(":").map(Number);
  const mins=(xh*60+xm)-(eh*60+em);
  if(mins<0) return null;
  if(mins<60) return `${mins}m`;
  return `${Math.floor(mins/60)}h ${mins%60}m`;
}
const $f = (v,d=2) => v===null||v===undefined||isNaN(v)?"—":`$${Math.abs(v).toFixed(d)}`;
const pf = v => v===null||v===undefined||isNaN(v)?"—":`${v>=0?"+":""}${v.toFixed(2)}%`;
const cl = v => !v||isNaN(v)?"":v>=0?"pos":"neg";

/* ─── Defaults ─── */
const BLANK = {
  id:null, date:TODAY, assetType:"stock", symbol:"", side:"long",
  qty:"", entryPrice:"", exitPrice:"",
  optionType:"call", strike:"", expiry:"", contracts:"", premium:"", exitPremium:"",
  tickMult:"",
  entryTime:"", exitTime:"",
  status:"closed",
  stopLoss:"", takeProfit:"",
  fees:"",
  setup:"", confidence:3, tags:"",
  notes:"",
  accountId:"default",
};

/* ════════════════════════════════════════════ */
export default function App() {
  const [trades, setTrades]     = useState(() => load(SK+"-trades",[]));
  const [accounts, setAccounts] = useState(() => load(SK+"-accounts",[{id:"default",name:"Main Account",balance:""}]));
  const [dayNotes, setDayNotes] = useState(() => load(SK+"-daynotes",{}));
  const [prefs, setPrefs]       = useState(() => load(SK+"-prefs",{defaultSetup:"",defaultAccount:"default",defaultAsset:"stock"}));

  const [page, setPage]         = useState("dashboard"); // dashboard | log | calendar | stats | add | detail | accounts | settings
  const [form, setForm]         = useState({...BLANK});
  const [editId, setEditId]     = useState(null);
  const [detailId, setDetailId] = useState(null);
  const [filter, setFilter]     = useState({type:"all",status:"all",symbol:"",setup:"",account:"all",dateFrom:"",dateTo:""});
  const [sortCol, setSortCol]   = useState("date");
  const [sortDir, setSortDir]   = useState("desc");
  const [calMonth, setCalMonth] = useState(new Date());
  const [dayNote, setDayNote]   = useState("");
  const [editDayNote, setEditDayNote] = useState(null); // date string
  const [acctForm, setAcctForm] = useState({name:"",balance:""});
  const [toast, setToast]       = useState(null);

  useEffect(() => { save(SK+"-trades", trades); }, [trades]);
  useEffect(() => { save(SK+"-accounts", accounts); }, [accounts]);
  useEffect(() => { save(SK+"-daynotes", dayNotes); }, [dayNotes]);
  useEffect(() => { save(SK+"-prefs", prefs); }, [prefs]);

  const showToast = msg => { setToast(msg); setTimeout(()=>setToast(null),2200); };

  /* remembered defaults */
  const openAdd = (prefill={}) => {
    const last = trades[trades.length-1];
    setForm({
      ...BLANK,
      setup: prefs.defaultSetup||"",
      accountId: prefs.defaultAccount||"default",
      assetType: prefs.defaultAsset||"stock",
      symbol: last?.symbol||"",
      ...prefill,
    });
    setEditId(null);
    setPage("add");
  };

  const saveTrade = () => {
    if (!form.symbol.trim()) { showToast("Symbol is required"); return; }
    const t = { ...form, id: editId||uid(), symbol: form.symbol.toUpperCase() };
    if (editId) setTrades(ts => ts.map(x => x.id===editId?t:x));
    else setTrades(ts => [...ts, t]);
    showToast(editId?"Trade updated ✓":"Trade logged ✓");
    setEditId(null);
    setPage("log");
  };

  const deleteTrade = id => { setTrades(ts => ts.filter(t => t.id!==id)); setPage("log"); showToast("Trade deleted"); };

  const setSort = col => {
    if(sortCol===col) setSortDir(d=>d==="asc"?"desc":"asc");
    else { setSortCol(col); setSortDir("desc"); }
  };

  /* filtered + sorted trades */
  const filtered = useMemo(() => {
    return trades.filter(t => {
      if(filter.type!=="all"&&t.assetType!==filter.type) return false;
      if(filter.status!=="all"&&t.status!==filter.status) return false;
      if(filter.account!=="all"&&t.accountId!==filter.account) return false;
      if(filter.symbol&&!t.symbol.toUpperCase().includes(filter.symbol.toUpperCase())) return false;
      if(filter.setup&&t.setup!==filter.setup) return false;
      if(filter.dateFrom&&t.date<filter.dateFrom) return false;
      if(filter.dateTo&&t.date>filter.dateTo) return false;
      return true;
    }).sort((a,b)=>{
      let av=a[sortCol],bv=b[sortCol];
      if(sortCol==="pnl"){av=calcPnL(a)??-Infinity;bv=calcPnL(b)??-Infinity;}
      if(sortCol==="rr"){av=calcRR(a)??-Infinity;bv=calcRR(b)??-Infinity;}
      if(av<bv) return sortDir==="asc"?-1:1;
      if(av>bv) return sortDir==="asc"?1:-1;
      return 0;
    });
  }, [trades, filter, sortCol, sortDir]);

  /* stats */
  const stats = useMemo(() => {
    const closed = filtered.filter(t=>t.status==="closed");
    const pnls = closed.map(t=>calcPnL(t)).filter(v=>v!==null);
    const wins = pnls.filter(v=>v>0), losses = pnls.filter(v=>v<0);
    const totalPnL = pnls.reduce((a,b)=>a+b,0);
    const winRate = pnls.length?(wins.length/pnls.length)*100:0;
    const avgWin = wins.length?wins.reduce((a,b)=>a+b,0)/wins.length:0;
    const avgLoss = losses.length?losses.reduce((a,b)=>a+b,0)/losses.length:0;
    const pf = losses.length?Math.abs(wins.reduce((a,b)=>a+b,0)/losses.reduce((a,b)=>a+b,0)):null;
    const maxWin = wins.length?Math.max(...wins):0;
    const maxLoss = losses.length?Math.min(...losses):0;
    const bySetup = {};
    closed.forEach(t=>{ const s=t.setup||"Unknown"; const p=calcPnL(t); if(p===null)return; if(!bySetup[s])bySetup[s]={total:0,wins:0,count:0}; bySetup[s].total+=p; bySetup[s].count++; if(p>0)bySetup[s].wins++; });
    const avgConf = closed.length?(closed.reduce((a,t)=>a+(t.confidence||3),0)/closed.length).toFixed(1):null;
    return { totalPnL, winRate, avgWin, avgLoss, pf, maxWin, maxLoss, total:closed.length, open:trades.filter(t=>t.status==="open").length, bySetup, avgConf };
  }, [filtered, trades]);

  /* equity curve */
  const equity = useMemo(() => {
    const map={};
    trades.filter(t=>t.status==="closed").forEach(t=>{ const p=calcPnL(t); if(p!==null&&t.date) map[t.date]=(map[t.date]||0)+p; });
    let cum=0;
    return Object.entries(map).sort((a,b)=>a[0].localeCompare(b[0])).map(([date,pnl])=>({date,pnl,cum:cum+=pnl}));
  }, [trades]);

  /* calendar data */
  const calData = useMemo(() => {
    const map={};
    trades.filter(t=>t.status==="closed").forEach(t=>{ const p=calcPnL(t); if(p!==null&&t.date) map[t.date]=(map[t.date]||0)+p; });
    return map;
  }, [trades]);

  const detail = detailId ? trades.find(t=>t.id===detailId) : null;
  const acctName = id => accounts.find(a=>a.id===id)?.name||"—";

  /* ─── Field helpers ─── */
  const upd = k => e => setForm(f=>({...f,[k]:e.target.value}));
  const inp = (k,extra={}) => <input value={form[k]} onChange={upd(k)} {...extra}/>;
  const sel = (k,opts,extra={}) => (
    <select value={form[k]} onChange={upd(k)} {...extra}>
      {opts.map(o=><option key={Array.isArray(o)?o[0]:o} value={Array.isArray(o)?o[0]:o}>{Array.isArray(o)?o[1]:o}</option>)}
    </select>
  );

  /* ─── Mini equity SVG ─── */
  const EquityCurve = ({data, h=80}) => {
    if(data.length<2) return <div className="chart-empty">Log closed trades to see your equity curve</div>;
    const vals=data.map(d=>d.cum), W=500;
    const mn=Math.min(...vals,0), mx=Math.max(...vals,0), rng=mx-mn||1;
    const pts=data.map((d,i)=>`${(i/(data.length-1))*W},${h-((d.cum-mn)/rng)*h}`);
    const z=h-((0-mn)/rng)*h, pos=vals[vals.length-1]>=0;
    const col=pos?"#10b981":"#f43f5e";
    return (
      <svg viewBox={`0 0 ${W} ${h}`} style={{width:"100%",height:h,display:"block"}} preserveAspectRatio="none">
        <defs><linearGradient id="eg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={col} stopOpacity=".25"/><stop offset="100%" stopColor={col} stopOpacity="0"/></linearGradient></defs>
        <line x1="0" y1={z} x2={W} y2={z} stroke="#1e293b" strokeWidth="1" strokeDasharray="4,3"/>
        <polygon fill="url(#eg)" points={`0,${h} ${pts.join(" ")} ${W},${h}`}/>
        <polyline fill="none" stroke={col} strokeWidth="2" strokeLinejoin="round" points={pts.join(" ")}/>
        {data.length>0&&<circle cx={(data.length-1)/(data.length-1)*W} cy={h-((vals[vals.length-1]-mn)/rng)*h} r="3" fill={col}/>}
      </svg>
    );
  };

  /* ─── PnL Calendar ─── */
  const PnLCalendar = () => {
    const y=calMonth.getFullYear(), m=calMonth.getMonth();
    const first=new Date(y,m,1).getDay();
    const days=new Date(y,m+1,0).getDate();
    const cells=[];
    for(let i=0;i<first;i++) cells.push(null);
    for(let d=1;d<=days;d++) cells.push(d);
    const dateStr = d => `${y}-${String(m+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    const pnlVals = cells.filter(Boolean).map(d=>calData[dateStr(d)]||0);
    const maxAbs = Math.max(...pnlVals.map(Math.abs),1);
    return (
      <div className="cal-wrap">
        <div className="cal-nav">
          <button className="cal-arrow" onClick={()=>setCalMonth(new Date(y,m-1,1))}>‹</button>
          <span className="cal-month">{MONTHS[m]} {y}</span>
          <button className="cal-arrow" onClick={()=>setCalMonth(new Date(y,m+1,1))}>›</button>
        </div>
        <div className="cal-grid">
          {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(d=><div key={d} className="cal-dow">{d}</div>)}
          {cells.map((d,i)=>{
            if(!d) return <div key={`e${i}`} className="cal-cell empty"/>;
            const ds=dateStr(d), pnl=calData[ds], note=dayNotes[ds];
            const alpha=pnl?clamp(Math.abs(pnl)/maxAbs*0.8,0.1,0.8):0;
            const bg=pnl?(pnl>0?`rgba(16,185,129,${alpha})`:`rgba(244,63,94,${alpha})`):"transparent";
            const isToday=ds===TODAY;
            return (
              <div key={d} className={`cal-cell ${isToday?"today":""}`} style={{background:bg}}
                onClick={()=>{setEditDayNote(ds);setDayNote(dayNotes[ds]||"");}}>
                <span className="cal-day">{d}</span>
                {pnl!==undefined&&<span className={`cal-pnl ${pnl>=0?"pos":"neg"}`}>{pnl>=0?"+":""}{pnl>=1000?`$${(pnl/1000).toFixed(1)}k`:pnl!==0?`$${Math.round(pnl)}`:""}</span>}
                {note&&<span className="cal-note-dot" title={note}>●</span>}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  /* ─── Confidence stars ─── */
  const Stars = ({val, onChange}) => (
    <div className="stars">
      {[1,2,3,4,5].map(i=>(
        <span key={i} className={`star ${i<=val?"on":""}`} onClick={()=>onChange&&onChange(i)}>★</span>
      ))}
    </div>
  );

  /* ─── Styles ─── */
  const css = `
    @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=JetBrains+Mono:ital,wght@0,300;0,400;0,500;1,400&display=swap');
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    :root{
      --bg:#050d14;--surf:#0a1628;--surf2:#0f1f35;--surf3:#162540;
      --bdr:#1a2e48;--bdr2:#1f3655;
      --text:#e2eaf4;--muted:#4a6080;--muted2:#6b82a0;
      --acc:#0ea5e9;--acc2:#38bdf8;--acc-dim:#0ea5e920;
      --green:#10b981;--red:#f43f5e;--yellow:#f59e0b;--purple:#8b5cf6;--orange:#f97316;
      --font:'Outfit',sans-serif;--mono:'JetBrains Mono',monospace;
      --r:10px;--r2:7px;
    }
    html,body,#root{height:100%;background:var(--bg);color:var(--text);font-family:var(--font);}
    .app{min-height:100vh;display:flex;flex-direction:column;}

    /* scrollbar */
    ::-webkit-scrollbar{width:4px;height:4px}
    ::-webkit-scrollbar-track{background:var(--surf)}
    ::-webkit-scrollbar-thumb{background:var(--bdr2);border-radius:4px}

    /* ── NAV ── */
    .nav{display:flex;align-items:stretch;background:var(--surf);border-bottom:1px solid var(--bdr);position:sticky;top:0;z-index:200;padding:0 20px;}
    .nav-logo{font-size:16px;font-weight:800;color:var(--acc);letter-spacing:-0.5px;display:flex;align-items:center;gap:8px;padding:0 20px 0 0;border-right:1px solid var(--bdr);margin-right:12px;}
    .nav-logo span{color:var(--text);font-weight:400;}
    .nav-logo em{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--green);margin-right:4px;animation:blink 2s infinite;}
    @keyframes blink{0%,100%{opacity:1}50%{opacity:.3}}
    .nav-link{background:none;border:none;color:var(--muted2);font-family:var(--font);font-size:13px;font-weight:500;padding:0 14px;cursor:pointer;border-bottom:2px solid transparent;transition:all .15s;white-space:nowrap;}
    .nav-link:hover{color:var(--text)}
    .nav-link.active{color:var(--acc);border-bottom-color:var(--acc);}
    .nav-right{margin-left:auto;display:flex;align-items:center;gap:10px;}
    .btn-primary{background:var(--acc);color:#fff;border:none;border-radius:var(--r2);font-family:var(--font);font-weight:600;font-size:13px;padding:7px 18px;cursor:pointer;transition:all .15s;white-space:nowrap;}
    .btn-primary:hover{background:var(--acc2);transform:translateY(-1px);}

    /* ── MAIN ── */
    .main{flex:1;padding:24px;max-width:1440px;width:100%;margin:0 auto;}

    /* ── CARDS ── */
    .card{background:var(--surf);border:1px solid var(--bdr);border-radius:var(--r);padding:20px 22px;}
    .card-sm{padding:14px 18px;}
    .card-title{font-size:11px;text-transform:uppercase;letter-spacing:.12em;color:var(--muted2);margin-bottom:14px;font-weight:500;}

    /* ── STATS GRID ── */
    .stats-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:18px;}
    .stat-val{font-family:var(--font);font-size:28px;font-weight:800;line-height:1;letter-spacing:-1px;}
    .stat-sub{font-size:11px;color:var(--muted2);margin-top:5px;}
    .pos{color:var(--green)}.neg{color:var(--red)}.neu{color:var(--text)}

    /* ── EQUITY ── */
    .eq-card{margin-bottom:18px;}
    .eq-header{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:12px;}
    .eq-total{font-size:22px;font-weight:800;letter-spacing:-0.5px;}
    .chart-empty{color:var(--muted);font-size:12px;text-align:center;padding:28px 0;}

    /* ── DASH ROW ── */
    .dash-row{display:grid;grid-template-columns:1fr 1fr;gap:14px;}

    /* ── RECENT ── */
    .recent-item{display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--bdr);cursor:pointer;transition:.1s;}
    .recent-item:last-child{border-bottom:none}
    .recent-item:hover{opacity:.75}
    .ri-sym{font-weight:700;font-size:14px;min-width:60px;}
    .ri-pnl{margin-left:auto;font-weight:700;font-size:14px;font-family:var(--mono);}
    .ri-date{font-size:11px;color:var(--muted2);}

    /* ── SETUP STATS ── */
    .setup-row{display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--bdr);font-size:13px;}
    .setup-row:last-child{border-bottom:none}
    .setup-name{min-width:120px;font-weight:500;}
    .setup-bar-wrap{flex:1;background:var(--surf3);border-radius:3px;height:5px;overflow:hidden;}
    .setup-bar{height:100%;border-radius:3px;}
    .setup-meta{font-size:11px;color:var(--muted2);min-width:80px;text-align:right;font-family:var(--mono);}

    /* ── TABLE ── */
    .filters{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;align-items:center;}
    .filters input,.filters select{background:var(--surf);border:1px solid var(--bdr);color:var(--text);border-radius:var(--r2);padding:6px 11px;font-family:var(--mono);font-size:12px;}
    .filters input:focus,.filters select:focus{outline:none;border-color:var(--acc);}
    .filter-chip{background:var(--acc-dim);border:1px solid var(--acc);color:var(--acc);border-radius:20px;padding:3px 10px;font-size:11px;cursor:pointer;font-weight:500;}
    .count-badge{margin-left:auto;font-size:11px;color:var(--muted2);font-family:var(--mono);}

    .tbl-wrap{border:1px solid var(--bdr);border-radius:var(--r);overflow:auto;}
    table{width:100%;border-collapse:collapse;font-size:13px;}
    thead th{background:var(--surf2);padding:9px 13px;text-align:left;color:var(--muted2);font-size:10px;text-transform:uppercase;letter-spacing:.1em;border-bottom:1px solid var(--bdr);cursor:pointer;white-space:nowrap;user-select:none;font-weight:500;}
    thead th:hover{color:var(--text)}
    tbody tr{border-bottom:1px solid var(--bdr);cursor:pointer;transition:background .1s;}
    tbody tr:last-child{border-bottom:none}
    tbody tr:hover{background:var(--surf2)}
    td{padding:9px 13px;white-space:nowrap;}
    .td-sym{font-weight:700;font-size:14px;}
    .td-mono{font-family:var(--mono);}
    .empty-state{text-align:center;padding:60px 0;color:var(--muted2);}
    .empty-state h3{font-size:17px;color:var(--text);margin-bottom:6px;}

    /* ── BADGE ── */
    .badge{display:inline-block;padding:2px 7px;border-radius:4px;font-size:10px;text-transform:uppercase;letter-spacing:.05em;font-weight:600;}
    .b-stock{background:#0c2a4a;color:#38bdf8}
    .b-option{background:#27114a;color:#c084fc}
    .b-crypto{background:#1a2d0c;color:#86efac}
    .b-futures{background:#2d1a0c;color:#fb923c}
    .b-forex{background:#2d2a0c;color:#fcd34d}
    .b-long{background:#0b2a1a;color:#4ade80}
    .b-short{background:#2a0b0b;color:#f87171}
    .b-open{background:#0c1f2d;color:#7dd3fc;display:inline-flex;align-items:center;gap:4px;}
    .b-open::before{content:"";display:inline-block;width:5px;height:5px;border-radius:50%;background:#38bdf8;animation:blink 1.5s infinite;}
    .b-closed{background:#0c2a1a;color:#6ee7b7}
    .b-call{background:#0b2a1a;color:#4ade80}
    .b-put{background:#2a0b0b;color:#f87171}

    /* ── FORM ── */
    .form-wrap{max-width:700px;margin:0 auto;}
    .form-card{background:var(--surf);border:1px solid var(--bdr);border-radius:var(--r);padding:28px 32px;}
    .form-h{font-size:20px;font-weight:800;margin-bottom:22px;letter-spacing:-0.5px;}
    .fsec{margin-bottom:20px;}
    .fsec-title{font-size:10px;text-transform:uppercase;letter-spacing:.12em;color:var(--muted2);margin-bottom:12px;padding-bottom:7px;border-bottom:1px solid var(--bdr);font-weight:500;}
    .fgrid{display:grid;gap:12px;}
    .fgrid.g2{grid-template-columns:1fr 1fr;}
    .fgrid.g3{grid-template-columns:1fr 1fr 1fr;}
    .fgrid.g4{grid-template-columns:1fr 1fr 1fr 1fr;}
    .frow{display:flex;flex-direction:column;gap:5px;}
    .frow label{font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted2);font-weight:500;}
    .frow input,.frow select,.frow textarea{background:var(--surf2);border:1px solid var(--bdr2);color:var(--text);border-radius:var(--r2);padding:9px 11px;font-family:var(--mono);font-size:13px;transition:.15s;}
    .frow input:focus,.frow select:focus,.frow textarea:focus{outline:none;border-color:var(--acc);}
    .frow textarea{resize:vertical;min-height:80px;font-family:var(--font);font-size:13px;line-height:1.5;}
    .toggle-row{display:flex;gap:8px;}
    .toggle-btn{flex:1;padding:8px;border-radius:var(--r2);border:1px solid var(--bdr2);background:var(--surf2);color:var(--muted2);font-family:var(--font);font-size:12px;font-weight:600;cursor:pointer;transition:all .15s;text-transform:uppercase;letter-spacing:.06em;}
    .toggle-btn.on{background:var(--acc);border-color:var(--acc);color:#fff;}
    .form-actions{display:flex;gap:10px;margin-top:24px;}
    .btn-save{flex:1;background:var(--acc);color:#fff;border:none;border-radius:var(--r2);font-family:var(--font);font-weight:700;font-size:14px;padding:11px;cursor:pointer;transition:.15s;}
    .btn-save:hover{background:var(--acc2);}
    .btn-cancel{background:var(--surf2);color:var(--muted2);border:1px solid var(--bdr2);border-radius:var(--r2);font-family:var(--font);font-size:13px;padding:11px 20px;cursor:pointer;transition:.15s;}
    .btn-cancel:hover{color:var(--text);}

    /* rr meter */
    .rr-display{display:flex;align-items:center;gap:8px;padding:9px 11px;background:var(--surf2);border:1px solid var(--bdr2);border-radius:var(--r2);font-family:var(--mono);font-size:13px;}
    .rr-val{font-weight:700;color:var(--acc);}

    /* confidence stars */
    .stars{display:flex;gap:3px;}
    .star{font-size:20px;cursor:pointer;color:var(--bdr2);transition:.1s;line-height:1;}
    .star.on{color:var(--yellow);}
    .star:hover{color:var(--yellow);}

    /* ── DETAIL ── */
    .det-header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:22px;flex-wrap:wrap;}
    .det-sym{font-size:38px;font-weight:800;letter-spacing:-2px;line-height:1;}
    .det-badges{display:flex;gap:7px;margin-top:8px;flex-wrap:wrap;}
    .det-pnl{text-align:right;}
    .det-pnl-val{font-size:34px;font-weight:800;letter-spacing:-1.5px;}
    .det-pnl-pct{font-size:14px;color:var(--muted2);margin-top:2px;}
    .det-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:11px;margin-bottom:18px;}
    .det-item{background:var(--surf);border:1px solid var(--bdr);border-radius:var(--r2);padding:13px 15px;}
    .det-label{font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted2);margin-bottom:4px;}
    .det-val{font-size:15px;font-weight:600;}
    .notes-box{background:var(--surf);border:1px solid var(--bdr);border-radius:var(--r2);padding:15px;font-size:13px;line-height:1.7;white-space:pre-wrap;color:var(--text);}
    .det-actions{display:flex;gap:10px;margin-top:18px;}
    .btn-edit{background:var(--surf2);border:1px solid var(--bdr2);color:var(--text);border-radius:var(--r2);font-family:var(--font);font-size:13px;padding:8px 18px;cursor:pointer;}
    .btn-del{background:#2a0b0b;border:1px solid #7f1d1d;color:var(--red);border-radius:var(--r2);font-family:var(--font);font-size:13px;padding:8px 18px;cursor:pointer;}
    .btn-back{background:none;border:none;color:var(--muted2);font-family:var(--font);font-size:12px;cursor:pointer;margin-bottom:16px;display:flex;align-items:center;gap:5px;}
    .btn-back:hover{color:var(--text);}
    .tag{display:inline-block;padding:2px 8px;background:var(--surf3);border:1px solid var(--bdr);border-radius:4px;font-size:11px;color:var(--muted2);margin:2px;}

    /* ── CALENDAR ── */
    .cal-wrap{width:100%;}
    .cal-nav{display:flex;align-items:center;justify-content:center;gap:16px;margin-bottom:14px;}
    .cal-arrow{background:none;border:1px solid var(--bdr);color:var(--text);border-radius:var(--r2);width:28px;height:28px;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center;}
    .cal-month{font-weight:700;font-size:16px;}
    .cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;}
    .cal-dow{text-align:center;font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted2);padding:4px 0;font-weight:500;}
    .cal-cell{min-height:64px;border:1px solid var(--bdr);border-radius:var(--r2);padding:6px;cursor:pointer;transition:.15s;display:flex;flex-direction:column;position:relative;}
    .cal-cell.empty{background:transparent;border-color:transparent;cursor:default;}
    .cal-cell:not(.empty):hover{border-color:var(--acc);}
    .cal-cell.today{border-color:var(--acc)!important;box-shadow:0 0 0 1px var(--acc);}
    .cal-day{font-size:11px;font-weight:600;color:var(--muted2);}
    .cal-pnl{font-size:11px;font-weight:700;margin-top:auto;font-family:var(--mono);}
    .cal-note-dot{position:absolute;top:5px;right:6px;font-size:8px;color:var(--acc);}

    /* day note modal */
    .modal-bg{position:fixed;inset:0;background:#000a;z-index:500;display:flex;align-items:center;justify-content:center;padding:20px;}
    .modal{background:var(--surf);border:1px solid var(--bdr);border-radius:var(--r);padding:24px;width:100%;max-width:440px;}
    .modal-title{font-weight:700;font-size:16px;margin-bottom:14px;}
    .modal textarea{width:100%;background:var(--surf2);border:1px solid var(--bdr2);color:var(--text);border-radius:var(--r2);padding:11px;font-family:var(--font);font-size:13px;line-height:1.6;resize:vertical;min-height:100px;}
    .modal textarea:focus{outline:none;border-color:var(--acc);}
    .modal-actions{display:flex;gap:8px;margin-top:14px;}

    /* ── ACCOUNTS ── */
    .acct-list{display:flex;flex-direction:column;gap:10px;margin-bottom:20px;}
    .acct-item{display:flex;align-items:center;gap:12px;padding:13px 16px;background:var(--surf2);border:1px solid var(--bdr);border-radius:var(--r2);}
    .acct-name{font-weight:600;font-size:14px;flex:1;}
    .acct-del{background:none;border:none;color:var(--muted);cursor:pointer;font-size:16px;padding:2px 6px;}
    .acct-del:hover{color:var(--red);}

    /* ── TOAST ── */
    .toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--surf3);border:1px solid var(--bdr2);color:var(--text);padding:10px 20px;border-radius:20px;font-size:13px;z-index:999;animation:fadeUp .25s ease;box-shadow:0 8px 32px #0008;}
    @keyframes fadeUp{from{opacity:0;transform:translateX(-50%) translateY(8px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}

    /* ── RESPONSIVE ── */
    @media(max-width:900px){.stats-grid{grid-template-columns:1fr 1fr}.dash-row{grid-template-columns:1fr}.det-grid{grid-template-columns:1fr 1fr}}
    @media(max-width:600px){.stats-grid{grid-template-columns:1fr}.fgrid.g3,.fgrid.g4{grid-template-columns:1fr 1fr}.fgrid.g2{grid-template-columns:1fr}.det-grid{grid-template-columns:1fr}.form-card{padding:18px}}
  `;

  /* ════════════════════════════ RENDER ════════════════════════════ */
  return (
    <div className="app">
      <style>{css}</style>

      {/* NAV */}
      <nav className="nav">
        <div className="nav-logo"><em/> APEX<span>Journal</span></div>
        {[["dashboard","Dashboard"],["log","Trade Log"],["calendar","PnL Calendar"],["stats","Statistics"],["accounts","Accounts"]].map(([v,l])=>(
          <button key={v} className={`nav-link ${page===v?"active":""}`} onClick={()=>setPage(v)}>{l}</button>
        ))}
        <div className="nav-right">
          <select value={filter.account} onChange={e=>setFilter(f=>({...f,account:e.target.value}))} style={{background:"var(--surf2)",border:"1px solid var(--bdr)",color:"var(--text)",borderRadius:"var(--r2)",padding:"5px 10px",fontFamily:"var(--font)",fontSize:12}}>
            <option value="all">All Accounts</option>
            {accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <button className="btn-primary" onClick={()=>openAdd()}>+ Log Trade</button>
        </div>
      </nav>

      <main className="main">

        {/* ── DASHBOARD ── */}
        {page==="dashboard" && <>
          <div className="stats-grid">
            {[
              {l:"Total P&L",v:<span className={cl(stats.totalPnL)}>{stats.totalPnL>=0?"":"−"}{$f(stats.totalPnL)}</span>,sub:`${stats.total} closed · ${stats.open} open`},
              {l:"Win Rate",v:<span className={stats.winRate>=50?"pos":"neg"}>{pf(stats.winRate)}</span>,sub:`${Math.round(stats.winRate/100*(stats.total))} W / ${stats.total-Math.round(stats.winRate/100*(stats.total))} L`},
              {l:"Avg Win / Loss",v:<span className="pos">{$f(stats.avgWin)}</span>,sub:<span className="neg">{$f(stats.avgLoss)}</span>},
              {l:"Profit Factor",v:<span className={(stats.pf||0)>=1.5?"pos":(stats.pf||0)>=1?"neu":"neg"}>{stats.pf?stats.pf.toFixed(2):"—"}</span>,sub:`Avg Confidence: ${stats.avgConf||"—"} ★`},
            ].map(s=>(
              <div key={s.l} className="card card-sm">
                <div className="card-title">{s.l}</div>
                <div className="stat-val">{s.v}</div>
                <div className="stat-sub">{s.sub}</div>
              </div>
            ))}
          </div>

          <div className="card eq-card">
            <div className="eq-header">
              <div className="card-title" style={{margin:0}}>Equity Curve</div>
              <div className={`eq-total ${cl(stats.totalPnL)}`}>{stats.totalPnL>=0?"+":""}{$f(stats.totalPnL)}</div>
            </div>
            <EquityCurve data={equity}/>
          </div>

          <div className="dash-row">
            <div className="card">
              <div className="card-title">Recent Trades</div>
              {trades.length===0?<div style={{color:"var(--muted2)",fontSize:13}}>No trades yet</div>:
                trades.slice().sort((a,b)=>b.date.localeCompare(a.date)).slice(0,7).map(t=>{
                  const p=calcPnL(t);
                  return (
                    <div key={t.id} className="recent-item" onClick={()=>{setDetailId(t.id);setPage("detail");}}>
                      <div className="ri-sym">{t.symbol}</div>
                      <span className={`badge b-${t.assetType}`}>{t.assetType}</span>
                      {t.assetType==="option"&&<span className={`badge b-${t.optionType}`}>{t.optionType}</span>}
                      <div className="ri-date">{t.date}</div>
                      <div className={`ri-pnl ${cl(p)}`}>{p===null?<span className="badge b-open">Open</span>:`${p>=0?"+":"-"}${$f(p)}`}</div>
                    </div>
                  );
                })
              }
            </div>

            <div className="card">
              <div className="card-title">Performance by Setup</div>
              {Object.keys(stats.bySetup).length===0?<div style={{color:"var(--muted2)",fontSize:13}}>No setup data yet</div>:
                Object.entries(stats.bySetup).sort((a,b)=>b[1].total-a[1].total).slice(0,8).map(([s,d])=>{
                  const wr=d.count?(d.wins/d.count)*100:0;
                  return (
                    <div key={s} className="setup-row">
                      <div className="setup-name">{s}</div>
                      <div className="setup-bar-wrap"><div className="setup-bar" style={{width:`${wr}%`,background:d.total>=0?"var(--green)":"var(--red)"}}/></div>
                      <div className="setup-meta"><span className={cl(d.total)}>{d.total>=0?"+":""}{$f(d.total)}</span> · {wr.toFixed(0)}%</div>
                    </div>
                  );
                })
              }
            </div>
          </div>
        </>}

        {/* ── TRADE LOG ── */}
        {page==="log" && <>
          <div className="filters">
            <input placeholder="Symbol…" value={filter.symbol} onChange={e=>setFilter(f=>({...f,symbol:e.target.value}))} style={{width:120}}/>
            <select value={filter.type} onChange={e=>setFilter(f=>({...f,type:e.target.value}))}>
              <option value="all">All Types</option>
              {ASSET_TYPES.map(t=><option key={t} value={t}>{t.charAt(0).toUpperCase()+t.slice(1)}</option>)}
            </select>
            <select value={filter.status} onChange={e=>setFilter(f=>({...f,status:e.target.value}))}>
              <option value="all">All Status</option>
              <option value="open">Open</option>
              <option value="closed">Closed</option>
            </select>
            <select value={filter.setup} onChange={e=>setFilter(f=>({...f,setup:e.target.value}))}>
              <option value="">All Setups</option>
              {SETUPS.map(s=><option key={s} value={s}>{s}</option>)}
            </select>
            <input type="date" value={filter.dateFrom} onChange={e=>setFilter(f=>({...f,dateFrom:e.target.value}))} style={{width:140}}/>
            <input type="date" value={filter.dateTo} onChange={e=>setFilter(f=>({...f,dateTo:e.target.value}))} style={{width:140}}/>
            {Object.values(filter).some(v=>v&&v!=="all")&&<button className="filter-chip" onClick={()=>setFilter({type:"all",status:"all",symbol:"",setup:"",account:"all",dateFrom:"",dateTo:""})}>✕ Clear</button>}
            <span className="count-badge">{filtered.length} trades</span>
          </div>
          {filtered.length===0?
            <div className="empty-state"><h3>No trades found</h3><div>Adjust filters or log your first trade</div></div>:
            <div className="tbl-wrap">
              <table>
                <thead>
                  <tr>
                    {[["date","Date"],["symbol","Symbol"],["assetType","Type"],["side","Side"],["status","Status"],["setup","Setup"],["pnl","P&L"],["rr","R:R"],["confidence","Conf"]].map(([c,l])=>(
                      <th key={c} onClick={()=>setSort(c)}>{l}{sortCol===c?(sortDir==="asc"?" ↑":" ↓"):""}</th>
                    ))}
                    <th>Hold</th><th>Account</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(t=>{
                    const p=calcPnL(t), pct=calcPct(t), rr=calcRR(t), hold=holdTime(t);
                    return (
                      <tr key={t.id} onClick={()=>{setDetailId(t.id);setPage("detail");}}>
                        <td className="td-mono">{t.date}</td>
                        <td><span className="td-sym">{t.symbol}</span>{t.assetType==="option"&&<span style={{fontSize:11,color:"var(--muted2)",marginLeft:6}}>{t.strike} {t.optionType?.toUpperCase()}</span>}</td>
                        <td><span className={`badge b-${t.assetType}`}>{t.assetType}</span></td>
                        <td><span className={`badge b-${t.side}`}>{t.side}</span></td>
                        <td><span className={`badge b-${t.status}`}>{t.status}</span></td>
                        <td style={{fontSize:12,color:"var(--muted2)"}}>{t.setup||"—"}</td>
                        <td>
                          {p===null?<span className="badge b-open">Open</span>:<span className={`td-mono ${cl(p)}`} style={{fontWeight:700}}>{p>=0?"+":"-"}{$f(p)} <span style={{fontSize:10,fontWeight:400,color:"var(--muted2)"}}>{pct!==null?pf(pct):""}</span></span>}
                        </td>
                        <td className="td-mono" style={{color:rr?(rr>=2?"var(--green)":rr>=1?"var(--yellow)":"var(--red)"):"var(--muted2)"}}>{rr?rr.toFixed(1)+"R":"—"}</td>
                        <td><Stars val={t.confidence||3}/></td>
                        <td style={{fontSize:12,color:"var(--muted2)"}}>{hold||"—"}</td>
                        <td style={{fontSize:12,color:"var(--muted2)"}}>{acctName(t.accountId)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          }
        </>}

        {/* ── PNL CALENDAR ── */}
        {page==="calendar" && <>
          <div style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:18}}>
            <div className="card"><PnLCalendar/></div>
            <div style={{display:"flex",flexDirection:"column",gap:14}}>
              <div className="card">
                <div className="card-title">This Month</div>
                {(()=>{
                  const y=calMonth.getFullYear(),m=calMonth.getMonth();
                  const days=Object.entries(calData).filter(([d])=>new Date(d).getFullYear()===y&&new Date(d).getMonth()===m);
                  const total=days.reduce((a,[,v])=>a+v,0);
                  const tradingDays=days.length;
                  const greenDays=days.filter(([,v])=>v>0).length;
                  return <>
                    <div className={`stat-val ${cl(total)}`} style={{fontSize:22}}>{total>=0?"+":"-"}{$f(total)}</div>
                    <div className="stat-sub">{tradingDays} trading days · {greenDays} green</div>
                  </>;
                })()}
              </div>
              <div className="card">
                <div className="card-title">Day Notes</div>
                {Object.entries(dayNotes).filter(([,v])=>v).sort((a,b)=>b[0].localeCompare(a[0])).slice(0,5).map(([date,note])=>(
                  <div key={date} style={{borderBottom:"1px solid var(--bdr)",paddingBottom:8,marginBottom:8,cursor:"pointer"}} onClick={()=>{setEditDayNote(date);setDayNote(note);}}>
                    <div style={{fontSize:11,color:"var(--muted2)",marginBottom:3}}>{date}</div>
                    <div style={{fontSize:12,lineHeight:1.5,color:"var(--text)"}}>{note.slice(0,80)}{note.length>80?"…":""}</div>
                  </div>
                ))}
                {Object.keys(dayNotes).length===0&&<div style={{color:"var(--muted2)",fontSize:12}}>Click a calendar day to add notes</div>}
              </div>
            </div>
          </div>
        </>}

        {/* ── STATISTICS ── */}
        {page==="stats" && <>
          <div className="stats-grid" style={{gridTemplateColumns:"repeat(3,1fr)"}}>
            {[
              {l:"Best Trade",v:<span className="pos">{$f(stats.maxWin)}</span>},
              {l:"Worst Trade",v:<span className="neg">{stats.maxLoss<0?"-":""}{$f(stats.maxLoss)}</span>},
              {l:"Profit Factor",v:<span className={(stats.pf||0)>=1.5?"pos":"neg"}>{stats.pf?stats.pf.toFixed(2):"—"}</span>},
              {l:"Avg Win",v:<span className="pos">{$f(stats.avgWin)}</span>},
              {l:"Avg Loss",v:<span className="neg">{$f(Math.abs(stats.avgLoss))}</span>},
              {l:"Avg Confidence",v:<span className="neu">{stats.avgConf||"—"} ★</span>},
            ].map(s=>(
              <div key={s.l} className="card card-sm">
                <div className="card-title">{s.l}</div>
                <div className="stat-val" style={{fontSize:22}}>{s.v}</div>
              </div>
            ))}
          </div>

          <div className="card" style={{marginTop:14,marginBottom:18}}>
            <div className="card-title">Equity Curve</div>
            <EquityCurve data={equity} h={120}/>
          </div>

          <div className="dash-row">
            <div className="card">
              <div className="card-title">P&L by Setup</div>
              {Object.keys(stats.bySetup).length===0?<div style={{color:"var(--muted2)",fontSize:13}}>No data</div>:
                Object.entries(stats.bySetup).sort((a,b)=>b[1].total-a[1].total).map(([s,d])=>{
                  const wr=d.count?(d.wins/d.count)*100:0;
                  return (
                    <div key={s} className="setup-row">
                      <div className="setup-name">{s}</div>
                      <div className="setup-bar-wrap"><div className="setup-bar" style={{width:`${wr}%`,background:d.total>=0?"var(--green)":"var(--red)"}}/></div>
                      <div className="setup-meta">{d.count} trades</div>
                      <div className={`setup-meta ${cl(d.total)}`} style={{minWidth:80}}>{d.total>=0?"+":"-"}{$f(d.total)}</div>
                    </div>
                  );
                })
              }
            </div>
            <div className="card">
              <div className="card-title">P&L by Asset Type</div>
              {(()=>{
                const byType={};
                trades.filter(t=>t.status==="closed").forEach(t=>{
                  const p=calcPnL(t); if(p===null)return;
                  if(!byType[t.assetType])byType[t.assetType]={total:0,count:0,wins:0};
                  byType[t.assetType].total+=p; byType[t.assetType].count++;
                  if(p>0)byType[t.assetType].wins++;
                });
                return Object.keys(byType).length===0?<div style={{color:"var(--muted2)",fontSize:13}}>No data</div>:
                  Object.entries(byType).sort((a,b)=>b[1].total-a[1].total).map(([type,d])=>(
                    <div key={type} className="setup-row">
                      <span className={`badge b-${type}`} style={{minWidth:60}}>{type}</span>
                      <div className="setup-bar-wrap"><div className="setup-bar" style={{width:`${d.count?d.wins/d.count*100:0}%`,background:d.total>=0?"var(--green)":"var(--red)"}}/></div>
                      <div className="setup-meta">{d.count} trades</div>
                      <div className={`setup-meta ${cl(d.total)}`}>{d.total>=0?"+":""}{$f(d.total)}</div>
                    </div>
                  ));
              })()}
            </div>
          </div>
        </>}

        {/* ── ACCOUNTS ── */}
        {page==="accounts" && <>
          <div style={{maxWidth:520}}>
            <div className="acct-list">
              {accounts.map(a=>{
                const acctTrades=trades.filter(t=>t.accountId===a.id&&t.status==="closed");
                const acctPnL=acctTrades.reduce((s,t)=>s+(calcPnL(t)||0),0);
                return (
                  <div key={a.id} className="acct-item">
                    <div>
                      <div className="acct-name">{a.name}</div>
                      <div style={{fontSize:12,color:"var(--muted2)",marginTop:3}}>{acctTrades.length} trades · <span className={cl(acctPnL)}>{acctPnL>=0?"+":"-"}{$f(acctPnL)}</span></div>
                    </div>
                    {a.id!=="default"&&<button className="acct-del" onClick={()=>setAccounts(ac=>ac.filter(x=>x.id!==a.id))}>✕</button>}
                  </div>
                );
              })}
            </div>
            <div className="card">
              <div className="card-title">Add Account / Portfolio</div>
              <div className="fgrid g2">
                <div className="frow"><label>Name</label><input value={acctForm.name} onChange={e=>setAcctForm(f=>({...f,name:e.target.value}))} placeholder="e.g. Options Account"/></div>
                <div className="frow"><label>Starting Balance ($)</label><input type="number" value={acctForm.balance} onChange={e=>setAcctForm(f=>({...f,balance:e.target.value}))} placeholder="10000"/></div>
              </div>
              <button className="btn-primary" style={{marginTop:14}} onClick={()=>{
                if(!acctForm.name.trim()) return;
                setAccounts(ac=>[...ac,{id:uid(),name:acctForm.name.trim(),balance:acctForm.balance}]);
                setAcctForm({name:"",balance:""});
                showToast("Account added ✓");
              }}>Add Account</button>
            </div>
          </div>
        </>}

        {/* ── ADD / EDIT ── */}
        {page==="add" && (()=>{
          const rr = calcRR(form);
          return (
            <div className="form-wrap">
              <div className="form-card">
                <div className="form-h">{editId?"Edit Trade":"Log New Trade"}</div>

                <div className="fsec">
                  <div className="fsec-title">Asset Type</div>
                  <div className="toggle-row">
                    {ASSET_TYPES.map(t=><button key={t} className={`toggle-btn ${form.assetType===t?"on":""}`} onClick={()=>setForm(f=>({...f,assetType:t}))}>{t}</button>)}
                  </div>
                </div>

                <div className="fsec">
                  <div className="fsec-title">Core Details</div>
                  <div className="fgrid g4">
                    <div className="frow"><label>Symbol *</label>{inp("symbol",{placeholder:"AAPL",style:{textTransform:"uppercase"}})}</div>
                    <div className="frow"><label>Date</label>{inp("date",{type:"date"})}</div>
                    <div className="frow"><label>Status</label>{sel("status",[["open","Open"],["closed","Closed"]])}</div>
                    <div className="frow"><label>Account</label>
                      <select value={form.accountId} onChange={upd("accountId")}>
                        {accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="fgrid g2" style={{marginTop:12}}>
                    <div className="frow"><label>Direction</label>
                      <div className="toggle-row">{SIDES.map(s=><button key={s} className={`toggle-btn ${form.side===s?"on":""}`} onClick={()=>setForm(f=>({...f,side:s}))}>{s==="long"?"▲ Long":"▼ Short"}</button>)}</div>
                    </div>
                    <div className="frow"><label>Setup</label>
                      {sel("setup",[["","— Select —"],...SETUPS.map(s=>[s,s])])}
                    </div>
                  </div>
                </div>

                {/* Stock / Crypto / Futures */}
                {form.assetType!=="option"&&<div className="fsec">
                  <div className="fsec-title">{form.assetType==="futures"?"Futures Fields":form.assetType==="forex"?"Forex Fields":"Price & Quantity"}</div>
                  <div className="fgrid g3">
                    <div className="frow"><label>{form.assetType==="forex"?"Lots":form.assetType==="futures"?"Contracts":"Shares / Units"}</label>{inp("qty",{type:"number",placeholder:"100"})}</div>
                    <div className="frow"><label>Entry Price</label>{inp("entryPrice",{type:"number",placeholder:"150.00",step:"0.01"})}</div>
                    <div className="frow"><label>Exit Price</label>{inp("exitPrice",{type:"number",placeholder:"155.00",step:"0.01"})}</div>
                  </div>
                  {form.assetType==="futures"&&<div className="fgrid g2" style={{marginTop:12}}>
                    <div className="frow"><label>Tick Multiplier</label>{inp("tickMult",{type:"number",placeholder:"50 (e.g. /ES)"})}</div>
                  </div>}
                </div>}

                {/* Options */}
                {form.assetType==="option"&&<div className="fsec">
                  <div className="fsec-title">Option Details</div>
                  <div className="fgrid g2" style={{marginBottom:12}}>
                    <div className="frow"><label>Call / Put</label>
                      <div className="toggle-row">
                        {OPTION_TYPES.map(t=><button key={t} className={`toggle-btn ${form.optionType===t?"on":""}`} onClick={()=>setForm(f=>({...f,optionType:t}))}>{t.toUpperCase()}</button>)}
                      </div>
                    </div>
                    <div className="frow"><label>Expiry Date</label>{inp("expiry",{type:"date"})}</div>
                  </div>
                  <div className="fgrid g4">
                    <div className="frow"><label>Strike ($)</label>{inp("strike",{type:"number",placeholder:"150",step:"0.5"})}</div>
                    <div className="frow"><label>Contracts</label>{inp("contracts",{type:"number",placeholder:"1"})}</div>
                    <div className="frow"><label>Entry Premium</label>{inp("premium",{type:"number",placeholder:"2.50",step:"0.01"})}</div>
                    <div className="frow"><label>Exit Premium</label>{inp("exitPremium",{type:"number",placeholder:"4.00",step:"0.01"})}</div>
                  </div>
                </div>}

                {/* Risk Management */}
                <div className="fsec">
                  <div className="fsec-title">Risk Management</div>
                  <div className="fgrid g3">
                    <div className="frow"><label>Stop Loss</label>{inp("stopLoss",{type:"number",placeholder:"148.00",step:"0.01"})}</div>
                    <div className="frow"><label>Take Profit</label>{inp("takeProfit",{type:"number",placeholder:"158.00",step:"0.01"})}</div>
                    <div className="frow"><label>Risk:Reward</label>
                      <div className="rr-display">
                        {rr?<><span className="rr-val">{rr.toFixed(2)}R</span><span style={{color:"var(--muted2)",fontSize:12}}>{rr>=2?"✓ Good":rr>=1?"≈ Fair":"✗ Poor"}</span></>:<span style={{color:"var(--muted2)"}}>Set SL & TP</span>}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Timing & Fees */}
                <div className="fsec">
                  <div className="fsec-title">Timing & Fees</div>
                  <div className="fgrid g3">
                    <div className="frow"><label>Entry Time</label>{inp("entryTime",{type:"time"})}</div>
                    <div className="frow"><label>Exit Time</label>{inp("exitTime",{type:"time"})}</div>
                    <div className="frow"><label>Fees / Commission ($)</label>{inp("fees",{type:"number",placeholder:"0.65",step:"0.01"})}</div>
                  </div>
                </div>

                {/* Journal */}
                <div className="fsec">
                  <div className="fsec-title">Journal</div>
                  <div className="fgrid g2">
                    <div className="frow"><label>Confidence</label><Stars val={form.confidence} onChange={v=>setForm(f=>({...f,confidence:v}))}/></div>
                    <div className="frow"><label>Tags (comma-separated)</label>{inp("tags",{placeholder:"earnings, gap-up, premarket"})}</div>
                  </div>
                  <div className="frow" style={{marginTop:12}}><label>Notes / Trade Rationale</label>
                    <textarea value={form.notes} onChange={upd("notes")} placeholder="Why did you take this trade? What was your thesis? What would you do differently?"/>
                  </div>
                </div>

                <div className="form-actions">
                  <button className="btn-cancel" onClick={()=>{setForm({...BLANK});setEditId(null);setPage(editId?"log":"log");}}>Cancel</button>
                  <button className="btn-save" onClick={saveTrade}>{editId?"Save Changes":"Log Trade ✓"}</button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* ── DETAIL ── */}
        {page==="detail" && detail && (()=>{
          const t=trades.find(tr=>tr.id===detailId)||detail;
          const p=calcPnL(t), pct=calcPct(t), rr=calcRR(t), hold=holdTime(t);
          const tags=t.tags?t.tags.split(",").map(s=>s.trim()).filter(Boolean):[];
          return (
            <>
              <button className="btn-back" onClick={()=>setPage("log")}>← Back to Log</button>
              <div className="det-header">
                <div>
                  <div className="det-sym">{t.symbol}</div>
                  <div className="det-badges">
                    <span className={`badge b-${t.assetType}`}>{t.assetType}</span>
                    <span className={`badge b-${t.side}`}>{t.side}</span>
                    {t.assetType==="option"&&<span className={`badge b-${t.optionType}`}>{t.optionType} {t.strike} · {t.expiry}</span>}
                    <span className={`badge b-${t.status}`}>{t.status}</span>
                  </div>
                  <div style={{marginTop:10}}><Stars val={t.confidence||3}/></div>
                </div>
                {p!==null&&<div className="det-pnl">
                  <div className={`det-pnl-val ${cl(p)}`}>{p>=0?"+":"-"}{$f(p)}</div>
                  <div className="det-pnl-pct">{pct!==null?pf(pct):"—"}</div>
                </div>}
              </div>

              <div className="det-grid">
                {[
                  ["Date",t.date],
                  ["Account",acctName(t.accountId)],
                  ["Setup",t.setup||"—"],
                  t.assetType==="option"?["Contracts",t.contracts||"—"]:["Qty",t.qty||"—"],
                  t.assetType==="option"?["Entry Premium",t.premium?`$${t.premium}`:"—"]:["Entry",t.entryPrice?`$${t.entryPrice}`:"—"],
                  t.assetType==="option"?["Exit Premium",t.exitPremium?`$${t.exitPremium}`:"—"]:["Exit",t.exitPrice?`$${t.exitPrice}`:"—"],
                  ["Stop Loss",t.stopLoss?`$${t.stopLoss}`:"—"],
                  ["Take Profit",t.takeProfit?`$${t.takeProfit}`:"—"],
                  ["R:R",rr?`${rr.toFixed(2)}R`:"—"],
                  ["Fees",t.fees?`$${t.fees}`:"—"],
                  ["Hold Time",hold||"—"],
                  ["Confidence",t.confidence?"★".repeat(t.confidence):"—"],
                ].map(([l,v])=>(
                  <div key={l} className="det-item">
                    <div className="det-label">{l}</div>
                    <div className="det-val">{v}</div>
                  </div>
                ))}
              </div>

              {tags.length>0&&<div style={{marginBottom:14}}>{tags.map(tag=><span key={tag} className="tag">#{tag}</span>)}</div>}
              {t.notes&&<>
                <div style={{fontSize:10,textTransform:"uppercase",letterSpacing:".1em",color:"var(--muted2)",marginBottom:8}}>Notes</div>
                <div className="notes-box">{t.notes}</div>
              </>}

              <div className="det-actions">
                <button className="btn-edit" onClick={()=>{setForm({...t});setEditId(t.id);setPage("add");}}>Edit Trade</button>
                <button className="btn-del" onClick={()=>deleteTrade(t.id)}>Delete</button>
              </div>
            </>
          );
        })()}

      </main>

      {/* Day Note Modal */}
      {editDayNote&&(
        <div className="modal-bg" onClick={e=>{if(e.target.className==="modal-bg"){setEditDayNote(null);}}}>
          <div className="modal">
            <div className="modal-title">Day Note — {editDayNote}</div>
            {(()=>{const dayTrades=trades.filter(t=>t.date===editDayNote&&t.status==="closed");const dp=dayTrades.reduce((s,t)=>s+(calcPnL(t)||0),0);return dayTrades.length>0&&<div style={{fontSize:13,marginBottom:12,color:dp>=0?"var(--green)":"var(--red)",fontWeight:600}}>{dp>=0?"+":"-"}{$f(dp)} · {dayTrades.length} trade{dayTrades.length!==1?"s":""}</div>;})()}
            <textarea value={dayNote} onChange={e=>setDayNote(e.target.value)} placeholder="Market conditions, lessons learned, mood, observations…"/>
            <div className="modal-actions">
              <button className="btn-cancel" onClick={()=>setEditDayNote(null)}>Cancel</button>
              <button className="btn-save" onClick={()=>{setDayNotes(d=>({...d,[editDayNote]:dayNote}));setEditDayNote(null);showToast("Day note saved ✓");}}>Save Note</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast&&<div className="toast">{toast}</div>}
    </div>
  );
}
