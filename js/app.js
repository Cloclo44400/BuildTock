// app.js — logique principale de l'application BuildTock

let state = {
  currentPage: "accueil",
  currentConfig: null,      // config en cours d'édition
};

let cloudCache = []; // dernière liste de configs publiées récupérées (cloud ou local selon dispo)

// Vérifie que l'utilisateur est connecté avec Google ; sinon propose la connexion et bloque l'action
function requireLogin(message) {
  if (!Cloud.enabled) return true; // mode local (Firebase non configuré) : pas de restriction
  if (Cloud.isLoggedIn()) return true;

  const wantsLogin = confirm((message || "Connecte-toi avec Google pour continuer.") + "\n\nSe connecter maintenant ?");
  if (wantsLogin) {
    Cloud.signInWithGoogle().catch(err => {
      console.error(err);
      alert("Connexion impossible : " + err.message);
    });
  }
  return false;
}

// Récupère les configs publiées : depuis Firebase si configuré, sinon depuis LocalStorage
async function fetchPublishedConfigs() {
  if (Cloud.enabled) {
    try {
      cloudCache = await Cloud.getPublished();
      return cloudCache;
    } catch (err) {
      console.error("Erreur Firebase, repli sur le mode local :", err);
    }
  }
  cloudCache = Storage.getConfigs().filter(c => c.published);
  return cloudCache;
}

// ---------- NAVIGATION ----------

function navigate(pageId) {
  if (pageId === "creation" && !requireLogin("Connecte-toi avec Google pour créer une configuration.")) {
    return;
  }

  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));

  document.getElementById("page-" + pageId).classList.add("active");
  document.querySelectorAll(`.nav-btn[data-nav="${pageId}"]`).forEach(b => b.classList.add("active"));

  state.currentPage = pageId;

  if (pageId === "accueil") renderHome();
  if (pageId === "communaute") renderCommunity();
  if (pageId === "profil") renderProfile();
}

document.querySelectorAll("[data-nav]").forEach(el => {
  el.addEventListener("click", () => navigate(el.dataset.nav));
});

// ---------- ACCUEIL ----------

async function renderHome() {
  document.getElementById("home-latest").innerHTML = `<p class="muted">Chargement...</p>`;
  const all = await fetchPublishedConfigs();
  const configs = [...all].sort((a, b) => b.date - a.date).slice(0, 3);

  document.getElementById("home-latest").innerHTML = configs.length
    ? configs.map(renderConfigCard).join("")
    : `<p class="muted">Aucune configuration publiée pour le moment. Sois le premier !</p>`;

  attachCardEvents();
}

function attachCardEvents() {
  document.querySelectorAll("[data-config]").forEach(card => {
    card.addEventListener("click", (e) => {
      if (e.target.closest("button")) return; // les boutons gèrent leurs propres clics
      openConfigModal(card.dataset.config);
    });
  });
  document.querySelectorAll("[data-like]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleLike(btn.dataset.like);
    });
  });
  document.querySelectorAll("[data-share]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      shareConfig(btn.dataset.share);
    });
  });
}

function shareConfig(configId) {
  const config = cloudCache.find(c => c.id === configId);
  const url = new URL(window.location.href);
  url.search = ""; // enlève d'éventuels anciens paramètres
  url.searchParams.set("config", configId);
  const shareUrl = url.toString();

  if (navigator.share) {
    navigator.share({
      title: config ? config.name : "BuildTock",
      text: config ? `Découvre cette configuration PC : ${config.name}` : "Découvre cette configuration PC",
      url: shareUrl
    }).catch(err => {
      // L'utilisateur a annulé le partage ou une erreur est survenue : pas grave, on ne fait rien
      if (err.name !== "AbortError") console.error(err);
    });
    return;
  }

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(shareUrl).then(() => {
      showToast("🔗 Lien copié dans le presse-papier !");
    }).catch(() => {
      prompt("Copie ce lien pour partager la configuration :", shareUrl);
    });
  } else {
    prompt("Copie ce lien pour partager la configuration :", shareUrl);
  }
}

