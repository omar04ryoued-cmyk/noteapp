/* ==========================================
   TABLEAU DE BORD ADMINISTRATEUR
   Lit/écrit directement les mêmes clés localStorage que auth.js et
   script.js. Fonctionne uniquement sur les comptes créés dans CE
   navigateur (voir avertissement dans auth.js).
   ========================================== */
document.addEventListener('DOMContentLoaded', () => {
    const currentAdmin = getCurrentUser();
    if (!currentAdmin) return; // requireAdmin() dans le <head> gère déjà la redirection

    document.getElementById('btn-admin-logout').addEventListener('click', () => {
        logoutUser();
        window.location.href = 'index.html';
    });

    /* --- Navigation entre onglets --- */
    const tabButtons = document.querySelectorAll('.admin-sidebar .menu-btn');
    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            tabButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById('tab-content-users').classList.toggle('hidden', btn.dataset.tab !== 'users');
            document.getElementById('tab-content-team').classList.toggle('hidden', btn.dataset.tab !== 'team');
            document.getElementById('tab-content-messages').classList.toggle('hidden', btn.dataset.tab !== 'messages');
        });
    });

    /* --- Lecture des données brutes d'un utilisateur donné --- */
    function getUserData(uid) {
        return {
            notes: JSON.parse(localStorage.getItem(`app_notes_${uid}`)) || [],
            tasks: JSON.parse(localStorage.getItem(`app_tasks_${uid}`)) || [],
            flashcards: JSON.parse(localStorage.getItem(`app_flashcards_${uid}`)) || [],
            trash: JSON.parse(localStorage.getItem(`app_trash_${uid}`)) || []
        };
    }

    function deleteUserData(uid) {
        localStorage.removeItem(`app_notes_${uid}`);
        localStorage.removeItem(`app_tasks_${uid}`);
        localStorage.removeItem(`app_flashcards_${uid}`);
        localStorage.removeItem(`app_trash_${uid}`);
    }

    /* --- Rendu de la vue "Utilisateurs" --- */
    let userSearchQuery = '';

    function renderUsers() {
        const users = getUsers();
        const statsRow = document.getElementById('admin-stats-row');
        const tbody = document.getElementById('admin-users-tbody');

        let totalNotes = 0, totalTasks = 0, totalFlashcards = 0;
        const usersWithData = users.map(u => {
            const data = getUserData(u.id);
            totalNotes += data.notes.length;
            totalTasks += data.tasks.length;
            totalFlashcards += data.flashcards.length;
            return { ...u, data };
        });

        statsRow.innerHTML = `
            <div class="admin-stat-card"><div class="admin-stat-value">${users.length}</div><div class="admin-stat-label">Comptes créés</div></div>
            <div class="admin-stat-card"><div class="admin-stat-value">${totalNotes}</div><div class="admin-stat-label">Notes au total</div></div>
            <div class="admin-stat-card"><div class="admin-stat-value">${totalTasks}</div><div class="admin-stat-label">Tâches au total</div></div>
            <div class="admin-stat-card"><div class="admin-stat-value">${totalFlashcards}</div><div class="admin-stat-label">Flashcards au total</div></div>
        `;

        if (users.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="admin-empty">Aucun utilisateur pour le moment.</td></tr>';
            return;
        }

        const query = userSearchQuery.trim().toLowerCase();
        const filtered = query
            ? usersWithData.filter(u => u.name.toLowerCase().includes(query) || u.email.toLowerCase().includes(query))
            : usersWithData;

        if (filtered.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="admin-empty">Aucun utilisateur ne correspond à "' + escapeHtmlAdmin(userSearchQuery) + '".</td></tr>';
            return;
        }

        tbody.innerHTML = '';
        filtered.forEach(u => {
            const tr = document.createElement('tr');
            const adminCount = users.filter(x => x.role === 'admin').length;
            const isLastAdmin = u.role === 'admin' && adminCount <= 1;

            tr.innerHTML = `
                <td><strong>${escapeHtmlAdmin(u.name)}</strong>${u.id === currentAdmin.id ? ' <span style="color:var(--text-secondary); font-size:0.78rem;">(vous)</span>' : ''}</td>
                <td>${escapeHtmlAdmin(u.email)}</td>
                <td><span class="admin-role-badge ${u.role}">${u.role === 'admin' ? 'Admin' : 'Utilisateur'}</span></td>
                <td>${new Date(u.createdAt).toLocaleDateString('fr-FR')}</td>
                <td>${u.data.notes.length} notes · ${u.data.tasks.length} tâches · ${u.data.flashcards.length} cartes</td>
                <td class="admin-table-actions">
                    <button class="btn-admin-view" data-action="view" data-uid="${u.id}">Voir</button>
                    <button class="btn-admin-role" data-action="role" data-uid="${u.id}" ${isLastAdmin ? 'disabled title="Impossible de retirer le dernier admin"' : ''}>
                        ${u.role === 'admin' ? 'Rétrograder' : 'Promouvoir admin'}
                    </button>
                    <button class="btn-admin-delete" data-action="delete" data-uid="${u.id}">Supprimer</button>
                </td>
            `;
            tbody.appendChild(tr);
        });

        tbody.querySelectorAll('button[data-action="view"]').forEach(btn => {
            btn.addEventListener('click', () => openDrawer(btn.dataset.uid));
        });
        tbody.querySelectorAll('button[data-action="role"]').forEach(btn => {
            btn.addEventListener('click', () => toggleRole(btn.dataset.uid));
        });
        tbody.querySelectorAll('button[data-action="delete"]').forEach(btn => {
            btn.addEventListener('click', () => deleteUser(btn.dataset.uid));
        });
    }

    function toggleRole(uid) {
        const users = getUsers();
        const user = users.find(u => u.id === uid);
        if (!user) return;

        const adminCount = users.filter(u => u.role === 'admin').length;
        if (user.role === 'admin' && adminCount <= 1) {
            alert("Impossible de retirer le rôle admin du dernier administrateur restant.");
            return;
        }

        const nextRole = user.role === 'admin' ? 'user' : 'admin';
        if (!confirm(`Changer le rôle de ${user.name} en "${nextRole === 'admin' ? 'Admin' : 'Utilisateur'}" ?`)) return;

        user.role = nextRole;
        saveUsers(users);
        renderUsers();
    }

    function deleteUser(uid) {
        const users = getUsers();
        const user = users.find(u => u.id === uid);
        if (!user) return;

        if (user.id === currentAdmin.id) {
            alert("Vous ne pouvez pas supprimer votre propre compte depuis cet écran.");
            return;
        }

        if (!confirm(`Supprimer définitivement le compte de ${user.name} et toutes ses données (notes, tâches, flashcards) ?`)) return;

        saveUsers(users.filter(u => u.id !== uid));
        deleteUserData(uid);
        renderUsers();
    }

    /* --- Panneau de détail (lecture des notes/tâches/flashcards d'un utilisateur) --- */
    const drawer = document.getElementById('admin-drawer');
    const drawerBody = document.getElementById('drawer-body');

    function openDrawer(uid) {
        const user = getUsers().find(u => u.id === uid);
        if (!user) return;
        const data = getUserData(uid);

        document.getElementById('drawer-user-name').textContent = user.name;

        drawerBody.innerHTML = `
            <div class="admin-drawer-section">
                <h4>Notes (${data.notes.length})</h4>
                ${data.notes.length ? data.notes.map(n => `<div class="admin-drawer-item">${escapeHtmlAdmin(n.title || 'Sans titre')}</div>`).join('') : '<div class="admin-drawer-item">Aucune note.</div>'}
            </div>
            <div class="admin-drawer-section">
                <h4>Tâches (${data.tasks.length})</h4>
                ${data.tasks.length ? data.tasks.map(t => `<div class="admin-drawer-item">${t.done ? '✅' : '⬜'} ${escapeHtmlAdmin(t.text)}</div>`).join('') : '<div class="admin-drawer-item">Aucune tâche.</div>'}
            </div>
            <div class="admin-drawer-section">
                <h4>Flashcards (${data.flashcards.length})</h4>
                ${data.flashcards.length ? data.flashcards.map(c => `<div class="admin-drawer-item">${escapeHtmlAdmin(c.front)}</div>`).join('') : '<div class="admin-drawer-item">Aucune flashcard.</div>'}
            </div>
        `;

        drawer.classList.remove('hidden');
    }

    document.getElementById('btn-close-drawer').addEventListener('click', () => drawer.classList.add('hidden'));
    drawer.addEventListener('click', (e) => {
        if (e.target === drawer) drawer.classList.add('hidden');
    });

    /* --- Gestion des membres de l'équipe (page publique) --- */
    function renderTeam() {
        const TEAM_KEY = 'team_members';
        const members = JSON.parse(localStorage.getItem(TEAM_KEY)) || [];
        const tbody = document.getElementById('admin-team-tbody');
        tbody.innerHTML = '';

        if (members.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="admin-empty">Aucun membre ajouté pour le moment. Ajoutez-en depuis la page "Équipe".</td></tr>';
            return;
        }

        members.forEach(m => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${escapeHtmlAdmin(m.name)}</strong></td>
                <td>${escapeHtmlAdmin(m.role || '—')}</td>
                <td>${escapeHtmlAdmin((m.bio || '').slice(0, 60))}</td>
                <td class="admin-table-actions">
                    <button class="btn-admin-delete" data-remove-member="${m.id}">Retirer</button>
                </td>
            `;
            tbody.appendChild(tr);
        });

        tbody.querySelectorAll('button[data-remove-member]').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.removeMember;
                if (!confirm("Retirer ce membre de la page Équipe ?")) return;
                const updated = members.filter(m => m.id !== id);
                localStorage.setItem(TEAM_KEY, JSON.stringify(updated));
                renderTeam();
            });
        });
    }

    function escapeHtmlAdmin(text) {
        const div = document.createElement('div');
        div.textContent = text || '';
        return div.innerHTML;
    }

    /* --- Recherche utilisateurs --- */
    document.getElementById('admin-user-search').addEventListener('input', (e) => {
        userSearchQuery = e.target.value;
        renderUsers();
    });

    /* --- Export CSV --- */
    document.getElementById('btn-export-users-csv').addEventListener('click', () => {
        const users = getUsers();
        if (users.length === 0) {
            alert("Aucun utilisateur à exporter.");
            return;
        }

        const escapeCsv = (value) => `"${String(value).replace(/"/g, '""')}"`;
        const header = ['Nom', 'Email', 'Rôle', 'Inscrit le', 'Notes', 'Tâches', 'Flashcards'];
        const rows = users.map(u => {
            const data = getUserData(u.id);
            return [
                u.name,
                u.email,
                u.role,
                new Date(u.createdAt).toLocaleDateString('fr-FR'),
                data.notes.length,
                data.tasks.length,
                data.flashcards.length
            ].map(escapeCsv).join(',');
        });

        const csvContent = [header.map(escapeCsv).join(','), ...rows].join('\r\n');
        const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `utilisateurs-noteapp-${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    });

    /* --- Messages de contact --- */
    const MESSAGES_KEY = 'site_contact_messages';

    function getMessages() {
        return JSON.parse(localStorage.getItem(MESSAGES_KEY)) || [];
    }

    function saveMessages(messages) {
        localStorage.setItem(MESSAGES_KEY, JSON.stringify(messages));
    }

    function renderMessages() {
        const messages = getMessages();
        const container = document.getElementById('messages-list');

        if (messages.length === 0) {
            container.innerHTML = '<div class="admin-empty">Aucun message reçu pour le moment.</div>';
            return;
        }

        container.innerHTML = messages.map(m => `
            <div class="admin-drawer-item" style="margin-bottom: 10px; padding: 14px 16px;" data-message-id="${m.id}">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:6px; gap:10px;">
                    <strong>${escapeHtmlAdmin(m.name)}</strong>
                    <div style="display:flex; align-items:center; gap:10px; flex-shrink:0;">
                        <span style="color:var(--text-secondary); font-size:0.78rem;">${new Date(m.createdAt).toLocaleString('fr-FR')}</span>
                        <button class="icon-btn btn-delete-message" data-id="${m.id}" title="Supprimer ce message"><i class="fa-solid fa-trash-can"></i></button>
                    </div>
                </div>
                <div style="color:var(--text-secondary); font-size:0.82rem; margin-bottom:8px;">${escapeHtmlAdmin(m.email)}</div>
                <div style="font-size:0.9rem;">${escapeHtmlAdmin(m.message)}</div>
            </div>
        `).join('');
    }

    document.getElementById('messages-list')?.addEventListener('click', (e) => {
        const btn = e.target.closest('.btn-delete-message');
        if (!btn) return;
        if (!confirm('Supprimer ce message définitivement ?')) return;
        const id = btn.dataset.id;
        saveMessages(getMessages().filter(m => m.id !== id));
        renderMessages();
    });

    document.getElementById('btn-clear-messages')?.addEventListener('click', () => {
        if (getMessages().length === 0) return;
        if (!confirm('Supprimer TOUS les messages de contact définitivement ? Cette action est irréversible.')) return;
        saveMessages([]);
        renderMessages();
    });

    renderUsers();
    renderTeam();
    renderMessages();
});
