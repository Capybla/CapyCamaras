'use strict';
const REF = {name:'Paiporta', lat:39.4278, lon:-0.4169};
const DGT_QUERY = 'https://services1.arcgis.com/nCKYwcSONQTkPA4K/arcgis/rest/services/CamarasDGT/FeatureServer/0/query';
const DGT_PORTAL = 'https://www.dgt.es/conoce-el-estado-del-trafico/camaras-de-trafico/';
const VLC_CKAN = 'https://opendata.vlci.valencia.es/api/3/action/package_show?id=cameres-trafic-camaras-trafico';
const VLC_RT_CKAN = 'https://opendata.vlci.valencia.es/api/3/action/package_show?id=estat-transit-temps-real';
const VLC_CAM_LAYER = 'https://geoportal.valencia.es/server/rest/services/OPENDATA/Trafico/MapServer/190/query';
const VLC_VISOR = 'https://camaras.valencia.es/camaras/visualizador.html?id=';
const PROXY = 'https://images.weserv.nl/?url=';
const PAGE = 60, STALE_MS = 3*3600*1000, PROBE_MS = 9000, SRC_CAP = 1400, MAP_CAP = 1200, OPT_CAP = 220;

let cameraMap=null, mapMarkers=new Map(), mapReady=false, mapPromise=null, tileSwapped=false, mapTimer=null, activeCard=null, rzTimer=null;

const PROV = {'01':'Álava','02':'Albacete','03':'Alicante','04':'Almería','05':'Ávila','06':'Badajoz','07':'Illes Balears','08':'Barcelona','09':'Burgos','10':'Cáceres','11':'Cádiz','12':'Castellón','13':'Ciudad Real','14':'Córdoba','15':'A Coruña','16':'Cuenca','17':'Girona','18':'Granada','19':'Guadalajara','20':'Gipuzkoa','21':'Huelva','22':'Huesca','23':'Jaén','24':'León','25':'Lleida','26':'La Rioja','27':'Lugo','28':'Madrid','29':'Málaga','30':'Murcia','31':'Navarra','32':'Ourense','33':'Asturias','34':'Palencia','35':'Las Palmas','36':'Pontevedra','37':'Salamanca','38':'Santa Cruz de Tenerife','39':'Cantabria','40':'Segovia','41':'Sevilla','42':'Soria','43':'Tarragona','44':'Teruel','45':'Toledo','46':'València','47':'Valladolid','48':'Bizkaia','49':'Zamora','50':'Zaragoza','51':'Ceuta','52':'Melilla'};
const KIND_LABEL = {img:'Imagen fija', mjpeg:'MJPEG', hls:'HLS', video:'Vídeo', iframe:'Página', portal:'Portal'};

const PORTALS = [
 {uid:'p-dgt',name:'DGT · portal de cámaras de carreteras',town:'España',prov:'',org:'DGT',url:DGT_PORTAL,desc:'Portal oficial de la DGT.'},
 {uid:'p-avamet',name:'AVAMET · webcams meteorológicas',town:'Comunitat Valenciana',prov:'',org:'AVAMET',url:'https://www.avamet.org/mxo-webcams.php',desc:'Webcams de la red AVAMET.'},
 {uid:'p-cv',name:'Webcams Comunitat Valenciana',town:'Comunitat Valenciana',prov:'',org:'Generalitat / Turisme',url:'https://www.comunitatvalenciana.com/es/webcams',desc:'Webcams de playas y localidades.'},
 {uid:'p-vlc-min',name:'València · València al minut',town:'València',prov:'46',org:'Ajuntament de València',url:'https://www.valencia.es/valenciaalminut/',desc:'Cuadro de mando municipal.'},
 {uid:'p-vlc-od',name:'València · catálogo de cámaras',town:'València',prov:'46',org:'Ajuntament de València',url:'https://opendata.vlci.valencia.es/es/dataset/cameres-trafic-camaras-trafico',desc:'Catálogo municipal de datos abiertos.',ckan:VLC_CKAN},
 {uid:'p-torrent',name:'Torrent · GeoTransit',town:'Torrent',prov:'46',org:'Ajuntament de Torrent',url:'https://geotransit.torrent.es/',desc:'Portal municipal de movilidad.'},
 {uid:'p-argos',name:'ARGOS ATLAS · cámaras CV',town:'Comunitat Valenciana',prov:'',org:'ARGOS ATLAS (tercero)',url:'https://argosatlas.com/camaras/espana/comunitat-valenciana/',desc:'Agregador de terceros.'},
 {uid:'p-meteoblue',name:'meteoblue · webcams cercanas',town:'Paiporta',prov:'46',org:'meteoblue (tercero)',url:'https://www.meteoblue.com/es/tiempo/webcams/paiporta_espa%C3%B1a_2513029',desc:'Directorio de webcams cercanas.'}
].map(p=>Object.assign({kind:'portal',road:'',pk:null,dir:'',lat:null,lon:null,img:'',src:p.url},p));

