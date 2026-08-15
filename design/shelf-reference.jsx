import React, { useState, useRef } from "react";

/* ============================================================
   GAMBIT — Shelf lobby design reference
   Themes · SFX swoosh (Web Audio, toggleable) · 11-game catalog
   This file is a design north star for the production build.
   ============================================================ */

const THEMES = {
  cocoa:    {label:"Cocoa",    bg:"#1a120c", panel:"#241811", panel2:"#2e2016", line:"#3d2c1d", ink:"#ede3d4", mut:"#9c8672", accent:"#c47e4a", felt:"#20150e"},
  linen:    {label:"Linen",    bg:"#efe7d8", panel:"#f7f1e5", panel2:"#ece2cf", line:"#d8c9ae", ink:"#2b2116", mut:"#8a7a62", accent:"#a4632e", felt:"#e9dfc9"},
  regalia:  {label:"Regalia",  bg:"#0e1626", panel:"#15203a", panel2:"#1b2a4a", line:"#2c3d61", ink:"#e9e2cf", mut:"#8fa0bf", accent:"#c9a24a", felt:"#111c31"},
  oxblood:  {label:"Oxblood",  bg:"#1c0e10", panel:"#291418", panel2:"#341a1f", line:"#4a262d", ink:"#efe1d6", mut:"#a88a86", accent:"#c98a4a", felt:"#231114"},
  empress:  {label:"Empress",  bg:"#0d1a15", panel:"#13251d", panel2:"#193028", line:"#28453a", ink:"#efe9d8", mut:"#8fa89a", accent:"#cbb56a", felt:"#102019"},
  amethyst: {label:"Amethyst", bg:"#151020", panel:"#1e172e", panel2:"#27203a", line:"#3a3054", ink:"#e9e4f0", mut:"#9a90b3", accent:"#b9a0d9", felt:"#191330"},
};

const GAMES = [
  {id:"chess",     name:"Chess",      tag:"The eternal duel",                       p:"2",    min:15, cx:3, hue:"#8a8474", badges:["Ranked"],       blurb:"Full classical rules, blitz & rapid clocks, and a ladder worth climbing."},
  {id:"boxcar",    name:"Boxcar",     tag:"Claim routes, connect the map",          p:"2–5",  min:45, cx:2, hue:"#b08d3f", badges:["3 maps"],       blurb:"Draw cards, claim rail lines, complete secret tickets across three continents."},
  {id:"landfall",  name:"Landfall",   tag:"Settle, trade, out-build the island",    p:"3–4",  min:60, cx:3, hue:"#4d8a52", badges:["Trading"],      blurb:"Roll for resources, cut deals at the table, race to ten victory points."},
  {id:"quintet",   name:"Quintet",    tag:"Cards down, five in a row",              p:"2–12", min:25, cx:1, hue:"#3c6ea8", badges:["Teams"],        blurb:"Play a card, place a chip, read the board. Team play at its purest."},
  {id:"phantom",   name:"Phantom",    tag:"One vanishes. Everyone hunts.",          p:"3–6",  min:40, cx:3, hue:"#5a5f8f", badges:["Hidden role"],  blurb:"A fugitive moves unseen through the city. Detectives close the net — or don't."},
  {id:"motive",    name:"Motive",     tag:"Someone at this table did it",           p:"3–6",  min:45, cx:2, hue:"#8a3b3b", badges:["Deduction"],    blurb:"Suggest, disprove, deduce. Accuse when certain — accuse wrong and you're out."},
  {id:"hamlet",    name:"Hamlet",     tag:"Lay the land, tile by tile",             p:"2–5",  min:35, cx:2, hue:"#7a8a4d", badges:["Tile laying"],  blurb:"Grow a countryside of roads and keeps, and claim it with your meeples."},
  {id:"mosaic",    name:"Mosaic",     tag:"Draft beauty, punish greed",             p:"2–4",  min:30, cx:2, hue:"#3f8f8a", badges:["Drafting"],     blurb:"Take tiles from the factories, build a perfect wall, mind the floor line."},
  {id:"facet",     name:"Facet",      tag:"Build a jewel of an engine",             p:"2–4",  min:30, cx:2, hue:"#8a5ba6", badges:["Engine"],       blurb:"Collect gems, chain discounts, court the nobles, hit fifteen prestige first."},
  {id:"stronghold",name:"Stronghold", tag:"Hold the map or lose it",                p:"2–6",  min:75, cx:2, hue:"#a6592e", badges:["Area control"], blurb:"Reinforce, attack, fortify. Regions pay dividends; hesitation pays nothing."},
  {id:"remedy",    name:"Remedy",     tag:"Beat the board — together",              p:"2–5",  min:45, cx:3, hue:"#3f7f6a", badges:["Co-op"],        blurb:"Four afflictions spread across the world. Your team cures all of them, or no one wins."},
];

