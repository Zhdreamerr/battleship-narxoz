import {initializeApp} from "https://www.gstatic.com/firebasejs/10.4.0/firebase-app.js";
import {getAuth,GoogleAuthProvider,signInWithPopup,signOut,onAuthStateChanged} from "https://www.gstatic.com/firebasejs/10.4.0/firebase-auth.js";
import {getDatabase,ref,set,onValue,update,remove} from "https://www.gstatic.com/firebasejs/10.4.0/firebase-database.js";
import {getFirestore,doc,getDoc,setDoc,increment,collection,query,orderBy,limit,getDocs} from "https://www.gstatic.com/firebasejs/10.4.0/firebase-firestore.js";
const N=10,SIZES=[4,3,3,2,2,2,1,1,1,1],KEY='battleship_v1',L='АБВГДЕЖЗИК';
const $=id=>document.getElementById(id);
const rnd=n=>Math.floor(Math.random()*n);
const newBoard=()=>({ships:[],shots:Array(100).fill(0)});
const fresh=(level='medium')=>({phase:'setup',turn:'player',level,ai:{hits:[]},mark:{p:-1,c:-1},log:[],pl:{size:4,h:true},me:newBoard(),cpu:newBoard(),last:{p:'',c:''},winner:null,g:{shots:0,hits:0}});
let S=load()||fresh(),timer=null,fx=null;

function validBoard(b){
  return b&&Array.isArray(b.shots)&&b.shots.length===100&&Array.isArray(b.ships)&&
    b.ships.length<=SIZES.length&&
    b.ships.every(s=>Array.isArray(s.cells)&&s.cells.every(i=>Number.isInteger(i)&&i>=0&&i<100));
}
function load(){
  try{
    const s=JSON.parse(localStorage.getItem(KEY));
    if(s&&['setup','battle','over'].includes(s.phase)&&validBoard(s.me)&&validBoard(s.cpu)&&s.last){
      s.level=['easy','medium','hard'].includes(s.level)?s.level:'medium';
      s.ai=s.ai&&Array.isArray(s.ai.hits)?s.ai:{hits:[]};s.mark=s.mark||{p:-1,c:-1};s.log=Array.isArray(s.log)?s.log:[];
      s.pl=s.pl&&[1,2,3,4].includes(s.pl.size)?s.pl:{size:4,h:true};
      s.g=s.g&&Number.isInteger(s.g.shots)&&Number.isInteger(s.g.hits)?s.g:{shots:0,hits:0};
      return s;
    }
  }catch(e){}
  return null;
}
function save(){try{if(S.net)sessionStorage.setItem(NKEY,JSON.stringify(S));else localStorage.setItem(KEY,JSON.stringify(S))}catch(e){}}   // онлайн-партия — в sessionStorage, локальная не затрагивается

const around=i=>{const r=Math.floor(i/N),c=i%N,o=[];
  for(let dr=-1;dr<=1;dr++)for(let dc=-1;dc<=1;dc++){const y=r+dr,x=c+dc;if(y>=0&&y<N&&x>=0&&x<N)o.push(y*N+x)}
  return o};
const name=i=>L[i%N]+(Math.floor(i/N)+1);

// Расстановка: корабли не пересекаются и не касаются (в т.ч. по диагонали)
function autoPlace(){
  for(let t=0;t<500;t++){
    const ships=[],occ=Array(100).fill(0);let ok=true;
    for(const size of SIZES){
      let done=false;
      for(let k=0;k<300&&!done;k++){
        const h=Math.random()<.5,r=rnd(h?N:N-size+1),c=rnd(h?N-size+1:N),cells=[];
        for(let i=0;i<size;i++)cells.push(h?r*N+c+i:(r+i)*N+c);
        if(cells.every(i=>around(i).every(j=>!occ[j]))){cells.forEach(i=>occ[i]=1);ships.push({cells});done=true}
      }
      if(!done){ok=false;break}
    }
    if(ok)return ships;
  }
  return [];
}
const shipOf=(b,i)=>b.ships.find(s=>s.cells.includes(i));
const isSunk=(b,s)=>s.cells.every(i=>b.shots[i]);
const alive=b=>b.ships.filter(s=>!isSunk(b,s)).length;

function shoot(b,i){
  b.shots[i]=1;
  const s=shipOf(b,i);
  if(!s)return'miss';
  if(!isSunk(b,s))return'hit';
  s.cells.forEach(c=>around(c).forEach(j=>b.shots[j]=1)); // клетки вокруг потопленного — заведомо пустые
  return'sunk';
}
const word={miss:'мимо',hit:'попадание',sunk:'потоплен'};

function playerShot(i){
  if(S.net)return netShot(i);
  if(S.phase!=='battle'||S.turn!=='player'||S.cpu.shots[i])return;
  const res=shoot(S.cpu,i);
  S.last.p=name(i)+': '+word[res];S.last.c='';S.mark.p=i;
  log('p','> '+name(i)+' … '+LOGW[res],res);stat(res);SoundManager.shot(res);
  
  if(alive(S.cpu)===0){
    S.phase='over';
    S.winner='player';finish('player');
  } else if(res==='miss'){
    S.turn='cpu'; // Передача хода компьютеру при промахе
  }
  
  fx='cpu';save();render();fx=null;
  if(S.turn==='cpu') schedule();
}

