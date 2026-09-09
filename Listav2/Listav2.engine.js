/**
 * Listav2.engine.js - motor de render del tablero de la segunda version.
 *
 * Nacio como copia del motor de `Lista/Lista.js` para que los dos tableros se comporten igual, y
 * desde entonces diverge: aqui vive la lista de verificacion marcable del tablero de resolucion,
 * que la v1 no tiene. Ya no se regenera desde la v1; se edita a mano.
 *
 * `Listav2.js` es la concatenacion de `Listav2.data.js` y este archivo. No edites `Listav2.js`.
 */

function flattenItems(stages) {
  return stages.flatMap((currentStage) =>
    currentStage.items.map((item) => ({
      ...item,
      ...getImplementationDetails(item),
      stageId: currentStage.id,
      stageTitle: currentStage.title,
      track: currentStage.track,
    })),
  );
}

/** Terminadas: aprobada, desplegada y cancelada ya no son trabajo pendiente. */
function isClosedStatus(status) {
  return status === "aprobada" || status === "desplegada" || status === "cancelada";
}

function countStatuses(items) {
  const counts = Object.fromEntries(VALID_STATUSES.map((status) => [status, 0]));
  for (const item of items) {
    if (Object.hasOwn(counts, item.status)) counts[item.status] += 1;
  }
  return counts;
}

/**
 * A cancelled row is a decision already taken, not pending work: it leaves both sides of the ratio
 * so the bar answers "how much of what we still intend to build is done". `countStatuses` keeps
 * counting every status, so the breakdown still shows how many rows were cancelled.
 */
function countedItems(items) {
  return items.filter((item) => item.status !== "cancelada");
}

function getStageProgress(currentStage) {
  const counted = countedItems(currentStage.items);
  const total = counted.length;
  const approved = counted.filter((item) => item.status === "aprobada").length;
  return {
    approved,
    approvedCount: approved,
    total,
    percentage: total === 0 ? 0 : Math.round((approved / total) * 100),
    statusCounts: countStatuses(currentStage.items),
  };
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function itemMatches(item, filters = {}) {
  const query = normalizeText(filters.query ?? filters.text);
  const implementation = getImplementationDetails(item);
  const searchableText = normalizeText(
    [
      item.id,
      item.title,
      item.status,
      item.description,
      item.dependsOn,
      item.evidence,
      implementation.implementationStatus,
      IMPLEMENTATION_STATUS_LABELS[implementation.implementationStatus],
      implementation.implementationEvidence,
      ...(item.references ?? []),
      item.stageId,
      item.stageTitle,
    ].join(" "),
  );

  const matchesQuery = !query || searchableText.includes(query);
  const matchesStatus =
    !filters.status || filters.status === "all" || item.status === filters.status;
  const matchesStage =
    !filters.stage ||
    filters.stage === "all" ||
    item.stageId === filters.stage ||
    item.stageTitle === filters.stage;
  const matchesTrack = !filters.track || filters.track === "all" || item.track === filters.track;
  const matchesKind = !filters.kind || filters.kind === "all" || item.kind === filters.kind;

  return matchesQuery && matchesStatus && matchesStage && matchesTrack && matchesKind;
}

const STATUS_LABELS = {
  desplegada: "Desplegada",
  aprobada: "Aprobada",
  revision: "En revisión",
  "en-progreso": "En progreso",
  pendiente: "Pendiente",
  bloqueada: "Bloqueada",
  cancelada: "Cancelada",
};

const STATUS_CLASSES = {
  desplegada: "status-deployed",
  aprobada: "status-approved",
  revision: "status-review",
  "en-progreso": "status-in-progress",
  pendiente: "status-pending",
  bloqueada: "status-blocked",
  cancelada: "status-cancelled",
};

const KIND_LABELS = {
  bug: "Bug",
  funcion: "Función nueva",
  verificacion: "Verificación",
  decision: "Decisión",
};

const TRACK_LABELS = {
  bugs: "Bugs del formulario",
  reserva: "Reserva de primera clase",
  miembros: "Miembros aceptados",
  landing: "Landing pública",
  admin: "Administración",
  pagos: "Pagos y centro",
  datos: "Datos del operador",
};

function filterItems(items, filters = {}) {
  return items.filter((item) => itemMatches(item, filters));
}

/**
 * En la v1 las anclas eran cuatro fases fijas. Aqui cada linea de trabajo es su propia ancla, asi
 * que el id de la etapa es el ancla, y `Listav2.html` declara un div por cada uno.
 */
function getPhaseAnchorId(currentStage) {
  const stageId = String(currentStage?.id ?? "");
  return stageId === "" ? null : stageId;
}

function getVisibleStages(stages, filters = {}) {
  return stages
    .map((currentStage) => {
      const visibleItems = currentStage.items.filter((item) =>
        itemMatches(
          {
            ...item,
            ...getImplementationDetails(item),
            stageId: currentStage.id,
            stageTitle: currentStage.title,
            track: currentStage.track,
          },
          filters,
        ),
      );

      return { ...currentStage, items: visibleItems.map(withImplementationDetails) };
    })
    .filter((currentStage) => currentStage.items.length > 0);
}

function getGlobalProgress(items) {
  const counted = countedItems(items);
  const approved = counted.filter((item) => item.status === "aprobada").length;
  return {
    approved,
    total: counted.length,
    percentage: counted.length === 0 ? 0 : Math.round((approved / counted.length) * 100),
  };
}

function createElement(tagName, text, className) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function appendLabeledValue(parent, label, value, className = "detail-value") {
  const container = createElement("div", undefined, "task-detail");
  container.append(
    createElement("span", label, "detail-label"),
    createElement("span", value || "-", className),
  );
  parent.append(container);
}

function createStatusBadge(status, className) {
  return createElement(
    "span",
    STATUS_LABELS[status] || status,
    `${className || "status-badge"} ${STATUS_CLASSES[status] || ""}`.trim(),
  );
}

function createProgressBar(progress, label) {
  const progressContainer = createElement("div", undefined, "phase-progress");
  const progressLabel = createElement("span", label, "phase-progress-label");
  const bar = createElement("div", undefined, "progress-bar");
  bar.setAttribute("role", "progressbar");
  bar.setAttribute("aria-label", label);
  bar.setAttribute("aria-valuemin", "0");
  bar.setAttribute("aria-valuemax", "100");
  bar.setAttribute("aria-valuenow", String(progress.percentage));
  const fill = createElement("span", undefined, "progress-bar-fill");
  fill.style.width = `${progress.percentage}%`;
  bar.append(fill);
  progressContainer.append(progressLabel, bar);
  return progressContainer;
}

function bindSummaryCard(card, onActivate) {
  if (!card.dataset.bound) {
    card.dataset.bound = "true";
    card.addEventListener("click", onActivate);
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onActivate();
      }
    });
  }
}

