// storage.js — gestion de la sauvegarde locale (LocalStorage)

const STORAGE_KEYS = {
  configs: "bmp_configs",
  profile: "bmp_profile"
};

const Storage = {
  getConfigs() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEYS.configs)) || [];
    } catch (e) {
      console.error("Erreur lecture configs", e);
      return [];
    }
  },

  saveConfigs(configs) {
    localStorage.setItem(STORAGE_KEYS.configs, JSON.stringify(configs));
  },

  addOrUpdateConfig(config) {
    const configs = this.getConfigs();
    const idx = configs.findIndex(c => c.id === config.id);
    if (idx >= 0) {
      configs[idx] = config;
    } else {
      configs.push(config);
    }
    this.saveConfigs(configs);
  },

  getConfigById(id) {
    return this.getConfigs().find(c => c.id === id);
  },

  getProfile() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEYS.profile)) || {
        pseudo: "Joueur",
        bio: ""
      };
    } catch (e) {
      return { pseudo: "Joueur", bio: "" };
    }
  },

  saveProfile(profile) {
    localStorage.setItem(STORAGE_KEYS.profile, JSON.stringify(profile));
  },

  uid() {
    return "id_" + Date.now() + "_" + Math.floor(Math.random() * 100000);
  }
};
