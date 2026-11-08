// Aplica o tema antes de desenhar a página (sem piscar branco). Sem escolha salva, segue o tema do sistema.
// Páginas públicas e de login ficam sempre claras.
(function () {
  try {
    var p = location.pathname, pub = ["/login"];
    for (var i = 0; i < pub.length; i++) if (p.indexOf(pub[i]) === 0) return;
    var t = localStorage.getItem("tema");
    var d = t === "escuro" || (t !== "claro" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", d);
  } catch (e) {}
})();
