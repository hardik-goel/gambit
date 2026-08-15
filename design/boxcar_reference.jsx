import React, { useState, useMemo } from "react";

/* ============================================================
   BOXCAR — full-feature rail game (TtR-style mechanics, original maps)
   3 maps · tunnels · ferries · double routes · stations · long tickets
   Hot-seat 2–5 players. Online multiplayer ships via the production build.
   ============================================================ */

/* route tuple: [a, b, len, color, flag]  flag: "t"=tunnel, "f1"/"f2"=ferry(min locos) */
const MAPS = {
  continental: {
    name:"Continental", tag:"Europe · 33 cities · tunnels, ferries & stations",
    stations:true,
    cities:{
      lisbon:["Lisbon",48,540], madrid:["Madrid",120,492], barcelona:["Barcelona",196,478],
      pamplona:["Pamplona",158,424], brest:["Brest",172,298], paris:["Paris",262,322],
      marseille:["Marseille",302,452], london:["London",256,220], edinburgh:["Edinburgh",236,110],
      amsterdam:["Amsterdam",342,226], brussels:["Brussels",318,278], frankfurt:["Frankfurt",398,288],
      berlin:["Berlin",478,236], munich:["Munich",438,352], zurich:["Zurich",384,388],
      venice:["Venice",448,432], rome:["Rome",456,516], palermo:["Palermo",472,614],
      prague:["Prague",496,300], vienna:["Vienna",528,362], budapest:["Budapest",572,396],
      zagreb:["Zagreb",524,446], warsaw:["Warsaw",588,258], copenhagen:["Copenhagen",474,156],
      stockholm:["Stockholm",548,76], riga:["Riga",632,140], kyiv:["Kyiv",730,296],
      moscow:["Moscow",824,196], bucharest:["Bucharest",708,452], sofia:["Sofia",648,504],
      athens:["Athens",648,616], istanbul:["Istanbul",742,546], stpetersburg:["St. Petersburg",690,84],
    },
    routes:[
      ["lisbon","madrid",3,"purple"],["madrid","barcelona",2,"yellow"],["madrid","pamplona",3,"black"],
      ["barcelona","pamplona",2,"gray"],["barcelona","marseille",4,"gray"],["pamplona","paris",4,"blue"],
      ["brest","paris",3,"black"],["brest","london",3,"gray","f1"],["paris","london",2,"gray","f1"],
      ["paris","brussels",2,"red"],["paris","frankfurt",4,"white"],["paris","frankfurt",4,"orange"],
      ["paris","marseille",4,"yellow"],["marseille","zurich",3,"purple","t"],["marseille","rome",4,"gray"],
      ["london","edinburgh",4,"orange"],["london","edinburgh",4,"black"],["london","amsterdam",2,"gray","f1"],
      ["brussels","amsterdam",1,"gray"],["brussels","frankfurt",2,"blue"],["amsterdam","frankfurt",2,"white"],
      ["amsterdam","copenhagen",3,"gray","f1"],["frankfurt","berlin",3,"red"],["frankfurt","munich",2,"purple"],
      ["frankfurt","prague",2,"orange"],["zurich","munich",2,"yellow","t"],["zurich","venice",2,"green","t"],
      ["munich","venice",2,"blue"],["munich","vienna",3,"orange"],["venice","rome",2,"black"],
      ["venice","zagreb",2,"gray"],["rome","palermo",3,"gray","f1"],["palermo","athens",4,"gray","f2"],
      ["berlin","prague",2,"green"],["prague","vienna",2,"purple"],["prague","warsaw",3,"gray"],
      ["berlin","warsaw",4,"yellow"],["berlin","copenhagen",3,"gray","f1"],["copenhagen","stockholm",3,"white"],
      ["stockholm","riga",3,"gray","f1"],["riga","warsaw",4,"blue"],["riga","moscow",5,"orange"],
      ["warsaw","kyiv",4,"red"],["warsaw","vienna",4,"white"],["kyiv","moscow",4,"white"],
      ["kyiv","bucharest",3,"black"],["vienna","budapest",1,"red"],["vienna","budapest",1,"white"],
      ["budapest","zagreb",2,"orange"],["budapest","bucharest",4,"green"],["zagreb","sofia",3,"gray"],
      ["sofia","bucharest",2,"gray"],["sofia","athens",3,"purple"],["sofia","istanbul",3,"yellow"],
      ["bucharest","istanbul",3,"gray"],["istanbul","athens",2,"gray","f1"],
      ["stockholm","stpetersburg",8,"green","t"],["stpetersburg","riga",4,"gray"],["stpetersburg","moscow",4,"gray"],
    ],
    tickets:[
      ["madrid","london",9],["lisbon","paris",10],["barcelona","berlin",13],["paris","vienna",8],
      ["brest","venice",11],["london","berlin",7],["edinburgh","paris",6],["amsterdam","vienna",6],
      ["copenhagen","rome",11],["stockholm","warsaw",7],["berlin","bucharest",9],["warsaw","istanbul",10],
      ["moscow","vienna",12],["kyiv","athens",8],["riga","berlin",8],["zurich","budapest",6],
      ["rome","istanbul",9],["madrid","athens",17,1],["lisbon","warsaw",19,1],["edinburgh","athens",20,1],
      ["paris","moscow",17,1],["palermo","vienna",10],["marseille","warsaw",12],["copenhagen","kyiv",11],
      ["stpetersburg","berlin",12],["stpetersburg","athens",16,1],["stpetersburg","zurich",17],["moscow","istanbul",10],
    ],
  },

  frontier: {
    name:"Frontier", tag:"North America · 33 cities · double-track corridors",
    stations:false,
    cities:{
      seattle:["Seattle",88,110], portland:["Portland",70,180], sanfrancisco:["San Francisco",58,345],
      losangeles:["Los Angeles",105,450], phoenix:["Phoenix",195,465], saltlake:["Salt Lake City",215,300],
      helena:["Helena",285,175], calgary:["Calgary",230,70], winnipeg:["Winnipeg",410,80],
      duluth:["Duluth",480,180], denver:["Denver",305,335], santafe:["Santa Fe",285,430],
      elpaso:["El Paso",285,525], dallas:["Dallas",435,495], houston:["Houston",480,565],
      oklahoma:["Oklahoma City",425,415], kansascity:["Kansas City",465,330], omaha:["Omaha",455,255],
      chicago:["Chicago",565,235], stlouis:["St. Louis",535,330], nashville:["Nashville",605,385],
      atlanta:["Atlanta",645,440], neworleans:["New Orleans",565,560], miami:["Miami",735,615],
      charleston:["Charleston",720,465], raleigh:["Raleigh",715,395], washington:["Washington",745,320],
      newyork:["New York",765,245], boston:["Boston",800,175], pittsburgh:["Pittsburgh",675,285],
      toronto:["Toronto",665,175], montreal:["Montreal",745,105], littlerock:["Little Rock",505,430],
    },
    routes:[
      ["seattle","portland",1,"gray"],["seattle","portland",1,"gray"],["seattle","calgary",4,"gray"],
      ["seattle","helena",6,"yellow"],["portland","sanfrancisco",5,"green"],["portland","sanfrancisco",5,"purple"],
      ["portland","saltlake",6,"blue"],["sanfrancisco","saltlake",5,"orange"],["sanfrancisco","saltlake",5,"white"],
      ["sanfrancisco","losangeles",3,"yellow"],["sanfrancisco","losangeles",3,"purple"],
      ["losangeles","phoenix",3,"gray"],["losangeles","elpaso",6,"black"],["phoenix","santafe",3,"gray"],
      ["phoenix","denver",5,"white"],["saltlake","denver",3,"red"],["saltlake","denver",3,"yellow"],
      ["saltlake","helena",3,"purple"],["calgary","helena",4,"gray"],["calgary","winnipeg",6,"white"],
      ["helena","winnipeg",4,"blue"],["helena","duluth",6,"orange"],["helena","denver",4,"green"],
      ["helena","omaha",5,"red"],["winnipeg","duluth",4,"black"],["duluth","omaha",2,"gray"],
      ["duluth","omaha",2,"gray"],["duluth","chicago",3,"red"],["duluth","toronto",6,"purple"],
      ["denver","santafe",2,"gray"],["denver","kansascity",4,"black"],["denver","kansascity",4,"orange"],
      ["denver","omaha",4,"purple"],["denver","oklahoma",4,"red"],["santafe","elpaso",2,"gray"],
      ["santafe","oklahoma",3,"blue"],["elpaso","dallas",4,"red"],["elpaso","houston",6,"green"],
      ["dallas","houston",1,"gray"],["dallas","houston",1,"gray"],["dallas","oklahoma",2,"gray"],
      ["dallas","oklahoma",2,"gray"],["dallas","littlerock",2,"gray"],["houston","neworleans",2,"gray"],
      ["oklahoma","kansascity",2,"gray"],["oklahoma","kansascity",2,"gray"],["oklahoma","littlerock",2,"gray"],
      ["kansascity","omaha",1,"gray"],["kansascity","omaha",1,"gray"],["kansascity","stlouis",2,"blue"],
      ["kansascity","stlouis",2,"purple"],["omaha","chicago",4,"blue"],["chicago","stlouis",2,"green"],
      ["chicago","stlouis",2,"white"],["chicago","pittsburgh",3,"orange"],["chicago","pittsburgh",3,"black"],
      ["chicago","toronto",4,"white"],["stlouis","littlerock",2,"gray"],["stlouis","nashville",2,"gray"],
      ["stlouis","pittsburgh",5,"green"],["littlerock","neworleans",3,"green"],["littlerock","nashville",3,"white"],
      ["neworleans","atlanta",4,"yellow"],["neworleans","atlanta",4,"orange"],["neworleans","miami",6,"red"],
      ["nashville","atlanta",1,"gray"],["nashville","pittsburgh",4,"yellow"],["nashville","raleigh",3,"black"],
      ["atlanta","charleston",2,"gray"],["atlanta","raleigh",2,"gray"],["atlanta","raleigh",2,"gray"],
      ["atlanta","miami",5,"blue"],["charleston","miami",4,"purple"],["charleston","raleigh",2,"gray"],
      ["raleigh","washington",2,"gray"],["raleigh","washington",2,"gray"],["raleigh","pittsburgh",2,"gray"],
      ["washington","pittsburgh",2,"gray"],["washington","newyork",2,"orange"],["washington","newyork",2,"black"],
      ["pittsburgh","newyork",2,"white"],["pittsburgh","newyork",2,"green"],["pittsburgh","toronto",2,"gray"],
      ["toronto","montreal",3,"gray"],["montreal","newyork",3,"blue"],["montreal","boston",2,"gray"],
      ["montreal","boston",2,"gray"],["newyork","boston",2,"yellow"],["newyork","boston",2,"red"],
    ],
    tickets:[
      ["losangeles","newyork",20,1],["losangeles","chicago",15],["seattle","newyork",20,1],
      ["sanfrancisco","atlanta",17,1],["calgary","phoenix",13,1],["montreal","neworleans",13,1],
      ["winnipeg","houston",12,1],["denver","pittsburgh",11],["duluth","elpaso",10],
      ["chicago","neworleans",7],["kansascity","houston",5],["boston","miami",12],
      ["toronto","miami",10],["portland","nashville",17],["helena","stlouis",8],
      ["saltlake","dallas",9],["seattle","losangeles",9],["montreal","atlanta",9],
      ["newyork","atlanta",6],["winnipeg","littlerock",11],["denver","elpaso",4],
      ["chicago","santafe",9],["calgary","saltlake",7],["portland","phoenix",11],
    ],
  },

  subcontinent: {
    name:"Subcontinent", tag:"India · 26 cities · Himalayan tunnels & stations",
    stations:true,
    cities:{
      srinagar:["Srinagar",330,55], amritsar:["Amritsar",300,135], chandigarh:["Chandigarh",375,145],
      delhi:["Delhi",390,215], jaipur:["Jaipur",315,275], jodhpur:["Jodhpur",240,300],
      ahmedabad:["Ahmedabad",215,380], surat:["Surat",240,445], mumbai:["Mumbai",255,510],
      pune:["Pune",300,540], goa:["Goa",315,595], kochi:["Kochi",360,650],
      madurai:["Madurai",455,645], bengaluru:["Bengaluru",430,585], chennai:["Chennai",525,585],
      hyderabad:["Hyderabad",445,485], nagpur:["Nagpur",450,385], bhopal:["Bhopal",385,335],
      indore:["Indore",320,355], lucknow:["Lucknow",490,235], varanasi:["Varanasi",555,275],
      patna:["Patna",615,265], kolkata:["Kolkata",675,330], bhubaneswar:["Bhubaneswar",625,420],
      visakhapatnam:["Visakhapatnam",560,470], guwahati:["Guwahati",790,235],
    },
    routes:[
      ["srinagar","amritsar",2,"gray","t"],["srinagar","chandigarh",3,"gray","t"],["amritsar","chandigarh",1,"gray"],
      ["amritsar","delhi",3,"orange"],["chandigarh","delhi",2,"blue"],["chandigarh","delhi",2,"red"],
      ["delhi","jaipur",2,"green"],["delhi","jaipur",2,"yellow"],["delhi","lucknow",3,"red"],
      ["delhi","lucknow",3,"white"],["jaipur","jodhpur",2,"gray"],["jaipur","bhopal",3,"purple"],
      ["jodhpur","ahmedabad",3,"orange"],["ahmedabad","indore",3,"gray"],["indore","bhopal",1,"gray"],
      ["ahmedabad","surat",2,"yellow"],["surat","mumbai",2,"blue"],["surat","mumbai",2,"black"],
      ["mumbai","pune",1,"gray"],["mumbai","pune",1,"gray"],["pune","goa",3,"green"],
      ["pune","hyderabad",4,"black"],["goa","bengaluru",4,"purple"],["goa","kochi",4,"gray","f1"],
      ["kochi","madurai",2,"gray"],["madurai","bengaluru",3,"yellow"],["madurai","chennai",4,"orange"],
      ["bengaluru","chennai",2,"red"],["bengaluru","chennai",2,"white"],["bengaluru","hyderabad",4,"blue"],
      ["chennai","hyderabad",4,"green"],["chennai","visakhapatnam",5,"purple"],["hyderabad","nagpur",3,"white"],
      ["hyderabad","visakhapatnam",4,"yellow"],["nagpur","bhopal",2,"gray"],["nagpur","bhubaneswar",5,"red"],
      ["nagpur","varanasi",4,"green"],["bhopal","lucknow",4,"black"],["lucknow","varanasi",2,"gray"],
      ["lucknow","varanasi",2,"gray"],["varanasi","patna",2,"orange"],["patna","kolkata",3,"blue"],
      ["patna","guwahati",6,"gray","t"],["kolkata","guwahati",5,"gray","t"],["kolkata","bhubaneswar",3,"green"],
      ["bhubaneswar","visakhapatnam",3,"orange"],["indore","surat",3,"white"],
    ],
    tickets:[
      ["delhi","mumbai",11],["delhi","kolkata",10],["mumbai","chennai",9],["delhi","chennai",14,1],
      ["srinagar","kochi",24,1],["amritsar","kolkata",13,1],["jaipur","hyderabad",8],
      ["ahmedabad","bengaluru",12],["mumbai","kolkata",15],["kolkata","chennai",11],
      ["delhi","bengaluru",14],["guwahati","mumbai",20,1],["lucknow","hyderabad",9],
      ["jodhpur","varanasi",9],["surat","goa",6],["patna","bhubaneswar",6],
      ["chandigarh","bhopal",7],["chennai","guwahati",16,1],["kochi","hyderabad",9],["nagpur","kolkata",8],
    ],
  },
};

