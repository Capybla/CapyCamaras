'use strict';
console.log('CapyCámaras · app v4');
const REF={name:'Paiporta',lat:39.4278,lon:-0.4169};
const DGT_QUERY='https://services1.arcgis.com/nCKYwcSONQTkPA4K/arcgis/rest/services/CamarasDGT/FeatureServer/0/query';
const DGT_PORTAL='https://www.dgt.es/conoce-el-estado-del-trafico/camaras-de-trafico/';
const VLC_CKAN='https://opendata.vlci.valencia.es/api/3/action/package_show?id=cameres-trafic-camaras-trafico';
const VLC_RT_CKAN='https://opendata.vlci.valencia.es/api/3/action/package_show?id=estat-transit-temps-real';
const VLC_CAM_LAYER='https://geoportal.valencia.es/server/rest/services/OPENDATA/Trafico/MapServer/190/query';
const VLC_VISOR='https://camaras.valencia.es/camaras/visualizador.html?id=';
const PROXY='https://images.weserv.nl/?url=';
const PAGE=60,STALE_MS=108e5,PROBE_MS=9000,SRC_CAP=1400,MAP_CAP=1200,OPT_CAP=220;
const FIRST_BATCH=250,BATCH=1000,REQ_MS=12000,BUDGET_MS=45000;

let cameraMap=null,mapMarkers=new Map(),mapReady=false,mapPromise=null,tileSwapped=false,mapTimer=null,activeCard=null,rzTimer=null;
let dgtCams=[],valenciaCams=[],customCams=[],extraCams=[],all=[],filtered=[],shown=0;
let selected=null,viewToken=0,loadedAt=null,paused=false,nextAt=0,lastCatalog=null,catalogLoading=false,catalogError='';
let hlsInstance=null,munTimer=null,io=null,repaintTimer=null;

const PROV={'01':'Álava','02':'Albacete','03':'Alicante','04':'Almería','05':'Ávila','06':'Badajoz','07':'Illes Balears','08':'Barcelona','09':'Burgos','10':'Cáceres','11':'Cádiz','12':'Castellón','13':'Ciudad Real','14':'Córdoba','15':'A Coruña','16':'Cuenca','17':'Girona','18':'Granada','19':'Guadalajara','20':'Gipuzkoa','21':'Huelva','22':'Huesca','23':'Jaén','24':'León','25':'Lleida','26':'La Rioja','27':'Lugo','28':'Madrid','29':'Málaga','30':'Murcia','31':'Navarra','32':'Ourense','33':'Asturias','34':'Palencia','35':'Las Palmas','36':'Pontevedra','37':'Salamanca','38':'Santa Cruz de Tenerife','39':'Cantabria','40':'Segovia','41':'Sevilla','42':'Soria','43':'Tarragona','44':'Teruel','45':'Toledo','46':'València','47':'Valladolid','48':'Bizkaia','49':'Zamora','50':'Zaragoza','51':'Ceuta','52':'Melilla'};
const KIND_LABEL={img:'Imagen fija',mjpeg:'MJPEG',hls:'HLS',video:'Vídeo',iframe:'Página',portal:'Portal'};

const PORTALS=[
{uid:'p-dgt',name:'DGT · portal de cámaras de carreteras',town:'España',prov:'',org:'DGT',url:DGT_PORTAL,desc:'Portal oficial de la DGT.'},
{uid:'p-avamet',name:'AVAMET · webcams meteorológicas',town:'Comunitat Valenciana',prov:'',org:'AVAMET',url:'https://www.avamet.org/mxo-webcams.php',desc:'Webcams de la red AVAMET.'},
{uid:'p-cv',name:'Webcams Comunitat Valenciana',town:'Comunitat Valenciana',prov:'',org:'Generalitat / Turisme',url:'https://www.comunitatvalenciana.com/es/webcams',desc:'Webcams de playas y localidades.'},
{uid:'p-vlc-min',name:'València · València al minut',town:'València',prov:'46',org:'Ajuntament de València',url:'https://www.valencia.es/valenciaalminut/',desc:'Cuadro de mando municipal.'},
{uid:'p-vlc-od',name:'València · catálogo de cámaras',town:'València',prov:'46',org:'Ajuntament de València',url:'https://opendata.vlci.valencia.es/es/dataset/cameres-trafic-camaras-trafico',desc:'Catálogo municipal de datos abiertos.'},
{uid:'p-torrent',name:'Torrent · GeoTransit',town:'Torrent',prov:'46',org:'Ajuntament de Torrent',url:'https://geotransit.torrent.es/',desc:'Portal municipal de movilidad.'},
{uid:'p-argos',name:'ARGOS ATLAS · cámaras CV',town:'Comunitat Valenciana',prov:'',org:'ARGOS ATLAS (tercero)',url:'https://argosatlas.com/camaras/espana/comunitat-valenciana/',desc:'Agregador de terceros.'},
{uid:'p-meteoblue',name:'meteoblue · webcams cercanas',town:'Paiporta',prov:'46',org:'meteoblue (tercero)',url:'https://www.meteoblue.com/es/tiempo/webcams/paiporta_espa%C3%B1a_2513029',desc:'Directorio de webcams cercanas.'}
].map(p=>Object.assign({kind:'portal',road:'',pk:null,dir:'',lat:null,lon:null,img:'',src:p.url},p));