// Компьютер знает только результаты своих выстрелов (мимо / попал / потопил), расстановку игрока не читает
const orth=i=>{const r=Math.floor(i/N),c=i%N,o=[];
  if(r>0)o.push(i-N);if(r<N-1)o.push(i+N);if(c>0)o.push(i-1);if(c<N-1)o.push(i+1);return o};
const group=(hits,start)=>{const set=new Set(hits),out=[start];
  for(let k=0;k<out.length;k++)for(const n of orth(out[k]))if(set.has(n)&&!out.includes(n))out.push(n);return out};

function aiLearn(i,res){
  if(res==='miss')return;
  S.ai.hits.push(i);
  if(res==='sunk'){const dead=group(S.ai.hits,i);S.ai.hits=S.ai.hits.filter(x=>!dead.includes(x))}
}

function aiPick(){
  const free=[];S.me.shots.forEach((v,i)=>{if(!v)free.push(i)});
  const pick=a=>a[rnd(a.length)],row=i=>Math.floor(i/N);
  if(S.level!=='easy'&&S.ai.hits.length){            // средний и сложный: добивают подбитый корабль
    const g=group(S.ai.hits,S.ai.hits[0]);
    let cand=g.flatMap(orth).filter(n=>!S.me.shots[n]);
    if(g.length>1){const h=row(g[0])===row(g[1]);cand=cand.filter(n=>h?row(n)===row(g[0]):n%N===g[0]%N)}
    if(cand.length)return pick(cand);
  }
  if(S.level==='hard'){const p=free.filter(i=>(row(i)+i%N)%2===0);if(p.length)return pick(p)}  // поиск «шахматкой»
  return pick(free);
}

function cpuMove(){
  timer=null;
  if(S.phase!=='battle'||S.turn!=='cpu')return;
  const i=aiPick();
  const res=shoot(S.me,i);
  aiLearn(i,res);
  S.last.c=name(i)+': '+word[res];S.mark.c=i;
  log('c','< '+name(i)+' … '+LOGW[res],res);SoundManager.shot(res);
  
  if(alive(S.me)===0){
    S.phase='over';
    S.winner='cpu';finish('cpu');
  } else if(res==='miss'){
    S.turn='player'; // Передача хода игроку при промахе
  }
  
  fx='me';save();render();fx=null;
  if(S.phase==='battle'&&S.turn==='cpu') schedule(); // Бот стреляет еще раз
}

function schedule(){
  if(S.phase==='battle'&&S.turn==='cpu'&&!timer)timer=setTimeout(cpuMove,550);
}

function boardHTML(b,own,reveal){
  const occ={};b.ships.forEach(s=>s.cells.forEach(i=>occ[i]=s));
  let h='<div class="bw"><span></span><div class="cols">'+[...L].map(x=>'<span>'+x+'</span>').join('')+'</div><div class="rows">'+
    Array.from({length:10},(_,i)=>'<span>'+(i+1)+'</span>').join('')+'</div><div class="board '+(own?(S.phase==='setup'?'place':''):'enemy'+(S.phase==='battle'&&S.turn==='player'?' live':''))+'">';
  for(let i=0;i<100;i++){
    const s=occ[i],shot=b.shots[i];let cls='c';
    if(shot&&i===(own?S.mark.c:S.mark.p))cls+=' last'+(fx===(own?'me':'cpu')?' pop':'');
    if(shot){cls+=s?(isSunk(b,s)?' hit sunk':' hit'):' miss'}
    else if(s&&(own||reveal))cls+=own?' ship':' reveal';
    else cls+=' free';
    h+=own?'<div class="'+cls+'" data-i="'+i+'"></div>':'<button class="'+cls+'" data-i="'+i+'" aria-label="'+name(i)+'"'+(shot?' disabled':'')+'></button>';
  }
  return h+'</div></div>';
}

function render(){
  const placedMe=S.me.ships.length===SIZES.length,placedCpu=S.cpu.ships.length===SIZES.length;
  $('me').innerHTML=boardHTML(S.me,true);
  $('cpu').innerHTML=boardHTML(S.cpu,false,S.phase==='over');
  $('cme').textContent=placedMe?'Кораблей осталось: '+alive(S.me)+' из 10':'Расставлено: '+S.me.ships.length+' из 10';
  $('ccpu').textContent=placedCpu?'Кораблей осталось: '+alive(S.cpu)+' из 10':'Флот не расставлен';
  let st;
  if(S.phase==='setup')st='<b>Расстановка.</b> Выберите корабль и кликните по сетке «Моя сеть». Клик по кораблю убирает его. Цель расставляется кнопкой.';
  else if(S.phase==='battle')st=S.turn==='player'?'<b>Ваш ход.</b> Выберите клетку на поле противника.':'<b>Ход компьютера…</b>';
  else st='<b>Бой окончен.</b>';
  if(S.last.p||S.last.c)st+='<br>'+(S.last.p?'Вы — '+S.last.p:'')+(S.last.p&&S.last.c?'. ':'')+(S.last.c?'Компьютер — '+S.last.c:'');
  $('status').innerHTML=st;
  $('term').innerHTML=S.log.map(l=>'<div class="l '+l.w+' '+l.c+'"><i>['+l.t+']</i> '+l.m+'</div>').join('')+'<div class="l"><i>$</i> <span class="cur">_</span></div>';
  $('term').scrollTop=$('term').scrollHeight;
  const setup=S.phase==='setup';
  renderDock();if(setup)preview(hov);
  document.querySelectorAll('#lvl [data-l]').forEach(b=>{b.classList.toggle('on',b.dataset.l===S.level);b.disabled=!setup});
  $('bMe').disabled=$('bCpu').disabled=!setup;
  $('bGo').disabled=!(setup&&placedMe&&placedCpu);
  $('bGo').style.display=setup?'':'none';
  $('bMe').style.display=$('bCpu').style.display=S.phase==='over'?'none':'';
  $('bNew').style.display=S.phase==='over'?'none':'';
  $('over').className=S.phase==='over'?'on':'';
  $('overTxt').textContent=S.winner==='player'?'ACCESS GRANTED. Флот противника уничтожен.':'ACCESS DENIED. Ваш флот уничтожен.';
  if(S.net)netUI();
  else{$('lvl').style.display='';$('bReady').style.display='none';$('bNew').textContent=$('bNew2').textContent='Новая игра'}
}