/* ---------- parsers de fuentes ---------- */
function parseDigitraffic(j){
 const out=[];
 for(const f of (j.features||[])){
  const p=f.properties||{}, g=f.geometry&&f.geometry.coordinates;
  if(!Array.isArray(g))continue;
  const lat=Number(g[1]), lon=Number(g[0]);
  if(!isFinite(lat)||!isFinite(lon))continue;
  for(const pr of (p.presets||[])){
   if(!pr||!pr.id)continue;
   out.push({id:String(pr.id),name:(p.name||p.id||'Cámara')+' · '+pr.id,lat,lon,img:'https://weathercam.digitraffic.fi/'+pr.id+'.jpg',desc:'Cámara meteorológica de carretera (Fintraffic).'});
  }
 }
 return out;
}
function parseTfl(j){
 const arr=Array.isArray(j)?j:(j&&j.places)||[], out=[];
 for(const p of arr){
  const ap=p.additionalProperties||{};
  const img=safeUrl(ap.imageUrl||'')||(p.id?'https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/'+p.id+'.jpg':'');
  if(!img)continue;
  out.push({id:String(p.id||img),name:p.commonName||('JamCam '+p.id),lat:Number(p.lat),lon:Number(p.lon),img,desc:'Cámara de Transport for London.'});
 }
 return out;
}
function parseMadrid(j){
 const out=[];
 const walk=o=>{
  if(!o||typeof o!=='object')return;
  if(Array.isArray(o)){o.forEach(walk);return}
  const u=o.url||o.imagen||o.image||o.contentUrl;
  if(typeof u==='string'&&/\.(jpe?g|png)(\?|$)/i.test(u)){
   const loc=o.location||o.geometry||{}, co=Array.isArray(loc.coordinates)?loc.coordinates:null;
   out.push({id:String(o.id||o.identifier||u),name:String(o.title||o.name||o.descripcion||'Cámara Madrid'),
    lat:Number(o.latitud||o.lat||loc.latitude||(co&&co[1])),lon:Number(o.longitud||o.lon||loc.longitude||(co&&co[0])),
    img:safeUrl(u),desc:'Cámara municipal de Madrid.'});
  }
  for(const k in o){const v=o[k];if(v&&typeof v==='object')walk(v)}
 };
 walk(j);
 return out;
}
function parseCaltrans(j){
 const out=[];
 for(const d of (j.data||[]))for(const c of (d.cctv||[])){
  const l=c.location||{}, img=safeUrl(l.imageSource||'');
  if(!img)continue;
  out.push({id:String(c.index||img),name:l.locationName||l.route||'Cámara Caltrans',lat:Number(l.latitude),lon:Number(l.longitude),img,desc:'Cámara de Caltrans (California).'});
 }
 return out;
}
const SOURCES=[
 {id:'fi',zone:'Finlandia',org:'Fintraffic (Finlandia)',town:'',url:'https://tie.digitraffic.fi/api/weathercam/v1/stations',parse:parseDigitraffic},
 {id:'uk-lon',zone:'Reino Unido',org:'Transport for London',town:'Londres',url:'https://api.tfl.gov.uk/Place/Type/JamCams',parse:parseTfl},
 {id:'es-mad',zone:'España (otros)',org:'Ayuntamiento de Madrid',town:'Madrid',url:'https://datos.madrid.es/egob/catalogo/202088-0-trafico-camaras.json',parse:parseMadrid},
 {id:'us-ca',zone:'Estados Unidos',org:'Caltrans (California)',town:'',parse:parseCaltrans,
  urls:Array.from({length:12},(_,i)=>'https://cwwp2.dot.ca.gov/data/d'+(i+1)+'/cctv/cctvStatusD'+String(i+1).padStart(2,'0')+'.json')},
 {id:'w-windy',zone:'Mundo',org:'Windy.com',town:'',portal:true,url:'https://www.windy.com/-Webcams/webcams'},
 {id:'w-skyline',zone:'Mundo',org:'SkylineWebcams',town:'',portal:true,url:'https://www.skylinewebcams.com/'},
 {id:'w-earthcam',zone:'Mundo',org:'EarthCam',town:'',portal:true,url:'https://www.earthcam.com/'},
 {id:'w-insecam',zone:'Mundo',org:'Insecam',town:'',portal:true,url:'https://www.insecam.org/'}
];