function parseDigitraffic(j){const o=[];for(const f of(j.features||[])){const p=f.properties||{},g=f.geometry&&f.geometry.coordinates;if(!Array.isArray(g))continue;const lat=+g[1],lon=+g[0];if(!isFinite(lat)||!isFinite(lon))continue;for(const pr of(p.presets||[])){if(!pr||!pr.id)continue;o.push({id:String(pr.id),name:(p.name||p.id||'Cámara')+' · '+pr.id,lat,lon,img:'https://weathercam.digitraffic.fi/'+pr.id+'.jpg',desc:'Cámara meteorológica (Fintraffic).'})}}return o}
function parseTfl(j){const a=Array.isArray(j)?j:(j&&j.places)||[],o=[];for(const p of a){const ap=p.additionalProperties||{},img=safeUrl(ap.imageUrl||'')||(p.id?'https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/'+p.id+'.jpg':'');if(!img)continue;o.push({id:String(p.id||img),name:p.commonName||('JamCam '+p.id),lat:+p.lat,lon:+p.lon,img,desc:'Cámara de Transport for London.'})}return o}
function parseMadrid(j){const o=[],w=x=>{if(!x||typeof x!=='object')return;if(Array.isArray(x)){x.forEach(w);return}const u=x.url||x.imagen||x.image||x.contentUrl;if(typeof u==='string'&&/\.(jpe?g|png)(\?|$)/i.test(u)){const l=x.location||x.geometry||{},c=Array.isArray(l.coordinates)?l.coordinates:null;o.push({id:String(x.id||x.identifier||u),name:String(x.title||x.name||x.descripcion||'Cámara Madrid'),lat:+(x.latitud||x.lat||l.latitude||(c&&c[1])),lon:+(x.longitud||x.lon||l.longitude||(c&&c[0])),img:safeUrl(u),desc:'Cámara municipal de Madrid.'})}for(const k in x){const v=x[k];if(v&&typeof v==='object')w(v)}};w(j);return o}
function parseCaltrans(j){const o=[];for(const d of(j.data||[]))for(const c of(d.cctv||[])){const l=c.location||{},img=safeUrl(l.imageSource||'');if(!img)continue;o.push({id:String(c.index||img),name:l.locationName||l.route||'Cámara Caltrans',lat:+l.latitude,lon:+l.longitude,img,desc:'Cámara de Caltrans.'})}return o}
const SOURCES=[
{id:'fi',zone:'Finlandia',org:'Fintraffic (Finlandia)',town:'',url:'https://tie.digitraffic.fi/api/weathercam/v1/stations',parse:parseDigitraffic},
{id:'uk-lon',zone:'Reino Unido',org:'Transport for London',town:'Londres',url:'https://api.tfl.gov.uk/Place/Type/JamCams',parse:parseTfl},
{id:'es-mad',zone:'España (otros)',org:'Ayuntamiento de Madrid',town:'Madrid',url:'https://datos.madrid.es/egob/catalogo/202088-0-trafico-camaras.json',parse:parseMadrid},
{id:'us-ca',zone:'Estados Unidos',org:'Caltrans (California)',town:'',parse:parseCaltrans,urls:Array.from({length:12},(_,i)=>'https://cwwp2.dot.ca.gov/data/d'+(i+1)+'/cctv/cctvStatusD'+String(i+1).padStart(2,'0')+'.json')},
{id:'w-windy',zone:'Mundo',org:'Windy.com',town:'',portal:true,url:'https://www.windy.com/-Webcams/webcams'},
{id:'w-skyline',zone:'Mundo',org:'SkylineWebcams',town:'',portal:true,url:'https://www.skylinewebcams.com/'},
{id:'w-earthcam',zone:'Mundo',org:'EarthCam',town:'',portal:true,url:'https://www.earthcam.com/'},
{id:'w-insecam',zone:'Mundo',org:'Insecam',town:'',portal:true,url:'https://www.insecam.org/'}
];

/* lookup inmune a HTML incompleto */
const dummy=()=>document.createElement('span');
const q=id=>document.getElementById(id)||dummy();
const on=(id,ev,fn)=>{const n=document.getElementById(id);if(n)n.addEventListener(ev,fn)};
const E={q:q('q'),fOrg:q('fOrg'),fKind:q('fKind'),fZone:q('fZone'),fProv:q('fProv'),fTown:q('fTown'),fRoad:q('fRoad'),fDist:q('fDist'),fSort:q('fSort'),list:q('list'),count:q('count'),thumbs:q('thumbs'),still:q('still'),video:q('video'),frame:q('frame'),overlay:q('overlay'),title:q('camTitle'),info:q('camInfo'),chips:q('camChips'),note:q('viewNote'),res:q('resList'),banner:q('banner'),status:q('statusLine'),autoInt:q('autoInt'),pause:q('btnPause'),cd:q('countdown'),srcList:q('srcList'),mapCount:q('mapCount')};