function renderSummary(summaryGrid, items, activeFilters, onStatusSelect, onTotalSelect) {
  const counts = countStatuses(items);
  const totalItems = flattenItems(projectData.stages);
  const progress = getGlobalProgress(totalItems);

  for (const card of summaryGrid.querySelectorAll('[data-render-target="status-cards"]')) {
    const status = card.dataset.status;
    card.replaceChildren();
    card.setAttribute("data-filter-status", status);
    card.setAttribute("role", "button");
    card.setAttribute("tabindex", "0");
    card.setAttribute("aria-label", `Filtrar por estado ${STATUS_LABELS[status] || status}`);
    card.setAttribute("aria-pressed", String(activeFilters.status === status));
    card.append(
      createElement("strong", String(counts[status] || 0)),
      createElement("span", STATUS_LABELS[status] || status),
    );
    bindSummaryCard(card, () => onStatusSelect(card.dataset.status));
  }

  const totalCard = summaryGrid.querySelector('[data-render-target="total-card"]');
  if (totalCard) {
    totalCard.replaceChildren(
      createElement("strong", String(totalItems.length)),
      createElement("span", "Total de tareas"),
    );
    totalCard.setAttribute("data-filter-status", "all");
    totalCard.setAttribute("role", "button");
    totalCard.setAttribute("tabindex", "0");
    totalCard.setAttribute("aria-label", `Mostrar todas las tareas (${totalItems.length})`);
    totalCard.setAttribute(
      "aria-pressed",
      String(!activeFilters.query && !activeFilters.status && !activeFilters.track),
    );
    bindSummaryCard(totalCard, onTotalSelect);
  }

  const globalProgress = summaryGrid.querySelector('[data-render-target="global-progress"]');
  if (globalProgress) {
    globalProgress.replaceChildren(
      createElement("strong", `${progress.percentage}%`),
      createElement("span", `${progress.approved} de ${progress.total} tareas completadas`),
      createProgressBar(progress, "Progreso global"),
    );
  }
}