/* ---------- estado ---------- */
let dgtCams=[], valenciaCams=[], customCams=[], extraCams=[], all=[], filtered=[], shown=0;
let selected=null, viewToken=0, loadedAt=null;
let paused=false, nextAt=0, lastCatalog=null, catalogLoading=false, catalogError='';
let hlsInstance=null, munTimer=null, io=null, repaintTimer=null;

const $=s=>document.querySelector(s);
const E={q:$('#q'),fOrg:$('#fOrg'),fKind:$('#fKind'),fZone:$('#fZone'),fProv:$('#fProv'),fTown:$('#fTown'),fRoad:$('#fRoad'),fDist:$('#fDist'),fSort:$('#fSort'),list:$('#list'),count:$('#count'),thumbs:$('#thumbs'),still:$('#still'),video:$('#video'),frame:$('#frame'),overlay:$('#overlay'),title:$('#camTitle'),info:$('#camInfo'),chips:$('#camChips'),note:$('#viewNote'),res:$('#resList'),banner:$('#banner'),status:$('#statusLine'),autoInt:$('#autoInt'),pause:$('#btnPause'),cd:$('#countdown'),srcList:$('#srcList'),mapCount:$('#mapCount')};

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
function imgCandidates(u){
 u=String(u||'').trim();if(!u)return[];
 if(u.startsWith('//'))u='https:'+u;
 const direct=[];
 if(u.startsWith('http://')){direct.push('https://'+u.slice(7));if(location.protocol!=='https:')direct.push(u)}
 else direct.push(u);
 return direct.concat(direct.map(proxyUrl).filter(Boolean)).filter(x=>safeUrl(x));
}

/* ---------- DGT progresivo ---------- */
async function loadDGT(onBatch){
 const fields='OBJECTID,id,carretera,pk,sentido,provincia,imagen,latitud,longitud,NAMEUNIT,codine';
 let offset=0, guard=0, total=0, noImg=0;
 while(guard++<10){
  const p=new URLSearchParams({where:'1=1',outFields:fields,returnGeometry:'false',orderByFields:'OBJECTID',resultOffset:String(offset),resultRecordCount:'2000',f:'json'});
  const r=await fetchT(DGT_QUERY+'?'+p.toString(),25000);
  if(!r.ok)throw new Error('HTTP '+r.status);
  const j=await r.json();
  if(j&&j.error)throw new Error('ArcGIS: '+(j.error.message||j.error.code));
  if(!j||!Array.isArray(j.features))throw new Error('respuesta sin «features»');
  const batch=[];
  for(const f of j.features){
   const a=lower(f.attributes||{}); total++;
   const img=String(a.imagen||'').trim();
   if(!img){noImg++;continue}
   const code=(a.codine&&String(a.codine).length>=2)?String(a.codine).slice(0,2):(a.provincia!=null?String(a.provincia).padStart(2,'0'):'');
   const lat=Number(a.latitud), lon=Number(a.longitud);
   const ok=isFinite(lat)&&isFinite(lon)&&lat!==0&&lon!==0;
   const road=String(a.carretera||'').trim(), pk=(a.pk!=null&&isFinite(Number(a.pk)))?Number(a.pk):null, dir=String(a.sentido||'').trim();
   batch.push({uid:'dgt-'+(a.id!=null?a.id:a.objectid),kind:'img',org:'DGT',road,pk,dir,
    name:(road||'Cámara DGT')+(pk!=null?' · km '+pk:'')+(dir?' · '+dir:''),
    town:String(a.nameunit||'').trim(),prov:code,zone:'España',lat:ok?lat:null,lon:ok?lon:null,img,src:img,
    desc:'Cámara de la DGT (imagen fija).'});
  }
  if(batch.length)onBatch(batch);
  if(j.exceededTransferLimit&&j.features.length)offset+=j.features.length; else break;
 }
 return {total,noImg};
}

