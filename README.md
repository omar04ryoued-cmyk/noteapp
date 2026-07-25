# NoteApp — Site complet

## Structure du projet

```
noteapp-site/
├── index.html              (accueil)
├── fonctionnalites.html
├── equipe.html
├── connexion.html
├── app.html                (protégée — connexion requise)
├── admin.html               (protégée — rôle admin requis)
├── a-propos.html
├── faq.html
├── css/
│   ├── style.css            (design system de l'app de notes)
│   └── site.css             (styles des pages vitrine)
└── js/
    ├── auth.js               (inscription, connexion, sessions, gardes d'accès)
    ├── nav.js                (navigation dynamique selon l'état de connexion)
    ├── team.js               (page Équipe)
    ├── admin.js              (tableau de bord admin)
    └── script.js             (logique de l'app de notes)
```

Les pages HTML restent à la racine (convention standard pour un site web —
la plupart des hébergeurs exigent que `index.html` soit à la racine).

## Comment l'essayer

Ouvre simplement `index.html` dans un navigateur (double-clic, ou avec un petit
serveur local type `python3 -m http.server` depuis ce dossier pour éviter
certaines restrictions de navigateur sur les fichiers locaux).

1. Clique sur **"Créer un compte gratuit"**.
2. Le **premier compte créé devient automatiquement administrateur**.
3. Une fois connecté, tu arrives sur `app.html` (l'appli de notes).
4. En tant qu'admin, un lien **"Espace admin"** apparaît dans le menu utilisateur (en haut à droite) → `admin.html`.

## ⚠️ Limite importante à connaître

Ce système d'authentification est une **simulation entièrement côté navigateur** (pas de serveur, pas de base de données partagée) :

- Les comptes créés n'existent **que dans le navigateur où ils ont été créés**. Si ton coéquipier ouvre le site sur son propre ordinateur, il ne verra pas les comptes que tu as créés sur le tien.
- L'espace admin ne peut donc gérer que les comptes créés **sur ce même navigateur**.
- Les mots de passe sont hachés (SHA-256) mais sans "sel" ni serveur — ce n'est **pas un niveau de sécurité suffisant pour de vrais utilisateurs en production**.

**Pour un vrai système multi-utilisateurs** (comptes partagés entre tous les appareils, admin qui voit vraiment tout le monde), il faut un backend avec une base de données. On en a discuté dans la conversation — dis-moi si tu veux qu'on s'y attaque à un moment.

## Fichiers techniques

- `auth.js` — inscription, connexion, session, gardes d'accès (`requireAuth`, `requireAdmin`)
- `nav.js` — affiche les bons boutons de navigation (connecté/déconnecté) sur les pages publiques
- `team.js` — logique de la page Équipe (ajout de membres + photo)
- `admin.js` — logique du tableau de bord admin
- `script.js` — logique de l'application de notes (namespacée par utilisateur : `app_notes_<id>`, etc.)
- `style.css` — design system de l'application (palette "Papier & Encre" / "Lampe de bureau")
- `site.css` — styles des pages vitrine (accueil, fonctionnalités, équipe, connexion, admin)