function getResolutionRequirements(item) {
  return item.resolutionRequirements?.length
    ? item.resolutionRequirements
    : RESOLUTION_REQUIREMENTS[item.id] || [];
}

/**
 * ── Lista de verificacion del tablero de resolucion ────────────────────────────────────────────
 *
 * Las casillas son de SOLO LECTURA a proposito. No se marcan desde la pagina: se marcan en
 * `Listav2.data.js` conforme el trabajo se resuelve, y viajan en el repositorio.
 *
 * Por que no dejarlas marcar aqui: una marca es una afirmacion sobre el estado del proyecto. Si
 * cualquiera pudiera ponerla desde el navegador, viviria solo en ese navegador -invisible para el
 * resto, perdida al cambiar de equipo y sin nada que la respalde-. Marcada en el repositorio, la
 * afirmacion tiene autor, fecha y diff.
 */

function checklistProgress(item) {
  const requirements = getResolutionRequirements(item);
  return {
    done: requirements.filter((requirement) => requirement.done === true).length,
    total: requirements.length,
  };
}

function countChecklist(items) {
  let done = 0;
  let total = 0;
  for (const item of items) {
    const progress = checklistProgress(item);
    done += progress.done;
    total += progress.total;
  }
  return { done, total };
}

function renderResolutionBoard(resolutionList) {
  // A cancelled row has nothing left to resolve, so it does not belong on this board either.
  const unresolvedItems = flattenItems(projectData.stages).filter(
    (item) => !isClosedStatus(item.status),
  );
  resolutionList.replaceChildren();

  for (const item of unresolvedItems) {
    const entry = createElement("article", undefined, "resolution-item");
    entry.dataset.resolutionItem = item.id;

    const requirements = getResolutionRequirements(item);
    const progress = checklistProgress(item);
    // Todos los requisitos marcados no significa aprobada: significa que no queda trabajo
    // pendiente identificado y que la fila esta lista para revisarse en el ledger.
    const complete = progress.total > 0 && progress.done === progress.total;
    entry.classList.toggle("resolution-item-complete", complete);

    const heading = createElement("div", undefined, "resolution-item-header");
    const counter = createElement(
      "span",
      `${progress.done}/${progress.total}`,
      "resolution-item-progress",
    );
    counter.setAttribute(
      "aria-label",
      `${progress.done} de ${progress.total} requisitos resueltos en ${item.id}`,
    );
    heading.append(
      createElement("span", item.id, "task-id"),
      createElement("h3", item.title, "resolution-item-title"),
      counter,
      createStatusBadge(item.status, "resolution-item-status"),
    );

    const metadata = createElement("p", undefined, "resolution-item-meta");
    metadata.append(
      createElement("strong", "Dependencias: "),
      document.createTextNode(item.dependsOn),
    );

    entry.append(heading, metadata);

    const note = RESOLUTION_NOTES[item.id];
    if (note) {
      const noteElement = createElement("p", undefined, "resolution-item-note");
      noteElement.append(createElement("strong", "Lo que ya sabemos: "), document.createTextNode(note));
      entry.append(noteElement);
    }

    const list = createElement("ol", undefined, "resolution-requirements");
    for (const requirement of requirements) {
      const listItem = createElement("li", undefined, "resolution-requirement");
      listItem.classList.toggle("requirement-done", requirement.done === true);

      const box = createElement("span", requirement.done === true ? "X" : "", "requirement-box");
      box.setAttribute("role", "img");
      box.setAttribute(
        "aria-label",
        requirement.done === true ? "Resuelto:" : "Pendiente:",
      );

      listItem.append(box, createElement("span", requirement.text, "resolution-requirement-text"));
      list.append(listItem);
    }

    entry.append(list);
    resolutionList.append(entry);
  }

  const summary = document.querySelector("[data-checklist-summary]");
  if (summary) {
    const { done, total } = countChecklist(unresolvedItems);
    summary.textContent =
      total === 0
        ? "No hay requisitos registrados."
        : `${done} de ${total} requisitos resueltos en ${unresolvedItems.length} tareas.`;
  }
}
/**
 * El bloque de reparto: con quien se puede trabajar a la vez y con quien no.
 *
 * Va detras de un guarda a proposito. El motor es el mismo que usa `Lista/`, cuyos datos no traen
 * este campo, y ahi tiene que seguir pintando exactamente lo de siempre.
 */
