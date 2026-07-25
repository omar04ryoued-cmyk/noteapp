document.addEventListener('DOMContentLoaded', () => {
    /* ==========================================
       0. NAMESPACING DES DONNÉES PAR UTILISATEUR
       ========================================== */
    // Chaque utilisateur connecté (auth.js) a ses propres clés localStorage,
    // pour que plusieurs comptes créés sur le même navigateur ne mélangent
    // pas leurs notes/tâches/flashcards.
    const CURRENT_USER = (typeof getCurrentUser === 'function') ? getCurrentUser() : null;
    const UID = CURRENT_USER ? CURRENT_USER.id : 'guest';
    const NOTES_KEY = `app_notes_${UID}`;
    const TASKS_KEY = `app_tasks_${UID}`;
    const FLASHCARDS_KEY = `app_flashcards_${UID}`;
    const TRASH_KEY = `app_trash_${UID}`;
    const FOLDERS_KEY = `app_folders_${UID}`;

    /* ==========================================
       1. DONNÉES ET ÉTAT DE L'APPLICATION
       ========================================== */
    let notes = JSON.parse(localStorage.getItem(NOTES_KEY)) || [];
    let currentNoteId = notes[0] ? notes[0].id : null;
    let currentMediaObjectURL = null;

    let tasks = JSON.parse(localStorage.getItem(TASKS_KEY)) || [];
    let flashcards = JSON.parse(localStorage.getItem(FLASHCARDS_KEY)) || [];
    let trash = JSON.parse(localStorage.getItem(TRASH_KEY)) || [];
    let customFolders = JSON.parse(localStorage.getItem(FOLDERS_KEY)) || [];
    let currentFolder = 'all';
    let searchQuery = '';

    // Empêche de spammer l'historique à chaque frappe : un instantané au maximum
    // toutes les 60 secondes par note (en mémoire, pas persisté).
    const lastSnapshotAt = new Map();
    const HISTORY_SNAPSHOT_INTERVAL_MS = 60 * 1000;
    const HISTORY_MAX_ENTRIES = 20;
    const TRASH_RETENTION_DAYS = 30;

    /* ==========================================
       2. ÉLÉMENTS DU DOM
       ========================================== */
    const markdownInput = document.getElementById('markdown-input');
    const markdownPreview = document.getElementById('markdown-preview');
    const mediaBox = document.getElementById('media-player-box');
    const noteTitle = document.getElementById('note-title');
    const noteFolderSelect = document.getElementById('note-folder-select');
    const noteTags = document.getElementById('note-tags');
    const notesList = document.getElementById('notes-list');

    /* ==========================================
       3. MOTEUR RENDU MARKDOWN & FORMATAGE
       ========================================== */
    // Échappe les caractères HTML spéciaux : utilisé comme filet de sécurité
    // partout où du texte utilisateur brut est inséré dans du innerHTML.
    function escapeHtml(text) {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // Convertit les entités HTML (&amp; &quot; ...) en texte brut.
    function decodeHtmlEntities(str) {
        const el = document.createElement('textarea');
        el.innerHTML = str;
        return el.value;
    }

    // Configuration de marked : GFM (tableaux, listes, etc.) + coloration
    // syntaxique automatique des blocs de code via highlight.js.
    if (typeof marked !== 'undefined') {
        marked.setOptions({
            breaks: true,
            gfm: true,
            highlight: function (code, lang) {
                if (typeof hljs === 'undefined') return code;
                if (lang && hljs.getLanguage(lang)) {
                    return hljs.highlight(code, { language: lang }).value;
                }
                return hljs.highlightAuto(code).value;
            }
        });
    }

    // Après le rendu Markdown + nettoyage anti-XSS, transforme les liens
    // internes [[Titre de note]] en liens cliquables. On limite volontairement
    // le motif captable (pas de <, >, [, ]) pour ne jamais pouvoir "sortir"
    // d'un texte déjà échappé/sanitisé et casser une balise existante.
    function linkifyInternalNotes(html) {
        return html.replace(/\[\[([^<>\[\]]{1,80})\]\]/g, (match, title) => {
            const cleanTitle = title.trim();
            if (!cleanTitle) return match;
            return `<a href="#" class="internal-link" data-title="${cleanTitle}">${cleanTitle}</a>`;
        });
    }

    // DOMPurify autorise l'attribut "style" par défaut mais ne filtre pas le
    // contenu CSS en profondeur. On restreint ici à UNIQUEMENT "color: #hex;"
    // (le seul usage légitime, généré par notre color-picker), pour bloquer
    // tout url()/expression()/background malveillant.
    if (typeof DOMPurify !== 'undefined') {
        DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
            if (data.attrName === 'style' && !/^color:\s*#[0-9a-fA-F]{3,6};?\s*$/i.test(data.attrValue)) {
                data.keepAttr = false;
            }
        });
    }

    function renderMarkdown(text) {
        if (!text) return '';

        // Si les librairies externes n'ont pas pu charger (pas de connexion
        // internet par ex.), on retombe sur un affichage brut mais sûr plutôt
        // que de planter.
        if (typeof marked === 'undefined' || typeof DOMPurify === 'undefined') {
            return `<pre>${escapeHtml(text)}</pre>`;
        }

        const rawHtml = marked.parse(text);

        // DOMPurify élimine tout ce qui pourrait exécuter du code
        // (scripts, gestionnaires onerror/onclick, urls javascript:, etc.)
        const cleanHtml = DOMPurify.sanitize(rawHtml, {
            ALLOWED_TAGS: [
                'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'hr',
                'strong', 'em', 'u', 's', 'del', 'blockquote',
                'ul', 'ol', 'li', 'a', 'code', 'pre', 'span',
                'table', 'thead', 'tbody', 'tr', 'th', 'td', 'img'
            ],
            ALLOWED_ATTR: ['href', 'target', 'rel', 'class', 'style', 'src', 'alt', 'title']
        });

        return linkifyInternalNotes(cleanHtml);
    }

    function updatePreview() {
        if (markdownPreview && markdownInput) {
            markdownPreview.innerHTML = renderMarkdown(markdownInput.value);
        }
    }

    // Clic sur un lien interne [[Titre]] : ouvre la note correspondante,
    // ou propose de la créer si elle n'existe pas encore.
    markdownPreview?.addEventListener('click', (e) => {
        const link = e.target.closest('.internal-link');
        if (!link) return;
        e.preventDefault();

        const title = decodeHtmlEntities(link.dataset.title || '').trim();
        if (!title) return;

        const target = notes.find(n => (n.title || '').trim().toLowerCase() === title.toLowerCase());
        if (target) {
            loadNote(target.id);
            return;
        }

        if (confirm(`Aucune note intitulée "${title}" n'existe. Voulez-vous la créer ?`)) {
            const newNote = { id: crypto.randomUUID(), title, content: '', folder: 'general', tags: '', history: [] };
            notes.unshift(newNote);
            localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
            updateStats();
            loadNote(newNote.id);
        }
    });

    function applyFormat(e, startTag, endTag) {
        if (e) e.preventDefault();
        if (!markdownInput) return;
        
        const start = markdownInput.selectionStart;
        const end = markdownInput.selectionEnd;
        const selectedText = markdownInput.value.substring(start, end) || 'texte';
        const replacement = startTag + selectedText + endTag;
        
        markdownInput.value = markdownInput.value.substring(0, start) + replacement + markdownInput.value.substring(end);
        markdownInput.focus();
        markdownInput.setSelectionRange(start + startTag.length, end + startTag.length);
        
        saveCurrentNote();
        updatePreview();
    }

    // Association de TOUS les boutons de la barre d'outils d'édition
    document.getElementById('btn-bold')?.addEventListener('click', (e) => applyFormat(e, '**', '**'));
    document.getElementById('btn-italic')?.addEventListener('click', (e) => applyFormat(e, '*', '*'));
    document.getElementById('btn-underline')?.addEventListener('click', (e) => applyFormat(e, '<u>', '</u>'));
    document.getElementById('btn-h1')?.addEventListener('click', (e) => applyFormat(e, '# ', ''));
    document.getElementById('btn-h2')?.addEventListener('click', (e) => applyFormat(e, '## ', ''));
    document.getElementById('btn-h3')?.addEventListener('click', (e) => applyFormat(e, '### ', ''));
    document.getElementById('btn-list')?.addEventListener('click', (e) => applyFormat(e, '- ', ''));
    document.getElementById('btn-numlist')?.addEventListener('click', (e) => applyFormat(e, '1. ', ''));
    document.getElementById('btn-code')?.addEventListener('click', (e) => applyFormat(e, '`', '`'));
    document.getElementById('btn-link')?.addEventListener('click', (e) => applyFormat(e, '[', '](https://)'));
    
    document.getElementById('color-picker')?.addEventListener('change', (e) => {
        applyFormat(null, `<span style="color: ${e.target.value};">`, '</span>');
    });

    markdownInput?.addEventListener('input', () => {
        saveCurrentNote();
        updatePreview();
    });

    /* ==========================================
       4. BOUTONS D'ONGLETS / VUES (Split / Edit / Preview)
       ========================================== */
    const tabButtons = document.querySelectorAll('.tab-btn');
    const editorBody = document.getElementById('editor-body');

    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            tabButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            const mode = btn.dataset.mode;
            if (editorBody) editorBody.className = `editor-body ${mode}`;
        });
    });

    /* ==========================================
       5. LECTEUR AUDIO (MP3 / Fichiers Son)
       ========================================== */
    const inputAudio = document.getElementById('input-import-audio');
    const bgAudioPlayer = document.getElementById('bg-audio-player');
    const btnPlayAudio = document.getElementById('btn-play-audio');
    const audioIcon = document.getElementById('audio-icon');
    const audioStatus = document.getElementById('audio-status');

    inputAudio?.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file && file.type.startsWith('audio/')) {
            if (bgAudioPlayer.src) URL.revokeObjectURL(bgAudioPlayer.src);
            
            const fileURL = URL.createObjectURL(file);
            bgAudioPlayer.src = fileURL;
            bgAudioPlayer.volume = 1.0;
            if (audioStatus) audioStatus.textContent = file.name;
            
            bgAudioPlayer.play().then(() => {
                if (audioIcon) audioIcon.className = 'fa-solid fa-pause';
            }).catch(err => console.log("Erreur lecture audio:", err));
        }
    });

    btnPlayAudio?.addEventListener('click', () => {
        if (!bgAudioPlayer || !bgAudioPlayer.src) {
            alert("Veuillez d'abord sélectionner un fichier audio via le bouton d'importation !");
            return;
        }

        if (bgAudioPlayer.paused) {
            bgAudioPlayer.play();
            if (audioIcon) audioIcon.className = 'fa-solid fa-pause';
        } else {
            bgAudioPlayer.pause();
            if (audioIcon) audioIcon.className = 'fa-solid fa-play';
        }
    });

    /* ==========================================
       6. IMPORTATION ET LECTEUR MEDIA (PDF & VIDÉO)
       ========================================== */
    const inputPdf = document.getElementById('input-import-pdf');
    const inputVideo = document.getElementById('input-import-video');

    function cleanupMediaURL() {
        if (currentMediaObjectURL) {
            URL.revokeObjectURL(currentMediaObjectURL);
            currentMediaObjectURL = null;
        }
    }

    inputPdf?.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file && file.type === 'application/pdf') {
            cleanupMediaURL();
            currentMediaObjectURL = URL.createObjectURL(file);
            
            if (mediaBox) {
                mediaBox.innerHTML = `
                    <div class="media-header-bar">
                        <span><i class="fa-solid fa-file-pdf"></i> ${escapeHtml(file.name)}</span>
                        <button class="btn-close-media"><i class="fa-solid fa-xmark"></i> Fermer</button>
                    </div>
                    <embed src="${currentMediaObjectURL}" type="application/pdf" width="100%" height="500px" />
                `;
                showMediaView();
            }
        }
    });

    inputVideo?.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file && file.type.startsWith('video/')) {
            cleanupMediaURL();
            currentMediaObjectURL = URL.createObjectURL(file);
            
            if (mediaBox) {
                mediaBox.innerHTML = `
                    <div class="media-header-bar">
                        <span><i class="fa-solid fa-file-video"></i> ${escapeHtml(file.name)}</span>
                        <button class="btn-close-media"><i class="fa-solid fa-xmark"></i> Fermer</button>
                    </div>
                    <video controls autoplay style="width: 100%; max-height: 500px;">
                        <source src="${currentMediaObjectURL}" type="${file.type}">
                        Votre navigateur ne supporte pas la lecture de cette vidéo.
                    </video>
                `;
                showMediaView();
            }
        }
    });

    function showMediaView() {
        if (markdownPreview) markdownPreview.classList.add('hidden');
        if (mediaBox) mediaBox.classList.remove('hidden');
    }

    // Fermeture du lecteur Média
    document.addEventListener('click', (e) => {
        if (e.target.closest('.btn-close-media')) {
            cleanupMediaURL();
            if (mediaBox) {
                mediaBox.innerHTML = '';
                mediaBox.classList.add('hidden');
            }
            if (markdownPreview) markdownPreview.classList.remove('hidden');
        }
    });

    /* ==========================================
       7. MINUTEUR POMODORO ET ALARME
       ========================================== */
    let pomoInterval = null;
    let pomoSecondsLeft = 25 * 60;
    let isPomoRunning = false;

    const timerDisplay = document.getElementById('timer-display');
    const btnPomoStart = document.getElementById('btn-pomo-start');
    const btnPomoReset = document.getElementById('btn-pomo-reset');
    const pomoInput = document.getElementById('pomo-minutes-input');

    function playAlarmSound() {
        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            const ctx = new AudioContext();

            if (ctx.state === 'suspended') ctx.resume();

            [0, 0.25, 0.5].forEach((delay) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();

                osc.type = 'sine';
                osc.frequency.setValueAtTime(880, ctx.currentTime + delay);

                gain.gain.setValueAtTime(0.3, ctx.currentTime + delay);
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.15);

                osc.connect(gain);
                gain.connect(ctx.destination);

                osc.start(ctx.currentTime + delay);
                osc.stop(ctx.currentTime + delay + 0.15);
            });
        } catch (e) {
            console.log("Erreur alarme sonore:", e);
        }
    }

    function updateTimerDisplay() {
        const minutes = Math.floor(pomoSecondsLeft / 60);
        const seconds = pomoSecondsLeft % 60;
        if (timerDisplay) {
            timerDisplay.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        }
    }

    pomoInput?.addEventListener('change', () => {
        if (!isPomoRunning) {
            const newMinutes = parseInt(pomoInput.value) || 25;
            pomoSecondsLeft = Math.max(1, newMinutes) * 60;
            updateTimerDisplay();
        }
    });

    btnPomoStart?.addEventListener('click', () => {
        if (isPomoRunning) {
            clearInterval(pomoInterval);
            isPomoRunning = false;
            btnPomoStart.textContent = 'Reprendre';
        } else {
            isPomoRunning = true;
            btnPomoStart.textContent = 'Pause';
            
            pomoInterval = setInterval(() => {
                if (pomoSecondsLeft > 0) {
                    pomoSecondsLeft--;
                    updateTimerDisplay();
                } else {
                    clearInterval(pomoInterval);
                    isPomoRunning = false;
                    btnPomoStart.textContent = 'Démarrer';
                    
                    playAlarmSound();
                    setTimeout(() => alert("⏰ Session Pomodoro terminée ! Prenez une pause bien méritée."), 100);
                }
            }, 1000);
        }
    });

    btnPomoReset?.addEventListener('click', () => {
        clearInterval(pomoInterval);
        isPomoRunning = false;
        if (btnPomoStart) btnPomoStart.textContent = 'Démarrer';
        const currentMinutes = parseInt(pomoInput.value) || 25;
        pomoSecondsLeft = currentMinutes * 60;
        updateTimerDisplay();
    });

    /* ==========================================
       8. GESTION DES NOTES (CRÉATION, SUPPRESSION, SAUVEGARDE)
       ========================================== */
    function getFilteredNotes() {
        return notes.filter(note => {
            const matchesFolder = currentFolder === 'all' || note.folder === currentFolder;
            if (!matchesFolder) return false;

            if (!searchQuery) return true;
            const haystack = `${note.title || ''} ${note.content || ''} ${note.tags || ''}`.toLowerCase();
            return haystack.includes(searchQuery);
        });
    }

    function renderNotesList() {
        if (!notesList) return;
        notesList.innerHTML = '';
        const filteredNotes = getFilteredNotes();

        if (filteredNotes.length === 0) {
            const empty = document.createElement('li');
            empty.className = 'empty-state';
            empty.textContent = notes.length === 0
                ? 'Aucune note pour le moment. Cliquez sur "Nouvelle Note" pour commencer.'
                : 'Aucune note ne correspond.';
            notesList.appendChild(empty);
            return;
        }

        filteredNotes.forEach(note => {
            const li = document.createElement('li');
            li.className = 'note-item' + (note.id === currentNoteId ? ' active' : '');
            
            const titleSpan = document.createElement('span');
            titleSpan.textContent = note.title || 'Note sans titre';
            titleSpan.addEventListener('click', () => loadNote(note.id));
            
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'btn-delete-note';
            deleteBtn.innerHTML = '<i class="fa-solid fa-trash"></i>';
            deleteBtn.title = 'Supprimer cette note';
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                deleteNote(note.id);
            });

            li.appendChild(titleSpan);
            li.appendChild(deleteBtn);
            notesList.appendChild(li);
        });
    }

    function loadNote(id) {
        currentNoteId = id;
        const note = notes.find(n => n.id === id);
        if (note) {
            if (noteTitle) noteTitle.value = note.title;
            if (markdownInput) markdownInput.value = note.content;
            if (noteFolderSelect) noteFolderSelect.value = note.folder || 'general';
            if (noteTags) noteTags.value = note.tags || '';
            updatePreview();
        }
        document.getElementById('history-panel')?.classList.add('hidden');
        renderNotesList();
    }

    function saveCurrentNote() {
        if (!currentNoteId) return;
        const note = notes.find(n => n.id === currentNoteId);
        if (note) {
            const previousContent = note.content;

            note.title = noteTitle ? noteTitle.value : note.title;
            note.content = markdownInput ? markdownInput.value : note.content;
            note.folder = noteFolderSelect ? noteFolderSelect.value : note.folder;
            note.tags = noteTags ? noteTags.value : note.tags;

            maybeSnapshotHistory(note, previousContent);

            localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
        }
    }

    // Enregistre une version précédente de la note dans son historique,
    // au maximum une fois par minute et par note, pour ne pas saturer le
    // localStorage à chaque frappe de clavier.
    function maybeSnapshotHistory(note, previousContent) {
        if (previousContent === note.content) return;
        if (!Array.isArray(note.history)) note.history = [];

        const now = Date.now();
        const last = lastSnapshotAt.get(note.id) || 0;
        if (now - last < HISTORY_SNAPSHOT_INTERVAL_MS) return;

        note.history.push({
            title: note.title,
            content: previousContent,
            timestamp: new Date().toISOString()
        });

        if (note.history.length > HISTORY_MAX_ENTRIES) {
            note.history = note.history.slice(note.history.length - HISTORY_MAX_ENTRIES);
        }

        lastSnapshotAt.set(note.id, now);
    }

    function deleteNote(id) {
        if (!confirm("Déplacer cette note vers la corbeille ?")) return;

        const index = notes.findIndex(n => n.id === id);
        if (index === -1) return;

        const [removed] = notes.splice(index, 1);
        removed.deletedAt = new Date().toISOString();
        trash.unshift(removed);

        localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
        localStorage.setItem(TRASH_KEY, JSON.stringify(trash));
        updateStats();
        renderTrashList();

        if (notes.length > 0) {
            currentNoteId = notes[0].id;
            loadNote(currentNoteId);
        } else {
            currentNoteId = null;
            if (noteTitle) noteTitle.value = '';
            if (markdownInput) markdownInput.value = '';
            if (markdownPreview) markdownPreview.innerHTML = '';
            renderNotesList();
        }
    }

    /* ==========================================
       8b. CORBEILLE
       ========================================== */
    const trashList = document.getElementById('trash-list');

    function saveTrash() {
        localStorage.setItem(TRASH_KEY, JSON.stringify(trash));
        updateStats();
    }

    // Supprime automatiquement les notes en corbeille depuis plus de 30 jours.
    function purgeOldTrash() {
        const cutoff = Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;
        const before = trash.length;
        trash = trash.filter(n => new Date(n.deletedAt).getTime() > cutoff);
        if (trash.length !== before) saveTrash();
    }

    function renderTrashList() {
        if (!trashList) return;
        trashList.innerHTML = '';

        if (trash.length === 0) {
            const empty = document.createElement('li');
            empty.className = 'empty-state';
            empty.textContent = 'La corbeille est vide.';
            trashList.appendChild(empty);
            return;
        }

        trash.forEach(note => {
            const li = document.createElement('li');
            li.className = 'trash-item';

            const info = document.createElement('div');
            info.className = 'trash-item-info';

            const title = document.createElement('span');
            title.className = 'trash-item-title';
            title.textContent = note.title || 'Note sans titre';

            const date = document.createElement('span');
            date.className = 'trash-item-date';
            const deletedDate = new Date(note.deletedAt);
            date.textContent = `Supprimée le ${deletedDate.toLocaleDateString('fr-FR')} à ${deletedDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;

            info.appendChild(title);
            info.appendChild(date);

            const actions = document.createElement('div');
            actions.className = 'trash-item-actions';

            const restoreBtn = document.createElement('button');
            restoreBtn.className = 'btn-restore';
            restoreBtn.textContent = 'Restaurer';
            restoreBtn.addEventListener('click', () => restoreNote(note.id));

            const purgeBtn = document.createElement('button');
            purgeBtn.className = 'btn-purge';
            purgeBtn.textContent = 'Supprimer définitivement';
            purgeBtn.addEventListener('click', () => permanentlyDeleteNote(note.id));

            actions.appendChild(restoreBtn);
            actions.appendChild(purgeBtn);

            li.appendChild(info);
            li.appendChild(actions);
            trashList.appendChild(li);
        });
    }

    function restoreNote(id) {
        const index = trash.findIndex(n => n.id === id);
        if (index === -1) return;

        const [restored] = trash.splice(index, 1);
        delete restored.deletedAt;
        notes.unshift(restored);

        localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
        saveTrash();
        renderNotesList();
        renderTrashList();
    }

    function permanentlyDeleteNote(id) {
        if (!confirm("Supprimer définitivement cette note ? Cette action est irréversible.")) return;
        trash = trash.filter(n => n.id !== id);
        saveTrash();
        renderTrashList();
    }

    document.getElementById('btn-empty-trash')?.addEventListener('click', () => {
        if (trash.length === 0) return;
        if (!confirm("Vider complètement la corbeille ? Cette action est irréversible.")) return;
        trash = [];
        saveTrash();
        renderTrashList();
    });

    /* ==========================================
       8c. HISTORIQUE DES VERSIONS
       ========================================== */
    const btnHistory = document.getElementById('btn-history');
    const historyPanel = document.getElementById('history-panel');
    const historyList = document.getElementById('history-list');

    function renderHistoryPanel() {
        if (!historyList) return;
        historyList.innerHTML = '';

        const note = notes.find(n => n.id === currentNoteId);
        const history = note && Array.isArray(note.history) ? note.history : [];

        if (history.length === 0) {
            const empty = document.createElement('li');
            empty.className = 'empty-state';
            empty.textContent = 'Aucune version antérieure enregistrée.';
            historyList.appendChild(empty);
            return;
        }

        // Les plus récentes en premier
        [...history].reverse().forEach((snapshot, reversedIndex) => {
            const realIndex = history.length - 1 - reversedIndex;
            const li = document.createElement('li');
            li.className = 'history-item';

            const date = new Date(snapshot.timestamp);
            const label = document.createElement('span');
            label.textContent = `${date.toLocaleDateString('fr-FR')} ${date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;

            const restoreBtn = document.createElement('button');
            restoreBtn.textContent = 'Restaurer';
            restoreBtn.addEventListener('click', () => restoreHistorySnapshot(realIndex));

            li.appendChild(label);
            li.appendChild(restoreBtn);
            historyList.appendChild(li);
        });
    }

    function restoreHistorySnapshot(index) {
        const note = notes.find(n => n.id === currentNoteId);
        if (!note || !Array.isArray(note.history) || !note.history[index]) return;

        if (!confirm("Restaurer cette version ? Le contenu actuel sera remplacé (mais reste dans l'historique).")) return;

        const snapshot = note.history[index];
        const currentSnapshot = { title: note.title, content: note.content, timestamp: new Date().toISOString() };

        note.title = snapshot.title;
        note.content = snapshot.content;
        note.history.push(currentSnapshot);
        if (note.history.length > HISTORY_MAX_ENTRIES) {
            note.history = note.history.slice(note.history.length - HISTORY_MAX_ENTRIES);
        }

        localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
        loadNote(note.id);
        renderHistoryPanel();
        historyPanel?.classList.add('hidden');
    }

    btnHistory?.addEventListener('click', () => {
        renderHistoryPanel();
        historyPanel?.classList.toggle('hidden');
    });

    document.getElementById('btn-close-history')?.addEventListener('click', () => {
        historyPanel?.classList.add('hidden');
    });

    // Événements de mise à jour automatique
    noteTitle?.addEventListener('input', () => {
        saveCurrentNote();
        renderNotesList();
    });
    noteFolderSelect?.addEventListener('change', saveCurrentNote);
    noteTags?.addEventListener('input', saveCurrentNote);

    // Bouton de création de note
    document.getElementById('btn-new-note')?.addEventListener('click', () => {
        const newNote = {
            id: crypto.randomUUID(),
            title: 'Nouvelle Note',
            content: '',
            folder: 'general',
            tags: '',
            history: []
        };
        notes.unshift(newNote);
        localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
        updateStats();
        loadNote(newNote.id);
    });

    /* ==========================================
       9. GESTION DES TÂCHES (priorité, échéance, sous-tâches)
       ========================================== */
    const newTaskInput = document.getElementById('new-task-input');
    const newTaskPriority = document.getElementById('new-task-priority');
    const newTaskDue = document.getElementById('new-task-due');
    const tasksList = document.getElementById('tasks-list');

    // IDs des tâches actuellement dépliées (sous-tâches visibles) — état
    // purement visuel, non persisté.
    const expandedTasks = new Set();

    function saveTasks() {
        localStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
        updateStats();
    }

    function todayISO() {
        return new Date().toISOString().slice(0, 10);
    }

    const PRIORITY_LABELS = { basse: 'Basse', moyenne: 'Moyenne', haute: 'Haute' };

    function renderTasksList() {
        if (!tasksList) return;
        tasksList.innerHTML = '';

        if (tasks.length === 0) {
            const empty = document.createElement('li');
            empty.className = 'empty-state';
            empty.textContent = 'Aucune tâche pour le moment.';
            tasksList.appendChild(empty);
            return;
        }

        tasks.forEach(task => {
            const li = document.createElement('li');
            li.className = 'task-item' + (task.done ? ' done' : '');

            /* --- Ligne principale --- */
            const mainRow = document.createElement('div');
            mainRow.className = 'task-main-row';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = task.done;
            checkbox.addEventListener('change', () => toggleTask(task.id));

            const textSpan = document.createElement('span');
            textSpan.className = 'task-text';
            textSpan.textContent = task.text;

            const priorityBadge = document.createElement('span');
            priorityBadge.className = `priority-badge priority-${task.priority || 'moyenne'}`;
            priorityBadge.textContent = PRIORITY_LABELS[task.priority] || 'Moyenne';

            mainRow.appendChild(checkbox);
            mainRow.appendChild(textSpan);
            mainRow.appendChild(priorityBadge);

            if (task.dueDate) {
                const dueBadge = document.createElement('span');
                const isOverdue = !task.done && task.dueDate < todayISO();
                dueBadge.className = 'due-badge' + (isOverdue ? ' overdue' : '');
                dueBadge.innerHTML = `<i class="fa-solid fa-calendar"></i> ${new Date(task.dueDate + 'T00:00:00').toLocaleDateString('fr-FR')}`;
                mainRow.appendChild(dueBadge);
            }

            const subtasks = Array.isArray(task.subtasks) ? task.subtasks : [];
            const expandBtn = document.createElement('button');
            expandBtn.className = 'btn-expand-subtasks';
            const doneSubtasks = subtasks.filter(s => s.done).length;
            expandBtn.innerHTML = `<i class="fa-solid fa-chevron-down"></i> ${doneSubtasks}/${subtasks.length}`;
            expandBtn.title = 'Afficher/masquer les sous-tâches';
            expandBtn.addEventListener('click', () => {
                if (expandedTasks.has(task.id)) expandedTasks.delete(task.id);
                else expandedTasks.add(task.id);
                renderTasksList();
            });
            mainRow.appendChild(expandBtn);

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'btn-delete-task';
            deleteBtn.innerHTML = '<i class="fa-solid fa-trash"></i>';
            deleteBtn.title = 'Supprimer cette tâche';
            deleteBtn.addEventListener('click', () => deleteTask(task.id));
            mainRow.appendChild(deleteBtn);

            li.appendChild(mainRow);

            /* --- Panneau sous-tâches --- */
            const subtasksPanel = document.createElement('div');
            subtasksPanel.className = 'subtasks-panel' + (expandedTasks.has(task.id) ? '' : ' hidden');

            subtasks.forEach(sub => {
                const subLi = document.createElement('div');
                subLi.className = 'subtask-item' + (sub.done ? ' done' : '');

                const subCheckbox = document.createElement('input');
                subCheckbox.type = 'checkbox';
                subCheckbox.checked = sub.done;
                subCheckbox.addEventListener('change', () => toggleSubtask(task.id, sub.id));

                const subText = document.createElement('span');
                subText.className = 'subtask-text';
                subText.textContent = sub.text;

                const subDelete = document.createElement('button');
                subDelete.innerHTML = '<i class="fa-solid fa-xmark"></i>';
                subDelete.addEventListener('click', () => deleteSubtask(task.id, sub.id));

                subLi.appendChild(subCheckbox);
                subLi.appendChild(subText);
                subLi.appendChild(subDelete);
                subtasksPanel.appendChild(subLi);
            });

            const addSubtaskRow = document.createElement('div');
            addSubtaskRow.className = 'add-subtask-row';

            const subInput = document.createElement('input');
            subInput.type = 'text';
            subInput.placeholder = 'Ajouter une sous-tâche...';

            const subAddBtn = document.createElement('button');
            subAddBtn.textContent = 'Ajouter';

            const submitSubtask = () => {
                const value = subInput.value.trim();
                if (!value) return;
                addSubtask(task.id, value);
                subInput.value = '';
                subInput.focus();
            };
            subAddBtn.addEventListener('click', submitSubtask);
            subInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') submitSubtask();
            });

            addSubtaskRow.appendChild(subInput);
            addSubtaskRow.appendChild(subAddBtn);
            subtasksPanel.appendChild(addSubtaskRow);

            li.appendChild(subtasksPanel);
            tasksList.appendChild(li);
        });
    }

    function addTask() {
        if (!newTaskInput) return;
        const text = newTaskInput.value.trim();
        if (!text) return;

        tasks.unshift({
            id: crypto.randomUUID(),
            text,
            done: false,
            priority: newTaskPriority ? newTaskPriority.value : 'moyenne',
            dueDate: newTaskDue ? newTaskDue.value : '',
            subtasks: []
        });
        newTaskInput.value = '';
        if (newTaskDue) newTaskDue.value = '';
        saveTasks();
        renderTasksList();
        newTaskInput.focus();
    }

    function toggleTask(id) {
        const task = tasks.find(t => t.id === id);
        if (task) {
            task.done = !task.done;
            saveTasks();
            renderTasksList();
        }
    }

    function deleteTask(id) {
        tasks = tasks.filter(t => t.id !== id);
        expandedTasks.delete(id);
        saveTasks();
        renderTasksList();
    }

    function addSubtask(taskId, text) {
        const task = tasks.find(t => t.id === taskId);
        if (!task) return;
        if (!Array.isArray(task.subtasks)) task.subtasks = [];
        task.subtasks.push({ id: crypto.randomUUID(), text, done: false });
        saveTasks();
        renderTasksList();
    }

    function toggleSubtask(taskId, subId) {
        const task = tasks.find(t => t.id === taskId);
        const sub = task?.subtasks?.find(s => s.id === subId);
        if (sub) {
            sub.done = !sub.done;
            saveTasks();
            renderTasksList();
        }
    }

    function deleteSubtask(taskId, subId) {
        const task = tasks.find(t => t.id === taskId);
        if (!task || !Array.isArray(task.subtasks)) return;
        task.subtasks = task.subtasks.filter(s => s.id !== subId);
        saveTasks();
        renderTasksList();
    }

    document.getElementById('btn-add-task')?.addEventListener('click', addTask);
    newTaskInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') addTask();
    });

    /* ==========================================
       10. GESTION DES FLASHCARDS + RÉPÉTITION ESPACÉE
       ========================================== */
    const fcFrontInput = document.getElementById('fc-front');
    const fcBackInput = document.getElementById('fc-back');
    const flashcardsGrid = document.getElementById('flashcards-grid');
    const fcDueCountEl = document.getElementById('fc-due-count');

    const STATE_LABELS = { new: 'Nouvelle', learning: 'En cours', mastered: 'Maîtrisée' };

    function saveFlashcards() {
        localStorage.setItem(FLASHCARDS_KEY, JSON.stringify(flashcards));
        updateStats();
        updateDueCount();
    }

    function getDueFlashcards() {
        const today = todayISO();
        return flashcards.filter(c => (c.nextReview || today) <= today);
    }

    function updateDueCount() {
        if (fcDueCountEl) fcDueCountEl.textContent = getDueFlashcards().length;
    }

    function renderFlashcards() {
        if (!flashcardsGrid) return;
        flashcardsGrid.innerHTML = '';

        if (flashcards.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'empty-state';
            empty.textContent = 'Aucune flashcard pour le moment.';
            flashcardsGrid.appendChild(empty);
            return;
        }

        flashcards.forEach(card => {
            const cardEl = document.createElement('div');
            cardEl.className = 'flashcard';

            const inner = document.createElement('div');
            inner.className = 'flashcard-inner';

            const front = document.createElement('div');
            front.className = 'flashcard-face flashcard-front';
            front.textContent = card.front;

            const back = document.createElement('div');
            back.className = 'flashcard-face flashcard-back';
            back.textContent = card.back;

            inner.appendChild(front);
            inner.appendChild(back);

            const stateBadge = document.createElement('span');
            stateBadge.className = 'fc-state-badge';
            stateBadge.textContent = STATE_LABELS[card.state] || 'Nouvelle';

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'btn-delete-fc';
            deleteBtn.innerHTML = '<i class="fa-solid fa-trash"></i>';
            deleteBtn.title = 'Supprimer cette flashcard';
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                deleteFlashcard(card.id);
            });

            cardEl.appendChild(inner);
            cardEl.appendChild(stateBadge);
            cardEl.appendChild(deleteBtn);
            cardEl.addEventListener('click', () => cardEl.classList.toggle('flipped'));

            flashcardsGrid.appendChild(cardEl);
        });
    }

    function addFlashcard() {
        if (!fcFrontInput || !fcBackInput) return;
        const front = fcFrontInput.value.trim();
        const back = fcBackInput.value.trim();
        if (!front || !back) return;

        flashcards.unshift({
            id: crypto.randomUUID(),
            front,
            back,
            interval: 0,
            repetition: 0,
            easeFactor: 2.5,
            nextReview: todayISO(),
            state: 'new'
        });
        fcFrontInput.value = '';
        fcBackInput.value = '';
        saveFlashcards();
        renderFlashcards();
        fcFrontInput.focus();
    }

    function deleteFlashcard(id) {
        flashcards = flashcards.filter(c => c.id !== id);
        saveFlashcards();
        renderFlashcards();
    }

    document.getElementById('btn-add-fc')?.addEventListener('click', addFlashcard);
    fcBackInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') addFlashcard();
    });

    /* --- Algorithme de répétition espacée (SM-2 simplifié, façon Anki) ---
       quality : 0 = "Encore", 3 = "Difficile", 4 = "Bien", 5 = "Facile" */
    function scheduleFlashcard(card, quality) {
        if (quality < 3) {
            card.repetition = 0;
            card.interval = 1;
        } else {
            if (card.repetition === 0) card.interval = 1;
            else if (card.repetition === 1) card.interval = 6;
            else card.interval = Math.round(card.interval * card.easeFactor);
            card.repetition += 1;
        }

        card.easeFactor = Math.max(1.3, card.easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)));

        const next = new Date();
        next.setDate(next.getDate() + card.interval);
        card.nextReview = next.toISOString().slice(0, 10);
        card.state = card.repetition === 0 ? 'learning' : (card.interval >= 21 ? 'mastered' : 'learning');
    }

    /* --- Session de révision --- */
    const reviewOverlay = document.getElementById('review-overlay');
    const reviewProgress = document.getElementById('review-progress');
    const reviewCardFace = document.getElementById('review-card-face');
    const reviewActionsReveal = document.getElementById('review-actions-reveal');
    const reviewActionsRate = document.getElementById('review-actions-rate');

    let reviewQueue = [];
    let reviewIndex = 0;
    let reviewShowingAnswer = false;

    function startReviewSession() {
        reviewQueue = getDueFlashcards();
        if (reviewQueue.length === 0) {
            alert("Aucune flashcard à réviser aujourd'hui ! Reviens plus tard ou ajoute-en de nouvelles.");
            return;
        }
        reviewIndex = 0;
        reviewOverlay?.classList.remove('hidden');
        showCurrentReviewCard();
    }

    function showCurrentReviewCard() {
        if (reviewIndex >= reviewQueue.length) {
            endReviewSession();
            return;
        }
        const card = reviewQueue[reviewIndex];
        reviewShowingAnswer = false;
        if (reviewProgress) reviewProgress.textContent = `Carte ${reviewIndex + 1} / ${reviewQueue.length}`;
        if (reviewCardFace) reviewCardFace.textContent = card.front;
        reviewActionsReveal?.classList.remove('hidden');
        reviewActionsRate?.classList.add('hidden');
    }

    document.getElementById('btn-reveal-answer')?.addEventListener('click', () => {
        if (reviewIndex >= reviewQueue.length) return;
        reviewShowingAnswer = true;
        if (reviewCardFace) reviewCardFace.textContent = reviewQueue[reviewIndex].back;
        reviewActionsReveal?.classList.add('hidden');
        reviewActionsRate?.classList.remove('hidden');
    });

    reviewActionsRate?.querySelectorAll('.rate-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (reviewIndex >= reviewQueue.length) return;
            const quality = parseInt(btn.dataset.quality, 10);
            const card = flashcards.find(c => c.id === reviewQueue[reviewIndex].id);
            if (card) scheduleFlashcard(card, quality);
            saveFlashcards();
            renderFlashcards();
            reviewIndex++;
            showCurrentReviewCard();
        });
    });

    function endReviewSession() {
        reviewOverlay?.classList.add('hidden');
        alert('Session de révision terminée. Bien joué !');
    }

    document.getElementById('btn-start-review')?.addEventListener('click', startReviewSession);
    document.getElementById('btn-close-review')?.addEventListener('click', () => {
        reviewOverlay?.classList.add('hidden');
    });

    /* ==========================================
       11. STATISTIQUES ET SAUVEGARDE (EXPORT / IMPORT)
       ========================================== */
    const statNotes = document.getElementById('stat-notes');
    const statTasks = document.getElementById('stat-tasks');
    const statFc = document.getElementById('stat-fc');
    const statTrash = document.getElementById('stat-trash');

    function updateStats() {
        if (statNotes) statNotes.textContent = notes.length;
        if (statTasks) statTasks.textContent = tasks.length;
        if (statFc) statFc.textContent = flashcards.length;
        if (statTrash) statTrash.textContent = trash.length;
    }

    // Instances Chart.js conservées pour pouvoir les détruire avant de
    // les redessiner (sinon Chart.js empile les graphiques sur le même canvas).
    const chartInstances = { folders: null, tasks: null, flashcards: null };

    function renderCharts() {
        if (typeof Chart === 'undefined') return;

        // Couleur de texte lue depuis le thème actif (clair ou sombre) pour que
        // les légendes/titres des graphiques restent lisibles dans les deux cas.
        const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text-primary').trim() || '#23293d';
        const gridColor = getComputedStyle(document.documentElement).getPropertyValue('--border-color').trim() || '#ded3b8';
        Chart.defaults.color = textColor;
        Chart.defaults.borderColor = gridColor;

        const folderCounts = { general: 0, work: 0, personal: 0 };
        notes.forEach(n => {
            if (folderCounts[n.folder] !== undefined) folderCounts[n.folder]++;
        });

        const doneTasks = tasks.filter(t => t.done).length;
        const pendingTasks = tasks.length - doneTasks;

        const fcCounts = { new: 0, learning: 0, mastered: 0 };
        flashcards.forEach(c => {
            const state = c.state || 'new';
            if (fcCounts[state] !== undefined) fcCounts[state]++;
        });

        const foldersCtx = document.getElementById('chart-folders');
        const tasksCtx = document.getElementById('chart-tasks');
        const fcCtx = document.getElementById('chart-flashcards');

        if (chartInstances.folders) chartInstances.folders.destroy();
        if (chartInstances.tasks) chartInstances.tasks.destroy();
        if (chartInstances.flashcards) chartInstances.flashcards.destroy();

        if (foldersCtx) {
            chartInstances.folders = new Chart(foldersCtx, {
                type: 'bar',
                data: {
                    labels: ['Général', 'Travail', 'Personnel'],
                    datasets: [{
                        label: 'Notes par dossier',
                        data: [folderCounts.general, folderCounts.work, folderCounts.personal],
                        backgroundColor: ['#dda426', '#33566d', '#4c7a5e']
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false }, title: { display: true, text: 'Notes par dossier' } },
                    scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }
                }
            });
        }

        if (tasksCtx) {
            chartInstances.tasks = new Chart(tasksCtx, {
                type: 'doughnut',
                data: {
                    labels: ['Terminées', 'En cours'],
                    datasets: [{ data: [doneTasks, pendingTasks], backgroundColor: ['#4c7a5e', '#c2483d'] }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { title: { display: true, text: 'Tâches' } }
                }
            });
        }

        if (fcCtx) {
            chartInstances.flashcards = new Chart(fcCtx, {
                type: 'doughnut',
                data: {
                    labels: ['Nouvelles', 'En cours', 'Maîtrisées'],
                    datasets: [{ data: [fcCounts.new, fcCounts.learning, fcCounts.mastered], backgroundColor: ['#a89f89', '#dda426', '#4c7a5e'] }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { title: { display: true, text: 'Flashcards' } }
                }
            });
        }
    }

    document.getElementById('btn-export')?.addEventListener('click', () => {
        const payload = {
            exportedAt: new Date().toISOString(),
            notes,
            tasks,
            flashcards,
            trash
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `noteapp-backup-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    });

    const importFileInput = document.getElementById('import-file');
    document.getElementById('btn-import-trigger')?.addEventListener('click', () => {
        importFileInput?.click();
    });

    importFileInput?.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = () => {
            try {
                const data = JSON.parse(reader.result);
                const importedNotes = Array.isArray(data.notes) ? data.notes : [];
                const importedTasks = Array.isArray(data.tasks) ? data.tasks : [];
                const importedFlashcards = Array.isArray(data.flashcards) ? data.flashcards : [];
                const importedTrash = Array.isArray(data.trash) ? data.trash : [];

                if (!importedNotes.length && !importedTasks.length && !importedFlashcards.length && !importedTrash.length) {
                    alert("Ce fichier ne contient aucune donnée reconnue (notes, tâches ou flashcards).");
                    return;
                }

                const replace = confirm(
                    "Importer ce fichier va REMPLACER toutes vos données actuelles (notes, tâches, flashcards, corbeille).\n\n" +
                    "Cliquez sur OK pour remplacer, ou Annuler pour ne rien faire."
                );
                if (!replace) return;

                notes = importedNotes;
                tasks = importedTasks;
                flashcards = importedFlashcards;
                trash = importedTrash;

                localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
                localStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
                localStorage.setItem(FLASHCARDS_KEY, JSON.stringify(flashcards));
                localStorage.setItem(TRASH_KEY, JSON.stringify(trash));

                currentNoteId = notes[0] ? notes[0].id : null;
                if (currentNoteId) {
                    loadNote(currentNoteId);
                } else {
                    renderNotesList();
                }
                renderTasksList();
                renderFlashcards();
                renderTrashList();
                updateStats();
                updateDueCount();

                alert("Importation réussie !");
            } catch (err) {
                console.error("Erreur d'import JSON:", err);
                alert("Le fichier sélectionné n'est pas un JSON valide.");
            }
        };
        reader.readAsText(file);
        importFileInput.value = '';
    });

    /* ==========================================
       12. RECHERCHE ET FILTRE PAR DOSSIER
       ========================================== */
    const searchInput = document.getElementById('search-input');
    const foldersListEl = document.getElementById('folders-list');
    const btnAddFolder = document.getElementById('btn-add-folder');

    function saveFolders() {
        localStorage.setItem(FOLDERS_KEY, JSON.stringify(customFolders));
    }

    // Ajoute les dossiers personnalisés comme options du menu déroulant utilisé
    // pour classer une note, en plus des 3 dossiers par défaut déjà dans le HTML.
    function syncFolderSelectOptions() {
        if (!noteFolderSelect) return;
        noteFolderSelect.querySelectorAll('option[data-custom-folder]').forEach(opt => opt.remove());
        customFolders.forEach(folder => {
            const opt = document.createElement('option');
            opt.value = folder.id;
            opt.textContent = folder.name;
            opt.dataset.customFolder = 'true';
            noteFolderSelect.appendChild(opt);
        });
    }

    // Ajoute les <li> des dossiers personnalisés à la suite des dossiers par
    // défaut (Général/Travail/Personnel), déjà présents dans le HTML.
    function renderCustomFolders() {
        if (!foldersListEl) return;
        foldersListEl.querySelectorAll('li[data-custom-folder]').forEach(li => li.remove());

        customFolders.forEach(folder => {
            const li = document.createElement('li');
            li.dataset.folder = folder.id;
            li.dataset.customFolder = 'true';
            li.className = folder.id === currentFolder ? 'active' : '';
            li.innerHTML = `
                <i class="fa-solid fa-folder"></i>
                <span style="flex:1;">${escapeHtml(folder.name)}</span>
                <button class="btn-delete-folder" title="Supprimer ce dossier" type="button"><i class="fa-solid fa-xmark"></i></button>
            `;
            foldersListEl.appendChild(li);
        });

        syncFolderSelectOptions();
    }

    btnAddFolder?.addEventListener('click', () => {
        const name = prompt("Nom du nouveau dossier :");
        if (name === null) return; // annulé
        const cleanName = name.trim();
        if (!cleanName) {
            alert("Le nom du dossier ne peut pas être vide.");
            return;
        }

        const takenNames = ['tous les dossiers', 'général', 'travail', 'personnel', ...customFolders.map(f => f.name.toLowerCase())];
        if (takenNames.includes(cleanName.toLowerCase())) {
            alert("Un dossier porte déjà ce nom.");
            return;
        }

        customFolders.push({ id: crypto.randomUUID(), name: cleanName });
        saveFolders();
        renderCustomFolders();
    });

    searchInput?.addEventListener('input', (e) => {
        searchQuery = e.target.value.trim().toLowerCase();
        renderNotesList();
    });

    foldersListEl?.addEventListener('click', (e) => {
        const deleteBtn = e.target.closest('.btn-delete-folder');
        if (deleteBtn) {
            const li = deleteBtn.closest('li[data-folder]');
            const folderId = li?.dataset.folder;
            const folder = customFolders.find(f => f.id === folderId);
            if (!folder) return;

            if (!confirm(`Supprimer le dossier "${folder.name}" ? Les notes qu'il contient seront déplacées vers "Général".`)) return;

            notes.forEach(n => {
                if (n.folder === folderId) n.folder = 'general';
            });
            localStorage.setItem(NOTES_KEY, JSON.stringify(notes));

            customFolders = customFolders.filter(f => f.id !== folderId);
            saveFolders();

            if (currentFolder === folderId) currentFolder = 'all';
            renderCustomFolders();
            renderNotesList();
            return;
        }

        const li = e.target.closest('li[data-folder]');
        if (!li) return;

        foldersListEl.querySelectorAll('li').forEach(item => item.classList.remove('active'));
        li.classList.add('active');
        currentFolder = li.dataset.folder;
        renderNotesList();
    });

    renderCustomFolders();

    /* ==========================================
       13. SIDEBAR MOBILE
       ========================================== */
    const sidebarLeft = document.getElementById('sidebar-left');

    document.getElementById('btn-toggle-sidebar')?.addEventListener('click', () => {
        sidebarLeft?.classList.add('mobile-open');
    });

    document.getElementById('btn-close-sidebar')?.addEventListener('click', () => {
        sidebarLeft?.classList.remove('mobile-open');
    });

    /* ==========================================
       14. NAVIGATION ET BOUTONS D'INTERFACE (Thème, Zen, Vues)
       ========================================== */
    const menuButtons = document.querySelectorAll('.menu-btn');
    const views = document.querySelectorAll('.main-view');

    menuButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            menuButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const viewName = btn.dataset.view;
            views.forEach(view => {
                if (view.id === `view-${viewName}`) {
                    view.classList.remove('hidden');
                } else {
                    view.classList.add('hidden');
                }
            });

            // Les graphiques ont besoin que leur canvas soit visible (largeur > 0)
            // pour se dessiner correctement : on ne les rend qu'à l'ouverture de la vue.
            if (viewName === 'stats') renderCharts();
            if (viewName === 'trash') renderTrashList();
        });
    });

    // Mode Zen / Plein écran
    document.getElementById('btn-toggle-zen')?.addEventListener('click', () => {
        const appContainer = document.getElementById('app-container') || document.body;
        appContainer.classList.toggle('zen-mode');
    });

    // Basculement Thème Clair / Sombre
    document.getElementById('btn-toggle-theme')?.addEventListener('click', () => {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('app_theme', newTheme);
    });

    // Restauration du thème sauvegardé
    const savedTheme = localStorage.getItem('app_theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);

    // INITIALISATION DE LA PREMIÈRE NOTE
    if (currentNoteId) {
        loadNote(currentNoteId);
    } else {
        renderNotesList();
    }

    // INITIALISATION DES TÂCHES, FLASHCARDS ET STATISTIQUES
    renderTasksList();
    renderFlashcards();
    updateDueCount();

    // INITIALISATION DE LA CORBEILLE (purge des notes de plus de 30 jours)
    purgeOldTrash();
    renderTrashList();

    updateStats();
});