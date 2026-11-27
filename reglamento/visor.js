'use strict';
const $=id=>document.getElementById(id);
const norm=t=>String(t).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
let doc=null,current=1,original=false,term='';
function pageURL(n){return doc.source_pdf+'#page='+n}
function highlight(text,container){
 container.replaceChildren();const at=term?norm(text).indexOf(norm(term)):-1;
 if(at<0){container.textContent=text;return}
 const mark=document.createElement('mark');mark.textContent=text.slice(at,at+term.length);
 container.append(document.createTextNode(text.slice(0,at)),mark,document.createTextNode(text.slice(at+term.length)));
}
function show(n,focus=false){
 if(!doc)return;current=Math.max(1,Math.min(doc.page_count,Number(n)||1));
 const p=doc.pages[current-1];$('page').value=current;$('pageTitle').textContent='Página '+current+' de '+doc.page_count;
 highlight(p.text || 'Esta página contiene contenido gráfico sin texto extraíble. Consúltala en «Página original».',$('pageText'));$('prev').disabled=current===1;$('next').disabled=current===doc.page_count;
 $('openPage').href=pageURL(current);if(original)$('pdfFrame').src=pageURL(current);
 const u=new URL(location.href);u.searchParams.set('pagina',current);history.replaceState(null,'',u);
 if(!p.text.trim())view(true);
 if(focus)$('pageTitle').focus();
}
function view(pdf){
 if(!doc)return;
 original=pdf;$('textTab').setAttribute('aria-pressed',String(!pdf));$('pdfTab').setAttribute('aria-pressed',String(pdf));$('pageText').hidden=pdf;$('pdfFrame').hidden=!pdf;
 if(pdf)$('pdfFrame').src=pageURL(current);
}
function buildIndex(){
 const groups=[...new Set(doc.index.map(e=>e.group))];
 for(const group of groups){const d=document.createElement('details'),s=document.createElement('summary');s.textContent=group;d.append(s);d.open=group==='Capítulos';
 for(const entry of doc.index.filter(e=>e.group===group)){const b=document.createElement('button');b.type='button';b.textContent=entry.title+' · p. '+entry.page;b.onclick=()=>show(entry.page,true);d.append(b)}
 $('index').append(d)}
}
function search(){
 if(!doc)return;term=$('query').value.trim();$('matches').replaceChildren();$('results').hidden=!term;
 if(!term){$('message').textContent=doc.page_count+' páginas disponibles.';show(current);return}
 const matches=doc.pages.filter(p=>norm(p.text).includes(norm(term)));
 $('message').textContent=matches.length+' páginas contienen «'+term+'».';
 for(const p of matches){const b=document.createElement('button');b.type='button';const h=document.createElement('strong');h.textContent='Página '+p.page;const t=document.createElement('span');const at=norm(p.text).indexOf(norm(term));t.textContent='…'+p.text.slice(Math.max(0,at-70),at+180).replace(/\s+/g,' ')+'…';b.append(h,t);b.onclick=()=>{view(false);show(p.page,true)};$('matches').append(b)}
 if(matches.length){view(false);show(matches[0].page)}
}
$('searchForm').onsubmit=e=>{e.preventDefault();search()};
$('clear').onclick=()=>{$('query').value='';search()};
$('pageForm').onsubmit=e=>{e.preventDefault();show($('page').value,true)};
$('prev').onclick=()=>show(current-1);$('next').onclick=()=>show(current+1);
$('textTab').onclick=()=>view(false);$('pdfTab').onclick=()=>view(true);
fetch('contenido.json').then(r=>{if(!r.ok)throw Error('No se pudo cargar el índice');return r.json()}).then(d=>{
 doc=d;$('page').max=d.page_count;$('total').textContent='de '+d.page_count;buildIndex();
 const url=new URL(location.href);show(url.searchParams.get('pagina')||10);$('message').textContent=d.page_count+' páginas disponibles. La numeración coincide con el PDF original.';
 if(url.searchParams.get('buscar')){$('query').value=url.searchParams.get('buscar');search()}
}).catch(()=>{$('message').textContent='No fue posible cargar el texto navegable. Puedes abrir o descargar el PDF original con los botones superiores.'});