const CARD_COLORS = ["red","orange","yellow","green","blue","purple","black","white"];
const HEX = {red:"#c8402f",orange:"#d98632",yellow:"#d9b93b",green:"#4d8a52",blue:"#3c6ea8",
  purple:"#8a5ba6",black:"#3a3632",white:"#efeadb",gray:"#a89f8c",loco:"#6b5b73"};
const PLAYER_COLORS = [["Crimson","#b0342a"],["Cobalt","#2f5f9e"],["Forest","#3d7a45"],["Saffron","#c9a227"],["Onyx","#2e2a26"]];
const ROUTE_PTS = {1:1,2:2,3:4,4:7,5:10,6:15,8:21};

/* ---------- helpers ---------- */
const shuffle = a => { const x=[...a]; for(let i=x.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[x[i],x[j]]=[x[j],x[i]];} return x; };
const emptyHand = () => Object.fromEntries([...CARD_COLORS,"loco"].map(c=>[c,0]));
const handSize = h => Object.values(h).reduce((s,v)=>s+v,0);
const makeTrainDeck = () => { const d=[]; CARD_COLORS.forEach(c=>{for(let i=0;i<12;i++)d.push(c);}); for(let i=0;i<14;i++)d.push("loco"); return shuffle(d); };

function buildMap(mapId){
  const m=MAPS[mapId];
  const R=m.routes.map((r,i)=>({id:i,a:r[0],b:r[1],len:r[2],color:r[3],
    tunnel:r[4]==="t", ferry:(r[4]&&r[4][0]==="f")?+r[4][1]:0, twin:null, side:0}));
  const seen={};
  R.forEach(r=>{ const k=[r.a,r.b].sort().join("|");
    if(seen[k]!==undefined){ const t=R[seen[k]]; r.twin=t.id; t.twin=r.id; t.side=-1; r.side=1; }
    else seen[k]=r.id; });
  const T=m.tickets.map((t,i)=>({id:i,a:t[0],b:t[1],pts:t[2],long:!!t[3]}));
  return {m,R,T};
}
function connected(edges,from,to){
  const adj={}; edges.forEach(e=>{(adj[e.a]=adj[e.a]||[]).push(e.b);(adj[e.b]=adj[e.b]||[]).push(e.a);});
  const seen=new Set([from]); const q=[from];
  while(q.length){const c=q.shift(); if(c===to)return true; (adj[c]||[]).forEach(n=>{if(!seen.has(n)){seen.add(n);q.push(n);}});}
  return false;
}
function longestPath(edges){
  let best=0;
  const dfs=(city,used,len)=>{ best=Math.max(best,len);
    edges.forEach((e,i)=>{ if(used.has(i))return;
      if(e.a===city){used.add(i);dfs(e.b,used,len+e.len);used.delete(i);}
      else if(e.b===city){used.add(i);dfs(e.a,used,len+e.len);used.delete(i);} }); };
  const cs=new Set(); edges.forEach(e=>{cs.add(e.a);cs.add(e.b);});
  cs.forEach(c=>dfs(c,new Set(),0));
  return best;
}