$('cpu').addEventListener('click',e=>{const b=e.target.closest('[data-i]');if(b)playerShot(+b.dataset.i)});
$('lvl').addEventListener('click',e=>{const b=e.target.closest('[data-l]');if(b&&S.phase==='setup'){S.level=b.dataset.l;save();render()}});
$('bMe').onclick=()=>{S.me=newBoard();S.me.ships=autoPlace();save();render()};
$('bCpu').onclick=()=>{S.cpu=newBoard();S.cpu.ships=autoPlace();save();render()};
$('bGo').onclick=()=>{S.phase='battle';S.turn='player';S.g={shots:0,hits:0};S.last={p:'',c:''};S.ai={hits:[]};S.mark={p:-1,c:-1};S.log=[];log('s','Сессия начата. Защита цели: '+LVN[S.level]);SoundManager.startBg();save();render()};
const reset=()=>{if(S.net)return leaveRoom();clearTimeout(timer);timer=null;SoundManager.stopBg();S=fresh(S.level);save();render()};
$('bNew').onclick=reset;$('bNew2').onclick=reset;

// ================= SPA, профиль, PRO (обёртка над движком) =================
const LOGW={miss:'TIMEOUT',hit:'CRITICAL ERROR',sunk:'NODE COMPROMISED'};
const LVN={easy:'Script Kiddie',medium:'SysAdmin',hard:'Hacker'};
const SKEY='battleship_profile_v1',VIEWS=['home','game','profile','rating','pro'];
function loadStats(){
  const d={pro:false};
  try{const s=JSON.parse(localStorage.getItem(SKEY));if(s&&typeof s==='object')return Object.assign(d,s)}catch(e){}
  return d;
}
let ST=loadStats();   // в LocalStorage остался только флаг PRO-демо
const saveStats=()=>{try{localStorage.setItem(SKEY,JSON.stringify(ST))}catch(e){}};
const hhmm=()=>new Date().toLocaleTimeString('ru-RU',{hour12:false});
function log(w,m,c){S.log.push({t:hhmm(),w,m,c:c||''});if(S.log.length>80)S.log.shift()}
function stat(res){S.g.shots++;if(res!=='miss')S.g.hits++}   // счётчик выстрелов текущей партии (хранится в S)

// ================= Firebase: Auth + Firestore =================
const app=initializeApp({
  apiKey:"AIzaSyAdAsf9CX_DBtzHpikfA4h-_Ri-Bw35XDE",
  authDomain:"narxoz-battleship.firebaseapp.com",
  projectId:"narxoz-battleship",
  storageBucket:"narxoz-battleship.firebasestorage.app",
  messagingSenderId:"228640698225",
  appId:"1:228640698225:web:0912fd6cdcac69857b10d0",
  databaseURL:"https://narxoz-battleship-default-rtdb.firebaseio.com"   // скопируйте точный URL из консоли Firebase → Realtime Database
});
const auth=getAuth(app),db=getFirestore(app);
let user=null,P=null,saveMsg='';
const uref=u=>doc(db,'users',u.uid);
const esc=s=>String(s).replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';');
const myName=()=>user?((P&&P.displayName)||user.displayName||'Игрок'):'Гость';