function classifyCameraUrl(u){
 u=safeUrl(u); if(!u)return null;
 const l=u.toLowerCase().split('#')[0], path=l.split('?')[0];
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
  const u=VLC_CAM_LAYER+'?where=1%3D1&outFields=objectid,idcamara,tipocamara,descripcio,url,anggra&returnGeometry=true&outSR=4326&f=geojson&resultRecordCount=2000';
  const r=await fetchT(u,20000);
  if(r.ok){
   const j=await r.json();
   for(const f of (j.features||[])){
    const p=f.properties||{}, g=f.geometry||{}, co=Array.isArray(g.coordinates)?g.coordinates:null;
    const id=String(p.idcamara||p.objectid||'').trim();
    if(!id)continue;
    byId.set(id,{id,url:safeUrl(p.url||'')||(VLC_VISOR+encodeURIComponent(id)),
     lat:co?Number(co[1]):NaN,lon:co?Number(co[0]):NaN,desc:String(p.descripcio||'').trim(),ang:Number(p.anggra)});
   }
  }
 }catch(e){}
 if(!byId.size){
  try{
   const meta=await fetchT(VLC_RT_CKAN,15000);
   if(meta.ok){
    const pkg=await meta.json();
    for(const res of ((pkg&&pkg.result&&pkg.result.resources)||[])){
     if(!res||!safeUrl(res.url)||!/geojson|json/i.test((res.format||'')+' '+(res.name||'')))continue;
     try{
      const rr=await fetchT(res.url,20000,{cache:'no-store'});
      if(!rr.ok)continue;
      const j=await rr.json();
      for(const f of (j.features||[])){
       const a=lower(f.properties||{}), id=String(a.idcamara||a.objectid||'').trim(), url=safeUrl(a.url||'');
       if(!id||!url||byId.has(id))continue;
       byId.set(id,{id,url,lat:Number(a.latitud||a.latitude),lon:Number(a.longitud||a.longitude),desc:String(a.descripcio||'').trim(),ang:NaN});
      }
      if(byId.size)break;
     }catch(e){}
    }
   }
  }catch(e){}
 }
 const out=[];
 for(const v of byId.values()){
  const ok=isFinite(v.lat)&&isFinite(v.lon)&&v.lat!==0&&v.lon!==0;
  const numeric=String(v.id).replace(/\D/g,'');
  out.push({uid:'vlc-'+v.id,kind:classifyCameraUrl(v.url)||'iframe',org:'Ajuntament de València',
   road:'',pk:null,dir:'',prov:'46',zone:'España',name:v.desc||('Cámara València '+v.id),town:'València',
   lat:ok?v.lat:null,lon:ok?v.lon:null,img:v.url,src:v.url,municipal:true,
   imgGuess:numeric?'https://camaras.valencia.es/camaras/img/'+numeric+'.jpg':'',
   desc:'Fuente municipal de tráfico (página de visualización).'});
 }
 return out;
}

/* ---------- arranque ---------- */
function skeletons(n){
 E.list.replaceChildren();
 for(let i=0;i<n;i++)E.list.appendChild(el('div','skel'));
}
function scheduleRepaint(){
 clearTimeout(repaintTimer);
 repaintTimer=setTimeout(()=>{rebuildAll();setStatus()},400);
}
async function loadCatalogs(){
 if(catalogLoading)return;
 catalogLoading=true;catalogError='';setStatus();skeletons(6);
 let meta='';
 const vlcP=loadValenciaCams().then(v=>{valenciaCams=v;scheduleRepaint()}).catch(()=>{});
 try{
  const res=await loadDGT(batch=>{dgtCams=dgtCams.concat(batch);scheduleRepaint()});
  lastCatalog=new Date();
  meta=res.total+' registros DGT, '+res.noImg+' sin imagen';
 }catch(e){
  const msg=(e&&e.name==='AbortError')?'tiempo de espera agotado':(e&&e.message)||'error';
  catalogError='No se pudo cargar el catálogo de la DGT ('+msg+'). Comprueba la conexión y pulsa «Actualizar».';
 }
 await vlcP;
 catalogLoading=false;
 clearTimeout(repaintTimer);
 rebuildAll();setStatus(meta);
 E.banner.textContent=catalogError;
 E.banner.classList.toggle('hidden',!catalogError);
}

/* ---------- índice ---------- */
function rebuildAll(){
 const map=new Map();
 for(const c of dgtCams.concat(valenciaCams,customCams,extraCams,PORTALS))if(c&&c.uid&&!map.has(c.uid))map.set(c.uid,c);
 all=Array.from(map.values());
 const orgs=new Set(),zones=new Set(),provs=new Set(),towns=new Set(),roads=new Set();
 for(const c of all){
  c._d=(c.lat!=null&&c.lon!=null)?haversine(REF.lat,REF.lon,c.lat,c.lon):null;
  c._hay=norm([c.name,c.town,c.road,c.dir,c.zone,PROV[c.prov]
