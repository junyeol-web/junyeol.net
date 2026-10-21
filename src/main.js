// Two small things, nothing else: fade images in as they load, and mark the current section in the header.
(() => {
  const reveal = (img) => img.classList.add("ok");
  document.querySelectorAll(".frame img, .m img").forEach((img) => {
    if (img.complete && img.naturalWidth) reveal(img);
    else {
      img.addEventListener("load", () => reveal(img), { once: true });
      img.addEventListener("error", () => reveal(img), { once: true });
    }
  });

  const sections = document.querySelectorAll("[data-section]");
  const links = document.querySelectorAll("[data-nav]");
  if (!sections.length || !("IntersectionObserver" in window)) return;
  const set = (key) => links.forEach((a) => a.classList.toggle("is-current", a.dataset.nav === key));
  const io = new IntersectionObserver(
    (entries) => entries.forEach((e) => e.isIntersecting && set(e.target.dataset.section)),
    { rootMargin: "-45% 0px -50% 0px" }
  );
  sections.forEach((s) => io.observe(s));
})();
