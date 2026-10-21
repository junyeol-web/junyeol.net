// Small and quiet: fade images in, play videos only while on screen, mark the current section in the menu.
(() => {
  const reveal = (img) => img.classList.add("ok");
  document.querySelectorAll(".tile-media img, .m img").forEach((img) => {
    if (img.complete && img.naturalWidth) reveal(img);
    else {
      img.addEventListener("load", () => reveal(img), { once: true });
      img.addEventListener("error", () => reveal(img), { once: true });
    }
  });

  if (!("IntersectionObserver" in window)) {
    document.querySelectorAll("video[data-src]").forEach((v) => { v.src = v.dataset.src; v.autoplay = true; });
    return;
  }

  // videos: load on approach, play when visible, pause when not
  const vio = new IntersectionObserver(
    (entries) =>
      entries.forEach(({ target: v, isIntersecting }) => {
        if (isIntersecting) {
          if (!v.src) v.src = v.dataset.src;
          v.play().catch(() => {});
        } else v.pause();
      }),
    { rootMargin: "200px 0px" }
  );
  document.querySelectorAll("video[data-src]").forEach((v) => vio.observe(v));

  // menu: current section
  const links = document.querySelectorAll("[data-nav]");
  const set = (key) => links.forEach((a) => a.classList.toggle("is-current", a.dataset.nav === key));
  const sio = new IntersectionObserver(
    (entries) => entries.forEach((e) => e.isIntersecting && set(e.target.dataset.section)),
    { rootMargin: "-45% 0px -50% 0px" }
  );
  document.querySelectorAll("[data-section]").forEach((s) => sio.observe(s));
})();
