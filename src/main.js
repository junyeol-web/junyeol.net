// Small and quiet: fade images in, play videos only while on screen, mark the current section,
// and move between works on the project page without a page reload.
(() => {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const io = "IntersectionObserver" in window;

  // ── images fade in as they arrive
  const reveal = (img) => img.classList.add("ok");
  const watchImages = (root) =>
    root.querySelectorAll(".plate img, .m img").forEach((img) => {
      if (img.complete && img.naturalWidth) reveal(img);
      else {
        img.addEventListener("load", () => reveal(img), { once: true });
        img.addEventListener("error", () => reveal(img), { once: true });
      }
    });

  // ── videos: load on approach, play when visible, pause when not
  const vio = io
    ? new IntersectionObserver(
        (entries) =>
          entries.forEach(({ target: v, isIntersecting }) => {
            if (isIntersecting) {
              if (!v.src) v.src = v.dataset.src;
              v.play().catch(() => {});
            } else v.pause();
          }),
        { rootMargin: "200px 0px" }
      )
    : null;
  // Vimeo players: attach the iframe only when it gets near the screen, fade it in once loaded
  const startFrame = (f) => {
    if (f.src) return;
    f.addEventListener("load", () => setTimeout(() => f.classList.add("ok"), 250), { once: true });
    f.src = f.dataset.src;
  };
  const fio = io
    ? new IntersectionObserver(
        (entries) => entries.forEach(({ target, isIntersecting }) => { if (isIntersecting) { startFrame(target); fio.unobserve(target); } }),
        { rootMargin: "400px 0px" }
      )
    : null;
  const watchVideos = (root) => {
    root.querySelectorAll("video[data-src]").forEach((v) => {
      if (vio) vio.observe(v);
      else { v.src = v.dataset.src; v.autoplay = true; }
    });
    root.querySelectorAll(".vimeo iframe[data-src]").forEach((f) => (fio ? fio.observe(f) : startFrame(f)));
  };

  // ── Vimeo cover clips on the grid: load near the screen, loop only the chosen seconds, pause off screen
  const VIMEO = "https://player.vimeo.com";
  const clips = new Map(); // contentWindow -> { frame, start, end, plate }
  const tell = (frame, method, value) => frame.contentWindow && frame.contentWindow.postMessage(JSON.stringify(value === undefined ? { method } : { method, value }), VIMEO);
  addEventListener("message", (e) => {
    if (e.origin !== VIMEO) return;
    const clip = clips.get(e.source);
    if (!clip) return;
    let msg;
    try { msg = typeof e.data === "string" ? JSON.parse(e.data) : e.data; } catch { return; }
    if (msg.event === "ready") {
      ["timeupdate", "playing", "play"].forEach((ev) => tell(clip.frame, "addEventListener", ev));
      if (clip.start) tell(clip.frame, "setCurrentTime", clip.start);
      if (clip.visible) tell(clip.frame, "play");
    } else if (msg.event === "timeupdate" && msg.data) {
      if (msg.data.seconds >= clip.end || msg.data.seconds < clip.start - 0.5) tell(clip.frame, "setCurrentTime", clip.start);
    } else if (msg.event === "playing" || msg.event === "play") {
      clip.plate.classList.add("is-playing");
    }
  });
  const cio = io
    ? new IntersectionObserver(
        (entries) =>
          entries.forEach(({ target: f, isIntersecting }) => {
            const clip = [...clips.values()].find((c) => c.frame === f);
            if (isIntersecting && !f.src) {
              f.src = f.dataset.src;
              clips.set(f.contentWindow, { frame: f, start: +f.dataset.start || 0, end: +f.dataset.end || 6, plate: f.closest(".plate"), visible: true });
            } else if (clip) {
              clip.visible = isIntersecting;
              tell(f, isIntersecting ? "play" : "pause");
            }
          }),
        { rootMargin: "150px 0px" }
      )
    : null;
  document.querySelectorAll(".cover-vid iframe[data-src]").forEach((f) => {
    if (cio) cio.observe(f);
  });

  watchImages(document);
  watchVideos(document);

  // ── name in the tab bar: on the landing page, glide back to the top instead of reloading
  const name = document.querySelector(".menu-name");
  if (name && document.body.dataset.page === "index") {
    name.addEventListener("click", (e) => {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
      if (location.hash) history.replaceState(null, "", location.pathname + location.search);
    });
  }

  // ── menu: current section on the landing page
  if (io) {
    const links = document.querySelectorAll("[data-nav]");
    const set = (key) => links.forEach((a) => a.classList.toggle("is-current", a.dataset.nav === key));
    const sio = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && set(e.target.dataset.section)),
      { rootMargin: "-45% 0px -50% 0px" }
    );
    document.querySelectorAll("[data-section]").forEach((s) => sio.observe(s));
  }

  // ── project page: the rail
  const rail = document.querySelector(".rail");
  if (!rail) return;

  const centerCurrent = (smooth) => {
    const here = rail.querySelector('[aria-current="page"]');
    if (!here) return;
    const li = here.parentElement;
    const vertical = rail.scrollHeight > rail.clientHeight;
    const opts = vertical
      ? { top: li.offsetTop - rail.clientHeight / 2 + li.offsetHeight / 2 }
      : { left: li.offsetLeft - rail.clientWidth / 2 + li.offsetWidth / 2 };
    rail.scrollTo({ ...opts, behavior: smooth && !reduced ? "smooth" : "auto" });
  };
  centerCurrent(false);

  // Move between works in place: fetch the next page, wait until its first images are decoded,
  // then swap the article inside a view transition. The rail and tab bar never leave the screen.
  const pages = new Map();
  const load = (href) => {
    if (!pages.has(href)) {
      pages.set(
        href,
        fetch(href, { credentials: "same-origin" })
          .then((r) => (r.ok ? r.text() : Promise.reject(r.status)))
          .then((html) => new DOMParser().parseFromString(html, "text/html"))
          .catch((err) => { pages.delete(href); throw err; })
      );
    }
    return pages.get(href);
  };

  // decode the images the visitor will see first, so nothing pops in after the swap
  const ready = (article) => {
    const imgs = [...article.querySelectorAll(".project-media img")].slice(0, 2);
    const jobs = imgs.map((src) => {
      const img = new Image();
      if (src.sizes) img.sizes = src.sizes;
      if (src.srcset) img.srcset = src.srcset;
      img.src = src.getAttribute("src");
      return img.decode().catch(() => {});
    });
    const timeout = new Promise((r) => setTimeout(r, 900));
    return Promise.race([Promise.all(jobs), timeout]);
  };

  let busy = false;
  const go = async (href, push) => {
    if (busy) return;
    busy = true;
    try {
      const doc = await load(href);
      const next = doc.querySelector("article.project");
      const current = document.querySelector("article.project");
      if (!next || !current) throw new Error("not a project page");
      await ready(next);

      const swap = () => {
        const fresh = document.importNode(next, true);
        current.replaceWith(fresh);
        document.title = doc.title;
        const path = new URL(href, location.href).pathname;
        rail.querySelectorAll("a").forEach((a) => {
          if (new URL(a.href).pathname === path) a.setAttribute("aria-current", "page");
          else a.removeAttribute("aria-current");
        });
        fresh.querySelectorAll(".project-media img").forEach((img, i) => { if (i < 2) reveal(img); });
        watchImages(fresh);
        watchVideos(fresh);
        bindNav(fresh);
        window.scrollTo({ top: 0, behavior: "instant" });
      };

      if (push) history.pushState({ project: true }, "", href);
      if (document.startViewTransition && !reduced) await document.startViewTransition(swap).finished.catch(() => {});
      else swap();
      centerCurrent(true);
    } catch {
      location.href = href; // anything unexpected: just navigate normally
    } finally {
      busy = false;
    }
  };

  const isWork = (a) => a && a.origin === location.origin && /\/work\/[^/]+\/?$/.test(a.pathname);
  const intercept = (e) => {
    const a = e.currentTarget;
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    if (a.pathname === location.pathname) return;
    go(a.href, true);
  };
  const warm = (e) => load(e.currentTarget.href).catch(() => {});
  const bindNav = (root) =>
    root.querySelectorAll("a").forEach((a) => {
      if (!isWork(a)) return;
      a.addEventListener("click", intercept);
      a.addEventListener("pointerenter", warm, { once: true });
      a.addEventListener("touchstart", warm, { once: true, passive: true });
    });

  bindNav(rail);
  bindNav(document.querySelector("article.project") || document);
  history.replaceState({ project: true }, "", location.href);
  addEventListener("popstate", (e) => {
    if (e.state && e.state.project && /\/work\//.test(location.pathname)) go(location.href, false);
    else location.reload();
  });
})();
