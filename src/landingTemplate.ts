// Adapted from https://github.com/Stremio/stremio-addon-sdk/blob/v1.6.2/src/landingTemplate.js
import { CustomManifest } from './types';
import { envGet } from './utils';

export function landingTemplate(manifest: CustomManifest) {
  const logo = manifest.logo || 'https://dl.strem.io/addon-logo.png';
  const shortDesc = manifest.description.split('\n\n')[0];

  const fmhySourceConfigs = manifest.config.filter(c => c.key.startsWith('disableFmhySource_'));

  const sourceChips = fmhySourceConfigs.map((c) => {
    const isOff = c.default === 'checked';
    return `<div class="ec${isOff ? ' ec-off' : ''}" data-key="${c.key}">${c.title}</div>`;
  }).join('');

  const customDesc = envGet('CONFIGURATION_DESCRIPTION')
    ? `<div class="note">${envGet('CONFIGURATION_DESCRIPTION')}</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${manifest.name} — Stremio Addon</title>
<link rel="icon" href="${logo}">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{min-height:100%;background:#282a36;font-family:'Inter',Arial,sans-serif;color:#f8f8f2}
body{position:relative;z-index:1;display:flex;justify-content:center;padding:2rem 1rem 5.5rem;min-height:100vh}
.page{width:100%;max-width:600px}
.hdr{display:flex;align-items:center;gap:1.25rem;margin-bottom:1.5rem}
.hdr-logo{width:58px;height:58px;border-radius:14px;overflow:hidden;flex-shrink:0}
.hdr-logo img{width:100%;height:100%;object-fit:contain}
.hdr-name{font-size:1.5rem;font-weight:700;line-height:1.2}
.hdr-ver{font-size:.78rem;opacity:.5;margin-top:3px}
.hdr-desc{font-size:.76rem;opacity:.65;margin-top:5px;line-height:1.45}
.links{display:flex;flex-wrap:wrap;gap:.5rem;margin-bottom:1.25rem}
.lnk{display:inline-flex;align-items:center;padding:.3rem .75rem;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.13);border-radius:8px;color:#fff;text-decoration:none;font-size:.75rem;font-weight:500;transition:background .15s}
.lnk:hover{background:rgba(255,255,255,.14)}
.card{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.11);border-radius:12px;padding:1.25rem;margin-bottom:.875rem}
.ct{font-size:.63rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;opacity:.42;margin-bottom:.875rem}
.ls{width:100%;background:rgba(255,255,255,.09);border:1px solid rgba(255,255,255,.14);border-radius:8px;color:#fff;font-family:inherit;font-size:.83rem;padding:.42rem .72rem;outline:none;margin-bottom:.72rem}
.ls::placeholder{opacity:.32}
.ls:focus{border-color:rgba(138,90,171,.55)}
.lgrid{display:flex;flex-wrap:wrap;gap:.38rem}
.lc{cursor:pointer;user-select:none}
.lc input{position:absolute;opacity:0;width:0;height:0}
.lc span{display:inline-block;padding:.26rem .58rem;border-radius:18px;font-size:.76rem;font-weight:500;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.12);transition:all .12s;white-space:nowrap}
.lc:hover span{background:rgba(138,90,171,.22);border-color:rgba(138,90,171,.4)}
.lc input:checked+span{background:rgba(138,90,171,.44);border-color:#8A5AAB}
.lc.hidden{display:none}
.rgrid{display:flex;flex-wrap:wrap;gap:.38rem}
.rc{cursor:pointer;user-select:none;display:inline-block;padding:.2rem .48rem;border-radius:6px;font-size:.7rem;font-weight:500;background:rgba(138,90,171,.35);border:1px solid rgba(138,90,171,.6);transition:all .12s}
.rc:hover{background:rgba(138,90,171,.5)}
.rc.rc-off{background:rgba(210,50,50,.28);border-color:rgba(210,50,50,.58);text-decoration:line-through;opacity:.6}
.rc.rc-off:hover{opacity:.65}
.hint{font-size:.68rem;opacity:.35;margin-top:.5rem}
.field{margin-bottom:.72rem}
.field:last-child{margin-bottom:0}
.fl{display:block;font-size:.65rem;font-weight:600;text-transform:uppercase;letter-spacing:.07em;opacity:.48;margin-bottom:.28rem}
.fi{width:100%;background:rgba(255,255,255,.09);border:1px solid rgba(255,255,255,.14);border-radius:8px;color:#fff;font-family:inherit;font-size:.83rem;padding:.48rem .72rem;outline:none}
.fi::placeholder{opacity:.28}
.fi:focus{border-color:rgba(138,90,171,.55)}
.ab{background:none;border:none;color:rgba(255,255,255,.42);font-size:.63rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;cursor:pointer;font-family:inherit;display:flex;align-items:center;gap:.38rem;width:100%;padding:0}
.ab:hover{color:rgba(255,255,255,.72)}
.ab .ar{display:inline-block;transition:transform .2s}
.ab.open .ar{transform:rotate(180deg)}
.abody{display:none;margin-top:.875rem}
.abody.open{display:block}
.or{display:flex;align-items:center;gap:.6rem;cursor:pointer;padding:.32rem 0;font-size:.83rem}
.or input[type=checkbox]{accent-color:#8A5AAB;width:15px;height:15px;cursor:pointer;flex-shrink:0}
.divider{border:none;border-top:1px solid rgba(255,255,255,.08);margin:.875rem 0}
.esub{font-size:.63rem;opacity:.36;margin-bottom:.45rem}
.egrid{display:flex;flex-wrap:wrap;gap:.32rem}
.ec{cursor:pointer;user-select:none;display:inline-block;padding:.2rem .48rem;border-radius:6px;font-size:.7rem;font-weight:500;background:rgba(138,90,171,.35);border:1px solid rgba(138,90,171,.6);transition:all .12s}
.ec:hover{background:rgba(138,90,171,.5)}
.ec.ec-off{background:rgba(210,50,50,.28);border-color:rgba(210,50,50,.58);text-decoration:line-through;opacity:.6}
.ec.ec-off:hover{opacity:.65}
.note{font-size:.74rem;opacity:.52;line-height:1.5;padding:.6rem .85rem;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:8px}
.note a{color:#b98ae0}
.note code{font-family:monospace;background:rgba(255,255,255,.1);padding:.1em .3em;border-radius:3px;font-size:.9em}
.ibar{position:fixed;bottom:0;left:0;right:0;padding:.875rem 1rem;background:linear-gradient(to top,rgba(0,0,0,.9) 55%,transparent);z-index:100;display:flex;justify-content:center}
.ibtn{display:inline-block;background:#8A5AAB;color:#fff;text-decoration:none;font-family:inherit;font-size:.88rem;font-weight:700;letter-spacing:.06em;padding:.72rem 3.5rem;border-radius:10px;transition:background .15s,transform .1s;box-shadow:0 3px 14px rgba(138,90,171,.36)}
.ibtn:hover{background:#9d6dc0}
.ibtn:active{transform:scale(.97)}
.cbtn{display:inline-flex;align-items:center;gap:.4rem;background:#44475a;color:#f8f8f2;border:1px solid #6272a4;font-family:inherit;font-size:.78rem;font-weight:600;padding:.6rem 1.2rem;border-radius:10px;cursor:pointer;transition:background .15s}
.cbtn:hover{background:#5a5e7a}
.cbtn.copied{background:rgba(80,200,120,.22);border-color:rgba(80,200,120,.5);color:#50c878}
@media(max-width:480px){.hdr{flex-direction:column;align-items:flex-start}.hdr-logo{width:46px;height:46px}}
</style>
</head>
<body>
<div class="page">
  <div class="hdr">
    <div class="hdr-logo"><img src="${logo}" alt="${manifest.name}"></div>
    <div>
      <div class="hdr-name">${manifest.name}</div>
      <div class="hdr-ver">v${manifest.version || '0.0.0'}</div>
      <div class="hdr-desc">${shortDesc}</div>
    </div>
  </div>

  <div class="links">
    <a href="https://github.com/RisPNG/fmhywebstremio" target="_blank" class="lnk">⬡ GitHub</a>
    <a href="https://github.com/RisPNG/fmhywebstremio/issues" target="_blank" class="lnk">⚠ Issues</a>
  </div>

  ${customDesc}

  <form id="mainForm">

    ${fmhySourceConfigs.length
      ? `<div class="card">
      <div class="ct">🕸 FMHY Sources</div>
      <div class="egrid">${sourceChips}</div>
      <div class="hint">Current health appears after each site. Click a site to disable it for this addon URL.</div>
    </div>`
      : ''}

  </form>

</div>

<div class="ibar" style="gap:.75rem"><a id="installLink" class="ibtn" href="#">INSTALL</a><button type="button" id="copyBtn" class="cbtn">📋 Copy URL</button></div>

<script>
const form=document.getElementById('mainForm');
const ilink=document.getElementById('installLink');
const updateLink=()=>{
  const data=new FormData(form);
  const config=Object.fromEntries([...data.entries()].filter(([,v])=>v!==''));
  ilink.href='stremio://'+window.location.host+'/'+encodeURIComponent(JSON.stringify(config))+'/manifest.json';
};
form.addEventListener('change',updateLink);

document.querySelectorAll('.ec.ec-off').forEach(chip=>{
  const inp=document.createElement('input');
  inp.type='hidden';inp.name=chip.dataset.key;inp.value='on';inp.id='hx_'+chip.dataset.key;
  form.appendChild(inp);
});

document.querySelectorAll('.ec').forEach(chip=>{
  chip.addEventListener('click',()=>{
    chip.classList.toggle('ec-off');
    const key=chip.dataset.key;
    const ex=document.getElementById('hx_'+key);
    if(chip.classList.contains('ec-off')){
      if(!ex){const inp=document.createElement('input');inp.type='hidden';inp.name=key;inp.value='on';inp.id='hx_'+key;form.appendChild(inp);}
    } else {
      if(ex)ex.remove();
    }
    updateLink();
  });
});

const copyBtn=document.getElementById('copyBtn');
if(copyBtn){
  copyBtn.addEventListener('click',()=>{
    const manifestUrl=ilink.href.replace(/^stremio:\\/\\//,'https://');
    navigator.clipboard.writeText(manifestUrl).then(()=>{
      copyBtn.textContent='✓ Copied!';copyBtn.classList.add('copied');
      setTimeout(()=>{copyBtn.textContent='📋 Copy URL';copyBtn.classList.remove('copied');},2000);
    }).catch(()=>{copyBtn.textContent='✗ Failed';setTimeout(()=>{copyBtn.textContent='📋 Copy URL';},1500);});
  });
}
updateLink();
</script>
</body>
</html>`;
}