let toastTimeout = null;
function showToast(message) {
  let toast = document.getElementById("app-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "app-toast";
    toast.className = "app-toast";
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove("visible"), 2500);
}

// ---------- BUILDER (création libre) ----------

function newEmptyConfig() {
  return {
    id: Storage.uid(),
    name: "",
    description: "",
    budget: null,
    components: [],
    author: getProfile().pseudo,
    date: Date.now(),
    published: false,
    cloudId: null,
    likes: [],
    views: 0,
    ratings: [],
    comments: []
  };
}

function componentRowTemplate(component) {
  return `
    <div class="component-row" data-comp-id="${component.id}">
      <div class="row-head">
        <select class="comp-type">
          ${COMPONENT_TYPES.map(t => `<option value="${t}" ${t === component.type ? "selected" : ""}>${t}</option>`).join("")}
        </select>
        <button class="remove-component" title="Supprimer">✕</button>
      </div>
      <input type="text" class="comp-name" placeholder="Nom du composant" value="${escapeHtml(component.name)}">
      <input type="number" class="comp-price" placeholder="Prix (€)" value="${component.price || ""}">
      <input type="url" class="comp-link full" placeholder="Lien du produit (optionnel)" value="${escapeHtml(component.link || "")}">
      <input type="text" class="comp-store" placeholder="Magasin" value="${escapeHtml(component.store || "")}">
      <select class="comp-state">
        <option value="Neuf" ${component.state === "Neuf" ? "selected" : ""}>Neuf</option>
        <option value="Occasion" ${component.state === "Occasion" ? "selected" : ""}>Occasion</option>
      </select>
      <input type="text" class="comp-comments full" placeholder="Commentaires (optionnel)" value="${escapeHtml(component.comments || "")}">
    </div>
  `;
}

function renderComponents() {
  const list = document.getElementById("components-list");
  list.innerHTML = state.currentConfig.components.map(componentRowTemplate).join("");

  list.querySelectorAll(".component-row").forEach(row => {
    const id = row.dataset.compId;
    row.querySelector(".comp-type").addEventListener("change", e => updateComponent(id, "type", e.target.value));
    row.querySelector(".comp-name").addEventListener("input", e => updateComponent(id, "name", e.target.value));
    row.querySelector(".comp-price").addEventListener("input", e => updateComponent(id, "price", e.target.value));
    row.querySelector(".comp-link").addEventListener("input", e => updateComponent(id, "link", e.target.value));
    row.querySelector(".comp-store").addEventListener("input", e => updateComponent(id, "store", e.target.value));
    row.querySelector(".comp-state").addEventListener("change", e => updateComponent(id, "state", e.target.value));
    row.querySelector(".comp-comments").addEventListener("input", e => updateComponent(id, "comments", e.target.value));
    row.querySelector(".remove-component").addEventListener("click", () => removeComponent(id));
  });

  updateSummary();
}

function updateComponent(id, field, value) {
  const comp = state.currentConfig.components.find(c => c.id === id);
  if (comp) comp[field] = value;
  updateSummary();
}

function removeComponent(id) {
  state.currentConfig.components = state.currentConfig.components.filter(c => c.id !== id);
  renderComponents();
}

document.getElementById("add-component").addEventListener("click", () => {
  if (!requireLogin("Connecte-toi avec Google pour ajouter des composants.")) return;

  state.currentConfig.components.push({
    id: Storage.uid(),
    type: "CPU",
    name: "",
    price: "",
    link: "",
    store: "",
    state: "Neuf",
    comments: ""
  });
  renderComponents();
});