const FILTERS = [
  {id:"all",  label:"All"},
  {id:"two",  label:"For 2"},
  {id:"party",label:"Big table"},
  {id:"quick",label:"Under 35 min"},
  {id:"coop", label:"Co-op"},
  {id:"teams",label:"Teams"},
  {id:"hidden",label:"Hidden roles"},
];
const passes=(g,f)=>{
  if(f==="all")return true;
  if(f==="two")return g.p.startsWith("2");
  if(f==="party")return +g.p.split("–")[1]>=5;
  if(f==="quick")return g.min<=35;
  if(f==="coop")return g.badges.includes("Co-op");
  if(f==="teams")return g.badges.includes("Teams");
  if(f==="hidden")return g.badges.includes("Hidden role")||g.badges.includes("Deduction");
  return true;
};

export default function App(){
  const [themeId,setThemeId]=useState("cocoa");
  const [sfx,setSfx]=useState(true);
  const [filter,setFilter]=useState("all");
  const [sel,setSel]=useState("boxcar");
  const [room,setRoom]=useState(null); // 'here' | 'online'
  const t=THEMES[themeId];
  const audioRef=useRef(null);

  /* tiny Web Audio swoosh — the production build replaces this with a proper sprite sheet */
  function swoosh(freq=520){
    if(!sfx)return;
    try{
      if(!audioRef.current) audioRef.current=new (window.AudioContext||window.webkitAudioContext)();
      const ctx=audioRef.current, now=ctx.currentTime;
      const o=ctx.createOscillator(), g=ctx.createGain(), f=ctx.createBiquadFilter();
      o.type="triangle"; o.frequency.setValueAtTime(freq,now); o.frequency.exponentialRampToValueAtTime(freq*0.45,now+0.18);
      f.type="lowpass"; f.frequency.value=1200;
      g.gain.setValueAtTime(0.0001,now); g.gain.exponentialRampToValueAtTime(0.12,now+0.02); g.gain.exponentialRampToValueAtTime(0.0001,now+0.22);
      o.connect(f); f.connect(g); g.connect(ctx.destination); o.start(now); o.stop(now+0.24);
    }catch(e){}
  }

  const shown=GAMES.filter(g=>passes(g,filter));
  const selected=GAMES.find(g=>g.id===sel);
  const selVisible=shown.some(g=>g.id===sel);

  const S={
    chip:(on)=>({padding:"7px 14px",borderRadius:20,fontSize:13,cursor:"pointer",whiteSpace:"nowrap",
      border:`1px solid ${on?t.accent:t.line}`,background:on?t.accent:"transparent",color:on?t.bg:t.mut,
      transition:"all .18s ease",fontFamily:"inherit"}),
    btn:{background:t.accent,color:t.bg,border:"none",borderRadius:8,padding:"12px 22px",fontFamily:"inherit",
      fontSize:15,fontWeight:700,cursor:"pointer",letterSpacing:.4},
    btn2:{background:"transparent",color:t.ink,border:`1px solid ${t.line}`,borderRadius:8,padding:"12px 22px",
      fontFamily:"inherit",fontSize:15,cursor:"pointer"},
  };

  return (
    <div style={{minHeight:"100vh",background:t.bg,color:t.ink,fontFamily:"Georgia,'Times New Roman',serif",transition:"background .35s ease, color .35s ease"}}>
      <div style={{maxWidth:1080,margin:"0 auto",padding:"20px 18px 60px"}}>

        {/* ---------- header ---------- */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:14,marginBottom:26}}>
          <div style={{display:"flex",alignItems:"baseline",gap:12}}>
            <div style={{fontSize:30,letterSpacing:5,fontWeight:700}}>GAMBIT</div>
            <div style={{fontSize:12,letterSpacing:2,color:t.mut,fontVariant:"small-caps"}}>every table, one place</div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:14}}>
            <div style={{display:"flex",gap:7,alignItems:"center"}}>
              {Object.entries(THEMES).map(([id,th])=>(
                <div key={id} title={th.label} onClick={()=>{setThemeId(id);swoosh(640);}}
                  style={{width:18,height:18,borderRadius:9,cursor:"pointer",background:`linear-gradient(135deg,${th.bg} 50%,${th.accent} 50%)`,
                    border:themeId===id?`2px solid ${t.ink}`:`1px solid ${t.line}`,transition:"transform .15s",transform:themeId===id?"scale(1.2)":"scale(1)"}}/>
              ))}
            </div>
            <div onClick={()=>{setSfx(!sfx); if(!sfx){/* turning on */ setTimeout(()=>swoosh(700),0);} }}
              title={sfx?"Sound on":"Sound off"}
              style={{cursor:"pointer",fontSize:18,opacity:sfx?1:.4,userSelect:"none"}}>{sfx?"🔊":"🔇"}</div>
          </div>
        </div>

        {/* ---------- filters ---------- */}
        <div style={{display:"flex",gap:8,overflowX:"auto",paddingBottom:8,marginBottom:10}}>
          {FILTERS.map(f=>(
            <button key={f.id} style={S.chip(filter===f.id)} onClick={()=>{setFilter(f.id);swoosh(560);}}>{f.label}</button>
          ))}
        </div>

        {/* ---------- the shelf ---------- */}
        <div style={{fontSize:12,letterSpacing:3,color:t.mut,fontVariant:"small-caps",margin:"6px 2px 10px"}}>the shelf · {shown.length} games</div>
        <div style={{position:"relative",marginBottom:8}}>
          <div style={{display:"flex",gap:10,overflowX:"auto",padding:"14px 6px 0",alignItems:"flex-end"}}>
            {shown.map(g=>{
              const on=sel===g.id;
              return (
                <div key={g.id} onClick={()=>{setSel(g.id);swoosh(500);}}
                  style={{flex:"0 0 auto",width:64,height:on?218:196,borderRadius:"6px 6px 3px 3px",cursor:"pointer",
                    background:`linear-gradient(180deg,${g.hue} 0%, ${g.hue}cc 60%, ${t.panel} 130%)`,
                    border:`1px solid ${t.line}`,boxShadow:on?`0 14px 26px rgba(0,0,0,.45), 0 0 0 2px ${t.accent}`:"0 6px 14px rgba(0,0,0,.35)",
                    transform:on?"translateY(-12px)":"translateY(0)",transition:"all .22s cubic-bezier(.34,1.4,.5,1)",
                    display:"flex",alignItems:"center",justifyContent:"center",position:"relative"}}>
                  <span style={{writingMode:"vertical-rl",transform:"rotate(180deg)",fontSize:15,letterSpacing:2.5,
                    fontWeight:700,color:"#f6efe2",textShadow:"0 1px 3px rgba(0,0,0,.5)"}}>{g.name.toUpperCase()}</span>
                  <span style={{position:"absolute",bottom:8,left:0,right:0,textAlign:"center",fontSize:10,color:"#f6efe2",opacity:.8}}>{g.p}</span>
                </div>
              );
            })}
            {shown.length===0&&<div style={{color:t.mut,padding:30,fontStyle:"italic"}}>Nothing on the shelf for that filter yet.</div>}
          </div>
          {/* shelf plank */}
          <div style={{height:10,borderRadius:3,background:`linear-gradient(180deg,${t.panel2},${t.panel})`,border:`1px solid ${t.line}`,boxShadow:"0 10px 18px rgba(0,0,0,.35)"}}/>
        </div>

        {/* ---------- selected game card ---------- */}
        {selected&&selVisible&&(
          <div key={sel} style={{marginTop:24,background:t.panel,border:`1px solid ${t.line}`,borderRadius:14,overflow:"hidden",
            animation:"gmbt-rise .3s ease both",boxShadow:"0 14px 30px rgba(0,0,0,.3)"}}>
            <style>{`@keyframes gmbt-rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}`}</style>
            <div style={{display:"flex",flexWrap:"wrap"}}>
              {/* cover */}
              <div style={{flex:"0 0 220px",minHeight:190,background:`linear-gradient(145deg,${selected.hue},${selected.hue}88 70%,${t.felt})`,
                display:"flex",alignItems:"center",justifyContent:"center",position:"relative"}}>
                <div style={{fontSize:26,letterSpacing:4,fontWeight:700,color:"#f6efe2",textShadow:"0 2px 8px rgba(0,0,0,.45)"}}>{selected.name.toUpperCase()}</div>
                <div style={{position:"absolute",bottom:10,fontSize:11,letterSpacing:2,color:"#f6efe2",opacity:.85}}>{selected.tag.toUpperCase()}</div>
              </div>
              {/* meta */}
              <div style={{flex:"1 1 340px",padding:"20px 22px"}}>
                <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:10}}>
                  <Meta t={t} label={`${selected.p} players`}/>
                  <Meta t={t} label={`~${selected.min} min`}/>
                  <Meta t={t} label={"complexity " + "●".repeat(selected.cx)+"○".repeat(3-selected.cx)}/>
                  {selected.badges.map(b=><Meta key={b} t={t} label={b} accent/>)}
                </div>
                <p style={{fontSize:16,lineHeight:1.55,color:t.ink,margin:"0 0 18px"}}>{selected.blurb}</p>
                <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                  <button style={S.btn} onClick={()=>{setRoom("here");swoosh(760);}}>Play here · same room</button>
                  <button style={S.btn2} onClick={()=>{setRoom("online");swoosh(760);}}>Play online · invite friends</button>
                  <button style={{...S.btn2,opacity:.75}} onClick={()=>swoosh(430)}>2-min tutorial</button>
                </div>
              </div>
            </div>
          </div>
        )}

        <div style={{marginTop:34,textAlign:"center",fontSize:12,color:t.mut,letterSpacing:1}}>
          design reference · production build adds motion physics, foley, music & per-game skins per GAMBIT_claude_code_prompt.md
        </div>
      </div>

      {/* ---------- room modal ---------- */}
      {room&&(
        <div onClick={()=>setRoom(null)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.72)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:40}}>
          <div onClick={e=>e.stopPropagation()} style={{background:t.panel,border:`1px solid ${t.line}`,borderRadius:16,padding:26,width:340,maxWidth:"90vw",textAlign:"center"}}>
            <div style={{fontSize:12,letterSpacing:3,color:t.mut,fontVariant:"small-caps",marginBottom:6}}>
              {room==="here"?"same-room table":"online table"} · {selected.name}</div>
            <div style={{fontSize:34,letterSpacing:6,fontWeight:700,margin:"4px 0 14px"}}>GMB·7Q4</div>
            {room==="here"?(
              <>
                <QRish t={t}/>
                <p style={{fontSize:13,color:t.mut,marginTop:12}}>Friends scan to sit down. Target: everyone seated in under 10 seconds.</p>
              </>
            ):(
              <>
                <div style={{background:t.panel2,border:`1px dashed ${t.line}`,borderRadius:8,padding:"10px 12px",fontSize:13,color:t.ink}}>gambit.app/r/GMB7Q4</div>
                <p style={{fontSize:13,color:t.mut,marginTop:12}}>Share on WhatsApp — they tap, they're seated, wherever they are.</p>
              </>
            )}
            <button style={{...S.btn,width:"100%",marginTop:14}} onClick={()=>{setRoom(null);swoosh(680);}}>Open the lobby</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Meta({t,label,accent}){
  return <span style={{fontSize:12,padding:"4px 10px",borderRadius:12,letterSpacing:.5,
    border:`1px solid ${accent?t.accent:t.line}`,color:accent?t.accent:t.mut}}>{label}</span>;
}

/* decorative QR-look block (deterministic pattern, not a real code) */
function QRish({t}){
  const cells=[]; let s=7;
  const rnd=()=>{ s=(s*16807)%2147483647; return s/2147483647; };
  for(let y=0;y<17;y++)for(let x=0;x<17;x++){
    const corner=(x<5&&y<5)||(x>11&&y<5)||(x<5&&y>11);
    const onEdge=(x===0||x===4||y===0||y===4)&&x<5&&y<5 || (x===12||x===16||y===0||y===4)&&x>11&&y<5 || (x===0||x===4||y===12||y===16)&&x<5&&y>11;
    const inner=corner&&x>1&&x<3&&y>1&&y<3 || corner&&x>13&&x<15&&y>1&&y<3 || corner&&x>1&&x<3&&y>13&&y<15;
    const fill = corner ? (onEdge||inner) : rnd()>0.52;
    if(fill)cells.push(<rect key={`${x}-${y}`} x={x*10} y={y*10} width="9" height="9" rx="1.5" fill={t.ink}/>);
  }
  return <svg viewBox="0 0 170 170" style={{width:170,height:170,background:t.panel2,borderRadius:10,padding:8,border:`1px solid ${t.line}`}}>{cells}</svg>;
}