async function refreshProfile(){
  if(!user)return;
  try{const s=await getDoc(uref(user));P=s.exists()?s.data():null}catch(e){console.error(e)}
  renderProfile();
}
onAuthStateChanged(auth,async u=>{
  user=u;P=null;renderProfile();netAuth(u);
  if(!u)return;
  try{   // первый вход — создаём документ users/{uid}
    const r=uref(u);
    if(!(await getDoc(r)).exists())await setDoc(r,{displayName:(u.displayName||'Игрок').slice(0,16),wins:0,losses:0,totalShots:0,hits:0});
  }catch(e){console.error(e)}
  refreshProfile();
});
$('bLogin').onclick=async()=>{
  $('authMsg').textContent='';
  if(user)return signOut(auth);
  try{await signInWithPopup(auth,new GoogleAuthProvider())}
  catch(e){if(!/popup-closed|cancelled-popup/.test(e.code))$('authMsg').textContent='Ошибка входа: '+(e.code||e.message)}
};
async function saveResult(u,win,g){
  try{
    await setDoc(uref(u),{wins:increment(win?1:0),losses:increment(win?0:1),totalShots:increment(g.shots),hits:increment(g.hits)},{merge:true});
    saveMsg='Статистика сохранена в облаке ✓';refreshProfile();
  }catch(e){console.error(e);saveMsg='Не удалось сохранить статистику: '+(e.code||'ошибка')}
  $('cSave').textContent=saveMsg;
}
async function loadRating(){
  const t=$('rBody'),row=(c,m)=>'<tr><td colspan="5" class="'+c+'">'+m+'</td></tr>';
  t.innerHTML=row('dim','Загрузка…');
  try{
    const q=await getDocs(query(collection(db,'users'),orderBy('wins','desc'),limit(10)));
    if(q.empty){t.innerHTML=row('dim','Пока нет игроков.');return}
    t.innerHTML=q.docs.map((d,i)=>{
      const x=d.data(),n=x.totalShots||0;
      return '<tr'+(user&&d.id===user.uid?' class="mine"':'')+'><td>'+(i+1)+'</td><td>'+esc(x.displayName||'Аноним')+'</td><td>'+(x.wins||0)+'</td><td>'+(x.losses||0)+'</td><td>'+(n?Math.round((x.hits||0)/n*100)+'%':'—')+'</td></tr>';
    }).join('');
  }catch(e){console.error(e);t.innerHTML=row('err','Не удалось загрузить рейтинг ('+esc(e.code||'error')+')')}
}

// ================= Конец партии + отчёт тренера =================
function finish(w){
  SoundManager.stopBg();
  log('s',w==='player'?'ACCESS GRANTED — цель скомпрометирована':'ACCESS DENIED — ваша сеть уничтожена',w==='player'?'':'hit');
  saveMsg=user?'Сохранение статистики…':'Вы играли как Гость — статистика не сохранена. Войдите через Google на главной.';
  if(user)saveResult(user,w==='player',S.g);
  setTimeout(()=>{if(S.phase==='over')showCoach(w)},600);   // даём увидеть последний выстрел
}
function showCoach(w){
  const g=S.g,a=g.shots?Math.round(g.hits/g.shots*100):0;
  $('cRes').textContent=w==='player'?'ACCESS GRANTED — победа':'ACCESS DENIED — поражение';
  $('cAcc').textContent=a+'%';
  $('cSub').textContent='Точность в партии: попаданий '+g.hits+' из '+g.shots+' выстрелов';
  $('cTip').textContent=a<25?"Совет тренера: Вы слишком часто бьете наугад. Старайтесь простреливать поле 'шахматкой'.":
    a<40?'Неплохо! Подбили корабль — добивайте его по линии, так вы не теряете ходы на промахи.':
    'Отличная работа! Адмирал гордится вашим анализом.';
  $('cSave').textContent=saveMsg;
  $('coach').hidden=false;$('bCoachX').focus();
}
const closeCoach=()=>{$('coach').hidden=true};
$('bCoachX').onclick=closeCoach;
$('coach').addEventListener('click',e=>{if(e.target===$('coach'))closeCoach()});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeCoach()});
$('bRep').onclick=()=>showCoach(S.winner);

// ================= Профиль =================
function renderProfile(){
  const n=myName(),w=P&&P.wins||0,l=P&&P.losses||0,s=P&&P.totalShots||0,h=P&&P.hits||0;
  $('hName').textContent=user?n:'operator';
  $('authName').textContent=$('pName').textContent=n;
  ['authAva','pAva'].forEach(id=>{const a=$(id),ok=!!(user&&user.photoURL);a.hidden=!ok;if(ok)a.src=user.photoURL});
  $('bLogin').textContent=user?'Выйти':'Войти через Google';
  $('pLead').textContent=user?'Статистика синхронизируется с облаком (Firestore).':'Вы играете как Гость — статистика не сохраняется. Войдите через Google на главной.';
  $('callsign').value=user?n:'';$('callsign').disabled=$('bName').disabled=!user;
  $('sGames').textContent=w+l;$('sWon').textContent=w;$('sLost').textContent=l;
  $('sWin').textContent=w+l?Math.round(w/(w+l)*100)+'%':'—';
  $('sAcc').textContent=s?Math.round(h/s*100)+'%':'—';
}
$('bName').onclick=async()=>{
  const n=$('callsign').value.trim().slice(0,16),b=$('bName');
  if(!user||!n)return;
  try{await setDoc(uref(user),{displayName:n},{merge:true});await refreshProfile();b.textContent='Сохранено ✓'}
  catch(e){console.error(e);b.textContent='Ошибка'}
  setTimeout(()=>b.textContent='Сохранить',1200);
};
function renderPro(){if(ST.pro){$('payMsg').className='mono ok';$('payMsg').textContent='Статус: ROOT активен (тестовый режим).'}}
function go(v){
  if(!VIEWS.includes(v))v='home';
  VIEWS.forEach(x=>{$('v-'+x).hidden=x!==v});
  document.querySelectorAll('#nav [data-v]').forEach(b=>b.classList.toggle('on',b.dataset.v===v));
  if(v==='game')$('term').scrollTop=$('term').scrollHeight;
  if(v==='profile'||v==='home')renderProfile();
  if(v==='profile')refreshProfile();
  if(v==='home')loadLobby();else stopLobby();
  if(v==='rating')loadRating();
  if(v==='pro')renderPro();
  if(location.hash!=='#'+v)location.hash=v;
  window.scrollTo(0,0);
}
$('nav').addEventListener('click',e=>{const b=e.target.closest('[data-v]');if(b)go(b.dataset.v)});
document.addEventListener('click',e=>{const g=e.target.closest('[data-go]');if(g)go(g.dataset.go)});
window.addEventListener('hashchange',()=>go(location.hash.slice(1)));
// Оплата — демо: данные карты нигде не сохраняются и не отправляются
$('cn').oninput=e=>{e.target.value=e.target.value.replace(/\D/g,'').slice(0,16).replace(/(.{4})/g,'$1 ').trim()};
$('cx').oninput=e=>{let v=e.target.value.replace(/\D/g,'').slice(0,4);if(v.length>2)v=v.slice(0,2)+'/'+v.slice(2);e.target.value=v};
$('cc').oninput=e=>{e.target.value=e.target.value.replace(/\D/g,'').slice(0,3)};
$('bPay').onclick=()=>{
  const n=$('cn').value.replace(/\s/g,''),x=$('cx').value,c=$('cc').value,m=$('payMsg'),mm=+x.slice(0,2);
  if(n.length!==16||x.length!==5||!(mm>=1&&mm<=12)||c.length!==3){m.className='mono err';m.textContent='ERROR: проверьте номер карты, срок (MM/YY) и CVC';return}
  ST.pro=true;saveStats();$('cn').value=$('cx').value=$('cc').value='';
  m.className='mono ok';m.textContent='ROOT ДОСТУП активирован (тест). Деньги не списаны, данные карты не сохраняются.';
};