function updateSummary() {
  const components = state.currentConfig.components;
  const total = components.reduce((sum, c) => sum + (parseFloat(c.price) || 0), 0);
  const budget = parseFloat(document.getElementById("cfg-budget").value) || null;

  document.getElementById("sum-total").textContent = total.toFixed(2) + " €";
  document.getElementById("sum-count").textContent = components.length;
  document.getElementById("sum-budget").textContent = budget ? budget + " €" : "-";

  const diffEl = document.getElementById("sum-diff");
  if (budget) {
    const diff = total - budget;
    diffEl.textContent = (diff > 0 ? "+" : "") + diff.toFixed(2) + " €";
    diffEl.style.color = diff > 0 ? "var(--red)" : "var(--green)";
  } else {
    diffEl.textContent = "-";
    diffEl.style.color = "var(--text)";
  }

  const compatResults = Compat.check(components, budget);
  document.getElementById("compat-list").innerHTML = compatResults.map(r =>
    `<li class="${r.ok ? "compat-ok" : "compat-warn"}">${r.ok ? "✓" : "⚠"} ${r.text}</li>`
  ).join("");
}

document.getElementById("cfg-budget").addEventListener("input", updateSummary);

function loadConfigIntoBuilder(config) {
  document.getElementById("cfg-name").value = config.name || "";
  document.getElementById("cfg-desc").value = config.description || "";
  document.getElementById("cfg-budget").value = config.budget || "";
  renderComponents();
}

function syncBuilderToState() {
  state.currentConfig.name = document.getElementById("cfg-name").value.trim();
  state.currentConfig.description = document.getElementById("cfg-desc").value.trim();
  state.currentConfig.budget = parseFloat(document.getElementById("cfg-budget").value) || null;
}

document.getElementById("save-config").addEventListener("click", () => {
  if (!requireLogin("Connecte-toi avec Google pour sauvegarder ta configuration.")) return;

  if (!state.currentConfig) state.currentConfig = newEmptyConfig();
  syncBuilderToState();

  if (!state.currentConfig.name) {
    alert("Merci de donner un nom à ta configuration avant de sauvegarder.");
    return;
  }

  Storage.addOrUpdateConfig(state.currentConfig);
  alert("Configuration sauvegardée ✅");
});

document.getElementById("publish-config").addEventListener("click", async () => {
  if (!requireLogin("Connecte-toi avec Google pour publier ta configuration.")) return;

  if (!state.currentConfig) state.currentConfig = newEmptyConfig();
  syncBuilderToState();

  if (!state.currentConfig.name) {
    alert("Merci de donner un nom à ta configuration avant de publier.");
    return;
  }
  if (state.currentConfig.components.length === 0) {
    alert("Ajoute au moins un composant avant de publier.");
    return;
  }

  state.currentConfig.published = true;
  state.currentConfig.date = Date.now();
  state.currentConfig.author = getProfile().pseudo;
  state.currentConfig.authorPhotoURL = getProfile().photoURL || null;

  const btn = document.getElementById("publish-config");
  btn.disabled = true;
  btn.textContent = "Publication...";

  try {
    if (Cloud.enabled) {
      await Cloud.ready;
      const cloudId = await Cloud.publish(state.currentConfig);
      state.currentConfig.cloudId = cloudId;
    }
    Storage.addOrUpdateConfig(state.currentConfig); // toujours gardé en local aussi (brouillon / repli offline)
    alert("Configuration publiée dans la Communauté 🎉");
    navigate("communaute");
  } catch (err) {
    console.error(err);
    alert(err.message || "Erreur lors de la publication.");
  } finally {
    btn.disabled = false;
    btn.textContent = "📤 Publier dans la Communauté";
  }
});

