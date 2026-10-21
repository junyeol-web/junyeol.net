// Index interactions: hover preview, filter, list/images toggle. No dependencies.
(() => {
  const index = document.querySelector(".index");
  if (!index) return;

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  };

  // ── hover preview (desktop only; CSS hides it on touch layouts)
  const preview = index.querySelector(".preview");
  const pImg = preview.querySelector("img");
  const pVid = preview.querySelector("video");
  const fine = matchMedia("(hover: hover) and (pointer: fine)").matches;

  if (fine) {
    // warm the cache so the first hover is instant
    const warm = () =>
      index.querySelectorAll(".row a[data-preview]").forEach((a) => {
        if (a.dataset.kind === "image" && a.dataset.preview) new Image().src = a.dataset.preview;
      });
    "requestIdleCallback" in window ? requestIdleCallback(warm) : setTimeout(warm, 800);

    index.querySelectorAll(".row a").forEach((a) => {
      a.addEventListener("mouseenter", () => {
        const src = a.dataset.preview;
        if (!src) return;
        const isVideo = a.dataset.kind === "video";
        preview.classList.toggle("is-video", isVideo);
        if (isVideo) {
          if (pVid.getAttribute("src") !== src) pVid.src = src;
          pVid.play().catch(() => {});
        } else if (pImg.getAttribute("src") !== src) {
          pImg.src = src;
        }
        preview.classList.add("on");
      });
      a.addEventListener("mouseleave", () => {
        preview.classList.remove("on");
        pVid.pause();
      });
    });
  }

  // ── filter
  const filterBtns = index.querySelectorAll("[data-filter]");
  const items = index.querySelectorAll(".row, .tile");
  const applyFilter = (value) => {
    filterBtns.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.filter === value)));
    items.forEach((el) => {
      if (!value || el.dataset.category === value) el.removeAttribute("hidden-by-filter");
      else el.setAttribute("hidden-by-filter", "");
    });
    // keep row numbers sequential within the visible set
    let n = 0;
    index.querySelectorAll(".row").forEach((row) => {
      if (!row.hasAttribute("hidden-by-filter")) row.querySelector(".c-num").textContent = String(++n).padStart(2, "0");
    });
    const url = new URL(location.href);
    value ? url.searchParams.set("filter", value) : url.searchParams.delete("filter");
    history.replaceState(null, "", url);
  };
  filterBtns.forEach((b) => b.addEventListener("click", () => applyFilter(b.dataset.filter)));
  const initial = new URLSearchParams(location.search).get("filter");
  if (initial) applyFilter(initial);

  // ── view toggle (remembered per visitor)
  const viewBtns = index.querySelectorAll("[data-view-btn]");
  const setView = (v) => {
    index.dataset.view = v;
    viewBtns.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.viewBtn === v)));
    store.set("view", v);
  };
  viewBtns.forEach((b) => b.addEventListener("click", () => setView(b.dataset.viewBtn)));
  const saved = store.get("view");
  if (saved === "grid" || saved === "list") setView(saved);
})();