// ================= Ручная расстановка =================
let hov=-1;
const cellsFor=(i,size,h)=>Array.from({length:size},(_,k)=>h?i+k:i+k*N).filter(x=>x<100&&(!h||Math.floor(x/N)===Math.floor(i/N)));
const canPlace=(b,cells,size)=>{
  if(cells.length!==size)return false;
  const occ=new Set(b.ships.flatMap(s=>s.cells));
  return cells.every(c=>around(c).every(j=>!occ.has(j)));   // не пересекаются и не касаются, даже углами
};
const leftOf=b=>{const l={};SIZES.forEach(s=>l[s]=(l[s]||0)+1);b.ships.forEach(s=>l[s.cells.length]--);return l};
function pickSize(){const l=leftOf(S.me);if(!(l[S.pl.size]>0)){const n=[4,3,2,1].find(x=>l[x]>0);if(n)S.pl.size=n}}
function renderDock(){
  const dk=$('dock'),setup=S.phase==='setup';
  dk.style.display=setup?'':'none';
  if(!setup)return;
  const l=leftOf(S.me);
  dk.innerHTML='<span>Корабль</span>'+[4,3,2,1].map(n=>'<button class="btn'+(S.pl.size===n?' on':'')+'" data-sz="'+n+'"'+(l[n]>0?'':' disabled')+'><span class="sh">'+'<i></i>'.repeat(n)+'</span>×'+Math.max(l[n],0)+'</button>').join('')+
    '<button class="btn" id="bRot">Повернуть: '+(S.pl.h?'горизонтально':'вертикально')+' (R)</button><button class="btn" id="bClr">Очистить</button>';
}
function preview(i){
  hov=i;
  document.querySelectorAll('#me .pv-ok,#me .pv-bad').forEach(e=>e.classList.remove('pv-ok','pv-bad'));
  if(S.phase!=='setup'||i<0||shipOf(S.me,i)||!(leftOf(S.me)[S.pl.size]>0))return;
  const cells=cellsFor(i,S.pl.size,S.pl.h),ok=canPlace(S.me,cells,S.pl.size);
  cells.forEach(c=>{const el=$('me').querySelector('[data-i="'+c+'"]');if(el)el.classList.add(ok?'pv-ok':'pv-bad')});
}
$('me').addEventListener('mouseover',e=>{const el=e.target.closest('[data-i]');preview(el?+el.dataset.i:-1)});
$('me').addEventListener('mouseleave',()=>preview(-1));
$('me').addEventListener('click',e=>{
  const el=e.target.closest('[data-i]');if(!el||S.phase!=='setup')return;
  const i=+el.dataset.i,ex=shipOf(S.me,i);
  if(ex){S.me.ships=S.me.ships.filter(s=>s!==ex);S.pl.size=ex.cells.length}   // клик по кораблю — снять
  else{
    const cells=cellsFor(i,S.pl.size,S.pl.h);
    if(!(leftOf(S.me)[S.pl.size]>0)||!canPlace(S.me,cells,S.pl.size))return;
    S.me.ships.push({cells});pickSize();
  }
  save();render();
});
$('dock').addEventListener('click',e=>{
  const b=e.target.closest('button');if(!b||S.phase!=='setup')return;
  if(b.dataset.sz)S.pl.size=+b.dataset.sz;
  else if(b.id==='bRot')S.pl.h=!S.pl.h;
  else if(b.id==='bClr'){S.me=newBoard();S.pl.size=4}
  save();render();
});
document.addEventListener('keydown',e=>{
  if(S.phase==='setup'&&!$('v-game').hidden&&/^(r|к)$/i.test(e.key)&&!/INPUT|TEXTAREA/.test(document.activeElement.tagName)){S.pl.h=!S.pl.h;save();render()}
});