function renderParallelWork(item) {
  if (item.surface === undefined) return null;

  const container = createElement("div", undefined, "task-detail task-parallel");
  container.append(createElement("span", "Trabajo en paralelo", "detail-label"));

  if (item.surface === null) {
    container.append(
      createElement(
        "p",
        "Superficie sin declarar: no se puede afirmar que sea paralela a nada. Declara en " +
          "TASK_SURFACES los ficheros que va a escribir antes de repartirla.",
        "parallel-unknown",
      ),
    );
    return container;
  }

  const surface = createElement("p", undefined, "parallel-surface");
  surface.append(
    createElement("span", "Toca: ", "parallel-key"),
    document.createTextNode(item.surface.length === 0 ? "no toca codigo" : item.surface.join(" · ")),
  );
  container.append(surface);

  if (!item.ready) {
    const reason =
      item.blockedBy && item.blockedBy.length > 0
        ? `No se puede empezar todavia: depende de ${item.blockedBy.join(", ")}.`
        : "No se puede empezar todavia.";
    container.append(createElement("p", reason, "parallel-blocked"));
    return container;
  }

  const partners = item.parallelWith || [];
  container.append(
    createElement(
      "p",
      partners.length > 0
        ? `Se puede hacer a la vez que: ${partners.join(", ")}.`
        : "Ninguna otra fila lista puede ir a la vez que esta.",
      "parallel-ready",
    ),
  );

  for (const conflict of item.conflicts || []) {
    container.append(
      createElement(
        "p",
        `Choca con ${conflict.id} en ${conflict.files.join(", ")}.`,
        "parallel-conflict",
      ),
    );
  }

  return container;
}

function renderTask(item) {
  const taskElement = createElement("article", undefined, "task");
  taskElement.dataset.taskId = item.id;

  const header = createElement("div", undefined, "task-header");
  header.append(
    createElement("span", item.id, "task-id"),
    createElement("h4", item.title, "task-title"),
  );

  const description = createElement("p", item.description, "task-description");
  const implementation = getImplementationDetails(item);
  const implementationClass =
    IMPLEMENTATION_STATUS_CLASSES[implementation.implementationStatus] || "";
  const checklist = createElement(
    "label",
    undefined,
    `task-checklist ${implementationClass}`.trim(),
  );
  const checkbox = createElement("input");
  checkbox.type = "checkbox";
  checkbox.id = `check-${item.id}`;
  checkbox.disabled = true;
  checkbox.checked =
    implementation.implementationStatus === "verificada" ||
    implementation.implementationStatus === "implementada";
  checkbox.setAttribute(
    "aria-label",
    `${IMPLEMENTATION_STATUS_LABELS[implementation.implementationStatus] || implementation.implementationStatus}: ${item.title}`,
  );
  checklist.append(
    checkbox,
    createElement(
      "span",
      IMPLEMENTATION_STATUS_LABELS[implementation.implementationStatus] ||
        implementation.implementationStatus,
      "checklist-label",
    ),
  );
  const details = createElement("div", undefined, "task-details");
  const detailGrid = createElement("div", undefined, "task-detail-grid");
  appendLabeledValue(detailGrid, "Dependencias", item.dependsOn);
  appendLabeledValue(detailGrid, "Tipo", KIND_LABELS[item.kind] || item.kind);

  const evidence = createElement("div", undefined, "task-detail");
  evidence.append(
    createElement("span", "Evidencia oficial", "detail-label"),
    createElement("span", item.evidence, "task-evidence"),
  );

  const implementationEvidence = createElement("div", undefined, "task-detail");
  implementationEvidence.append(
    createElement("span", "Ejecución detectada", "detail-label"),
    createElement("span", implementation.implementationEvidence, "task-evidence"),
  );

  const references = createElement("div", undefined, "task-detail");
  references.append(createElement("span", "Referencias", "detail-label"));
  const referenceList = createElement("div", undefined, "task-references");
  for (const reference of item.references || []) {
    referenceList.append(createElement("span", reference, "task-reference"));
  }
  references.append(referenceList);
  const parallelWork = renderParallelWork(item);
  details.append(detailGrid, evidence, implementationEvidence, references);
  if (parallelWork) details.append(parallelWork);

  const backlogBadge = createStatusBadge(item.status, "task-status");
  backlogBadge.textContent = `Backlog: ${STATUS_LABELS[item.status] || item.status}`;
  taskElement.append(header, checklist, description, backlogBadge, details);
  return taskElement;
}

