/* ==========================================
   MODULE D'AUTHENTIFICATION (simulation front-end)
   ==========================================
   IMPORTANT — À lire avant d'utiliser ce fichier en production :
   Ce système fonctionne ENTIÈREMENT dans le navigateur, sans serveur.
   - Les comptes créés n'existent que dans le navigateur où ils ont été créés
     (pas de partage entre appareils/utilisateurs différents).
   - Le hachage de mot de passe (SHA-256 côté client, sans sel) protège contre
     une lecture accidentelle du localStorage, mais N'EST PAS un niveau de
     sécurité suffisant pour un vrai site avec des utilisateurs réels.
   Pour un vrai système multi-utilisateurs sécurisé, il faut un backend
   (serveur + base de données) — voir la conversation pour plus de détails.
   ========================================== */

const AUTH_USERS_KEY = 'site_users';
const AUTH_SESSION_KEY = 'site_session_uid';

/* --- Hachage simple du mot de passe (SHA-256 via l'API Web Crypto) --- */
async function hashPassword(password) {
    if (!window.crypto || !window.crypto.subtle) {
        throw new Error("Ce navigateur ne supporte pas les fonctions de sécurité nécessaires. Essayez d'ouvrir ce lien dans Chrome ou Safari plutôt que dans l'appli WhatsApp/Messenger.");
    }
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

/* --- Génère un identifiant unique, avec repli si crypto.randomUUID est indisponible --- */
function generateId() {
    if (window.crypto && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

function getUsers() {
    return JSON.parse(localStorage.getItem(AUTH_USERS_KEY)) || [];
}

function saveUsers(users) {
    localStorage.setItem(AUTH_USERS_KEY, JSON.stringify(users));
}

/* --- Inscription : le tout premier compte créé sur ce navigateur devient admin --- */
async function registerUser({ name, email, password }) {
    const cleanEmail = email.trim().toLowerCase();
    const users = getUsers();

    if (users.some(u => u.email === cleanEmail)) {
        throw new Error("Un compte existe déjà avec cet email sur cet appareil.");
    }

    const passwordHash = await hashPassword(password);
    const newUser = {
        id: generateId(),
        name: name.trim(),
        email: cleanEmail,
        passwordHash,
        role: users.length === 0 ? 'admin' : 'user',
        createdAt: new Date().toISOString()
    };

    users.push(newUser);
    saveUsers(users);
    localStorage.setItem(AUTH_SESSION_KEY, newUser.id);
    return newUser;
}

async function loginUser(email, password) {
    const cleanEmail = email.trim().toLowerCase();
    const users = getUsers();
    const user = users.find(u => u.email === cleanEmail);
    if (!user) throw new Error("Aucun compte ne correspond à cet email sur cet appareil.");

    const passwordHash = await hashPassword(password);
    if (passwordHash !== user.passwordHash) {
        throw new Error("Mot de passe incorrect.");
    }

    localStorage.setItem(AUTH_SESSION_KEY, user.id);
    return user;
}

function logoutUser() {
    localStorage.removeItem(AUTH_SESSION_KEY);
}

function getCurrentUser() {
    const uid = localStorage.getItem(AUTH_SESSION_KEY);
    if (!uid) return null;
    const users = getUsers();
    return users.find(u => u.id === uid) || null;
}

/* --- Garde-fous à appeler en haut des pages protégées --- */
function requireAuth() {
    const user = getCurrentUser();
    if (!user) {
        window.location.href = 'connexion.html';
        return null;
    }
    return user;
}

function requireAdmin() {
    const user = requireAuth();
    if (user && user.role !== 'admin') {
        alert("Accès réservé aux administrateurs.");
        window.location.href = 'app.html';
        return null;
    }
    return user;
}

/* --- Utilitaire : initiales pour l'avatar --- */
function getInitials(name) {
    if (!name) return '?';
    return name.trim().split(/\s+/).slice(0, 2).map(p => p[0].toUpperCase()).join('');
}
