const signalCopy = {
  tests: "An existing test boundary gives the compiler a concrete validation owner.",
  security: "A security requirement justifies specialist review instead of a generic extra agent.",
  delivery: "GitHub Actions evidence makes the delivery work visible and traceable.",
};
const coverageLabel = {
  recommended: "Recommended · required work plus independent verification",
  focused: "Focused · the smallest complete coverage",
  extended: "Extended · required work plus optional lifecycle support",
};

const menuToggle = document.querySelector(".menu-toggle");
const siteNav = document.querySelector(".site-nav");
const closeMenu = (returnFocus = false) => {
  if (!menuToggle || !siteNav) return;
  menuToggle.setAttribute("aria-expanded", "false");
  siteNav.classList.remove("is-open");
  if (returnFocus) menuToggle.focus();
};
menuToggle?.addEventListener("click", () => {
  const open = menuToggle.getAttribute("aria-expanded") === "true";
  menuToggle.setAttribute("aria-expanded", String(!open));
  siteNav?.classList.toggle("is-open", !open);
});
siteNav?.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => closeMenu()));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeMenu(true);
});
document.addEventListener("click", (event) => {
  if (siteNav?.classList.contains("is-open") && !siteNav.contains(event.target) && !menuToggle?.contains(event.target)) closeMenu();
});

const signalText = document.querySelector("#signal-copy");
document.querySelectorAll("[data-signal]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll("[data-signal]").forEach((item) => {
      const active = item === button;
      item.classList.toggle("is-active", active);
      item.setAttribute("aria-pressed", String(active));
    });
    if (signalText) signalText.textContent = signalCopy[button.dataset.signal] ?? "";
  });
});

const tabs = [...document.querySelectorAll('[role="tab"]')];
const panels = [...document.querySelectorAll("[data-coverage-panel]")];
const demoStatus = document.querySelector(".demo-status");
function selectCoverage(coverage, focus = false) {
  tabs.forEach((tab) => {
    const active = tab.dataset.coverage === coverage;
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
  });
  panels.forEach((panel) => { panel.hidden = panel.dataset.coveragePanel !== coverage; });
  if (demoStatus) demoStatus.textContent = coverageLabel[coverage] ?? "";
  if (focus) tabs.find((tab) => tab.dataset.coverage === coverage)?.focus();
}
tabs.forEach((tab, index) => {
  tab.addEventListener("click", () => selectCoverage(tab.dataset.coverage));
  tab.addEventListener("keydown", (event) => {
    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    selectCoverage(tabs[next].dataset.coverage, true);
  });
});

document.querySelectorAll("[data-copy-target]").forEach((button) => {
  button.addEventListener("click", async () => {
    const target = document.getElementById(button.dataset.copyTarget);
    const status = button.closest(".command-box")?.querySelector(".copy-status");
    if (!target) return;
    const text = target.innerText.replace(/\\n/g, "\n");
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = "Copied";
      if (status) status.textContent = "Commands copied.";
    } catch {
      if (status) status.textContent = "Copy unavailable; select the commands above.";
    }
    window.setTimeout(() => { button.textContent = "Copy"; }, 1800);
  });
});

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
if (!reduceMotion && "IntersectionObserver" in window) {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: .12 });
  document.querySelectorAll(".reveal").forEach((element) => observer.observe(element));
}
