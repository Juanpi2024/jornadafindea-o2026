'use strict';
const el=id=>document.getElementById(id);
const audio=el('audio');let datos,indice=0;
function mostrar(n,seguir=false){
  indice=Math.min(datos.slides.length-1,Math.max(0,n));const s=datos.slides[indice];audio.pause();
  el('lamina').src=s.image;el('lamina').alt=s.title;el('tituloLamina').textContent=`${indice+1} / ${datos.slides.length} · ${s.title}`;
  audio.src=s.audio;audio.load();el('salto').value=String(indice);el('transcripcion').textContent=s.text;
  el('pagina').href=`Reglamento_Evaluacion_CEIA_2027-2030.pdf#page=${s.page}`;el('pagina').textContent=`Consultar página ${s.page} del reglamento`;
  el('anterior').disabled=indice===0;el('siguiente').disabled=indice===datos.slides.length-1;
  const u=new URL(location.href);u.searchParams.set('lamina',String(indice+1));history.replaceState(null,'',u);
  if(seguir)audio.play().catch(()=>{el('estado').textContent='Pulsa Reproducir para continuar con el audio.';});
}
function nodo(tag,text){const e=document.createElement(tag);e.textContent=text;return e;}
function actividades(){
  datos.vf.forEach((v,i)=>{
    const art=document.createElement('article');art.className='afirmacion';art.append(nodo('p',`${i+1}. ${v.statement}`));
    const buttons=document.createElement('div');buttons.className='controles';const respuesta=document.createElement('div');respuesta.className='respuesta';respuesta.setAttribute('role','status');respuesta.hidden=true;
    ['Verdadero','Falso'].forEach(op=>{const b=nodo('button',op);b.type='button';b.setAttribute('aria-label',`${op}, afirmación ${i+1}`);b.addEventListener('click',()=>{respuesta.replaceChildren(nodo('strong',op==='Falso'?'Coincide con el reglamento.':'Revisa el procedimiento.'));respuesta.append(nodo('p',v.feedback));const a=nodo('a',`${v.article} · página ${v.page}`);a.href=`Reglamento_Evaluacion_CEIA_2027-2030.pdf#page=${v.page}`;a.target='_blank';a.rel='noopener';respuesta.append(a);respuesta.hidden=false;Array.from(buttons.children).forEach(btn=>btn.setAttribute('aria-pressed',String(btn===b)));});buttons.append(b);});
    art.append(buttons,respuesta);el('afirmaciones').append(art);
  });
  datos.cases.forEach(c=>{
    const art=document.createElement('article');art.className='caso';art.append(nodo('h3',`Caso ${c.id} · ${c.title}`),nodo('p',c.text),nodo('p',`Desafío: ${c.challenge}`));
    const a=nodo('a',`${c.article} · página ${c.page}`);a.href=`Reglamento_Evaluacion_CEIA_2027-2030.pdf#page=${c.page}`;a.target='_blank';a.rel='noopener';art.append(a);
    const d=document.createElement('details');d.append(nodo('summary','Orientaciones para contrastar tu propuesta'),nodo('p',c.guide));art.append(d);el('listaCasos').append(art);
  });
}
fetch('contenido.json').then(r=>{if(!r.ok)throw new Error();return r.json();}).then(d=>{
  datos=d;d.slides.forEach((s,i)=>{const o=nodo('option',`${i+1} · ${s.title}`);o.value=String(i);el('salto').append(o);});
  const seg=Math.round(d.slides.reduce((a,s)=>a+s.duration,0));el('estado').textContent=`13 láminas · ${Math.floor(seg/60)}:${String(seg%60).padStart(2,'0')} de narración · Puedes pausar o elegir cualquier lámina.`;
  mostrar((Number(new URLSearchParams(location.search).get('lamina'))||1)-1);actividades();
  el('anterior').onclick=()=>mostrar(indice-1,!audio.paused);el('siguiente').onclick=()=>mostrar(indice+1,!audio.paused);
  el('salto').onchange=e=>mostrar(Number(e.target.value));el('reproducir').onclick=()=>audio.paused?audio.play().catch(()=>{el('estado').textContent='No se pudo iniciar el audio. Prueba el control de reproducción.';}):audio.pause();
  el('completa').onclick=()=>el('pantalla').requestFullscreen?.().catch(()=>{});
  audio.addEventListener('play',()=>el('reproducir').textContent='Pausar');audio.addEventListener('pause',()=>el('reproducir').textContent='Reproducir');
  audio.addEventListener('ended',()=>{if(el('automatico').checked&&indice<d.slides.length-1)mostrar(indice+1,true);});
  audio.addEventListener('error',()=>el('estado').textContent='No se pudo cargar este audio. Puedes consultar la transcripción y avanzar.');
}).catch(()=>el('estado').textContent='No se pudo cargar la presentación. Recarga la página.');
