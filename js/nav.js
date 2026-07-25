/* ==========================================
   Remplit dynamiquement la zone .site-nav-actions selon que
   quelqu'un est connecté ou non — utilisé sur toutes les pages
   publiques (index, fonctionnalités, équipe).
   ========================================== */
/* ==========================================
   1) Menu hamburger mobile — toujours actif, même sur les pages
      sans zone #nav-actions (ex: connexion.html).
   2) Remplit dynamiquement la zone .site-nav-actions selon que
      quelqu'un est connecté ou non.
   ========================================== */
document.addEventListener('DOMContentLoaded', () => {
    // --- 1) Menu hamburger ---
    const navToggle = document.getElementById('nav-toggle');
    const navLinks = document.querySelector('.site-nav-links');

    if (navToggle && navLinks) {
        navToggle.addEventListener('click', () => {
            const isOpen = navLinks.classList.toggle('mobile-open');
            navToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
            navToggle.innerHTML = isOpen
                ? '<i class="fa-solid fa-xmark"></i>'
                : '<i class="fa-solid fa-bars"></i>';
        });

        // Ferme le menu si on clique sur un lien (navigation vers une autre page).
        navLinks.querySelectorAll('a').forEach(link => {
            link.addEventListener('click', () => {
                navLinks.classList.remove('mobile-open');
                navToggle.setAttribute('aria-expanded', 'false');
                navToggle.innerHTML = '<i class="fa-solid fa-bars"></i>';
            });
        });

        // Ferme le menu si on clique en dehors de la nav.
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.site-nav') && navLinks.classList.contains('mobile-open')) {
                navLinks.classList.remove('mobile-open');
                navToggle.setAttribute('aria-expanded', 'false');
                navToggle.innerHTML = '<i class="fa-solid fa-bars"></i>';
            }
        });
    }

    // --- 2) Boutons connexion/inscription ou menu utilisateur ---
    const navActions = document.getElementById('nav-actions');
    if (!navActions) return;

    const user = getCurrentUser();

    if (!user) {
        navActions.innerHTML = `
            <a href="connexion.html" class="btn-outline">Se connecter</a>
            <a href="connexion.html?mode=register" class="btn-solid">S'inscrire</a>
        `;
        return;
    }

    navActions.innerHTML = `
        <a href="app.html" class="btn-outline"><i class="fa-solid fa-book-open"></i> Mes notes</a>
        <div class="user-menu">
            <div class="user-avatar">${getInitials(user.name)}</div>
        </div>
    `;
});