function renderPhase(currentStage, phaseId) {
  const phase = createElement("article", undefined, "phase");
  const taskListId = `${currentStage.id}-tasks`;
  phase.id = phaseId;
  phase.dataset.stageId = currentStage.id;
  phase.dataset.track = currentStage.track;

  const header = createElement("header", undefined, "phase-header");
  const titleGroup = createElement("div");
  titleGroup.append(
    createElement("span", TRACK_LABELS[currentStage.track] || currentStage.track, "phase-kicker"),
    createElement("h3", currentStage.title, "phase-title"),
    createElement("p", currentStage.description, "phase-description"),
  );

  const progress = getStageProgress(currentStage);
  const meta = createElement("div", undefined, "phase-meta");
  meta.append(
    createStatusBadge(currentStage.status, "phase-status"),
    createElement("span", `${progress.approved} de ${progress.total} tareas completadas`),
    createProgressBar(progress, `Progreso de ${currentStage.title}`),
  );

  const toggle = createElement("button", "Contraer", "phase-toggle");
  toggle.type = "button";
  toggle.setAttribute("aria-expanded", "true");
  toggle.setAttribute("aria-controls", taskListId);

  const taskList = createElement("div", undefined, "phase-tasks");
  taskList.id = taskListId;
  for (const item of currentStage.items) taskList.append(renderTask(item));

  toggle.addEventListener("click", () => {
    const expanded = toggle.getAttribute("aria-expanded") === "true";
    toggle.setAttribute("aria-expanded", String(!expanded));
    toggle.textContent = expanded ? "Expandir" : "Contraer";
    taskList.hidden = expanded;
  });

  header.append(titleGroup, meta, toggle);
  phase.append(header, taskList);
  return phase;
}

function setVisiblePhasesExpanded(phaseList, expanded) {
  for (const phase of phaseList.querySelectorAll(".phase")) {
    const toggle = phase.querySelector(".phase-toggle");
    const taskList = phase.querySelector(".phase-tasks");
    if (!toggle || !taskList) continue;
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.textContent = expanded ? "Contraer" : "Expandir";
    taskList.hidden = !expanded;
  }
}

function renderMaintenance(maintenance) {
  if (!maintenance || maintenance.querySelector("[data-rendered-maintenance]")) return;
  const list = createElement("ul");
  list.dataset.renderedMaintenance = "true";
  for (const step of projectData.maintenanceSteps) list.append(createElement("li", step));
  maintenance.append(createElement("h3", "Checklist de actualización"), list);
}

function initializeFilters(statusFilter, trackFilter) {
  statusFilter.replaceChildren(createElement("option", "Todos los estados"));
  statusFilter.firstElementChild.value = "";
  for (const status of VALID_STATUSES) {
    const option = createElement("option", STATUS_LABELS[status], undefined);
    option.value = status;
    statusFilter.append(option);
  }

  const tracks = [...new Set(projectData.stages.map((currentStage) => currentStage.track))].sort();
  trackFilter.replaceChildren(createElement("option", "Todas las líneas"));
  trackFilter.firstElementChild.value = "";
  for (const track of tracks) {
    const option = createElement("option", TRACK_LABELS[track] || track);
    option.value = track;
    trackFilter.append(option);
  }
}