// ================= Сетевая атака 1 на 1 (Realtime Database) =================
// Корабли знает только владелец: стрелок пишет shot, защищающийся считает результат по своей сетке и пишет res (+turn при промахе).
// Локальная игра не затрагивается: на время онлайн-режима S подменяется, LS хранит локальную партию.
const RID=new URLSearchParams(location.search).get('room'),RID_RE=/^room_[a-z0-9]{3,12}$/i,NKEY='battleship_net_v1';
let LS=null,unsub=null,rdb=null;
const R=()=>rdb||(rdb=getDatabase(app));
const room=id=>ref(R(),'rooms/'+id);
const other=r=>r==='player1'?'player2':'player1';
const roomLink=id=>location.origin+location.pathname+'?room='+id;
const rtok=()=>Math.random().toString(36).slice(2);
const netMsg=(m,bad)=>{const e=$('netMsg');e.textContent=m||'';e.className='mono '+(bad?'err':'ok')};
const tmo=p=>Promise.race([p,new Promise((_,r)=>setTimeout(()=>r({code:'нет ответа от Realtime Database — проверьте databaseURL и правила'}),8000))]);
function netState(id,role,tok){const s=fresh();s.net={id,role,tok,applied:0,def:0,pend:false,opp:''};s.turn='opp';return s}

function enterNet(ns){
  if(!S.net)LS=S;
  clearTimeout(timer);timer=null;SoundManager.stopBg();
  S=ns;go('game');render();
}
function listen(ns){
  if(unsub)unsub();
  enterNet(ns);
  unsub=onValue(room(ns.net.id),s=>onRoom(s.val()),e=>quitNet('Ошибка соединения: '+(e.code||e.message)));
}
function quitNet(msg){
  if(unsub){unsub();unsub=null}
  try{sessionStorage.removeItem(NKEY)}catch(e){}
  if(S.net&&LS){S=LS;LS=null}
  if(location.search)history.replaceState(null,'',location.pathname+'#home');
  netMsg(msg,1);go('home');render();schedule();
}
async function createRoom(){
  if(!user){netMsg('Для сетевой игры войдите через Google',true);return}
  if(S.net)leaveRoom();
  const id='room_'+Math.random().toString(36).slice(2,8),tok=rtok(),link=roomLink(id);
  const cp=navigator.clipboard?navigator.clipboard.writeText(link).then(()=>1,()=>0):Promise.resolve(0);
  netMsg('Создаём сервер…');
  try{await tmo(set(room(id),{status:'waiting',p1:{name:myName(),tok},created:Date.now()}))}
  catch(e){return netMsg('Ошибка создания сервера: '+(e.code||e.message),1)}
  netMsg(((await cp)?'Ссылка скопирована: ':'Ссылка на игру: ')+link);
  listen(netState(id,'player1',tok));
}
function joinRoom(id){
  if(!user){netMsg('Для сетевой игры войдите через Google',true);return}
  if(!RID_RE.test(id))return netMsg('Неверный ID комнаты.',true);
  if(S.net){if(S.net.id===id)return go('game');leaveRoom()}
  try{
    let sv=null;try{sv=JSON.parse(sessionStorage.getItem(NKEY))}catch(e){}
    if(sv&&sv.net&&sv.net.id===id&&sv.me&&sv.cpu)return listen(sv);   // перезагрузка страницы — возвращаемся в свою комнату
    const tok=rtok();go('home');netMsg('Подключение к комнате…');
    onValue(room(id),snap=>{
      const d=snap.val();
      if(!d)return quitNet('Комната не найдена или уже закрыта.');
      if(d.p2||d.status!=='waiting')return quitNet('Комната недоступна: уже занята или игра идёт.');
      update(room(id),{p2:{name:myName(),tok},status:'setup'}).catch(console.error);
      listen(netState(id,'player2',tok));
    },{onlyOnce:true});
  }catch(e){quitNet('Ошибка подключения: '+e.message)}
}
function leaveRoom(){
  const n=S.net;if(!n)return;
  if(S.phase==='battle')update(room(n.id),{status:'over',winner:other(n.role),left:true}).catch(()=>{});   // выход в бою = поражение
  else remove(room(n.id)).catch(()=>{});
  quitNet('');
}

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function send(n,obj){   // запись с повторами: ход не теряется при сетевом сбое
  for(let k=0;k<3;k++){
    try{await update(room(n.id),obj);return true}catch(e){console.error(e);await sleep(400*(k+1))}
  }
  return false;
}
// RTDB вызывает слушатель повторно прямо внутри update() — такие снимки ставим в очередь и обрабатываем по порядку,
// иначе устаревший снимок перезаписывал новый ход («зависание» на «Ход соперника»)
let busy=false,queued=null;
function onRoom(d){
  if(busy){queued={d};return}
  busy=true;
  try{let cur={d};while(cur){syncRoom(cur.d);cur=queued;queued=null}}
  catch(e){console.error(e)}
  finally{busy=false}
}
function syncRoom(d){
  const n=S.net;if(!n)return;
  if(!d){if(S.phase!=='over')quitNet('Комната закрыта.');return}
  const me=n.role,op=other(me),o=d[me==='player1'?'p2':'p1'],sh=d.shot,rs=d.res;
  if(me==='player2'&&d.p2&&d.p2.tok!==n.tok)return quitNet('В комнате уже есть второй игрок.');
  n.opp=o?o.name:'';
  let turn=d.turn;   // актуальный ход: учитываем и то, что я сам только что записал
  if(d.status==='battle'&&(S.phase==='setup'||S.phase==='wait')){   // оба готовы — бой
    S.phase='battle';S.g={shots:0,hits:0};S.log=[];S.last={p:'',c:''};S.mark={p:-1,c:-1};
    log('s','Сессия начата. Соперник: '+n.opp);SoundManager.startBg();
  }
  if(sh&&sh.by===op&&d.status==='battle'&&n.def!==sh.n&&(!rs||rs.n!==sh.n)){n.def=sh.n;turn=defend(sh)||turn}   // выстрел по мне
  if(rs&&rs.by===me&&rs.n>n.applied)applyRes(rs);                                                               // результат моего выстрела
  if(sh&&rs&&rs.n===sh.n&&rs.by===op&&rs.r==='miss'&&d.status==='battle'&&turn!==me){turn=me;send(n,{turn:me})} // самолечение: промах обработан, а ход не передан
  if(me==='player1'&&d.status==='setup'&&d.ready&&d.ready.player1&&d.ready.player2)send(n,{status:'battle',turn:Math.random()<.5?'player1':'player2'});
  n.pend=!!(sh&&sh.by===me&&(!rs||rs.n!==sh.n));   // «жду результат» вычисляется из базы, поэтому сбрасывается у обоих игроков
  if(S.phase==='battle')S.turn=turn===me&&!n.pend?'player':'opp';
  if(d.status==='over'&&S.phase!=='over'){
    S.phase='over';S.winner=d.winner===me?'player':'opp';
    if(d.left&&S.winner==='player')log('s','Соперник покинул комнату');
    finish(S.winner==='player'?'player':'cpu');
  }
  save();render();fx=null;
}
// Соперник выстрелил по мне: считаем результат, пишем res. Ход переходит ко мне ТОЛЬКО при промахе (res и turn — одной атомарной записью)
function defend(sh){
  const n=S.net,i=sh.i,r=shoot(S.me,i),ship=r==='sunk'?shipOf(S.me,i):null,out={res:{n:sh.n,by:sh.by,i,r,cells:ship?ship.cells:null}};
  let next;
  S.mark.c=i;S.last.c=name(i)+': '+word[r];S.last.p='';
  log('c','< '+name(i)+' … '+LOGW[r],r);SoundManager.shot(r);fx='me';
  if(alive(S.me)===0){out.status='over';out.winner=sh.by;S.phase='over';S.winner='opp';finish('cpu')}
  else if(r==='miss')out.turn=next=n.role;
  send(n,out).then(ok=>{if(!ok){n.def=0;log('s','Сеть: не удалось отправить результат выстрела','hit');render()}});
  return next;
}
// Результат моего выстрела: отражаем его на поле соперника
function applyRes(x){
  const n=S.net,b=S.cpu,i=x.i,c=x.cells||[i];
  n.applied=x.n;n.pend=false;b.shots[i]=1;
  if(x.r!=='miss')b.ships.push({cells:[i,-1]});   // пока размер корабля неизвестен (-1 = «неоткрытая» клетка)
  if(x.r==='sunk'){b.ships=b.ships.filter(s=>!s.cells.some(k=>c.includes(k)));b.ships.push({cells:c});c.forEach(k=>around(k).forEach(j=>b.shots[j]=1))}
  S.mark.p=i;S.last.p=name(i)+': '+word[x.r];S.last.c='';
  log('p','> '+name(i)+' … '+LOGW[x.r],x.r);stat(x.r);SoundManager.shot(x.r);fx='cpu';
}
function netShot(i){
  const n=S.net;
  if(S.phase!=='battle'||S.turn!=='player'||n.pend||S.cpu.shots[i])return;
  n.pend=true;S.turn='opp';save();render();
  send(n,{shot:{by:n.role,i,n:Date.now()}}).then(ok=>{if(!ok&&S.net===n){n.pend=false;S.turn='player';render()}});
}

