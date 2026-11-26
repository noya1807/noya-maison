// WhatsApp links on a computer (phones keep wa.me, which opens the app):
// the first time, ask once – the WhatsApp app on this computer, or WhatsApp Web – and remember the answer.
// App: whatsapp://send opens the chat inside the WhatsApp already open (no new login window).
// Web: always reuses the same tab ("noya_wa"), so it doesn't open a new WhatsApp Web tab on every share.
(function(){
  if(window.__noyaWa)return;window.__noyaWa=1;
  var KEY="noya_wa_mode";
  function get(){try{return localStorage.getItem(KEY)||"";}catch(e){return "";}}
  function set(v){try{v?localStorage.setItem(KEY,v):localStorage.removeItem(KEY);}catch(e){}}
  function parts(href){var u=new URL(href);return {phone:u.pathname.replace(/\D/g,""),text:u.searchParams.get("text")||""};}
  function openApp(p){location.href="whatsapp://send?"+(p.phone?"phone="+p.phone+"&":"")+"text="+encodeURIComponent(p.text);}
  function openWeb(p){var url="https://web.whatsapp.com/send?"+(p.phone?"phone="+p.phone+"&":"")+"text="+encodeURIComponent(p.text);
    var w=window.open(url,"noya_wa");if(!w)location.href=url;}
  function copyIt(p){var t=p.text;var done=function(){toast("ההודעה הועתקה ✓ עכשיו פתחו את וואטסאפ, בחרו צ'אט והדביקו (Ctrl+V)");};
    if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(t).then(done,function(){fallback(t);done();});}else{fallback(t);done();}}
  function fallback(t){var ta=document.createElement("textarea");ta.value=t;ta.style.position="fixed";ta.style.opacity="0";document.body.appendChild(ta);ta.select();try{document.execCommand("copy");}catch(e){}ta.remove();}
  function toast(m){css();var n=document.createElement("div");n.className="wap-bg";n.style.background="transparent";n.style.pointerEvents="none";n.style.alignItems="flex-end";
    n.innerHTML='<div class="wap" style="margin-bottom:24px;padding:12px 14px"><p style="margin:0;color:#2e6b45;font-weight:700">'+m+'</p></div>';document.body.appendChild(n);setTimeout(function(){n.remove();},6000);}
  function css(){if(document.getElementById("waPickCss"))return;var s=document.createElement("style");s.id="waPickCss";
    s.textContent=".wap-bg{position:fixed;inset:0;background:rgba(40,25,15,.45);z-index:99999;display:flex;align-items:center;justify-content:center;font-family:Assistant,Arial,sans-serif;direction:rtl}"+
    ".wap{background:#fffaf3;border-radius:18px;padding:20px 20px 16px;width:min(380px,92vw);box-shadow:0 16px 40px rgba(0,0,0,.25);color:#3f271c}"+
    ".wap h3{margin:0 0 6px;font-size:19px}.wap p{margin:0 0 12px;font-size:14px;color:#7a5a48}.wap button{display:block;width:100%;margin:8px 0 0;padding:12px;border-radius:12px;font:inherit;font-size:16px;font-weight:700;cursor:pointer;border:1px solid #d9c3a0;background:#fff;color:#3f271c}"+
    ".wap button.app{background:#25a85f;border-color:#25a85f;color:#fff}.wap label{display:flex;gap:6px;align-items:center;font-size:13px;color:#7a5a48;margin-top:10px}.wap .x{background:none;border:0;color:#a08670;font-weight:400;font-size:14px;margin-top:4px}";
    document.head.appendChild(s);}
  function note(p){var n=document.createElement("div");n.className="wap-bg";n.style.background="transparent";n.style.pointerEvents="none";n.style.alignItems="flex-end";
    n.innerHTML='<div class="wap" style="pointer-events:auto;margin-bottom:24px;padding:12px 14px"><p style="margin:0">וואטסאפ לא נפתח? <a href="#" id="wapCopy">העתקת ההודעה</a> · <a href="#" id="wapWeb">WhatsApp Web</a> · <a href="#" id="wapReset">לשנות בחירה</a></p></div>';
    document.body.appendChild(n);n.querySelector("#wapWeb").onclick=function(e){e.preventDefault();set("web");n.remove();openWeb(p);};
    n.querySelector("#wapCopy").onclick=function(e){e.preventDefault();set("copy");n.remove();copyIt(p);};
    n.querySelector("#wapReset").onclick=function(e){e.preventDefault();set("");n.remove();};setTimeout(function(){n.remove();},9000);}
  function pick(p){css();var bg=document.createElement("div");bg.className="wap-bg";
    bg.innerHTML='<div class="wap" role="dialog" aria-label="איך לפתוח וואטסאפ"><h3>איך לפתוח את וואטסאפ?</h3><p>נזכור את הבחירה בפעם הבאה.</p>'+
      '<button class="app" data-m="app">💻 באפליקציית וואטסאפ במחשב</button><button data-m="web">🌐 ב-WhatsApp Web (בדפדפן)</button><button data-m="copy">📋 העתקת ההודעה, ואני אדביק בוואטסאפ שכבר פתוח</button>'+
      '<p style="margin:10px 0 0;font-size:12.5px">ההעתקה עובדת תמיד: מעתיקים, עוברים לוואטסאפ ומדביקים בצ\'אט.</p><button class="x" data-m="">ביטול</button></div>';
    document.body.appendChild(bg);
    bg.addEventListener("click",function(e){var b=e.target.closest("[data-m]");if(!b&&e.target!==bg)return;bg.remove();if(!b)return;var m=b.dataset.m;if(!m)return;set(m);
      if(m==="app"){openApp(p);note(p);}else if(m==="copy")copyIt(p);else openWeb(p);});}
  document.addEventListener("click",function(e){var a=e.target.closest&&e.target.closest('a[href*="wa.me/"]');if(!a)return;
    if(matchMedia("(pointer:coarse)").matches)return;
    var p;try{p=parts(a.href);}catch(_){return;}
    e.preventDefault();e.stopPropagation();var m=get();
    if(m==="app"){openApp(p);note(p);}else if(m==="web"){openWeb(p);note(p);}else if(m==="copy")copyIt(p);else pick(p);},true);
  window.noyaWaReset=function(){set("");};
})();