/* ---------- root ---------- */
export default function App(){
  const [screen,setScreen]=useState("setup");
  const [G,setG]=useState(null);
  const [draftIdx,setDraftIdx]=useState(0);
  const [pending,setPending]=useState(null);
  const [picked,setPicked]=useState([]);
  const [placing,setPlacing]=useState(false);
  const [toast,setToast]=useState(null);
  const say = m => { setToast(m); setTimeout(()=>setToast(null),2800); };

  const [names,setNames]=useState(["",""]);
  const [mapId,setMapId]=useState("continental");
  const [trainCount,setTrainCount]=useState(45);
  const [useStations,setUseStations]=useState(true);
  const [globetrotter,setGlobetrotter]=useState(false);

  const MAP = G ? G.MAP : null;

  /* ----- start ----- */
  function startGame(){
    const ps=names.map(s=>s.trim()).filter(Boolean);
    if(ps.length<2){say("Need at least 2 players");return;}
    const built=buildMap(mapId);
    let deck=makeTrainDeck();
    const stationsOn = built.m.stations && useStations;
    const players=ps.map((name,i)=>{
      const hand=emptyHand(); for(let k=0;k<4;k++)hand[deck.pop()]++;
      return {name,color:PLAYER_COLORS[i][1],hand,trains:trainCount,score:0,tickets:[],routes:[],
        stationsLeft:stationsOn?3:0,stationCities:[]};
    });
    let faceUp=[]; for(let k=0;k<5;k++)faceUp.push(deck.pop());
    const longs=shuffle(built.T.filter(t=>t.long).map(t=>t.id));
    const regs=shuffle(built.T.filter(t=>!t.long).map(t=>t.id));
    setG({MAP:built, mapId, players, deck, discard:[], faceUp,
      draftLongs:longs, draftRegs:regs, ticketDeck:[],
      cur:0, draws:0, finalTurns:null,
      settings:{stationsOn, globetrotter, trainCount}});
    setDraftIdx(0); setPicked([]);
    setScreen("ticketDraft");
  }

  /* ----- initial draft: 1 long + 3 regular, keep >= 2 ----- */
  const draftOffer = useMemo(()=>{
    if(screen!=="ticketDraft"||!G)return [];
    return [G.draftLongs[draftIdx], ...G.draftRegs.slice(draftIdx*3,draftIdx*3+3)].filter(x=>x!==undefined);
  },[screen,G,draftIdx]);

  function confirmDraft(){
    if(picked.length<2){say("Keep at least 2 tickets");return;}
    const isLast = draftIdx===G.players.length-1;
    setG(g=>{
      const players=[...g.players];
      players[draftIdx]={...players[draftIdx],tickets:[...picked]};
      let ticketDeck=g.ticketDeck;
      if(isLast){
        const kept=new Set(players.flatMap(p=>p.tickets));
        const consumedRegs=g.players.length*3;
        ticketDeck=shuffle([
          ...g.draftRegs.slice(consumedRegs),
          ...g.draftRegs.slice(0,consumedRegs).filter(t=>!kept.has(t)),
        ]); // rejected longs are removed from the game
      }
      return {...g,players,ticketDeck};
    });
    setPicked([]);
    if(!isLast) setDraftIdx(draftIdx+1);
    else setScreen("handoff");
  }

  /* ----- deck ----- */
  function drawOne(deck,discard){
    if(deck.length===0 && discard.length>0){ deck=shuffle(discard); discard=[]; }
    if(deck.length===0) return {card:null,deck,discard};
    return {card:deck[deck.length-1],deck:deck.slice(0,-1),discard};
  }
  function refillFaceUp(g){
    let {faceUp,deck,discard}=g; let guard=0;
    const fill=()=>{ while(faceUp.length<5){ const r=drawOne(deck,discard); if(!r.card)break; faceUp=[...faceUp,r.card]; deck=r.deck; discard=r.discard; } };
    fill();
    while(faceUp.filter(c=>c==="loco").length>=3 && (deck.length+discard.length)>=3 && guard<4){
      discard=[...discard,...faceUp]; faceUp=[]; fill(); guard++;
    }
    return {...g,faceUp,deck,discard};
  }

  /* ----- turn flow ----- */
  function endTurn(g){
    let finalTurns=g.finalTurns;
    const p=g.players[g.cur];
    if(finalTurns===null && p.trains<=2){ finalTurns=g.players.length; say(`${p.name} is nearly out of cars — final round!`); }
    else if(finalTurns!==null){ finalTurns-=1;
      if(finalTurns<=0){ setG({...g,finalTurns}); setPlacing(false); setScreen("gameover"); return; } }
    setG({...g,cur:(g.cur+1)%g.players.length,draws:0,finalTurns});
    setPlacing(false);
    setScreen("handoff");
  }

  function takeFaceUp(i){
    const card=G.faceUp[i];
    if(card==="loco" && G.draws>0){say("A face-up locomotive can only be your first pick");return;}
    let g={...G};
    const players=[...g.players]; const p={...players[g.cur],hand:{...players[g.cur].hand}};
    p.hand[card]++; players[g.cur]=p;
    g=refillFaceUp({...g,players,faceUp:g.faceUp.filter((_,j)=>j!==i)});
    if(card==="loco"||g.draws===1) endTurn({...g,draws:0});
    else setG({...g,draws:1});
  }
  function takeBlind(){
    const r=drawOne(G.deck,G.discard);
    if(!r.card){say("No cards left to draw");return;}
    let g={...G,deck:r.deck,discard:r.discard};
    const players=[...g.players]; const p={...players[g.cur],hand:{...players[g.cur].hand}};
    p.hand[r.card]++; players[g.cur]=p; g={...g,players};
    if(g.draws===1) endTurn({...g,draws:0}); else setG({...g,draws:1});
  }

  /* ----- claiming ----- */
  const routeOwner = id => { for(let i=0;i<G.players.length;i++) if(G.players[i].routes.includes(id)) return i; return null; };

  function paymentOptions(route,hand){
    const opts=[]; const need=route.len; const ferry=route.ferry||0;
    const colors= route.color==="gray" ? CARD_COLORS : [route.color];
    colors.forEach(c=>{
      const colorUse=Math.min(hand[c],need-ferry);
      const locoUse=need-colorUse;
      if((colorUse>0||need===ferry) && locoUse<=hand.loco && locoUse>=ferry) opts.push({c,colorUse,locoUse});
    });
    if(hand.loco>=need && !opts.some(o=>o.colorUse===0)) opts.push({c:"loco",colorUse:0,locoUse:need});
    return opts;
  }

  function tryClaim(route){
    const p=G.players[G.cur];
    if(G.draws>0){say("Finish drawing your second card first");return;}
    if(placing){say("You're placing a station — tap a city, or cancel");return;}
    if(routeOwner(route.id)!==null){say("Route already claimed");return;}
    if(route.twin!==null){
      const tw=routeOwner(route.twin);
      if(tw!==null){
        if(tw===G.cur){say("You can't claim both tracks of a double route");return;}
        if(G.players.length<=3){say("Second track is closed in 2–3 player games");return;}
      }
    }
    if(p.trains<route.len){say("Not enough train cars");return;}
    const opts=paymentOptions(route,p.hand);
    if(opts.length===0){say("You can't afford this route yet");return;}
    setPending({type:"claim",route,opts});
  }

  function commitClaim(route,colorUse,locoUse,c,extraToDiscard,deckOv,discOv){
    let g={...G};
    if(deckOv)g={...g,deck:deckOv,discard:discOv};
    const players=[...g.players]; const p={...players[g.cur],hand:{...players[g.cur].hand},routes:[...players[g.cur].routes]};
    const discard=[...g.discard,...(extraToDiscard||[])];
    if(colorUse>0){ p.hand[c]-=colorUse; for(let i=0;i<colorUse;i++)discard.push(c); }
    p.hand.loco-=locoUse; for(let i=0;i<locoUse;i++)discard.push("loco");
    p.trains-=route.len; p.score+=ROUTE_PTS[route.len]; p.routes.push(route.id);
    players[g.cur]=p;
    setPending(null);
    say(`${p.name} claimed ${MAP.m.cities[route.a][0]}–${MAP.m.cities[route.b][0]} (+${ROUTE_PTS[route.len]})`);
    endTurn({...g,players,discard});
  }

  function doClaim(opt){
    const route=pending.route;
    if(!route.tunnel){ commitClaim(route,opt.colorUse,opt.locoUse,opt.c); return; }
    // TUNNEL: reveal top 3 cards
    let deck=G.deck, discard=G.discard, revealed=[];
    for(let i=0;i<3;i++){ const r=drawOne(deck,discard); if(!r.card)break; revealed.push(r.card); deck=r.deck; discard=r.discard; }
    const matchColor = opt.c;
    const extra = revealed.filter(c => c==="loco" || (matchColor!=="loco" && c===matchColor)).length;
    if(extra===0){ commitClaim(route,opt.colorUse,opt.locoUse,opt.c,revealed,deck,discard); return; }
    const hand=G.players[G.cur].hand;
    const afford = matchColor==="loco"
      ? (hand.loco-opt.locoUse)>=extra
      : ((hand[matchColor]-opt.colorUse)+(hand.loco-opt.locoUse))>=extra;
    setPending({type:"tunnel",route,opt,revealed,extra,afford,deck,discard});
  }

  function tunnelPay(){
    const {route,opt,revealed,extra,deck,discard}=pending;
    const hand=G.players[G.cur].hand;
    let exColor=0, exLoco=0;
    if(opt.c==="loco"){ exLoco=extra; }
    else { exColor=Math.min(hand[opt.c]-opt.colorUse,extra); exLoco=extra-exColor; }
    commitClaim(route,opt.colorUse+exColor,opt.locoUse+exLoco,opt.c,revealed,deck,discard);
  }
  function tunnelAbandon(){
    const {revealed,deck,discard}=pending;
    const g={...G,deck,discard:[...discard,...revealed]};
    setPending(null);
    say("Tunnel blocked — cards returned, turn over");
    endTurn(g);
  }

  /* ----- tickets mid-game ----- */
  function drawTickets(){
    if(G.draws>0){say("Finish drawing cards first");return;}
    const offer=G.ticketDeck.slice(0,3);
    if(offer.length===0){say("No destination tickets left");return;}
    setPicked([]); setPending({type:"tickets",offer});
  }
  function confirmTickets(){
    if(picked.length<1){say("Keep at least 1 ticket");return;}
    let g={...G};
    const players=[...g.players]; const p={...players[g.cur],tickets:[...players[g.cur].tickets,...picked]};
    players[g.cur]=p;
    const rejected=pending.offer.filter(t=>!picked.includes(t));
    g={...g,players,ticketDeck:[...g.ticketDeck.slice(pending.offer.length),...rejected]};
    setPending(null); setPicked([]);
    endTurn(g);
  }

  /* ----- stations ----- */
  function stationCost(p){ return 3 - p.stationsLeft + 1; } // 1st costs 1, 2nd 2, 3rd 3
  function tryStation(cityId){
    const p=G.players[G.cur];
    const taken=G.players.some(pl=>pl.stationCities.includes(cityId));
    if(taken){say("That city already has a station");return;}
    const k=stationCost(p);
    const opts=[];
    CARD_COLORS.forEach(c=>{
      const colorUse=Math.min(p.hand[c],k); const locoUse=k-colorUse;
      if(colorUse>0 && locoUse<=p.hand.loco) opts.push({c,colorUse,locoUse});
    });
    if(p.hand.loco>=k) opts.push({c:"loco",colorUse:0,locoUse:k});
    if(opts.length===0){say(`Need ${k} cards of one color`);return;}
    setPending({type:"stationPay",cityId,cost:k,opts});
  }
  function doStation(opt){
    const {cityId}=pending;
    let g={...G};
    const players=[...g.players];
    const p={...players[g.cur],hand:{...players[g.cur].hand},stationCities:[...players[g.cur].stationCities]};
    const discard=[...g.discard];
    if(opt.colorUse>0){ p.hand[opt.c]-=opt.colorUse; for(let i=0;i<opt.colorUse;i++)discard.push(opt.c); }
    p.hand.loco-=opt.locoUse; for(let i=0;i<opt.locoUse;i++)discard.push("loco");
    p.stationsLeft-=1; p.stationCities.push(cityId);
    players[g.cur]=p;
    setPending(null); setPlacing(false);
    say(`${p.name} built a station in ${MAP.m.cities[cityId][0]}`);
    endTurn({...g,players,discard});
  }

  /* ----- final scoring (with station borrowing optimizer) ----- */
  const results = useMemo(()=>{
    if(screen!=="gameover"||!G)return null;
    const {R,T}=MAP;
    const rows=G.players.map((p,pi)=>{
      const own=R.filter(r=>p.routes.includes(r.id));
      const cand=p.stationCities.map(city=>{
        const adj=R.filter(r=>(r.a===city||r.b===city)&&routeOwner(r.id)!==null&&routeOwner(r.id)!==pi);
        return [null,...adj];
      });
      let best=null;
      const evalCombo=(borrowed)=>{
        const edges=[...own,...borrowed.filter(Boolean)];
        let tPlus=0,tMinus=0,done=0;
        const tix=p.tickets.map(tid=>{const t=T[tid];const ok=connected(edges,t.a,t.b);
          if(ok){tPlus+=t.pts;done++;}else tMinus+=t.pts; return {...t,ok};});
        const net=tPlus-tMinus;
        if(!best||net>best.net) best={net,tPlus,tMinus,done,tix};
      };
      const rec=(i,acc)=>{ if(i===cand.length){evalCombo(acc);return;} cand[i].forEach(c=>rec(i+1,[...acc,c])); };
      rec(0,[]);
      const stationBonus=G.settings.stationsOn?p.stationsLeft*4:0;
      return {p,routePts:p.score,...best,longest:longestPath(own),stationBonus};
    });
    const maxLong=Math.max(...rows.map(r=>r.longest));
    rows.forEach(r=>{ r.longBonus=(r.longest===maxLong&&maxLong>0)?10:0; });
    if(G.settings.globetrotter){
      const maxDone=Math.max(...rows.map(r=>r.done));
      rows.forEach(r=>{ r.globe=(r.done===maxDone&&maxDone>0)?10:0; });
    } else rows.forEach(r=>{r.globe=0;});
    rows.forEach(r=>{ r.total=r.routePts+r.tPlus-r.tMinus+r.longBonus+r.stationBonus+r.globe; });
    return rows.sort((a,b)=>b.total-a.total);
  },[screen,G]);

  /* ================= UI ================= */
  const S={
    page:{minHeight:"100vh",background:"#14202e",color:"#e8e0cd",fontFamily:"Georgia,'Times New Roman',serif",padding:12},
    panel:{background:"#1d2c3d",border:"1px solid #3a4a5c",borderRadius:10,padding:14},
    btn:{background:"#b08d3f",color:"#1a1408",border:"none",borderRadius:6,padding:"9px 16px",fontFamily:"inherit",fontSize:15,fontWeight:700,cursor:"pointer",letterSpacing:.5},
    btn2:{background:"transparent",color:"#d8c58a",border:"1px solid #b08d3f",borderRadius:6,padding:"8px 14px",fontFamily:"inherit",fontSize:14,cursor:"pointer"},
    h:{fontVariant:"small-caps",letterSpacing:2,color:"#d8c58a",margin:"0 0 8px"},
  };
  const Card=({c,onClick,small})=>(
    <div onClick={onClick} style={{width:small?42:56,height:small?28:38,borderRadius:5,
      background:c==="loco"?`linear-gradient(135deg,${CARD_COLORS.map(x=>HEX[x]).join(",")})`:HEX[c],
      border:c==="white"?"1px solid #8a8570":"1px solid rgba(0,0,0,.35)",display:"flex",alignItems:"center",justifyContent:"center",
      cursor:onClick?"pointer":"default",boxShadow:"0 2px 4px rgba(0,0,0,.4)",fontSize:small?12:15}}>{c==="loco"?"🚂":""}</div>);
  const TicketRow=({t,done,selectable,sel,onToggle,cities})=>(
    <div onClick={onToggle} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"7px 10px",borderRadius:6,marginBottom:6,
      cursor:selectable?"pointer":"default",background:sel?"#3a4a2c":done?"#2c3d2c":"#26354a",
      border:sel?"1px solid #9ab35c":t.long?"1px solid #b08d3f":"1px solid #3a4a5c",fontSize:14}}>
      <span>{t.long&&"★ "}{cities[t.a][0]} → {cities[t.b][0]} {done&&"✓"}</span>
      <b style={{color:"#d8c58a"}}>{t.pts}</b>
    </div>);

  /* ---------- SETUP ---------- */
  if(screen==="setup"){
    const sel=MAPS[mapId];
    return (
      <div style={S.page}>
        <div style={{maxWidth:560,margin:"30px auto"}}>
          <div style={{textAlign:"center",marginBottom:20}}>
            <div style={{fontSize:13,letterSpacing:6,color:"#b08d3f"}}>THE TRANSCONTINENTAL RAIL COMPANY PRESENTS</div>
            <h1 style={{fontSize:52,margin:"6px 0",letterSpacing:4}}>BOXCAR</h1>
            <div style={{color:"#8fa3b8",fontSize:15}}>Claim routes · Complete tickets · Build the longest line</div>
          </div>
          <div style={{...S.panel,marginBottom:12}}>
            <h3 style={S.h}>Choose your map</h3>
            {Object.entries(MAPS).map(([id,m])=>(
              <div key={id} onClick={()=>{setMapId(id);setUseStations(m.stations);}}
                style={{padding:"10px 12px",borderRadius:8,marginBottom:8,cursor:"pointer",
                  background:mapId===id?"#2c3a4c":"transparent",border:mapId===id?"1px solid #b08d3f":"1px solid #3a4a5c"}}>
                <b style={{color:"#d8c58a"}}>{m.name}</b>
                <div style={{fontSize:13,color:"#8fa3b8"}}>{m.tag}</div>
              </div>))}
          </div>
          <div style={{...S.panel,marginBottom:12}}>
            <h3 style={S.h}>Passengers (2–5)</h3>
            {names.map((n,i)=>(
              <div key={i} style={{display:"flex",gap:8,marginBottom:8}}>
                <span style={{width:14,height:14,borderRadius:7,background:PLAYER_COLORS[i][1],marginTop:10,border:"1px solid #000"}}/>
                <input value={n} onChange={e=>{const x=[...names];x[i]=e.target.value;setNames(x);}}
                  placeholder={`Player ${i+1} name`} style={{flex:1,padding:9,borderRadius:6,border:"1px solid #3a4a5c",background:"#14202e",color:"#e8e0cd",fontFamily:"inherit",fontSize:15}}/>
                {names.length>2&&<button style={S.btn2} onClick={()=>setNames(names.filter((_,j)=>j!==i))}>✕</button>}
              </div>))}
            {names.length<5&&<button style={S.btn2} onClick={()=>setNames([...names,""])}>+ Add player</button>}
          </div>
          <div style={{...S.panel,marginBottom:14}}>
            <h3 style={S.h}>Options</h3>
            <div style={{display:"flex",gap:8,marginBottom:10,flexWrap:"wrap"}}>
              {[45,30,20].map(t=>(
                <button key={t} onClick={()=>setTrainCount(t)} style={{...S.btn2,background:trainCount===t?"#b08d3f":"transparent",color:trainCount===t?"#1a1408":"#d8c58a"}}>
                  {t} cars {t===45?"(full)":t===30?"(medium)":"(quick)"}</button>))}
            </div>
            {sel.stations&&(
              <label style={{display:"block",fontSize:14,marginBottom:6,cursor:"pointer"}}>
                <input type="checkbox" checked={useStations} onChange={e=>setUseStations(e.target.checked)}/> Stations (borrow one neighbouring route · +4 per unused)
              </label>)}
            <label style={{display:"block",fontSize:14,cursor:"pointer"}}>
              <input type="checkbox" checked={globetrotter} onChange={e=>setGlobetrotter(e.target.checked)}/> Globetrotter bonus (+10 for most completed tickets)
            </label>
          </div>
          <button style={{...S.btn,width:"100%",fontSize:17}} onClick={startGame}>ALL ABOARD</button>
          <p style={{color:"#5d7186",fontSize:12,textAlign:"center",marginTop:12}}>Hot-seat prototype: pass the device between turns. Online multiplayer ships in the production build.</p>
        </div>
        {toast&&<Toast msg={toast}/>}
      </div>);
  }

  /* ---------- DRAFT ---------- */
  if(screen==="ticketDraft"){
    const p=G.players[draftIdx];
    return (
      <div style={S.page}>
        <div style={{maxWidth:470,margin:"60px auto"}}>
          <div style={S.panel}>
            <h3 style={S.h}>{p.name} — choose destination tickets</h3>
            <p style={{fontSize:13,color:"#8fa3b8"}}>Keep at least 2. ★ is a long ticket — big reward, big risk. Failed tickets score negative.</p>
            {draftOffer.map(tid=>{const t=MAP.T[tid];return(
              <TicketRow key={tid} t={t} cities={MAP.m.cities} selectable sel={picked.includes(tid)}
                onToggle={()=>setPicked(picked.includes(tid)?picked.filter(x=>x!==tid):[...picked,tid])}/>);})}
            <button style={{...S.btn,width:"100%",marginTop:8}} onClick={confirmDraft}>Keep {picked.length} ticket{picked.length!==1&&"s"}</button>
          </div>
        </div>
        {toast&&<Toast msg={toast}/>}
      </div>);
  }

  /* ---------- HANDOFF ---------- */
  if(screen==="handoff"){
    const p=G.players[G.cur];
    return (
      <div style={S.page}>
        <div style={{maxWidth:420,margin:"120px auto",textAlign:"center"}}>
          <div style={S.panel}>
            <div style={{fontSize:13,letterSpacing:4,color:"#8fa3b8"}}>PASS THE DEVICE TO</div>
            <h1 style={{fontSize:38,margin:"10px 0",color:p.color==="#2e2a26"?"#cfc9bf":p.color}}>{p.name}</h1>
            <div style={{color:"#8fa3b8",marginBottom:16,fontSize:14}}>{p.trains} cars · {p.score} pts · {handSize(p.hand)} cards
              {G.settings.stationsOn&&<> · {p.stationsLeft} 🏠</>}
              {G.finalTurns!==null&&<div style={{color:"#d98632",marginTop:6}}>⚠ FINAL ROUND</div>}</div>
            <button style={{...S.btn,fontSize:17}} onClick={()=>setScreen("turn")}>Begin my turn</button>
          </div>
        </div>
      </div>);
  }

  /* ---------- GAME OVER ---------- */
  if(screen==="gameover") return (
    <div style={S.page}>
      <div style={{maxWidth:660,margin:"30px auto"}}>
        <h1 style={{textAlign:"center",letterSpacing:4,color:"#d8c58a"}}>END OF THE LINE — {MAP.m.name}</h1>
        {results.map((r,i)=>(
          <div key={i} style={{...S.panel,marginBottom:12,border:i===0?"2px solid #b08d3f":"1px solid #3a4a5c"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline"}}>
              <h2 style={{margin:0,color:r.p.color==="#2e2a26"?"#cfc9bf":r.p.color}}>{i===0&&"🏆 "}{r.p.name}</h2>
              <div style={{fontSize:30,fontWeight:700,color:"#d8c58a"}}>{r.total}</div>
            </div>
            <div style={{fontSize:14,color:"#8fa3b8",marginTop:4}}>
              Routes {r.routePts} · Tickets +{r.tPlus} / −{r.tMinus}
              {r.longBonus?` · Longest line +10 (${r.longest})`:` · Longest line ${r.longest}`}
              {r.stationBonus?` · Stations +${r.stationBonus}`:""}
              {r.globe?` · Globetrotter +10`:""}
            </div>
            <div style={{marginTop:8}}>{r.tix.map(t=>(
              <span key={t.id} style={{display:"inline-block",fontSize:12,padding:"3px 8px",borderRadius:4,marginRight:6,marginBottom:4,
                background:t.ok?"#2c3d2c":"#3d2c2c",color:t.ok?"#9ab35c":"#c88"}}>
                {t.long&&"★"}{MAP.m.cities[t.a][0]}→{MAP.m.cities[t.b][0]} {t.ok?`+${t.pts}`:`−${t.pts}`}</span>))}
            </div>
          </div>))}
        <button style={{...S.btn,width:"100%"}} onClick={()=>{setG(null);setScreen("setup");setNames(["",""]);}}>New game</button>
      </div>
    </div>);

  /* ---------- TURN ---------- */
  const me=G.players[G.cur];
  const myEdges=MAP.R.filter(r=>me.routes.includes(r.id));
  const stationTaken=cid=>G.players.findIndex(pl=>pl.stationCities.includes(cid));

  return (
    <div style={S.page}>
      <div style={{display:"flex",gap:12,flexWrap:"wrap",alignItems:"flex-start",maxWidth:1400,margin:"0 auto"}}>
        <div style={{flex:"1 1 640px",minWidth:340}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8,flexWrap:"wrap",gap:6}}>
            <div><span style={{fontSize:13,letterSpacing:3,color:"#8fa3b8"}}>NOW DEPARTING · </span>
              <b style={{color:me.color==="#2e2a26"?"#cfc9bf":me.color,fontSize:18}}>{me.name}</b>
              {G.finalTurns!==null&&<span style={{color:"#d98632",marginLeft:10,fontSize:13}}>FINAL ROUND</span>}</div>
            <div style={{fontSize:13,color:placing?"#d98632":"#8fa3b8"}}>
              {placing?"Tap a city to build your station":G.draws===1?"Draw one more card":"Draw 2 cards · claim a route · tickets · station"}</div>
          </div>

          <svg viewBox="0 0 900 680" style={{width:"100%",background:"linear-gradient(160deg,#e6dcc2,#d9cba6)",borderRadius:10,border:"3px solid #7a6234",boxShadow:"0 6px 24px rgba(0,0,0,.5)"}}>
            <text x="20" y="668" fontSize="11" fill="#7a6234" opacity=".7" fontStyle="italic">Boxcar · {MAP.m.name} network · ⛰ tunnel · ⛴ ferry</text>

            {MAP.R.map(r=>{
              const A=MAP.m.cities[r.a],B=MAP.m.cities[r.b];
              const dx=B[1]-A[1],dy=B[2]-A[2],dist=Math.hypot(dx,dy),ang=Math.atan2(dy,dx)*180/Math.PI;
              const ox=r.side*(-dy/dist)*6, oy=r.side*(dx/dist)*6;
              const owner=routeOwner(r.id);
              const segs=[]; const pad=13, usable=dist-2*pad, segLen=Math.max(usable/r.len-4,6);
              for(let i=0;i<r.len;i++){
                const t=(pad+i*(usable/r.len)+(usable/r.len)/2)/dist;
                const cx=A[1]+dx*t+ox, cy=A[2]+dy*t+oy;
                segs.push(<rect key={i} x={cx-segLen/2} y={cy-5} width={segLen} height={10} rx={2.5}
                  transform={`rotate(${ang} ${cx} ${cy})`}
                  fill={owner!==null?G.players[owner].color:(r.color==="gray"?"#cfc6ad":HEX[r.color])}
                  stroke={owner!==null?"#1a1408":r.tunnel?"#4a3319":"#6b5a35"} strokeWidth={owner!==null?1.6:r.tunnel?1.8:0.9}
                  strokeDasharray={r.tunnel&&owner===null?"3,2":"none"} opacity={owner!==null?1:.92}/>);
              }
              const mx=(A[1]+B[1])/2+ox,my=(A[2]+B[2])/2+oy;
              return (
                <g key={r.id} onClick={()=>tryClaim(r)} style={{cursor:"pointer"}}>
                  <line x1={A[1]+ox} y1={A[2]+oy} x2={B[1]+ox} y2={B[2]+oy} stroke="transparent" strokeWidth="16"/>
                  {segs}
                  {owner===null&&(r.ferry||r.tunnel)&&
                    <text x={mx} y={my-9} fontSize="11" textAnchor="middle" fill="#3c5f78">{r.tunnel?"⛰":`⛴${r.ferry}`}</text>}
                </g>);
            })}

            {Object.entries(MAP.m.cities).map(([id,c])=>{
              const st=stationTaken(id);
              return (
                <g key={id} onClick={()=>{if(placing)tryStation(id);}} style={{cursor:placing?"crosshair":"default"}}>
                  {placing&&<circle cx={c[1]} cy={c[2]} r="15" fill="#b08d3f" opacity=".25"/>}
                  <circle cx={c[1]} cy={c[2]} r="8" fill="#b08d3f" stroke="#5c4718" strokeWidth="2"/>
                  <circle cx={c[1]} cy={c[2]} r="3" fill="#5c4718"/>
                  {st>=0&&<rect x={c[1]+7} y={c[2]-16} width="10" height="10" transform={`rotate(45 ${c[1]+12} ${c[2]-11})`}
                    fill={G.players[st].color} stroke="#1a1408" strokeWidth="1.2"/>}
                  <text x={c[1]} y={c[2]-13} fontSize="12" textAnchor="middle" fill="#33270f" fontWeight="bold"
                    style={{paintOrder:"stroke",stroke:"#e6dcc2",strokeWidth:3}}>{c[0]}</text>
                </g>);
            })}
          </svg>
        </div>

        <div style={{flex:"0 1 330px",minWidth:300,display:"flex",flexDirection:"column",gap:12}}>
          <div style={S.panel}>
            <h3 style={S.h}>The Market</h3>
            <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
              {G.faceUp.map((c,i)=><Card key={i} c={c} onClick={()=>takeFaceUp(i)}/>)}
              <div onClick={takeBlind} style={{width:56,height:38,borderRadius:5,background:"#37475c",border:"1px dashed #7c8ea3",color:"#aebccb",
                display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,cursor:"pointer",textAlign:"center"}}>DECK<br/>{G.deck.length+G.discard.length}</div>
            </div>
            <button style={{...S.btn2,width:"100%",marginTop:10}} onClick={drawTickets}>Draw destination tickets ({G.ticketDeck.length} left)</button>
            {G.settings.stationsOn&&me.stationsLeft>0&&(
              <button style={{...S.btn2,width:"100%",marginTop:8,borderColor:placing?"#d98632":"#b08d3f",color:placing?"#d98632":"#d8c58a"}}
                onClick={()=>{ if(G.draws>0){say("Finish drawing cards first");return;} setPlacing(!placing); }}>
                {placing?"Cancel station placement":`Build station — costs ${stationCost(me)} card${stationCost(me)>1?"s":""} of one color`}
              </button>)}
          </div>

          <div style={S.panel}>
            <h3 style={S.h}>Your hand · {me.trains} cars{G.settings.stationsOn?` · ${me.stationsLeft} stations`:""}</h3>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {[...CARD_COLORS,"loco"].filter(c=>me.hand[c]>0).map(c=>(
                <div key={c} style={{textAlign:"center"}}>
                  <Card c={c} small/><div style={{fontSize:13,marginTop:2,color:"#d8c58a"}}>×{me.hand[c]}</div>
                </div>))}
              {handSize(me.hand)===0&&<span style={{color:"#5d7186",fontSize:13}}>No cards — draw from the market.</span>}
            </div>
            <h3 style={{...S.h,marginTop:12}}>Your tickets</h3>
            {me.tickets.map(tid=>{const t=MAP.T[tid];return <TicketRow key={tid} t={t} cities={MAP.m.cities} done={connected(myEdges,t.a,t.b)}/>;})}
          </div>

          <div style={S.panel}>
            <h3 style={S.h}>Standings</h3>
            {G.players.map((p,i)=>(
              <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"5px 8px",borderRadius:5,fontSize:14,
                background:i===G.cur?"#2c3a4c":"transparent"}}>
                <span><span style={{display:"inline-block",width:10,height:10,borderRadius:5,background:p.color,marginRight:8,border:"1px solid #000"}}/>{p.name}</span>
                <span style={{color:"#8fa3b8"}}>{p.score} pts · {p.trains} 🚃 · {handSize(p.hand)} 🂠{G.settings.stationsOn?` · ${p.stationsLeft} 🏠`:""}</span>
              </div>))}
          </div>
        </div>
      </div>

      {pending?.type==="claim"&&(
        <Modal onClose={()=>setPending(null)}>
          <h3 style={S.h}>Claim {MAP.m.cities[pending.route.a][0]} – {MAP.m.cities[pending.route.b][0]}</h3>
          <p style={{fontSize:13,color:"#8fa3b8"}}>Length {pending.route.len} · worth {ROUTE_PTS[pending.route.len]} pts
            {pending.route.ferry?` · ferry needs ${pending.route.ferry} 🚂`:""}
            {pending.route.tunnel?" · ⛰ tunnel: 3 cards will be revealed — matches cost extra":""}</p>
          {pending.opts.map((o,i)=>(
            <button key={i} style={{...S.btn2,width:"100%",marginBottom:8}} onClick={()=>doClaim(o)}>
              {o.colorUse>0&&<span>{o.colorUse} × <b style={{color:HEX[o.c]}}>{o.c}</b> </span>}
              {o.locoUse>0&&<span>{o.colorUse>0?"+ ":""}{o.locoUse} × 🚂</span>}
            </button>))}
        </Modal>)}

      {pending?.type==="tunnel"&&(
        <Modal onClose={null}>
          <h3 style={S.h}>⛰ Tunnel — revealed cards</h3>
          <div style={{display:"flex",gap:8,marginBottom:10}}>{pending.revealed.map((c,i)=><Card key={i} c={c}/>)}</div>
          <p style={{fontSize:14,color:"#8fa3b8"}}>{pending.extra} match{pending.extra>1?"es":""} — pay {pending.extra} extra {pending.opt.c==="loco"?"locomotive":pending.opt.c}/🚂 card{pending.extra>1?"s":""} to dig through.</p>
          {pending.afford&&<button style={{...S.btn,width:"100%",marginBottom:8}} onClick={tunnelPay}>Pay {pending.extra} extra & claim</button>}
          <button style={{...S.btn2,width:"100%"}} onClick={tunnelAbandon}>
            {pending.afford?"Abandon (turn ends)":"Can't pay — abandon (turn ends)"}</button>
        </Modal>)}

      {pending?.type==="stationPay"&&(
        <Modal onClose={()=>setPending(null)}>
          <h3 style={S.h}>Station in {MAP.m.cities[pending.cityId][0]}</h3>
          <p style={{fontSize:13,color:"#8fa3b8"}}>At scoring it lets you borrow ONE neighbouring route owned by an opponent. Cost: {pending.cost} card{pending.cost>1?"s":""} of one color.</p>
          {pending.opts.map((o,i)=>(
            <button key={i} style={{...S.btn2,width:"100%",marginBottom:8}} onClick={()=>doStation(o)}>
              {o.colorUse>0&&<span>{o.colorUse} × <b style={{color:HEX[o.c]}}>{o.c}</b> </span>}
              {o.locoUse>0&&<span>{o.colorUse>0?"+ ":""}{o.locoUse} × 🚂</span>}
            </button>))}
        </Modal>)}

      {pending?.type==="tickets"&&(
        <Modal onClose={null}>
          <h3 style={S.h}>New destination tickets — keep at least 1</h3>
          {pending.offer.map(tid=>{const t=MAP.T[tid];return(
            <TicketRow key={tid} t={t} cities={MAP.m.cities} selectable sel={picked.includes(tid)}
              onToggle={()=>setPicked(picked.includes(tid)?picked.filter(x=>x!==tid):[...picked,tid])}/>);})}
          <button style={{...S.btn,width:"100%",marginTop:6}} onClick={confirmTickets}>Keep {picked.length}</button>
        </Modal>)}

      {toast&&<Toast msg={toast}/>}
    </div>
  );
}

function Modal({children,onClose}){
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(8,14,22,.75)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:50}}
      onClick={onClose?()=>onClose():undefined}>
      <div style={{background:"#1d2c3d",border:"1px solid #3a4a5c",borderRadius:10,padding:20,width:380,maxWidth:"92vw",maxHeight:"85vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
        {children}
      </div>
    </div>);
}
function Toast({msg}){
  return <div style={{position:"fixed",bottom:20,left:"50%",transform:"translateX(-50%)",background:"#b08d3f",color:"#1a1408",
    padding:"10px 18px",borderRadius:8,fontWeight:700,zIndex:60,boxShadow:"0 4px 14px rgba(0,0,0,.5)",fontFamily:"Georgia,serif",maxWidth:"88vw",textAlign:"center"}}>{msg}</div>;
}