document.getElementById("export-config").addEventListener("click", () => {
  if (!state.currentConfig) return;
  syncBuilderToState();
  const blob = new Blob([JSON.stringify(state.currentConfig, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = (state.currentConfig.name || "config") + ".json";
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById("import-config").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = JSON.parse(reader.result);
      imported.id = Storage.uid(); // évite les collisions
      state.currentConfig = imported;
      loadConfigIntoBuilder(imported);
    } catch (err) {
      alert("Fichier JSON invalide.");
    }
  };
  reader.readAsText(file);
  e.target.value = "";
});

// Nouveau bouton "Création libre" doit réinitialiser le builder
document.querySelectorAll('.nav-btn[data-nav="creation"], .btn[data-nav="creation"]').forEach(btn => {
  btn.addEventListener("click", () => {
    if (!state.currentConfig || (state.currentConfig.published === undefined)) {
      // rien
    }
  });
});

// ---------- COMMUNAUTE ----------

function renderConfigCard(config) {
  const avgRating = getAverageRating(config);
  const myIdentity = Cloud.enabled ? Cloud.uid : getProfile().pseudo;
  const isLiked = (config.likes || []).includes(myIdentity);
  const authorPhoto = config.authorPhotoURL
    ? `<img class="author-avatar" src="${config.authorPhotoURL}" alt="">`
    : `<span class="author-avatar author-avatar-fallback">🙂</span>`;
  return `
    <div class="card" data-config="${config.id}">
      <h3>${escapeHtml(config.name)}</h3>
      <p class="meta author-line">${authorPhoto}${escapeHtml(config.author)} · ${formatDate(config.date)}</p>
      <div class="price">${configTotal(config).toFixed(2)} €${config.budget ? " / " + config.budget + " €" : ""}</div>
      <div class="footer-row">
        <span>⭐ ${avgRating ? avgRating.toFixed(1) : "-"} · 👁 ${config.views}</span>
        <div class="actions">
          <button data-like="${config.id}" class="${isLiked ? "liked" : ""}">❤ ${config.likes.length}</button>
          <button data-share="${config.id}" title="Partager">🔗</button>
        </div>
      </div>
    </div>
  `;
}

function configTotal(config) {
  return config.components.reduce((sum, c) => sum + (parseFloat(c.price) || 0), 0);
}

function getAverageRating(config) {
  if (!config.ratings || config.ratings.length === 0) return null;
  const sum = config.ratings.reduce((s, r) => s + r.value, 0);
  return sum / config.ratings.length;
}

async function toggleLike(configId) {
  if (!requireLogin("Connecte-toi avec Google pour liker une configuration.")) return;

  if (Cloud.enabled) {
    try {
      await Cloud.toggleLike(configId);
    } catch (err) {
      alert(err.message);
      return;
    }
  } else {
    const configs = Storage.getConfigs();
    const config = configs.find(c => c.id === configId);
    if (!config) return;
    const pseudo = getProfile().pseudo;
    const idx = config.likes.indexOf(pseudo);
    if (idx >= 0) config.likes.splice(idx, 1);
    else config.likes.push(pseudo);
    Storage.saveConfigs(configs);
  }
  if (state.currentPage === "communaute") renderCommunity();
  if (state.currentPage === "accueil") renderHome();
}

async function renderCommunity() {
  document.getElementById("community-list").innerHTML = `<p class="muted">Chargement...</p>`;
  let configs = await fetchPublishedConfigs();

  const searchTerm = (document.getElementById("search-input").value || "").toLowerCase();
  if (searchTerm) {
    configs = configs.filter(c =>
      c.name.toLowerCase().includes(searchTerm) ||
      (c.author || "").toLowerCase().includes(searchTerm)
    );
  }

  const sortBy = document.getElementById("sort-select").value;
  configs = sortConfigs(configs, sortBy);

  document.getElementById("community-list").innerHTML = configs.length
    ? configs.map(renderConfigCard).join("")
    : `<p class="muted">Aucune configuration ne correspond à ta recherche.</p>`;

  attachCardEvents();
}

function sortConfigs(configs, sortBy) {
  const copy = [...configs];
  switch (sortBy) {
    case "popular": return copy.sort((a, b) => b.likes.length - a.likes.length);
    case "budget": return copy.sort((a, b) => configTotal(a) - configTotal(b));
    case "rating": return copy.sort((a, b) => (getAverageRating(b) || 0) - (getAverageRating(a) || 0));
    case "views": return copy.sort((a, b) => b.views - a.views);
    default: return copy.sort((a, b) => b.date - a.date);
  }
}

document.getElementById("search-input").addEventListener("input", renderCommunity);
document.getElementById("sort-select").addEventListener("change", renderCommunity);

// ---------- MODALE FICHE CONFIG ----------

async function openConfigModal(configId) {
  let config = cloudCache.find(c => c.id === configId);
  if (!config) return;

  if (Cloud.enabled && Cloud.isLoggedIn()) {
    const wasNew = await Cloud.incrementViews(configId).catch(err => { console.error(err); return false; });
    if (wasNew) config.views = (config.views || 0) + 1;
  } else if (!Cloud.enabled) {
    const configs = Storage.getConfigs();
    const localConfig = configs.find(c => c.id === configId);
    if (localConfig) {
      localConfig.views = (localConfig.views || 0) + 1;
      config.views = localConfig.views;
      Storage.saveConfigs(configs);
    }
  }

  renderConfigModal(config);
  document.getElementById("modal-overlay").classList.add("active");
}

// Re-render le contenu de la modale sans recompter de vue (utilisé après un like/commentaire)
function renderConfigModal(config) {
  const avg = getAverageRating(config);
  const total = configTotal(config);

  const authorPhoto = config.authorPhotoURL
    ? `<img class="author-avatar" src="${config.authorPhotoURL}" alt="">`
    : `<span class="author-avatar author-avatar-fallback">🙂</span>`;

  document.getElementById("modal-content").innerHTML = `
    <div class="modal-title-row">
      <h2>${escapeHtml(config.name)}</h2>
      <button id="modal-share-btn" class="btn small ghost" title="Partager">🔗 Partager</button>
    </div>
    <p class="meta author-line">${authorPhoto}Par ${escapeHtml(config.author)} · ${formatDate(config.date)}</p>
    <p>${escapeHtml(config.description || "")}</p>
    <div class="summary-box" style="margin: 16px 0;">
      <div class="summary-row"><span>Prix total</span><strong>${total.toFixed(2)} €</strong></div>
      ${config.budget ? `<div class="summary-row"><span>Budget</span><strong>${config.budget} €</strong></div>` : ""}
      <div class="summary-row"><span>Vues</span><strong>${config.views}</strong></div>
      <div class="summary-row"><span>Likes</span><strong>${config.likes.length}</strong></div>
      <div class="summary-row"><span>Note moyenne</span><strong>${avg ? avg.toFixed(1) + " / 5" : "Pas encore noté"}</strong></div>
    </div>
    <h3>Composants</h3>
    <ul class="modal-comp-list">
      ${config.components.map(c => `
        <li>
          <span>
            ${c.type} — ${escapeHtml(c.name || "?")} ${c.state === "Occasion" ? "(occasion)" : ""}
            ${c.link ? `<a href="${escapeHtml(c.link)}" target="_blank" rel="noopener noreferrer" class="comp-link-out">🔗 Lien</a>` : ""}
            ${c.store ? `<span class="comp-store-out muted">· ${escapeHtml(c.store)}</span>` : ""}
          </span>
          <span>${c.price ? parseFloat(c.price).toFixed(2) + " €" : "-"}</span>
        </li>
      `).join("")}
    </ul>
    <h3>Noter cette configuration</h3>
    <div class="rating-widget">
      ${[1,2,3,4,5].map(n => `<button class="btn small rate-btn" data-rate="${n}">${n} ⭐</button>`).join(" ")}
    </div>
    <h3>Commentaires (${(config.comments || []).length})</h3>
    <div class="comment-form">
      <textarea id="comment-input" placeholder="Écris un commentaire..."></textarea>
      <button id="submit-comment" class="btn small primary">Publier</button>
    </div>
    <ul class="comment-list">
      ${(config.comments || []).slice().reverse().map(c => `
        <li class="comment-item">
          ${c.photoURL ? `<img class="author-avatar" src="${c.photoURL}" alt="">` : `<span class="author-avatar author-avatar-fallback">🙂</span>`}
          <div>
            <div class="comment-meta"><strong>${escapeHtml(c.pseudo)}</strong> <span class="muted">${formatDate(c.date)}</span></div>
            <div class="comment-text">${escapeHtml(c.text)}</div>
          </div>
        </li>
      `).join("") || `<li class="muted">Aucun commentaire pour le moment.</li>`}
    </ul>
  `;

  document.getElementById("submit-comment").addEventListener("click", () => submitComment(config.id));
  document.getElementById("modal-share-btn").addEventListener("click", () => shareConfig(config.id));

  document.getElementById("modal-content").querySelectorAll(".rate-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      rateConfig(config.id, parseInt(btn.dataset.rate));
      document.getElementById("modal-overlay").classList.remove("active");
    });
  });
}

