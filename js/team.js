/* ==========================================
   GESTION DE LA PAGE ÉQUIPE
   Les membres sont stockés dans localStorage ('team_members'),
   avec la photo encodée en base64 directement dans l'entrée.
   ========================================== */
document.addEventListener('DOMContentLoaded', () => {
    const TEAM_KEY = 'team_members';
    const grid = document.getElementById('team-grid');
    if (!grid) return;

    // Membres par défaut de l'équipe : créés sans photo, chacun pourra
    // ensuite charger la sienne en cliquant sur sa carte.
    const DEFAULT_MEMBERS = [
        'Kanan Victoire Theresia Flavie',
        'Nassa Kiswendsida',
        'Compaoré Cherlynn Wendyam Célimène',
        'Ouedraogo Oumarou',
        'Kinda Fabiola Zeina Relwendé',
        'Kiendrebeogo Jemima Wendkuni Astride',
    ].map(name => ({ id: generateId(), name, role: '', bio: '', photo: null }));

    const SEED_FLAG_KEY = 'team_seeded_v1';

    function getMembers() {
        if (localStorage.getItem(SEED_FLAG_KEY) === null) {
            // Jamais initialisé sur ce navigateur : on crée l'équipe par défaut,
            // même si 'team_members' contient déjà un tableau vide.
            localStorage.setItem(SEED_FLAG_KEY, 'true');
            saveMembers(DEFAULT_MEMBERS);
            return DEFAULT_MEMBERS;
        }
        return JSON.parse(localStorage.getItem(TEAM_KEY)) || [];
    }

    function saveMembers(members) {
        localStorage.setItem(TEAM_KEY, JSON.stringify(members));
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Redimensionne et compresse une image côté navigateur avant de la stocker
    // en base64 dans localStorage (limité à ~5-10 Mo) : sans ça, deux ou trois
    // photos haute résolution peuvent suffire à saturer le quota.
    const PHOTO_MAX_DIMENSION = 400;
    const PHOTO_JPEG_QUALITY = 0.75;

    function compressImage(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(new Error("Impossible de lire le fichier."));
            reader.onload = () => {
                const img = new Image();
                img.onerror = () => reject(new Error("Fichier image invalide."));
                img.onload = () => {
                    let { width, height } = img;
                    if (width > height && width > PHOTO_MAX_DIMENSION) {
                        height = Math.round(height * (PHOTO_MAX_DIMENSION / width));
                        width = PHOTO_MAX_DIMENSION;
                    } else if (height > PHOTO_MAX_DIMENSION) {
                        width = Math.round(width * (PHOTO_MAX_DIMENSION / height));
                        height = PHOTO_MAX_DIMENSION;
                    }

                    const canvas = document.createElement('canvas');
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);

                    resolve(canvas.toDataURL('image/jpeg', PHOTO_JPEG_QUALITY));
                };
                img.src = reader.result;
            };
            reader.readAsDataURL(file);
        });
    }

    function render() {
        const members = getMembers();
        grid.innerHTML = '';

        members.forEach(member => {
            const card = document.createElement('div');
            card.className = 'team-card';

            const removeBtn = document.createElement('button');
            removeBtn.className = 'btn-remove-member';
            removeBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
            removeBtn.title = 'Retirer ce membre';
            removeBtn.addEventListener('click', () => {
                if (!confirm(`Retirer ${member.name} de l'équipe ?`)) return;
                saveMembers(getMembers().filter(m => m.id !== member.id));
                render();
            });

            let photoWrapper;
            if (member.photo) {
                const photoEl = document.createElement('img');
                photoEl.className = 'team-photo';
                photoEl.src = member.photo;
                photoEl.alt = member.name;
                photoWrapper = photoEl;
            } else {
                // Pas encore de photo : la zone devient un bouton de chargement.
                photoWrapper = document.createElement('label');
                photoWrapper.className = 'team-photo-placeholder team-photo-upload';
                photoWrapper.title = 'Cliquez pour charger votre photo';
                photoWrapper.innerHTML = `
                    <span class="member-initials">${escapeHtml(getInitials(member.name))}</span>
                    <span class="member-upload-hint"><i class="fa-solid fa-camera"></i> Charger la photo</span>
                    <input type="file" accept="image/*" style="display:none;">
                `;

                const fileInput = photoWrapper.querySelector('input[type="file"]');
                fileInput.addEventListener('change', async () => {
                    const file = fileInput.files[0];
                    if (!file) return;

                    photoWrapper.querySelector('.member-upload-hint').innerHTML =
                        '<i class="fa-solid fa-spinner fa-spin"></i> Compression...';
                    try {
                        const dataUrl = await compressImage(file);
                        const updated = getMembers().map(m =>
                            m.id === member.id ? { ...m, photo: dataUrl } : m
                        );
                        saveMembers(updated);
                        render();
                    } catch (err) {
                        console.error(err);
                        alert("Cette image n'a pas pu être traitée. Essayez-en une autre.");
                        photoWrapper.querySelector('.member-upload-hint').innerHTML =
                            '<i class="fa-solid fa-camera"></i> Charger la photo';
                    }
                });
            }

            card.appendChild(removeBtn);
            card.appendChild(photoWrapper);

            const nameEl = document.createElement('h4');
            nameEl.textContent = member.name;

            const roleEl = document.createElement('div');
            roleEl.className = 'team-role';
            roleEl.textContent = member.role || '';

            const bioEl = document.createElement('p');
            bioEl.className = 'team-bio';
            bioEl.textContent = member.bio || '';

            card.appendChild(nameEl);
            card.appendChild(roleEl);
            card.appendChild(bioEl);
            grid.appendChild(card);
        });

        /* --- Carte d'ajout --- */
        const addCard = document.createElement('div');
        addCard.className = 'add-member-card';
        addCard.innerHTML = `
            <label for="member-photo-input" class="photo-upload-label">
                <i class="fa-solid fa-camera"></i> Ajouter une photo
            </label>
            <input type="file" id="member-photo-input" accept="image/*" style="display:none;">
            <input type="text" id="member-name-input" placeholder="Nom">
            <input type="text" id="member-role-input" placeholder="Rôle (ex : Développeuse)">
            <textarea id="member-bio-input" placeholder="Courte bio (optionnel)"></textarea>
            <button class="primary-btn" id="btn-add-member" type="button">Ajouter à l'équipe</button>
        `;
        grid.appendChild(addCard);

        let pendingPhoto = null;
        const photoInput = document.getElementById('member-photo-input');
        const photoLabel = addCard.querySelector('.photo-upload-label');

        photoInput.addEventListener('change', async () => {
            const file = photoInput.files[0];
            if (!file) return;

            photoLabel.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Compression...`;
            try {
                pendingPhoto = await compressImage(file);
                photoLabel.innerHTML = `<i class="fa-solid fa-check"></i> ${escapeHtml(file.name)}`;
            } catch (err) {
                console.error(err);
                photoLabel.innerHTML = `<i class="fa-solid fa-camera"></i> Ajouter une photo`;
                alert("Cette image n'a pas pu être traitée. Essayez-en une autre.");
            }
        });

        document.getElementById('btn-add-member').addEventListener('click', () => {
            const name = document.getElementById('member-name-input').value.trim();
            const role = document.getElementById('member-role-input').value.trim();
            const bio = document.getElementById('member-bio-input').value.trim();

            if (!name) {
                alert('Le nom est obligatoire.');
                return;
            }

            const members = getMembers();
            members.push({ id: generateId(), name, role, bio, photo: pendingPhoto });
            saveMembers(members);
            render();
        });
    }

    render();
});
