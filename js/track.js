/* Noya – analytics consent + events. GA (Google tag GTM-W9WCSJ4X) runs in consent mode:
   nothing is stored until the visitor approves. Clarity loads only after approval. */
(function () {
  var CLARITY = ""; // Microsoft Clarity project id (set when the project exists)
  var KEY = "noyaConsent";
  function get() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function put(v) { try { localStorage.setItem(KEY, v); } catch (e) {} }
  function gt() { window.dataLayer = window.dataLayer || []; window.dataLayer.push(arguments); }
  window.noyaTrack = function (name, params) { try { gt("event", name, params || {}); if (window.clarity) window.clarity("event", name); } catch (e) {} };
  function clarity() {
    if (!CLARITY || window.clarity) return;
    (function (c, l, a, r, i, t, y) { c[a] = c[a] || function () { (c[a].q = c[a].q || []).push(arguments); }; t = l.createElement(r); t.async = 1; t.src = "https://www.clarity.ms/tag/" + i; y = l.getElementsByTagName(r)[0]; y.parentNode.insertBefore(t, y); })(window, document, "clarity", "script", CLARITY);
    window.clarity("consent");
  }
  function grant() { gt("consent", "update", { analytics_storage: "granted" }); clarity(); }
  function banner() {
    var b = document.createElement("div");
    b.setAttribute("role", "dialog"); b.setAttribute("aria-label", "הודעה על עוגיות");
    b.style.cssText = "position:fixed;left:12px;right:12px;bottom:12px;z-index:99999;max-width:560px;margin:auto;background:#fffaf3;color:#4a2f22;border:1px solid #e2d3c0;border-radius:16px;box-shadow:0 12px 30px -12px rgba(74,47,34,.45);padding:14px 16px;font:15px/1.5 Assistant,Arial,sans-serif;direction:rtl;display:flex;gap:10px;align-items:center;flex-wrap:wrap";
    b.innerHTML = '<span style="flex:1 1 260px">אנחנו משתמשים בעוגיות כדי להבין איך משתמשים באתר ולשפר אותו. <a href="https://www.noyaglobal.com/%D7%9E%D7%93%D7%99%D7%A0%D7%99%D7%95%D7%AA-%D7%A4%D7%A8%D7%98%D7%99%D7%95%D7%AA" target="_blank" rel="noopener" style="color:#4a2f22">מדיניות פרטיות</a></span>' +
      '<button type="button" data-v="yes" style="font:inherit;font-weight:700;border:0;border-radius:99px;padding:8px 18px;background:#cfab6c;color:#4a2f22;cursor:pointer">מאשר</button>' +
      '<button type="button" data-v="no" style="font:inherit;border:1.5px solid #cfab6c;border-radius:99px;padding:7px 16px;background:#fff;color:#4a2f22;cursor:pointer">רק הכרחיות</button>';
    b.addEventListener("click", function (e) { var v = e.target.getAttribute && e.target.getAttribute("data-v"); if (!v) return; put(v); if (v === "yes") grant(); b.remove(); });
    document.body.appendChild(b);
  }
  var c = get();
  if (c === "yes") grant(); else if (!c) { if (document.body) banner(); else document.addEventListener("DOMContentLoaded", banner); }

  // ---- events ----
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a,button");
    if (!a) return;
    var h = a.getAttribute("href") || "";
    if (/wa\.me|whatsapp/i.test(h)) noyaTrack("whatsapp_click", { link_url: h.split("?")[0], page_path: location.pathname });
    else if (/^tel:/.test(h)) noyaTrack("phone_click", { page_path: location.pathname });
    else if (/^mailto:/.test(h)) noyaTrack("email_click", { page_path: location.pathname });
    else if (a.id === "quoteBtn") noyaTrack("quote_open");
    else if (/[?&](add|set|budget|cat)=/.test(h) || (h === "/" && location.pathname !== "/")) noyaTrack("builder_link", { link_url: h, page_path: location.pathname });
  }, true);
  function wrap(name, ev, fn) {
    var f = window[name]; if (typeof f !== "function" || f.__noya) return;
    var w = function () { try { noyaTrack(ev, fn ? fn.apply(null, arguments) : {}); } catch (e) {} return f.apply(this, arguments); };
    w.__noya = 1; window[name] = w;
  }
  function hook() {
    wrap("add", "add_to_box", function (id) { return { item_id: String(id) }; });
    wrap("makeQuotePdf", "quote_pdf");
    wrap("shareWhatsApp", "share_whatsapp");
    wrap("shareLink", "share_link");
    wrap("playReveal", "box_reveal");
  }
  if (document.readyState === "complete") hook(); else window.addEventListener("load", hook);
})();