async function rateConfig(configId, value) {
  if (!requireLogin("Connecte-toi avec Google pour noter une configuration.")) return;

  if (Cloud.enabled) {
    try {
      await Cloud.rate(configId, value);
    } catch (err) {
      alert(err.message);
      return;
    }
  } else {
    const configs = Storage.getConfigs();
    const config = configs.find(c => c.id === configId);
    if (!config) return;
    const pseudo = getProfile().pseudo;
    config.ratings = config.ratings || [];
    const existing = config.ratings.find(r => r.user === pseudo);
    if (existing) existing.value = value;
    else config.ratings.push({ user: pseudo, value });
    Storage.saveConfigs(configs);
  }
  if (state.currentPage === "communaute") renderCommunity();
}

async function submitComment(configId) {
  if (!requireLogin("Connecte-toi avec Google pour commenter.")) return;

  const input = document.getElementById("comment-input");
  const text = input.value.trim();
  if (!text) return;
  if (text.length > 500) {
    alert("Commentaire trop long (500 caractères max).");
    return;
  }

  const profile = getProfile();
  const comment = {
    uid: Cloud.enabled ? Cloud.uid : null,
    pseudo: profile.pseudo,
    photoURL: profile.photoURL || null,
    text,
    date: Date.now()
  };

  if (Cloud.enabled) {
    try {
      await Cloud.addComment(configId, comment);
    } catch (err) {
      alert(err.message);
      return;
    }
  } else {
    const configs = Storage.getConfigs();
    const config = configs.find(c => c.id === configId);
    if (!config) return;
    config.comments = config.comments || [];
    config.comments.push(comment);
    Storage.saveConfigs(configs);
  }

  // Met à jour le cache local et rouvre la modale à jour
  const cached = cloudCache.find(c => c.id === configId);
  if (cached) {
    cached.comments = cached.comments || [];
    cached.comments.push(comment);
  }
  input.value = "";
  if (cached) renderConfigModal(cached);
}

