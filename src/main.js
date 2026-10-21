// Highlights the current section in the header while scrolling the feed. That's all — no scroll hijacking.
(() => {
  const sections = document.querySelectorAll("[data-section]");
  const links = document.querySelectorAll("[data-nav]");
  if (!sections.length || !("IntersectionObserver" in window)) return;

  const set = (key) => links.forEach((a) => a.classList.toggle("is-current", a.dataset.nav === key));
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) if (e.isIntersecting) set(e.target.dataset.section);
    },
    { rootMargin: "-45% 0px -50% 0px" }
  );
  sections.forEach((s) => io.observe(s));
  addEventListener("scroll", () => scrollY < 200 && set(""), { passive: true });
})();