// ================= Лобби и авторизация =================
let lobbyOff=null,pendingRoom=RID;
function stopLobby(){if(lobbyOff){lobbyOff();lobbyOff=null}}
function loadLobby(){
  stopLobby();
  const box=$('lobby'),msg=(c,t)=>{box.innerHTML='<div class="'+c+' mono">'+t+'</div>'};
  if(!user)return msg('dim','Войдите через Google, чтобы видеть свободные серверы.');
  msg('dim','Загрузка…');
  try{
    lobbyOff=onValue(ref(R(),'rooms'),snap=>{
      const now=Date.now(),rows=Object.entries(snap.val()||{})
        .filter(([id,d])=>RID_RE.test(id)&&d&&d.status==='waiting'&&d.p1&&!d.p2&&now-(d.created||0)<30*60000)   // брошенные комнаты старше 30 мин скрываем
        .sort((a,b)=>b[1].created-a[1].created);
      box.innerHTML=rows.length?rows.map(([id,d])=>'<div class="lrow"><span>'+esc(d.p1.name||'Игрок')+'</span><code>'+esc(id)+'</code><button class="btn" data-join="'+esc(id)+'">Присоединиться</button></div>').join(''):
        '<div class="dim mono">Свободных серверов нет — создайте свой.</div>';
    },e=>msg('err','Не удалось загрузить список: '+esc(e.code||e.message)));
  }catch(e){msg('err','Ошибка лобби: '+esc(e.message))}
}
function netAuth(u){   // вызывается при каждой смене авторизации
  if(!u&&S.net)leaveRoom();
  if(pendingRoom&&!S.net){   // пришли по ссылке ?room=… — ждём, пока Firebase определит пользователя
    if(u){const id=pendingRoom;pendingRoom=null;joinRoom(id)}
    else{go('home');netMsg('Для сетевой игры войдите через Google',true)}
  }
  if(!$('v-home').hidden)loadLobby();
}
$('bJoin').onclick=()=>{const v=$('roomId').value,m=v.match(/room_[a-z0-9]{3,12}/i);joinRoom(m?m[0]:v.trim())};
$('lobby').addEventListener('click',e=>{const b=e.target.closest('[data-join]');if(b)joinRoom(b.dataset.join)});

