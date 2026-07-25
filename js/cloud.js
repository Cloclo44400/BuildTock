// cloud.js — connexion à Firebase (Firestore + Auth Google)
// Gère les configurations PUBLIÉES (communauté), partagées entre tous les utilisateurs.
// Les brouillons (non publiés) restent en LocalStorage (voir storage.js).

const Cloud = {
  db: null,
  auth: null,
  uid: null,
  user: null,   // { uid, displayName, photoURL, email }
  ready: null,  // promesse résolue quand Firebase est initialisé (connecté ou non)
  enabled: true,
  onAuthChange: null, // callback optionnel(user) déclenché à chaque changement d'état de connexion

  init() {
    this.ready = new Promise((resolve) => {
      try {
        if (firebaseConfig.apiKey === "...") {
          console.warn("Firebase non configuré : renseigne js/firebase-config.js. Mode local uniquement.");
          this.enabled = false;
          resolve(false);
          return;
        }

        firebase.initializeApp(firebaseConfig);
        this.db = firebase.firestore();
        this.auth = firebase.auth();

        this.auth.onAuthStateChanged(user => {
          if (user) {
            this.uid = user.uid;
            this.user = {
              uid: user.uid,
              displayName: user.displayName,
              photoURL: user.photoURL,
              email: user.email
            };
          } else {
            this.uid = null;
            this.user = null;
          }
          if (this.onAuthChange) this.onAuthChange(this.user);
          resolve(true);
        });
      } catch (err) {
        console.error("Erreur init Firebase :", err);
        this.enabled = false;
        resolve(false);
      }
    });
    return this.ready;
  },

  async signInWithGoogle() {
    if (!this.enabled) return;
    const provider = new firebase.auth.GoogleAuthProvider();
    await this.auth.signInWithPopup(provider);
  },

  async signOut() {
    if (!this.enabled) return;
    await this.auth.signOut();
  },

  isLoggedIn() {
    return !!this.uid;
  },

  configsCollection() {
    return this.db.collection("configs");
  },

  // Récupère toutes les configs publiées, triées par date décroissante
  async getPublished() {
    if (!this.enabled) return [];
    const snap = await this.configsCollection().orderBy("date", "desc").get();
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  },

  // Récupère les configs publiées par l'utilisateur courant (uid anonyme)
  async getMine() {
    if (!this.enabled) return [];
    const snap = await this.configsCollection().where("authorId", "==", this.uid).get();
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  },

  // Publie ou met à jour une config dans le cloud
  async publish(config) {
    if (!this.enabled) throw new Error("Firebase non configuré");
    if (!this.isLoggedIn()) throw new Error("Connecte-toi avec Google pour publier");
    const payload = {
      name: config.name,
      description: config.description || "",
      budget: config.budget || null,
      components: config.components,
      authorId: this.uid,
      authorPseudo: config.author,
      authorPhotoURL: config.authorPhotoURL || null,
      date: config.date || Date.now(),
      views: config.views || 0,
      likes: config.likes || [],
      ratings: config.ratings || [],
      comments: config.comments || []
    };
    if (config.cloudId) {
      await this.configsCollection().doc(config.cloudId).set(payload, { merge: true });
      return config.cloudId;
    } else {
      const ref = await this.configsCollection().add(payload);
      return ref.id;
    }
  },

  async toggleLike(cloudId) {
    if (!this.enabled) return;
    if (!this.isLoggedIn()) throw new Error("Connecte-toi avec Google pour liker");
    const ref = this.configsCollection().doc(cloudId);
    await this.db.runTransaction(async (t) => {
      const doc = await t.get(ref);
      if (!doc.exists) return;
      const data = doc.data();
      const likes = data.likes || [];
      const idx = likes.indexOf(this.uid);
      if (idx >= 0) likes.splice(idx, 1);
      else likes.push(this.uid);
      t.update(ref, { likes });
    });
  },

  async rate(cloudId, value) {
    if (!this.enabled) return;
    if (!this.isLoggedIn()) throw new Error("Connecte-toi avec Google pour noter");
    const ref = this.configsCollection().doc(cloudId);
    await this.db.runTransaction(async (t) => {
      const doc = await t.get(ref);
      if (!doc.exists) return;
      const data = doc.data();
      const ratings = data.ratings || [];
      const existing = ratings.find(r => r.uid === this.uid);
      if (existing) existing.value = value;
      else ratings.push({ uid: this.uid, value });
      t.update(ref, { ratings });
    });
  },

  async addComment(cloudId, comment) {
    if (!this.enabled) return;
    if (!this.isLoggedIn()) throw new Error("Connecte-toi avec Google pour commenter");
    const ref = this.configsCollection().doc(cloudId);
    await this.db.runTransaction(async (t) => {
      const doc = await t.get(ref);
      if (!doc.exists) return;
      const data = doc.data();
      const comments = data.comments || [];
      comments.push(comment);
      t.update(ref, { comments });
    });
  },

  async incrementViews(cloudId) {
    if (!this.enabled) return false;
    if (!this.isLoggedIn()) return false;
    const ref = this.configsCollection().doc(cloudId);
    let counted = false;
    await this.db.runTransaction(async (t) => {
      const doc = await t.get(ref);
      if (!doc.exists) return;
      const data = doc.data();
      const viewedBy = data.viewedBy || [];
      if (viewedBy.includes(this.uid)) return; // déjà comptabilisé pour cet utilisateur
      viewedBy.push(this.uid);
      t.update(ref, {
        viewedBy,
        views: firebase.firestore.FieldValue.increment(1)
      });
      counted = true;
    });
    return counted;
  }
};