document.getElementById("modal-close").addEventListener("click", () => {
  document.getElementById("modal-overlay").classList.remove("active");
});
document.getElementById("modal-overlay").addEventListener("click", (e) => {
  if (e.target.id === "modal-overlay") e.target.classList.remove("active");
});

// ---------- PROFIL ----------

function getProfile() {
  return Storage.getProfile();
}

function renderProfileAvatar() {
  const profile = getProfile();
  const el = document.getElementById("profile-avatar");
  if (!el) return;
  el.innerHTML = profile.photoURL
    ? `<img src="${profile.photoURL}" alt="">`
    : "🙂";
}

async function renderProfile() {
  const profile = getProfile();
  document.getElementById("profile-pseudo").value = profile.pseudo;
  document.getElementById("profile-bio").value = profile.bio;
  renderProfileAvatar();

  document.getElementById("profile-configs").innerHTML = `<p class="muted">Chargement...</p>`;

  let myConfigs;
  if (Cloud.enabled) {
    await Cloud.ready;
    myConfigs = await Cloud.getMine();
    cloudCache = [...cloudCache, ...myConfigs.filter(c => !cloudCache.some(x => x.id === c.id))];
  } else {
    myConfigs = Storage.getConfigs().filter(c => c.author === profile.pseudo);
  }
  const totalLikes = myConfigs.reduce((sum, c) => sum + (c.likes ? c.likes.length : 0), 0);

  document.getElementById("stat-configs").textContent = myConfigs.length;
  document.getElementById("stat-likes").textContent = totalLikes;

  document.getElementById("profile-configs").innerHTML = myConfigs.length
    ? myConfigs.map(renderConfigCard).join("")
    : `<p class="muted">Tu n'as pas encore créé de configuration.</p>`;

  attachCardEvents();
}