function el(t,c,x){const e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e}
function lower(o){const r={};for(const k in o)r[k.toLowerCase()]=o[k];return r}
function norm(s){return String(s==null?'':s).toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g,'')}
function haversine(a,b,c,d){const R=6371,r=x=>x*Math.PI/180,dl=r(c-a),dn=r(d-b);const h=Math.sin(dl/2)**2+Math.cos(r(a))*Math.cos(r(c))*Math.sin(dn/2)**2;return 2*R*Math.asin(Math.sqrt(h))}
function fmtTime(d){return d.toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}
function safeUrl(u){try{const x=new URL(u,location.href);return(x.protocol==='https:'||x.protocol==='http:')?x.href:''}catch(e){return ''}}
function bust(u){try{const x=new URL(u);x.searchParams.set('_t',Date.now());return x.href}catch(e){return u}}
function fetchT(url,ms,opt){const c=new AbortController(),t=setTimeout(()=>c.abort(),ms);return fetch(url,Object.assign({signal:c.signal},opt||{})).finally(()=>clearTimeout(t))}
function lsGet(k){try{return localStorage.getItem(k)}catch(e){return null}}
function lsSet(k,v){try{localStorage.setItem(k,v)}catch(e){}}
function esc(s){return String(s==null?'':s).replace(/[<>&"]/g,m=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[m]))}
function isMunicipal(c){return !!(c&&c.municipal)}
function isLive(c){return !!(c&&(c.kind==='mjpeg'||c.kind==='hls'||c.kind==='video'||isMunicipal(c)))}
function proxyUrl(u){try{const x=new URL(u);if(!x.host)return '';return PROXY+encodeURIComponent(x.host+x.pathname+x.search)}catch(e){return ''}}
function imgCandidates(u){u=String(u||'').trim();if(!u)return[];if(u.startsWith('//'))u='https:'+u;const d=[];if(u.startsWith('http://')){d.push('https://'+u.slice(7));if(location.protocol!=='https:')d.push(u)}else d.push(u);return d.concat(d.map(proxyUrl).filter(Boolean)).filter(x=>safeUrl(x))}

async function loadDGT(onBatch){
 const fields='OBJECTID,id,carretera,pk,sentido,provincia,imagen,latitud,longitud,NAMEUNIT,codine';
 const t0=Date.now();
 let offset=0,guard=0,total=0,noImg=0;
 while(guard++<12&&Date.now()-t0<BUDGET_MS){
  const size=guard===1?FIRST_BATCH:BATCH;
  const p=new URLSearchParams({where:'1=1',outFields:fields,returnGeometry:'false',orderByFields:'OBJECTID',resultOffset:String(offset),resultRecordCount:String(size),f:'json'});
  const r=await fetchT(DGT_QUERY+'?'+p,REQ_MS);
  if(!r.ok)throw new Error('HTTP '+r.status);
  const j=await r.json();
  if(j&&j.error)throw new Error('ArcGIS: '+(j.error.message||j.error.code));
  if(!j||!Array.isArray(j.features))throw new Error('respuesta sin «features»');
  const batch=[];
  for(const f of j.features){
   const a=lower(f.attributes||{});total++;
   const img=String(a.imagen||'').trim();
   if(!img){noImg++;continue}
   const code=(a.codine&&String(a.codine).length>=2)?String(a.codine).slice(0,2):(a.provincia!=null?String(a.provincia).padStart(2,'0'):'');
   const lat=+a.latitud,lon=+a.longitud,ok=isFinite(lat)&&isFinite(lon)&&lat!==0&&lon!==0;
   const road=String(a.carretera||'').trim(),pk=(a.pk!=null&&isFinite(+a.pk))?+a.pk:null,dir=String(a.sentido||'').trim();
   batch.push({uid:'dgt-'+(a.id!=null?a.id:a.objectid),kind:'img',org:'DGT',road,pk,dir,name:(road||'Cámara DGT')+(pk!=null?' · km '+pk:'')+(dir?' · '+dir:''),town:String(a.nameunit||'').trim(),prov:code,zone:'España',lat:ok?lat:null,lon:ok?lon:null,img,src:img,desc:'Cámara de la DGT (imagen fija).'});
  }
  if(batch.length)onBatch(batch);
  if(!(j.exceededTransferLimit&&j.features.length))break;
  offset+=j.features.length;
 }
 return {total,noImg};
}

function classifyCameraUrl(u){
 u=safeUrl(u);if(!u)return null;
 const l=u.toLowerCase().split('#')[0],path=l.split('?')[0];
 if(/\.m3u8$/.test(path)||path.includes('/hls/'))return 'hls';
 if(/\.(mp4|webm|ogg)$/.test(path))return 'video';
 if(/mjpeg|multipart|motion\.cgi|video\.mjpg|stream\.cgi/.test(path))return 'mjpeg';
 if(/\.(jpe?g|png|webp|gif|bmp|avif)$/.test(path))return 'img';
 if(/\.(html?|php|aspx?|jsp)$/.test(path))return 'iframe';
 if(/visualizador|embed|player|visor|reproductor/.test(l))return 'iframe';
 if(/camera|camara|camaras|trafic|traffic/.test(l)&&!/\.(html?|php)$/.test(path))return 'img';
 return 'iframe';
}

async function loadValenciaCams(){
 const byId=new Map();
 try{
  const u=VLC_CAM_LAYER+'?where=1%3D1&outFields=objectid,idcamara,descripcio,url,anggra&returnGeometry=true&outSR=4326&f=geojson&resultRecordCount=2000';
  const r=await fetchT(u,12000);
  if(r.ok){
   const j=await r.json();
   for(const f of(j.features||[])){
    const p=f.properties||{},g=f.geometry||{},co=Array.isArray(g.coordinates)?g.coordinates:null;
    const id=String(p.idcamara||p.objectid||'').trim();
    if(!id)continue;
    byId.set(id,{id,url:safeUrl(p.url||'')||(VLC_VISOR+encodeURIComponent(id)),lat:co?+co[1]:NaN,lon:co?+co[0]:NaN,desc:String(p.descripcio||'').trim()});
   }
  }
 }catch(e){}
 const out=[];
 for(const v of byId.values()){
  const ok=isFinite(v.lat)&&isFinite(v.lon)&&v.lat!==0&&v.lon!==0,n=String(v.id).replace(/\D/g,'');
  out.push({uid:'vlc-'+v.id,kind:classifyCameraUrl(v.url)||'iframe',org:'Ajuntament de València',road:'',pk:null,dir:'',prov:'46',zone:'España',name:v.desc||('Cámara València '+v.id),town:'València',lat:ok?v.lat:null,lon:ok?v.lon:null,img:v.url,src:v.url,municipal:true,imgGuess:n?'https://camaras.valencia.es/camaras/img/'+n+'.jpg':'',desc:'Fuente municipal (página de visualización).'});
 }
 return out;
}

function scheduleRepaint(){clearTimeout(repaintTimer);repaintTimer=setTimeout(()=>{rebuildAll();setStatus()},350)}

async function loadCatalogs(){
 if(catalogLoading)return;
 catalogLoading=true;catalogError='';setStatus();
 const vlcP=loadValenciaCams().then(v=>{valenciaCams=v;scheduleRepaint()}).catch(()=>{});
 try{
  const res=await loadDGT(b=>{dgtCams=dgtCams.concat(b);scheduleRepaint()});
  lastCatalog=new Date();
  catalogError='';
  setStatus(res.total+' registros, '+res.noImg+' sin imagen');
 }catch(e){
  const msg=(e&&e.name==='AbortError')?'tiempo agotado':(e&&e.message)||'error';
  catalogError=dgtCams.length
   ?'Carga parcial: la DGT dejó de responder ('+msg+'). Se muestran '+dgtCams.length+' cámaras. Pulsa «Actualizar» para reintentar.'
   :'No se pudo consultar la DGT ('+msg+'). Los portales locales y las fuentes mundiales siguen disponibles. Pulsa «Actualizar» para reintentar.';
 }
 await vlcP;
 catalogLoading=false;clearTimeout(repaintTimer);
 rebuildAll();setStatus();
 E.banner.textContent=catalogError;
 E.banner.classList.toggle('hidden',!catalogError);
}

function rebuildAll(){
 const map=new Map();
 for(const c of dgtCams.concat(valenciaCams,customCams,extraCams,PORTALS))if(c&&c.uid&&!map.has(c.uid))map.set(c.uid,c);
 all=Array.from(map.values());
 const orgs=new Set(),zones=new Set(),provs=new Set(),towns=new Set(),roads=new Set();
 for(const c of all){
  c._d=(c.lat!=null&&c.lon!=null)?haversine(REF.lat,REF.lon,c.lat,c.lon):null;
  c._hay=norm([c.name,c.town,c.road,c.dir,c.zone,PROV[c.prov]||'',c.org,c.desc].join(' '));
  if(c.org)orgs.add(c.org);
  if(c.zone)zones.add(c.zone);
  if(c.prov)provs.add(c.prov);
  if(c.kind!=='portal'){if(c.town)towns.add(c.town);if(c.road)roads.add(c.road)}
 }
 fillSelect(E.fOrg,'Todos los organismos',Array.from(orgs).sort((a,b)=>a.localeCompare(b,'es')).map(v=>[v,v]),E.fOrg.value,OPT_CAP);
 fillSelect(E.fZone,'Todas las zonas',Array.from(zones).sort((a,b)=>a.localeCompare(b,'es')).map(v=>[v,v]),E.fZone.value,0);
 fillSelect(E.fProv,'Todas las provincias',Array.from(provs).sort((a,b)=>(PROV[a]||a).localeCompare(PROV[b]||b,'es')).map(v=>[v,PROV[v]||('Provincia '+v)]),E.fProv.value,0);
 fillSelect(E.fTown,'Todas las localidades',Array.from(towns).sort((a,b)=>a.localeCompare(b,'es')).map(v=>[v,v]),E.fTown.value,OPT_CAP);
 fillSelect(E.fRoad,'Todas las carreteras',Array.from(roads).sort((a,b)=>a.localeCompare(b,'es',{numeric:true})).map(v=>[v,v]),E.fRoad.value,OPT_CAP);
 applyFilters();
}
function fillSelect(sel,allLabel,pairs,keep,cap){
 sel.replaceChildren();
 const o=el('option',null,allLabel);o.value='';sel.appendChild(o);
 const lim=cap&&pairs.length>cap?cap:pairs.length;
 for(let i=0;i<lim;i++){const x=el('option',null,pairs[i][1]);x.value=pairs[i][0];sel.appendChild(x)}
 if(cap&&pairs.length>cap){const x=el('option',null,'… '+(pairs.length-cap)+' más (usa la búsqueda)');x.value='';x.disabled=true;sel.appendChild(x)}
 sel.value=pairs.some(p=>p[0]===keep)?keep:'';
}

function applyFilters(){
 const qq=norm(E.q.value.trim()),org=E.fOrg.value,kind=E.fKind.value,zone=E.fZone.value,prov=E.fProv.value,town=E.fTown.value,road=E.fRoad.value,maxd=Number(E.fDist.value)||0,sort=E.fSort.value;
 const terms=qq?qq.split(/\s+/):null;
 filtered=[];
 for(const c of all){
  if(org&&c.org!==org)continue;
  if(kind){
   if(kind==='video'){if(!(c.kind==='mjpeg'||c.kind==='hls'||c.kind==='video'))continue}
   else if(kind==='liveimg'){if(!isMunicipal(c))continue}
   else if(c.kind!==kind)continue;
  }
  if(zone&&c.zone!==zone)continue;
  if(prov&&c.prov!==prov)continue;
  if(town&&c.town!==town)continue;
  if(road&&c.road!==road)continue;
  if(maxd&&(c._d==null||c._d>maxd))continue;
  if(terms){let ok=true;for(const t of terms)if(!c._hay.includes(t)){ok=false;break}if(!ok)continue}
  filtered.push(c);
 }
 const cmpD=(a,b)=>(a._d==null?1e9:a._d)-(b._d==null?1e9:b._d);
 if(sort==='road')filtered.sort((a,b)=>(a.road||'~').localeCompare(b.road||'~','es',{numeric:true})||((a.pk||0)-(b.pk||0)));
 else if(sort==='town')filtered.sort((a,b)=>(a.town||'~').localeCompare(b.town||'~','es')||cmpD(a,b));
 else filtered.sort((a,b)=>(a.kind==='portal')-(b.kind==='portal')||cmpD(a,b));
 shown=0;E.list.replaceChildren();E.list.scrollTop=0;activeCard=null;
 E.count.textContent=filtered.length+(filtered.length===1?' cámara':' cámaras');
 if(!filtered.length)E.list.appendChild(el('p','note',all.length?'Ninguna cámara coincide con los filtros.':'No hay cámaras cargadas.'));
 else renderMore();
 scheduleMap();
}
function renderMore(){
 const end=Math.min(shown+PAGE,filtered.length),frag=document.createDocumentFragment();
 for(let i=shown;i<end;i++)frag.appendChild(makeCard(filtered[i]));
 shown=end;E.list.appendChild(frag);
 observeThumbs(frag);
}
function observeThumbs(frag){
 if(!E.thumbs.checked)return;
 const nodes=Array.from(frag.querySelectorAll('.thumb[data-src]'));
 if(!('IntersectionObserver' in window)){nodes.forEach(loadThumb);return}
 if(!io)io=new IntersectionObserver(es=>{for(const e of es)if(e.isIntersecting){io.unobserve(e.target);loadThumb(e.target)}},{root:E.list,rootMargin:'200px'});
 nodes.forEach(t=>io.observe(t));
}
function loadThumb(t){
 const u=t.getAttribute('data-src');t.removeAttribute('data-src');if(!u)return;
 const im=new Image();im.decoding='async';im.referrerPolicy='no-referrer';im.alt='';
 im.onload=()=>t.replaceChildren(im);
 im.onerror=()=>{t.textContent='⚠'};
 im.src=u;
}
function makeCard(c){
 const b=el('button','card'+(selected&&selected.uid===c.uid?' active':''));b.type='button';b.dataset.uid=c.uid;
 const t=el('div','thumb',c.kind==='portal'?'◍':(c.kind==='img'?'▤':'▷'));
 if(c.kind==='img'&&E.thumbs.checked){const cand=imgCandidates(c.img);if(cand.length)t.setAttribute('data-src',cand[0])}
 const body=el('div','cardBody');
 body.appendChild(el('strong',null,c.name));
 body.appendChild(el('small',null,[c.town,c.zone||PROV[c.prov]].filter(Boolean).join(' · ')||c.desc||''));
 const chips=el('div','chips');
 chips.appendChild(el('span','chip',c.org));
 chips.appendChild(el('span','chip'+(isLive(c)?' live':''),isMunicipal(c)?'Municipal':KIND_LABEL[c.kind]));
 if(c._d!=null)chips.appendChild(el('span','chip dist',c._d<10?c._d.toFixed(1)+' km':Math.round(c._d)+' km'));
 body.appendChild(chips);
 b.append(t,body);
 b.addEventListener('click',()=>selectCam(c,b,true));
 return b;
}

function setOverlay(mode,msg,link,proxyBtn){
 const o=E.overlay;o.replaceChildren();o.className='overlay';
 if(mode==='none'){o.classList.add('hidden');return}
 if(mode==='loading'){o.appendChild(el('div','spin'));o.appendChild(el('span',null,msg||'Cargando…'));return}
 if(mode==='err')o.classList.add('err');
 o.appendChild(el('span',null,msg));
 if(link){const a=el('a',null,'Abrir la fuente en otra pestaña');a.href=link;a.target='_blank';a.rel='noopener noreferrer';o.appendChild(a)}
 if(proxyBtn){const b=el('button','btn','Reintentar con proxy');b.type='button';b.addEventListener('click',()=>{if(selected)showImage(selected,true,viewToken,true)});o.appendChild(b)}
}
function hideMedia(){
 E.still.classList.add('hidden');E.video.classList.add('hidden');E.frame.classList.add('hidden');
 E.still.onload=null;E.still.onerror=null;E.still.removeAttribute('src');
 try{E.video.pause()}catch(e){}
 if(hlsInstance){try{hlsInstance.destroy()}catch(e){}hlsInstance=null}
 E.video.onerror=null;E.video.onplaying=null;E.video.removeAttribute('src');try{E.video.load()}catch(e){}
 E.frame.onload=null;if(E.frame.getAttribute('src'))E.frame.src='about:blank';
 clearTimeout(munTimer);
}
function selectCam(c,cardEl,scroll){
 selected=c;viewToken++;loadedAt=null;hideMedia();
 E.res.replaceChildren();E.note.textContent='';E.note.className='note';
 E.title.textContent=c.name;
 const bits=[];if(c.town)bits.push(c.town);if(c.zone)bits.push(c.zone);
 if(c.prov&&PROV[c.prov]&&PROV[c.prov]!==c.zone)bits.push(PROV[c.prov]);
 if(c.road)bits.push(c.road+(c.pk!=null?' km '+c.pk:'')+(c.dir?' ('+c.dir+')':''));
 bits.push('Fuente: '+c.org);
 E.info.textContent=bits.join(' · ')+(c.desc&&c.kind!=='img'?' — '+c.desc:'');
 E.chips.replaceChildren();E.chips.appendChild(el('span','chip'+(isLive(c)?' live':''),isMunicipal(c)?'Municipal':KIND_LABEL[c.kind]));
 const del=document.getElementById('btnDel');if(del)del.classList.toggle('hidden',!c.custom);
 const bm=document.getElementById('btnMap');if(bm)bm.disabled=c.lat==null;
 const br=document.getElementById('btnReload');if(br)br.disabled=c.kind==='portal';
 if(activeCard)activeCard.classList.remove('active');
 if(cardEl){activeCard=cardEl;cardEl.classList.add('active')}
 showCam(c,false);resetCountdown();
 if(scroll&&window.matchMedia('(max-width:880px)').matches)E.title.scrollIntoView({behavior:'smooth',block:'start'});
}
function showCam(c,refresh){
 const tok=viewToken;
 if(c.kind==='img')return showImage(c,refresh,tok);
 if(c.kind==='mjpeg')return showMjpeg(c,tok);
 if(c.kind==='hls'||c.kind==='video')return showVideo(c,tok);
 if(c.kind==='iframe'){showFrame(c,tok);if(isMunicipal(c))tryMunicipalImage(c,tok);return}
 showPortal(c,tok);
}
function tryMunicipalImage(c,tok){
 if(!c.imgGuess)return;
 const p=new Image();p.referrerPolicy='no-referrer';
 p.onload=()=>{if(tok!==viewToken||!p.naturalWidth)return;c.kind='img';c.img=c.imgGuess;c.src=c.imgGuess;showImage(c,false,tok)};
 p.src=c.imgGuess;
}
function showImage(c,refresh,tok,forceProxy){
 const cands=imgCandidates(c.img);
 const urls=forceProxy?cands.filter(u=>u.startsWith(PROXY)):cands;
 if(!urls.length){setOverlay('err','Esta cámara no tiene una URL de imagen válida.',null,!!c.img);return}
 E.video.classList.add('hidden');E.frame.classList.add('hidden');
 if(!refresh||E.still.classList.contains('hidden'))setOverlay('loading','Cargando imagen…');
 let i=0;
 const next=()=>{
  if(tok!==viewToken)return;
  if(i>=urls.length){
   E.still.classList.add('hidden');
   setOverlay('err','No se pudo cargar la imagen. Puede estar desconectada, caducada, bloqueada o ser un enlace roto.',c.src,true);
   markCardError(c);return;
  }
  const base=urls[i++],u=refresh?bust(base):base;
  let done=false;const p=new Image();p.referrerPolicy='no-referrer';
  const fail=()=>{if(done)return;done=true;clearTimeout(tm);next()};
  const tm=setTimeout(fail,PROBE_MS);
  p.onload=()=>{
   if(done)return;done=true;clearTimeout(tm);
   if(tok!==viewToken||!p.naturalWidth)return;
   E.still.src=p.src;E.still.classList.remove('hidden');setOverlay('none');
   loadedAt=new Date();clearTimeout(munTimer);
   if(isMunicipal(c)){
    E.note.textContent='Cámara municipal: fotograma actualizado cada 5 s.';
    munTimer=setTimeout(()=>{if(tok===viewToken&&!document.hidden&&!paused)showImage(c,true,tok,forceProxy)},5000);
   }else E.note.textContent='Imagen fija cargada a las '+fmtTime(loadedAt)+'.';
   checkFreshness(base,tok);
  };
  p.onerror=fail;p.src=u;
 };
 next();
}
function markCardError(c){
 const b=E.list.querySelector('.card[data-uid="'+(window.CSS&&CSS.escape?CSS.escape(c.uid):c.uid)+'"] .chips');
 if(b&&!b.querySelector('.chip.err'))b.appendChild(el('span','chip err','sin imagen'));
}
function checkFreshness(url,tok){
 fetchT(url,6000,{method:'HEAD',cache:'no-store',referrerPolicy:'no-referrer'}).then(r=>{
  if(tok!==viewToken||!r.ok)return;
  const lm=r.headers.get('last-modified');if(!lm)return;
  const d=new Date(lm);if(isNaN(d))return;
  E.note.textContent+=' Última modificación: '+d.toLocaleString('es-ES')+'.';
  if(Date.now()-d.getTime()>STALE_MS){E.note.classList.add('warn');E.note.textContent+=' ⚠ Parece caducada.'}
 }).catch(()=>{});
}
function showMjpeg(c,tok){
 const u=safeUrl(c.img);if(!u){setOverlay('err','URL no válida.',null);return}
 setOverlay('loading','Conectando con el flujo MJPEG…');
 E.still.onload=()=>{if(tok===viewToken){setOverlay('none');E.note.textContent='Flujo MJPEG continuo.'}};
 E.still.onerror=()=>{if(tok===viewToken){E.still.classList.add('hidden');setOverlay('err','No se pudo abrir el flujo MJPEG.',c.src)}};
 E.still.src=u;E.still.classList.remove('hidden');
}
function loadScript(src){return new Promise((ok,ko)=>{const s=document.createElement('script');s.src=src;s.onload=ok;s.onerror=()=>ko(new Error('script'));document.head.appendChild(s)})}
async function showVideo(c,tok){
 const u=safeUrl(c.img);if(!u){setOverlay('err','URL no válida.',null);return}
 setOverlay('loading','Preparando vídeo…');
 const v=E.video;v.classList.remove('hidden');
 const fail=m=>{if(tok===viewToken){v.classList.add('hidden');setOverlay('err',m,c.src)}};
 v.onerror=()=>fail('El navegador no pudo reproducir este vídeo.');
 v.onplaying=()=>{if(tok===viewToken){setOverlay('none');E.note.textContent='Vídeo en directo.'}};
 try{
  if(c.kind==='hls'&&!v.canPlayType('application/vnd.apple.mpegurl')){
   if(!window.Hls)await loadScript('https://cdn.jsdelivr.net/npm/hls.js@1');
   if(tok!==viewToken)return;
   if(!window.Hls||!window.Hls.isSupported()){fail('Este navegador no admite HLS.');return}
   hlsInstance=new window.Hls();
   hlsInstance.on(window.Hls.Events.ERROR,(e,d)=>{if(d&&d.fatal)fail('Error fatal en el flujo HLS.')});
   hlsInstance.loadSource(u);hlsInstance.attachMedia(v);
  }else v.src=u;
  const pr=v.play();if(pr&&pr.catch)pr.catch(()=>setOverlay('none'));
 }catch(e){fail('No se pudo cargar el reproductor HLS.')}
}
function showFrame(c,tok){
 const u=safeUrl(c.img);if(!u){setOverlay('err','URL no válida.',null);return}
 setOverlay('loading','Cargando página de la cámara…');
 E.frame.classList.remove('hidden');
 E.frame.onload=()=>{
  if(tok!==viewToken)return;
  setOverlay('none');
  E.note.textContent=isMunicipal(c)?'Página oficial de la cámara municipal. Si queda en blanco, usa «Abrir fuente».':'Si queda en blanco, el proveedor impide la inserción: usa «Abrir fuente».';
 };
 E.frame.src=u;
}
function showPortal(c,tok){
 const o=E.overlay;o.replaceChildren();o.className='overlay';
 const municipal=isMunicipal(c)||/municipal|ajuntament|ayuntamiento/i.test(c.name+' '+c.org);
 const a=el('a',null,'Abrir '+c.org+' en otra pestaña');a.href=c.url;a.target='_blank';a.rel='noopener noreferrer';
 const b=el('button','btn',municipal?'Recargar':'Intentar incrustar');
 const load=()=>{
  if(tok!==viewToken)return;
  setOverlay('loading','Cargando página…');
  E.frame.classList.remove('hidden');
  E.frame.onload=()=>{if(tok===viewToken){setOverlay('none');E.note.textContent='Si queda en blanco, el portal bloquea la inserción. Usa «Abrir fuente».'}};
  E.frame.src=c.url;
 };
 o.appendChild(el('span',null,c.desc||'Portal externo.'));
 o.appendChild(a);b.addEventListener('click',load);o.appendChild(b);
 E.note.textContent=municipal?'Portal municipal: se intenta mostrar dentro del visor.':'Portal externo: se intenta incrustar.';
 if(municipal)setTimeout(load,0);
}

function mapColor(c){return c.org==='DGT'?'#35b86b':(isMunicipal(c)?'#e8b64c':'#9b6cff')}
function mapPopup(c){
 let h='<div class="mapPopup"><b>'+esc(c.name)+'</b><small>'+esc(c.desc||c.town||'')+'</small>';
 if(c.kind==='img'&&c.img){const cand=imgCandidates(c.img);if(cand.length)h+='<img src="'+esc(cand[0])+'" alt="" loading="lazy" referrerpolicy="no-referrer">'}
 return h+'<button type="button" data-map-uid="'+esc(c.uid)+'">Abrir en el visor</button></div>';
}
function scheduleMap(){clearTimeout(mapTimer);mapTimer=setTimeout(refreshMap,240)}
function ensureMap(){
 if(mapReady)return Promise.resolve(true);
 if(mapPromise)return mapPromise;
 mapPromise=buildMap().then(ok=>{mapPromise=null;return ok},()=>{mapPromise=null;return false});
 return mapPromise;
}
function loadLeaflet(){
 return new Promise((resolve,reject)=>{
  if(window.L)return resolve();
  const ex=document.querySelector('script[data-capy-leaflet]');
  if(ex){ex.addEventListener('load',resolve,{once:true});ex.addEventListener('error',()=>reject(new Error('Leaflet')),{once:true});return}
  if(!document.querySelector('link[data-capy-leaflet]')){
   const l=document.createElement('link');l.rel='stylesheet';l.href='https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';l.dataset.capyLeaflet='';document.head.appendChild(l);
  }
  const s=document.createElement('script');s.src='https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';s.dataset.capyLeaflet='';
  s.onload=resolve;s.onerror=()=>reject(new Error('Leaflet'));document.head.appendChild(s);
 });
}
async function buildMap(){
 const host=document.getElementById('cameraMap');if(!host)return false;
 host.replaceChildren();
 try{
  await loadLeaflet();
  if(!window.L)throw new Error('Leaflet');
  cameraMap=L.map(host,{preferCanvas:true,worldCopyJump:true}).setView([REF.lat,REF.lon],11);
  const esri=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,attribution:'© Esri · © OpenStreetMap'}).addTo(cameraMap);
  let errs=0;
  esri.on('tileerror',()=>{
   if(tileSwapped||++errs<8)return;
   tileSwapped=true;cameraMap.removeLayer(esri);
   L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',{maxZoom:20,subdomains:'abcd',attribution:'© OSM · © CARTO'}).addTo(cameraMap);
  });
  mapReady=true;
  cameraMap.on('popupopen',e=>{
   const b=e.popup.getElement()&&e.popup.getElement().querySelector('[data-map-uid]');
   if(!b)return;
   b.addEventListener('click',()=>{
    const c=all.find(x=>String(x.uid)===String(b.getAttribute('data-map-uid')));
    if(c){selectCam(c,null,false);switchTab('viewer')}
   });
  });
  cameraMap.whenReady(()=>cameraMap.invalidateSize());
  refreshMap();
  return true;
 }catch(e){
  host.innerHTML='<div class="mapFail">No se pudo cargar el mapa. Vuelve a pulsar «Mapa» para reintentar.</div>';
  return false;
 }
}
function refreshMap(){
 if(!mapReady||!cameraMap)return;
 const present=new Set();let n=0,clipped=false;
 for(const c of filtered){
  if(c.lat==null||c.lon==null)continue;
  const lat=+c.lat,lon=+c.lon;
  if(!Number.isFinite(lat)||!Number.isFinite(lon))continue;
  const key=String(c.uid);
  let m=mapMarkers.get(key);
  if(!m){
   if(n>=MAP_CAP){clipped=true;continue}
   m=L.circleMarker([lat,lon],{radius:6,weight:1.5,color:'#fff',fillColor:mapColor(c),fillOpacity:.92});
   m.bindPopup(()=>mapPopup(c));m.addTo(cameraMap);mapMarkers.set(key,m);n++;
  }else{m.setLatLng([lat,lon]);m.setStyle({fillColor:mapColor(c)});n++}
  present.add(key);
 }
 for(const [key,m] of Array.from(mapMarkers))if(!present.has(key)){m.remove();mapMarkers.delete(key)}
 E.mapCount.textContent=present.size+(clipped?' (máx. '+MAP_CAP+')':'')+' en mapa';
 if(present.size&&!cameraMap._capyFitted){
  const bounds=L.latLngBounds(Array.from(mapMarkers.values()).map(m=>m.getLatLng()));
  if(bounds.isValid()){cameraMap.fitBounds(bounds.pad(.08),{maxZoom:13});cameraMap._capyFitted=true}
 }
}
function fitMapToMarkers(){
 if(!mapReady||!cameraMap)return;
 const pts=Array.from(mapMarkers.values()).map(m=>m.getLatLng());
 if(!pts.length){cameraMap.setView([REF.lat,REF.lon],11);return}
 cameraMap.fitBounds(L.latLngBounds(pts).pad(.08),{maxZoom:13});
}
function switchTab(tab){
 const viewer=tab==='viewer';
 const vp=document.getElementById('viewerPanel'),mp=document.getElementById('mapPanel');
 if(vp)vp.style.display=viewer?'block':'none';
 if(mp)mp.style.display=viewer?'none':'block';
 const tv=document.getElementById('tabViewer'),tm=document.getElementById('tabMap');
 if(tv){tv.classList.toggle('active',viewer);tv.setAttribute('aria-selected',viewer?'true':'false')}
 if(tm){tm.classList.toggle('active',!viewer);tm.setAttribute('aria-selected',viewer?'false':'true')}
 if(viewer)return;
 ensureMap().then(ok=>{
  if(!ok||!mapReady)return;
  cameraMap.invalidateSize();refreshMap();fitMapToMarkers();
  setTimeout(()=>{if(mapReady)cameraMap.invalidateSize()},120);
 });
}
window.addEventListener('resize',()=>{clearTimeout(rzTimer);rzTimer=setTimeout(()=>{if(mapReady&&cameraMap)cameraMap.invalidateSize()},150)});

function interval(){return Number(E.autoInt.value)||0}
function resetCountdown(){nextAt=interval()&&!paused?Date.now()+interval()*1000:0;tick()}
function tick(){
 const iv=interval();
 if(!iv){E.cd.textContent='';E.pause.disabled=true;return}
 E.pause.disabled=false;
 if(paused){E.cd.textContent='En pausa';return}
 if(!selected||['portal','iframe','hls','video','mjpeg'].includes(selected.kind)){E.cd.textContent='';nextAt=Date.now()+iv*1000;maybeCatalog();return}
 const left=Math.max(0,Math.round((nextAt-Date.now())/1000));
 E.cd.textContent=left>=60?Math.floor(left/60)+' min '+(left%60)+' s':left+' s';
 if(Date.now()>=nextAt){
  if(document.hidden)nextAt=Date.now()+5000;
  else{nextAt=Date.now()+iv*1000;showCam(selected,true)}
 }
 maybeCatalog();
}
function maybeCatalog(){
 if(!interval()||paused||catalogLoading||document.hidden||!lastCatalog)return;
 if(Date.now()-lastCatalog.getTime()>36e5)loadCatalogs();
}
setInterval(tick,1000);

function setStatus(extra){
 E.status.replaceChildren();
 if(catalogLoading){
  E.status.append(document.createTextNode('Cargando DGT… '));
  E.status.append(el('b',null,String(dgtCams.length)));
  if(valenciaCams.length)E.status.append(document.createTextNode(' · '+valenciaCams.length+' València'));
  return;
 }
 E.status.append(el('b',null,String(dgtCams.length)),document.createTextNode(' DGT'));
 if(valenciaCams.length)E.status.appendChild(document.createTextNode(' · '+valenciaCams.length+' València'));
 if(extraCams.length)E.status.appendChild(document.createTextNode(' · '+extraCams.length+' mundo'));
 if(customCams.length)E.status.appendChild(document.createTextNode(' · '+customCams.length+' propias'));
 if(lastCatalog)E.status.appendChild(document.createTextNode(' · '+fmtTime(lastCatalog)));
 if(extra)E.status.appendChild(document.createTextNode(' ('+extra+')'));
 if(catalogError)E.status.appendChild(el('span',null,' · ⚠'));
}

function paintSources(){
 E.srcList.replaceChildren();
 for(const s of SOURCES){
  const row=el('label','srcRow');
  const cb=document.createElement('input');cb.type='checkbox';cb.checked=!!s.enabled;cb.disabled=s.state==='loading';
  cb.addEventListener('change',()=>toggleSource(s,cb.checked));
  const cnt=el('span','srcCount',s.state==='loading'?'…':(s.state==='error'?'⚠':(s.count!=null?String(s.count):'')));
  if(s.state==='error')cnt.classList.add('err');
  if(s.state==='loading')cnt.classList.add('load');
  row.append(cb,el('span','srcName',s.org+(s.town?' · '+s.town:'')+(s.portal?' (portal)':'')),cnt);
  E.srcList.appendChild(row);
 }
}
async function toggleSource(src,on_){
 src.enabled=on_;saveSources();
 if(!on_){extraCams=extraCams.filter(c=>c.sourceId!==src.id);src.state='';src.count=null;paintSources();rebuildAll();setStatus();return}
 if(src.state==='done'||src.state==='loading')return;
 if(src.portal){
  extraCams=extraCams.filter(c=>c.sourceId!==src.id).concat({uid:'x-'+src.id,kind:'portal',org:src.org,name:src.org+' · directorio',town:'',prov:'',zone:src.zone,road:'',pk:null,dir:'',lat:null,lon:null,img:'',src:src.url,url:src.url,sourceId:src.id,desc:'Directorio mundial de webcams.'});
  src.state='done';src.count=1;paintSources();rebuildAll();setStatus();return;
 }
 src.state='loading';paintSources();
 let acc=[];
 for(const u of(src.urls||[src.url])){
  try{
   const r=await fetchT(u,20000,{headers:{Accept:'application/json'}});
   if(!r.ok)continue;
   acc=acc.concat(src.parse(await r.json())||[]);
  }catch(e){}
  if(acc.length>=SRC_CAP)break;
 }
 const seen=new Set(),cams=[];
 for(const o of acc.slice(0,SRC_CAP)){
  const img=safeUrl(o.img||'');if(!img)continue;
  const uid='x-'+src.id+'-'+String(o.id).replace(/[^\w.\-]/g,'');
  if(seen.has(uid))continue;seen.add(uid);
  const lat=+o.lat,lon=+o.lon,ok=isFinite(lat)&&isFinite(lon)&&lat!==0&&lon!==0;
  cams.push({uid,kind:classifyCameraUrl(img)||'img',org:src.org,name:o.name||src.org,town:src.town||'',prov:'',zone:src.zone,road:'',pk:null,dir:'',lat:ok?lat:null,lon:ok?lon:null,img,src:img,sourceId:src.id,desc:o.desc||'Catálogo público.'});
 }
 extraCams=extraCams.filter(c=>c.sourceId!==src.id).concat(cams);
 src.state=cams.length?'done':'error';src.count=cams.length;
 paintSources();rebuildAll();setStatus();
}
function saveSources(){try{lsSet('capy_sources',JSON.stringify(SOURCES.filter(s=>s.enabled).map(s=>s.id)))}catch(e){}}

function loadCustom(){
 try{
  const a=JSON.parse(lsGet('capy_custom_cams')||'[]');
  if(Array.isArray(a))customCams=a.filter(x=>x&&x.uid&&safeUrl(x.img)).map(x=>Object.assign({org:'Personalizada',road:'',pk:null,dir:'',prov:'',zone:'',lat:null,lon:null,desc:'Cámara propia.',custom:true},x,{src:x.img}));
 }catch(e){customCams=[]}
}
function saveCustom(){lsSet('capy_custom_cams',JSON.stringify(customCams.map(c=>({uid:c.uid,kind:c.kind,name:c.name,town:c.town,img:c.img}))))}

function bindEvents(){
 let qt=null;
 E.q.addEventListener('input',()=>{clearTimeout(qt);qt=setTimeout(applyFilters,200)});
 E.fOrg.addEventListener('change',applyFilters);
 E.fKind.addEventListener('change',applyFilters);
 E.fZone.addEventListener('change',applyFilters);
 E.fProv.addEventListener('change',applyFilters);
 E.fTown.addEventListener('change',applyFilters);
 E.fRoad.addEventListener('change',applyFilters);
 E.fDist.addEventListener('change',applyFilters);
 E.fSort.addEventListener('change',applyFilters);
 E.thumbs.addEventListener('change',()=>{lsSet('capy_thumbs',E.thumbs.checked?'1':'0');applyFilters()});
 on('btnReset','click',()=>{
  E.q.value='';E.fOrg.value='';E.fKind.value='';E.fZone.value='';E.fProv.value='';E.fTown.value='';E.fRoad.value='';E.fDist.value='0';
  rebuildAll();
 });
 E.list.addEventListener('scroll',()=>{if(shown<filtered.length&&E.list.scrollTop+E.list.clientHeight>=E.list.scrollHeight-300)renderMore()},{passive:true});
 on('btnCatalog','click',loadCatalogs);
 on('tabViewer','click',()=>switchTab('viewer'));
 on('tabMap','click',()=>switchTab('map'));
 on('btnReload','click',()=>{if(selected){showCam(selected,true);resetCountdown()}});
 on('btnOpen','click',()=>{if(!selected)return;const u=safeUrl(selected.kind==='portal'?selected.url:selected.src);if(u)window.open(u,'_blank','noopener,noreferrer')});
 on('btnMap','click',()=>{
  if(!selected||selected.lat==null)return;
  switchTab('map');
  ensureMap().then(ok=>{
   if(!ok||!mapReady)return;
   cameraMap.invalidateSize();cameraMap.setView([selected.lat,selected.lon],15);
   const m=mapMarkers.get(String(selected.uid));if(m)setTimeout(()=>m.openPopup(),150);
  });
 });
 on('btnFull','click',()=>{
  const v=document.getElementById('viewer');if(!v)return;
  const f=v.requestFullscreen||v.webkitRequestFullscreen;
  if(f)f.call(v);else E.note.textContent='Pantalla completa no disponible.';
 });
 E.autoInt.addEventListener('change',()=>{lsSet('capy_auto',E.autoInt.value);resetCountdown()});
 E.pause.addEventListener('click',()=>{paused=!paused;E.pause.textContent=paused?'▶':'⏸';E.pause.classList.toggle('on',paused);resetCountdown()});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&interval()&&!paused&&selected&&Date.now()>=nextAt)tick()});
 on('addForm','submit',ev=>{
  ev.preventDefault();
  const uEl=document.getElementById('cUrl'),nEl=document.getElementById('cName'),tEl=document.getElementById('cTown'),tyEl=document.getElementById('cType');
  if(!uEl||!nEl)return;
  const url=safeUrl(uEl.value.trim()),name=nEl.value.trim();
  if(!url||!name)return;
  const c={uid:'c-'+Date.now(),kind:tyEl?tyEl.value:'img',name,town:tEl?tEl.value.trim():'',img:url,src:url,org:'Personalizada',road:'',pk:null,dir:'',prov:'',zone:'',lat:null,lon:null,desc:'Cámara propia.',custom:true};
  customCams.push(c);saveCustom();uEl.value='';nEl.value='';rebuildAll();setStatus();selectCam(c,null,true);
 });
 on('btnDel','click',()=>{
  if(!selected||!selected.custom||!confirm('¿Quitar esta cámara?'))return;
  customCams=customCams.filter(c=>c.uid!==selected.uid);saveCustom();selected=null;viewToken++;hideMedia();
  setOverlay('idle','Cámara eliminada. Selecciona otra.');E.title.textContent='Selecciona una cámara';rebuildAll();setStatus();
 });
}

