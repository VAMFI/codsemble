const evidenceCopy = {
  delivery: "A delivery goal activates a delivery work package and makes its evidence traceable.",
  security: "A security requirement justifies a specialist review instead of a generic extra agent.",
  tests: "An existing test boundary gives the compiler a concrete validation owner to cover.",
};

const menuToggle = document.querySelector(".menu-toggle");
const siteNav = document.querySelector(".site-nav");
menuToggle?.addEventListener("click", () => {
  const open = menuToggle.getAttribute("aria-expanded") === "true";
  menuToggle.setAttribute("aria-expanded", String(!open));
  siteNav?.classList.toggle("is-open", !open);
});
siteNav?.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => {
    menuToggle?.setAttribute("aria-expanded", "false");
    siteNav.classList.remove("is-open");
  });
});

const tabs = [...document.querySelectorAll('[role="tab"]')];
const panels = [...document.querySelectorAll("[data-team-panel]")];
function selectTeam(team, focus = false) {
  tabs.forEach((tab) => {
    const selected = tab.dataset.team === team;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
  });
  panels.forEach((panel) => { panel.hidden = panel.dataset.teamPanel !== team; });
  if (focus) tabs.find((tab) => tab.dataset.team === team)?.focus();
}
tabs.forEach((tab, index) => {
  tab.addEventListener("click", () => selectTeam(tab.dataset.team));
  tab.addEventListener("keydown", (event) => {
    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    selectTeam(tabs[next].dataset.team, true);
  });
});

const evidenceDetail = document.querySelector("#evidence-detail-text");
document.querySelectorAll("[data-evidence]").forEach((chip) => {
  chip.addEventListener("click", () => {
    document.querySelectorAll("[data-evidence]").forEach((item) => item.classList.toggle("is-active", item === chip));
    if (evidenceDetail) evidenceDetail.textContent = evidenceCopy[chip.dataset.evidence] ?? "This signal contributes to a bounded work package.";
  });
});

document.querySelectorAll("[data-copy-target]").forEach((button) => {
  button.addEventListener("click", async () => {
    const target = document.getElementById(button.dataset.copyTarget);
    const status = button.closest(".command-box")?.querySelector(".copy-status");
    if (!target) return;
    try {
      await navigator.clipboard.writeText(target.textContent.trim());
      button.textContent = "Copied";
      if (status) status.textContent = "Install commands copied to your clipboard.";
    } catch {
      if (status) status.textContent = "Copy is unavailable here; select the commands above instead.";
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
} else {
  document.querySelectorAll(".reveal").forEach((element) => element.classList.add("is-visible"));
}