// Redimensionne/compresse une image dans un carré (via canvas) et renvoie un data URL JPEG léger
function resizeImageFile(file, maxSize = 160, quality = 0.85) {
  const work = new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Impossible de lire le fichier."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Fichier image invalide ou corrompu."));
      img.onload = () => {
        try {
          // Recadrage carré centré
          const side = Math.min(img.naturalWidth, img.naturalHeight);
          const sx = (img.naturalWidth - side) / 2;
          const sy = (img.naturalHeight - side) / 2;

          const canvas = document.createElement("canvas");
          canvas.width = maxSize;
          canvas.height = maxSize;
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("Le navigateur ne permet pas de traiter l'image (canvas indisponible).");
          ctx.drawImage(img, sx, sy, side, side, 0, 0, maxSize, maxSize);

          const dataUrl = canvas.toDataURL("image/jpeg", quality);
          if (!dataUrl || dataUrl === "data:,") throw new Error("Échec de la conversion de l'image.");
          resolve(dataUrl);
        } catch (err) {
          reject(err);
        }
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });

  // Filet de sécurité : si rien ne se passe après 8s (image bloquée, CSP, etc.), on abandonne proprement
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Le traitement de l'image a pris trop de temps. Essaie une image plus petite.")), 8000)
  );

  return Promise.race([work, timeout]);
}

document.getElementById("profile-photo-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  if (!file.type.startsWith("image/")) {
    alert("Merci de choisir un fichier image.");
    e.target.value = "";
    return;
  }

  const status = document.getElementById("profile-save-status");
  status.textContent = "⏳ Traitement de l'image...";
  status.classList.add("visible");

  try {
    console.log("[BuildTock] Photo sélectionnée :", file.name, file.type, file.size + " octets");
    const dataUrl = await resizeImageFile(file);
    console.log("[BuildTock] Image traitée avec succès, taille finale :", dataUrl.length + " caractères");

    const profile = getProfile();
    profile.photoURL = dataUrl;
    profile.customPhoto = true;
    Storage.saveProfile(profile);

    renderProfileAvatar();
    renderAuthZone(Cloud.user);

    status.textContent = "✓ Photo mise à jour — clique sur \"Enregistrer le profil\" pour la publier sur tes configs";
    clearTimeout(status._hideTimeout);
    status._hideTimeout = setTimeout(() => status.classList.remove("visible"), 5000);
  } catch (err) {
    console.error("[BuildTock] Erreur upload photo :", err);
    status.classList.remove("visible");
    alert("Erreur lors du chargement de l'image : " + err.message);
  }
  e.target.value = "";
});

document.getElementById("save-profile").addEventListener("click", () => {
  const profile = getProfile();
  const oldPseudo = profile.pseudo;
  const newPseudo = document.getElementById("profile-pseudo").value.trim() || "Joueur";
  const newBio = document.getElementById("profile-bio").value;

  profile.pseudo = newPseudo;
  profile.bio = newBio;
  Storage.saveProfile(profile);

  // Met à jour l'auteur des configs locales liées à l'ancien pseudo (mode hors ligne)
  if (oldPseudo !== newPseudo) {
    const configs = Storage.getConfigs();
    let changed = false;
    configs.forEach(c => { if (c.author === oldPseudo) { c.author = newPseudo; changed = true; } });
    if (changed) Storage.saveConfigs(configs);
  }

  const status = document.getElementById("profile-save-status");
  status.textContent = "✓ Profil enregistré";
  status.classList.add("visible");
  clearTimeout(status._hideTimeout);
  status._hideTimeout = setTimeout(() => status.classList.remove("visible"), 2500);

  renderAuthZone(Cloud.user); // met à jour le pseudo affiché dans la barre du haut
  renderProfileAvatar();
});

