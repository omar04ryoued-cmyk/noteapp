/* ==========================================
   Remplit dynamiquement la zone .site-nav-actions selon que
   quelqu'un est connecté ou non — utilisé sur toutes les pages
   publiques (index, fonctionnalités, équipe).
   ========================================== */
document.addEventListener('DOMContentLoaded', () => {
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
