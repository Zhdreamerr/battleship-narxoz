const N=10,SIZES=[4,3,3,2,2,2,1,1,1,1],KEY='battleship_v1',L='АБВГДЕЖЗИК';
const $=id=>document.getElementById(id);
const rnd=n=>Math.floor(Math.random()*n);
const newBoard=()=>({ships:[],shots:Array(100).fill(0)});
const fresh=(level='medium')=>({phase:'setup',turn:'player',level,ai:{hits:[]},mark:{p:-1,c:-1},me:newBoard(),cpu:newBoard(),last:{p:'',c:''},winner:null});
let S=load()||fresh(),timer=null,fx=null;

function validBoard(b){
  return b&&Array.isArray(b.shots)&&b.shots.length===100&&Array.isArray(b.ships)&&
    (b.ships.length===0||b.ships.length===SIZES.length)&&
    b.ships.every(s=>Array.isArray(s.cells)&&s.cells.every(i=>Number.isInteger(i)&&i>=0&&i<100));
}
function load(){
  try{
    const s=JSON.parse(localStorage.getItem(KEY));
    if(s&&['setup','battle','over'].includes(s.phase)&&validBoard(s.me)&&validBoard(s.cpu)&&s.last){
      s.level=['easy','medium','hard'].includes(s.level)?s.level:'medium';
      s.ai=s.ai&&Array.isArray(s.ai.hits)?s.ai:{hits:[]};s.mark=s.mark||{p:-1,c:-1};
      return s;
    }
  }catch(e){}
  return null;
}
function save(){try{localStorage.setItem(KEY,JSON.stringify(S))}catch(e){}}

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
  if(S.phase!=='battle'||S.turn!=='player'||S.cpu.shots[i])return;
  const res=shoot(S.cpu,i);
  S.last.p=name(i)+': '+word[res];S.last.c='';S.mark.p=i;
  if(alive(S.cpu)===0){S.phase='over';S.winner='player'}
  else S.turn='cpu';
  fx='cpu';save();render();fx=null;schedule();
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
  if(alive(S.me)===0){S.phase='over';S.winner='cpu'}
  else S.turn='player';
  fx='me';save();render();fx=null;
}
function schedule(){
  if(S.phase==='battle'&&S.turn==='cpu'&&!timer)timer=setTimeout(cpuMove,550);
}

function boardHTML(b,own,reveal){
  const occ={};b.ships.forEach(s=>s.cells.forEach(i=>occ[i]=s));
  let h='<div class="bw"><span></span><div class="cols">'+[...L].map(x=>'<span>'+x+'</span>').join('')+'</div><div class="rows">'+
    Array.from({length:10},(_,i)=>'<span>'+(i+1)+'</span>').join('')+'</div><div class="board '+(own?'':'enemy'+(S.phase==='battle'&&S.turn==='player'?' live':''))+'">';
  for(let i=0;i<100;i++){
    const s=occ[i],shot=b.shots[i];let cls='c';
    if(shot&&i===(own?S.mark.c:S.mark.p))cls+=' last'+(fx===(own?'me':'cpu')?' pop':'');
    if(shot){cls+=s?(isSunk(b,s)?' hit sunk':' hit'):' miss'}
    else if(s&&(own||reveal))cls+=own?' ship':' reveal';
    else cls+=' free';
    h+=own?'<div class="'+cls+'"></div>':'<button class="'+cls+'" data-i="'+i+'" aria-label="'+name(i)+'"'+(shot?' disabled':'')+'></button>';
  }
  return h+'</div></div>';
}

function render(){
  const placedMe=S.me.ships.length>0,placedCpu=S.cpu.ships.length>0;
  $('me').innerHTML=boardHTML(S.me,true);
  $('cpu').innerHTML=boardHTML(S.cpu,false,S.phase==='over');
  $('cme').textContent=placedMe?'Кораблей осталось: '+alive(S.me)+' из 10':'Флот не расставлен';
  $('ccpu').textContent=placedCpu?'Кораблей осталось: '+alive(S.cpu)+' из 10':'Флот не расставлен';
  let st;
  if(S.phase==='setup')st='<b>Расстановка.</b> Расставьте оба флота, затем начните бой.';
  else if(S.phase==='battle')st=S.turn==='player'?'<b>Ваш ход.</b> Выберите клетку на поле противника.':'<b>Ход компьютера…</b>';
  else st='<b>Бой окончен.</b>';
  if(S.last.p||S.last.c)st+='<br>'+(S.last.p?'Вы — '+S.last.p:'')+(S.last.p&&S.last.c?'. ':'')+(S.last.c?'Компьютер — '+S.last.c:'');
  $('status').innerHTML=st;
  const setup=S.phase==='setup';
  document.querySelectorAll('#lvl [data-l]').forEach(b=>{b.classList.toggle('on',b.dataset.l===S.level);b.disabled=!setup});
  $('bMe').disabled=$('bCpu').disabled=!setup;
  $('bGo').disabled=!(setup&&placedMe&&placedCpu);
  $('bGo').style.display=setup?'':'none';
  $('bMe').style.display=$('bCpu').style.display=S.phase==='over'?'none':'';
  $('bNew').style.display=S.phase==='over'?'none':'';
  $('over').className=S.phase==='over'?'on':'';
  $('overTxt').textContent=S.winner==='player'?'Победа. Флот противника уничтожен.':'Поражение. Ваш флот уничтожен.';
}

$('cpu').addEventListener('click',e=>{const b=e.target.closest('[data-i]');if(b)playerShot(+b.dataset.i)});
$('lvl').addEventListener('click',e=>{const b=e.target.closest('[data-l]');if(b&&S.phase==='setup'){S.level=b.dataset.l;save();render()}});
$('bMe').onclick=()=>{S.me=newBoard();S.me.ships=autoPlace();save();render()};
$('bCpu').onclick=()=>{S.cpu=newBoard();S.cpu.ships=autoPlace();save();render()};
$('bGo').onclick=()=>{S.phase='battle';S.turn='player';S.last={p:'',c:''};S.ai={hits:[]};S.mark={p:-1,c:-1};save();render()};
const reset=()=>{clearTimeout(timer);timer=null;S=fresh(S.level);save();render()};
$('bNew').onclick=reset;$('bNew2').onclick=reset;

render();schedule();   // после перезагрузки страницы партия и ход компьютера продолжаются