// ---------- UTILS ----------

function escapeHtml(str) {
  if (!str) return "";
  return str.replace(/[&<>"']/g, m => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[m]));
}

function formatDate(timestamp) {
  return new Date(timestamp).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
}

// ---------- INIT ----------

state.currentConfig = newEmptyConfig();
renderComponents();

Cloud.onAuthChange = (user) => {
  renderAuthZone(user);
  // On ne re-render pas automatiquement la page Profil : ça écraserait le pseudo/bio
  // en cours de saisie à chaque changement d'état de connexion (ex: rafraîchissement de token).
  if (["accueil", "communaute"].includes(state.currentPage)) navigate(state.currentPage);
};

function renderAuthZone(user) {
  const zone = document.getElementById("auth-zone");
  if (!Cloud.enabled) {
    zone.innerHTML = "";
    return;
  }
  if (user) {
    const profile = getProfile();

    // Pré-remplit le pseudo local avec le nom Google si aucun pseudo personnalisé n'a encore été choisi
    if (!profile.googleSynced) {
      profile.pseudo = user.displayName || profile.pseudo;
      profile.googleSynced = true;
      Storage.saveProfile(profile);
    }
    // Garde toujours la photo Google à jour, sauf si l'utilisateur a mis une photo personnalisée
    if (!profile.customPhoto && profile.photoURL !== user.photoURL) {
      profile.photoURL = user.photoURL || null;
      Storage.saveProfile(profile);
    }

    zone.innerHTML = `
      ${profile.photoURL ? `<img src="${profile.photoURL}" alt="">` : ""}
      <span class="user-name">${escapeHtml(profile.pseudo)}</span>
      <button class="btn small" id="logout-btn">Déconnexion</button>
    `;
    document.getElementById("logout-btn").addEventListener("click", () => Cloud.signOut());
  } else {
    zone.innerHTML = `
      <button class="google-btn" id="login-btn">
        <svg width="16" height="16" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.9 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l6-6C34.5 5.5 29.5 3.5 24 3.5 12.7 3.5 3.5 12.7 3.5 24S12.7 44.5 24 44.5 44.5 35.3 44.5 24c0-1.2-.1-2.4-.3-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13.5 24 13.5c3.1 0 5.8 1.1 8 3l6-6C34.5 6.5 29.5 4.5 24 4.5 15.6 4.5 8.4 9.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44.5c5.3 0 10.1-1.8 13.5-4.9l-6.2-5.2C29.4 36 26.9 37 24 37c-5.3 0-9.7-3.1-11.3-7.6l-6.5 5C8.4 39.6 15.6 44.5 24 44.5z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4 5.4l6.2 5.2C40.6 36 44.5 30.6 44.5 24c0-1.2-.1-2.4-.9-3.5z"/></svg>
        Se connecter avec Google
      </button>
    `;
    document.getElementById("login-btn").addEventListener("click", () => {
      Cloud.signInWithGoogle().catch(err => {
        console.error(err);
        alert("Connexion impossible : " + err.message);
      });
    });
  }
}

Cloud.init().finally(async () => {
  renderAuthZone(Cloud.user);

  const sharedConfigId = new URLSearchParams(window.location.search).get("config");
  if (sharedConfigId) {
    navigate("communaute");
    await fetchPublishedConfigs();
    const exists = cloudCache.some(c => c.id === sharedConfigId);
    if (exists) {
      openConfigModal(sharedConfigId);
    } else {
      showToast("⚠ Configuration introuvable (elle a peut-être été supprimée).");
    }
  } else {
    navigate("accueil");
  }
});