function netUI(){
  const n=S.net,ph=S.phase,prep=ph==='setup'||ph==='wait',sunk=S.cpu.ships.filter(s=>isSunk(S.cpu,s)).length;
  let st;
  if(prep)st=(n.opp?'<b>Ожидание расстановки флота.</b> Соперник: '+esc(n.opp)+'. ':'<b>Ожидание соперника.</b> Ссылка для приглашения: '+esc(roomLink(n.id))+' ')+
    (ph==='wait'?'Вы готовы — ждём соперника…':'Расставьте корабли и нажмите «Готов».');
  else if(ph==='battle')st=S.turn==='player'?'<b>Ваш ход.</b> Выберите клетку на поле противника.':'<b>'+(n.pend?'Ожидание результата…':'Ход соперника…')+'</b>';
  else st='<b>Бой окончен.</b>';
  if(S.last.p||S.last.c)st+='<br>'+(S.last.p?'Вы — '+S.last.p:'')+(S.last.p&&S.last.c?'. ':'')+(S.last.c?'Соперник — '+S.last.c:'');
  $('status').innerHTML=st;
  $('ccpu').textContent=prep?'Флот соперника скрыт':'Потоплено кораблей: '+sunk+' из 10';
  $('lvl').style.display=$('bCpu').style.display=$('bGo').style.display='none';
  $('bReady').style.display=ph==='setup'?'':'none';$('bReady').disabled=S.me.ships.length!==SIZES.length;
  $('bNew').textContent=$('bNew2').textContent='Покинуть комнату';
}
$('bRoom').onclick=createRoom;
$('bReady').onclick=()=>{
  const n=S.net;if(!n||S.phase!=='setup'||S.me.ships.length!==SIZES.length)return;
  S.phase='wait';save();render();   // фаза «wait»: расстановка заблокирована
  update(room(n.id),{['ready/'+n.role]:true}).catch(e=>{console.error(e);S.phase='setup';render()});
};

// ================= Звук =================
const SoundManager={
  on:(()=>{try{return localStorage.getItem('battleship_sound')!=='off'}catch(e){return true}})(),
  files:{hit:'sounds/hit.mp3',miss:'sounds/miss.mp3',bg:'sounds/bg.mp3'},
  a:{},ctx:null,bgOn:false,
  load(){
    for(const k in this.files){const au=new Audio(this.files[k]);au.preload='auto';this.a[k]=au}
    this.a.bg.loop=true;this.a.bg.volume=.25;
  },
  beep(f){   // запасной сигнал, если mp3 не найден
    try{this.ctx=this.ctx||new (window.AudioContext||window.webkitAudioContext)();
      const o=this.ctx.createOscillator(),g=this.ctx.createGain();o.frequency.value=f;g.gain.value=.05;
      o.connect(g);g.connect(this.ctx.destination);o.start();o.stop(this.ctx.currentTime+.14)}catch(e){}
  },
  play(k){
    if(!this.on)return;
    const au=this.a[k],f=k==='hit'?140:420;
    if(!au)return this.beep(f);
    au.currentTime=0;au.volume=.7;
    const p=au.play();if(p&&p.catch)p.catch(()=>this.beep(f));
  },
  shot(res){this.play(res==='miss'?'miss':'hit')},
  startBg(){if(!this.on)return;this.bgOn=true;const p=this.a.bg.play();if(p&&p.catch)p.catch(()=>{})},
  stopBg(){this.bgOn=false;this.a.bg.pause();try{this.a.bg.currentTime=0}catch(e){}},
  toggle(){
    this.on=!this.on;try{localStorage.setItem('battleship_sound',this.on?'on':'off')}catch(e){}
    if(!this.on)this.a.bg.pause();else if(S.phase==='battle')this.startBg();
    this.ui();
  },
  ui(){$('bSnd').textContent='Звук: '+(this.on?'вкл':'выкл');$('bSnd').setAttribute('aria-pressed',this.on)}
};
SoundManager.load();SoundManager.ui();
$('bSnd').onclick=()=>SoundManager.toggle();
// после перезагрузки музыка продолжится после первого клика (политика автозапуска браузеров)
document.addEventListener('pointerdown',()=>{if(S.phase==='battle'&&!SoundManager.bgOn)SoundManager.startBg()});

render();schedule();   // после перезагрузки страницы партия и ход компьютера продолжаются
go(location.hash.slice(1));   // открыть вкладку из адресной строки
