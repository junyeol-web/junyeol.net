// Small and quiet: fade images in, play videos only while on screen, mark the current section in the menu.
(() => {
  const reveal = (img) => img.classList.add("ok");
  document.querySelectorAll(".plate img, .m img").forEach((img) => {
    if (img.complete && img.naturalWidth) reveal(img);
    else {
      img.addEventListener("load", () => reveal(img), { once: true });
      img.addEventListener("error", () => reveal(img), { once: true });
    }
  });

  // project page: bring the current work into view in the rail (the rail scrolls, not the page)
  const rail = document.querySelector(".rail");
  const here = rail && rail.querySelector('[aria-current="page"]');
  if (here) {
    const li = here.parentElement;
    if (rail.scrollHeight > rail.clientHeight) rail.scrollTop = li.offsetTop - rail.clientHeight / 2 + li.offsetHeight / 2;
    else rail.scrollLeft = li.offsetLeft - rail.clientWidth / 2 + li.offsetWidth / 2;
  }

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