window.addEventListener('error',e=>{
 if(!E.banner)return;
 E.banner.classList.remove('hidden');
 E.banner.textContent='Error de script: '+(e.message||'desconocido')+' — abre la consola (F12).';
});

(function init(){
 try{
  window.__capyBoot=true;
  const a=lsGet('capy_auto');
  if(a!==null&&Array.from(E.autoInt.options||[]).some(o=>o.value===a))E.autoInt.value=a;
  const t=lsGet('capy_thumbs'),sd=navigator.connection&&navigator.connection.saveData;
  E.thumbs.checked=t!==null?t==='1':!sd;
  loadCustom();
  bindEvents();
  paintSources();
  rebuildAll();          /* pinta ya: portales y filtros, sin red */
  setStatus('listo');
  tick();
  setTimeout(loadCatalogs,80);   /* la red va detrás, sin bloquear */
  let saved=[];
  try{saved=JSON.parse(lsGet('capy_sources')||'[]')}catch(e){}
  if(Array.isArray(saved))setTimeout(()=>{for(const id of saved){const s=SOURCES.find(x=>x.id===id);if(s)toggleSource(s,true)}},1500);
 }catch(e){
  const b=document.getElementById('banner');
  if(b){b.classList.remove('hidden');b.textContent='Fallo al iniciar: '+e.message}
  console.error(e);
 }
})();
/* fin */