function renderProject(documentRoot = typeof document !== "undefined" ? document : null) {
  if (!documentRoot) return false;
  const app = documentRoot.getElementById("app");
  const summaryGrid = documentRoot.getElementById("summary-grid");
  const resolutionList = documentRoot.getElementById("resolution-list");
  const filters = documentRoot.getElementById("filters");
  const phaseList = documentRoot.getElementById("phase-list");
  const emptyState = documentRoot.getElementById("empty-state");
  const maintenance = documentRoot.getElementById("maintenance");
  const lastUpdated = documentRoot.getElementById("last-updated");
  const searchInput = documentRoot.getElementById("search-input");
  const statusFilter = documentRoot.getElementById("status-filter");
  const trackFilter = documentRoot.getElementById("track-filter");
  const filterStatus = documentRoot.getElementById("filter-status");
  const backToTop = documentRoot.getElementById("back-to-top");
  const expandAll = documentRoot.getElementById("expand-all");
  const collapseAll = documentRoot.getElementById("collapse-all");

  if (
    !app ||
    !summaryGrid ||
    !resolutionList ||
    !filters ||
    !phaseList ||
    !emptyState ||
    !statusFilter ||
    !trackFilter ||
    !searchInput
  ) {
    return false;
  }

  initializeFilters(statusFilter, trackFilter);
  renderMaintenance(maintenance);
  renderResolutionBoard(resolutionList);
  if (lastUpdated) {
    lastUpdated.dateTime = projectData.cutoffDate;
    lastUpdated.textContent = new Intl.DateTimeFormat("es-ES", {
      dateStyle: "long",
      timeZone: "UTC",
    }).format(new Date(`${projectData.cutoffDate}T00:00:00Z`));
  }

  const allItems = flattenItems(projectData.stages);
  const form = filters.querySelector("form");
  const readFilters = () => ({
    query: searchInput.value,
    status: statusFilter.value,
    track: trackFilter.value,
  });
  const update = () => {
    const currentFilters = readFilters();
    const visibleItems = filterItems(allItems, currentFilters);
    renderSummary(
      summaryGrid,
      visibleItems,
      currentFilters,
      (status) => {
        statusFilter.value = statusFilter.value === status ? "" : status;
        update();
      },
      () => {
        searchInput.value = "";
        statusFilter.value = "";
        trackFilter.value = "";
        update();
      },
    );
    const visibleStages = getVisibleStages(projectData.stages, currentFilters);
    const usedAnchors = new Set();
    const renderedPhases = visibleStages.map((currentStage, index) => {
      const anchorId = getPhaseAnchorId(currentStage);
      const phaseId =
        anchorId && !usedAnchors.has(anchorId)
          ? anchorId
          : `${anchorId || currentStage.id}-${index}`;
      if (anchorId) usedAnchors.add(anchorId);
      return renderPhase(currentStage, phaseId);
    });
    for (const anchor of documentRoot.querySelectorAll(".phase-anchor")) anchor.remove();
    phaseList.replaceChildren(...renderedPhases);
    emptyState.hidden = visibleItems.length !== 0;
    if (filterStatus) {
      filterStatus.textContent = `${visibleItems.length} ${visibleItems.length === 1 ? "tarea visible" : "tareas visibles"}`;
    }
  };

  if (form && !form.dataset.bound) {
    form.dataset.bound = "true";
    form.addEventListener("input", update);
    form.addEventListener("change", update);
    form.addEventListener("reset", (event) => {
      event.preventDefault();
      searchInput.value = "";
      statusFilter.value = "";
      trackFilter.value = "";
      update();
    });
  }

  if (backToTop && !backToTop.dataset.bound) {
    backToTop.dataset.bound = "true";
    const prefersReducedMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const updateBackToTop = () => {
      backToTop.hidden = window.scrollY < 320;
    };
    backToTop.addEventListener("click", () =>
      window.scrollTo({ top: 0, behavior: prefersReducedMotion ? "auto" : "smooth" }),
    );
    window.addEventListener("scroll", updateBackToTop, { passive: true });
    updateBackToTop();
  }

  if (expandAll && !expandAll.dataset.bound) {
    expandAll.dataset.bound = "true";
    expandAll.addEventListener("click", () => setVisiblePhasesExpanded(phaseList, true));
  }

  if (collapseAll && !collapseAll.dataset.bound) {
    collapseAll.dataset.bound = "true";
    collapseAll.addEventListener("click", () => setVisiblePhasesExpanded(phaseList, false));
  }

  update();
  return true;
}

function initialize() {
  renderProject(document);
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
}

globalThis.ListaV2Project = {
  projectData,
  VALID_STATUSES,
  flattenItems,
  isClosedStatus,
  countStatuses,
  getStageProgress,
  normalizeText,
  itemMatches,
  filterItems,
  getPhaseAnchorId,
  getVisibleStages,
  getGlobalProgress,
  getImplementationDetails,
  getResolutionRequirements,
  renderParallelWork,
  renderResolutionBoard,
  setVisiblePhasesExpanded,
  renderProject,
  checklistProgress,
  countChecklist,
  RESOLUTION_NOTES,
  TASK_SURFACES,
};
