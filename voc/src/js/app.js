/* Externalized application JS from vocabmaster.html
   Adjustments made:
   - Removed UserIdentity generation and storage (identity will be provided via distributor page)
   - renderUI shows a link to the distributed app page for identity management
   - Kept core classes and functionality intact
*/

// Learning Statistics & Tracking
class LearningStats {
    constructor() {
        this.attempts = 0;
        this.correct = 0;
        this.lastReviewed = null;
        this.easeFactor = 2.5;
        this.interval = 1;
        this.dueDate = Date.now();
    }

    async resetProgressInteractive() {
        try {
            // Ask for confirmation in the browser UI
            if (typeof window !== 'undefined' && window.confirm) {
                const ok = window.confirm('Reset all progress for this user? This cannot be undone.');
                if (!ok) { this.showToast('Reset cancelled'); return; }
            }
            const res = await this.resetAllProgress();
            if (res && res.reset) this.showToast('Progress reset'); else this.showToast('Reset failed');
            this.renderUI();
        } catch (e) {
            console.warn('resetProgressInteractive failed', e);
            this.showToast('Reset failed');
        }
    }

    calculateNextReview(correct) {
        if (correct) {
            this.interval = this.interval * this.easeFactor;
        } else {
            this.interval = 1;
            this.easeFactor = Math.max(1.3, this.easeFactor - 0.2);
        }
        this.dueDate = Date.now() + (this.interval * 24 * 60 * 60 * 1000);
    }
}

class Word {
    constructor(target, native, examples = [], tags = [], transliteration = '', image = '') {
        this.target = target;
        this.native = native;
        this.examples = examples;
        this.tags = tags;
        this.transliteration = transliteration;
        this.image = image; // optional URL to an image
        this.stats = new LearningStats();
    }
}

class VocabularySet {
    constructor(id, name, language, words = []) {
        this.id = id;
        this.name = name;
        this.language = language;
        this.words = words;
        this.metadata = { created: Date.now(), version: '1.0', difficulty: 'beginner' };
    }
}

class UserProgress {
    constructor() {
        this.stats = { wordsLearned: 0, sessionsCompleted: 0, totalAttempts: 0, correctAttempts: 0 };
    }

    updateStats(correct) {
        this.stats.totalAttempts++;
        if (correct) { this.stats.correctAttempts++; this.stats.wordsLearned++; }
    }

    getStats() {
        return { ...this.stats, accuracy: this.stats.totalAttempts > 0 ? (this.stats.correctAttempts / this.stats.totalAttempts) * 100 : 0 };
    }
}

class LearningEngine {
    constructor() { this.algorithm = 'sm2'; }

    getNextWord(vocabSet) {
        const now = Date.now();
        const dueWords = vocabSet.words.filter(word => word.stats.dueDate <= now);
        if (dueWords.length === 0) return null;
        return this.calculatePriority(dueWords);
    }

    calculatePriority(words) {
        if (words.length === 0) return null;
        return words.reduce((highest, word) => {
            const priority = this.calculateWordPriority(word);
            return priority > highest.priority ? { word, priority } : highest;
        }, { word: null, priority: -Infinity }).word;
    }

    calculateWordPriority(word) {
        const now = Date.now();
        const overdue = Math.max(0, now - word.stats.dueDate);
        const easePenalty = (2.5 - word.stats.easeFactor) * 10;
        const practiceBonus = word.stats.attempts * 5;
        return overdue + easePenalty - practiceBonus;
    }
}

// Lightweight storage wrapper using localStorage
class SimpleStorage {
    constructor() { this.prefix = 'vocabmaster:'; }
    async saveProgress(key, data) {
        try { localStorage.setItem(`${this.prefix}progress_${key}`, JSON.stringify(data)); }
        catch (e) { console.warn('SimpleStorage saveProgress failed', e); }
    }
    async loadProgress(key) {
        try { const raw = localStorage.getItem(`${this.prefix}progress_${key}`); return raw ? JSON.parse(raw) : null; }
        catch (e) { console.warn('SimpleStorage loadProgress failed', e); return null; }
    }
}

class LearningSession {
    constructor(app, vocabSet) { this.app = app; this.vocabSet = vocabSet; this.currentWord = null; this.showingAnswer = false; }
    start() { this.nextWord(); this.renderSession(); }
    nextWord() { this.currentWord = this.app.learningEngine.getNextWord(this.vocabSet); this.showingAnswer = false; }
    renderSession() {
        const mainContent = document.getElementById('main-content');
        if (!this.currentWord) { mainContent.innerHTML = `<h2>Session Complete!</h2><p>All words reviewed.</p><button onclick="app.renderUI()">Back to Main</button>`; return; }
        mainContent.innerHTML = `
            <h2>Learning Session</h2>
            <div class="card">
                <h3>${this.currentWord.target} <span class="gt-anchor-wrapper" style="margin-left:8px;">${this.app.googleTranslateAnchor(this.currentWord.target, this.vocabSet.language || 'auto')}</span></h3>
                ${this.currentWord.transliteration ? `<p class="transliteration">${this.currentWord.transliteration}</p>` : ''}
                ${this.currentWord.image ? `<div class="word-image"><img src="${this.currentWord.image}" alt="${this.currentWord.target}" style="max-width:200px;max-height:200px;"/></div>` : ''}
                ${this.showingAnswer ? `
                    <p><strong>Translation:</strong> ${this.currentWord.native}</p>
                    ${this.currentWord.tags && this.currentWord.tags.length ? `<p><strong>Tags:</strong> ${this.currentWord.tags.map(t => `<span class="tag">${t}</span>`).join(' ')}</p>` : ''}
                    <p><strong>Examples:</strong></p>
                    <ul>${this.currentWord.examples.map(ex => `<li>${ex}</li>`).join('')}</ul>
                    <button onclick="app.currentSession.markCorrect(true)">Correct</button>
                    <button onclick="app.currentSession.markCorrect(false)">Incorrect</button>
                ` : `<button onclick="app.currentSession.showAnswer()">Show Answer</button>`}
            </div>
            <button onclick="app.renderUI()">End Session</button>
        `;
    }
    showAnswer() { this.showingAnswer = true; this.renderSession(); }
    async markCorrect(correct) {
        this.currentWord.stats.calculateNextReview(correct);
        this.app.userProgress.updateStats(correct);

        // Update per-vocabulary learned ids when the user answers correctly
        try {
            if (correct) {
                const vocabKey = this.vocabSet.id || this.app.currentlyLoadedPath || '';
                const wordId = this.currentWord.id || this.currentWord.target || `word-${Date.now()}`;
                if (!this.app.vocabProgress.has(vocabKey)) this.app.vocabProgress.set(vocabKey, new Set());
                const s = this.app.vocabProgress.get(vocabKey);
                s.add(wordId);
                await this.app.saveVocabProgressForKey(vocabKey);
                // also mirror progress under original path if we know it
                try {
                    const p = this.app.vocabPathForId.get(vocabKey);
                    if (p) {
                        this.app.vocabProgress.set(p, s);
                        await this.app.saveVocabProgressForKey(p);
                    }
                } catch (e) { /* ignore */ }
            }
        } catch (e) {
            console.warn('Failed to update vocab progress', e);
        }

        await this.app.saveProgress();
        this.nextWord();
        this.renderSession();
    }

}

class VocabMaster {
    constructor() {
        this.vocabSets = new Map();
        this.userProgress = new UserProgress();
        this.learningEngine = new LearningEngine();
        this.currentSession = null;
        this.storage = new SimpleStorage();
        // Ensure a persistent local user identifier so progress can be shared between devices
        this.userId = this.getOrCreateUserId();
        // In-memory per-vocabulary learned word ids (populated from storage on init)
        this.vocabProgress = new Map();
        this.vocabPathForId = new Map();
    }

    getOrCreateUserId() {
        try {
            const key = 'vocabmaster:userId';
            let id = localStorage.getItem(key);
            if (!id) {
                // Simple short id: timestamp + random suffix
                id = `u-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
                localStorage.setItem(key, id);
            }
            return id;
        } catch (e) {
            console.warn('Failed to get/create userId, falling back to default', e);
            return 'default';
        }
    }

    copyUserIdToClipboard() {
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(this.userId).then(() => this.showToast('User ID copied to clipboard')).catch(err => {
                    console.warn('Clipboard write failed', err);
                    this.fallbackCopyUserId();
                });
            } else {
                this.fallbackCopyUserId();
            }
        } catch (e) {
            console.warn('Copy failed', e);
            this.showToast('Copy failed');
        }
    }

    fallbackCopyUserId() {
        try {
            const ta = document.createElement('textarea');
            ta.value = this.userId;
            document.body.appendChild(ta);
            ta.select();
            const ok = document.execCommand('copy');
            ta.remove();
            if (ok) this.showToast('User ID copied to clipboard'); else this.showToast('Copy failed');
        } catch (e) {
            console.warn('Fallback copy failed', e);
            this.showToast('Copy failed');
        }
    }

    showToast(message, timeout = 3000) {
        try {
            let container = document.getElementById('vocabmaster-toast-container');
            if (!container) {
                container = document.createElement('div');
                container.id = 'vocabmaster-toast-container';
                document.body.appendChild(container);
            }
            const toast = document.createElement('div');
            toast.className = 'vocab-toast';
            toast.textContent = message;
            container.appendChild(toast);
            // Force reflow for CSS transition
            // eslint-disable-next-line no-unused-expressions
            toast.offsetHeight;
            toast.classList.add('visible');
            setTimeout(() => {
                toast.classList.remove('visible');
                setTimeout(() => toast.remove(), 300);
            }, timeout);
        } catch (e) {
            console.warn('showToast failed', e);
        }
    }

    /**
     * Build a Google Translate URL for the provided text.
     * Opens the translate page where users can play pronunciation audio.
     * `src` is the source language code (use 'auto' to detect).
     */
    googleTranslateUrl(text, src = 'auto', tl = 'en') {
        try {
            const qs = `?sl=${encodeURIComponent(src)}&tl=${encodeURIComponent(tl)}&text=${encodeURIComponent(text)}&op=translate`;
            return `https://translate.google.com/${qs}`;
        } catch (e) {
            return `https://translate.google.com/`;
        }
    }

    /**
     * Return an HTML anchor string that opens Google Translate for `text`.
     * Use this in templates next to displayed words to allow pronunciation.
     */
    googleTranslateAnchor(text, src = 'auto', tl = 'en', label = '🔊') {
        const url = this.googleTranslateUrl(text, src, tl);
        // Use an onclick handler that will try to open the native app on mobile
        // and fall back to the web URL. Keep the href present so non-JS or
        // middle-click still work.
        return `<a class="gt-link" href="${url}" onclick="app.openInGoogleTranslate(${JSON.stringify(text)}, ${JSON.stringify(src)}, ${JSON.stringify(tl)}); return false;" target="_blank" rel="noopener noreferrer" aria-label="Open in Google Translate">${label}</a>`;
    }

    /**
     * Try to open the Google Translate native app on mobile devices and
     * fall back to the web translate page when the app isn't available.
     * - Android: uses the `intent:` URI with a browser_fallback_url to open the
     *   `com.google.android.apps.translate` package when possible.
     * - iOS: attempts a custom scheme then falls back to the web URL.
     * Note: behavior varies by browser and OS; this attempts a best-effort approach.
     */
    openInGoogleTranslate(text, src = 'auto', tl = 'en') {
        try {
            const webUrl = this.googleTranslateUrl(text, src, tl);
            const ua = navigator.userAgent || '';
            const encWeb = encodeURIComponent(webUrl);

            // Android (Chrome supports intent: URIs)
            if (/Android/i.test(ua)) {
                const intentUrl = `intent://translate.google.com/translate?sl=${encodeURIComponent(src)}&tl=${encodeURIComponent(tl)}&text=${encodeURIComponent(text)}#Intent;package=com.google.android.apps.translate;scheme=https;S.browser_fallback_url=${encWeb};end`;
                // A user gesture triggered this call (onclick), so navigate to intent URI
                window.location.href = intentUrl;
                return;
            }

            // iOS (try opening app via scheme then fallback) — scheme support may vary
            if (/iPhone|iPad|iPod/i.test(ua)) {
                const iosScheme = `googletranslate://translate?sl=${encodeURIComponent(src)}&tl=${encodeURIComponent(tl)}&text=${encodeURIComponent(text)}`;
                const now = Date.now();
                // Attempt to open scheme; if it fails, after timeout open the web URL
                window.location.href = iosScheme;
                setTimeout(() => {
                    // If still on page, assume scheme failed and open web URL
                    if (Date.now() - now < 2000) window.location.href = webUrl;
                }, 1200);
                return;
            }

            // Default: open web URL in new tab
            window.open(webUrl, '_blank');
        } catch (e) {
            // Fallback if anything goes wrong
            try { window.open(this.googleTranslateUrl(text, src, tl), '_blank'); } catch (err) { /* ignore */ }
        }
    }

    async initialize() {
        // Try to load manifest and default to embedded sample if manifest unavailable
        await this.loadVocabManifest();
        // try to load pre-generated summaries (generated by scripts/generate-vocab-summaries.js)
        await this.loadVocabSummaries();
        // load app version (from /VERSION when available)
        try { await this.loadVersion(); } catch (e) { /* ignore */ }
        // preload per-vocab progress for manifest entries so UI can show learning counts
        if (this.vocabManifest && Array.isArray(this.vocabManifest.sets)) {
            for (const p of this.vocabManifest.sets) {
                // load progress for this manifest path (if any)
                // don't block UI if load fails
                // eslint-disable-next-line no-await-in-loop
                await this.loadVocabProgressForPath(p).catch(() => {});
            }
        }
        if (this.vocabSets.size === 0) {
            this.loadDefaultVocabulary();
        }
        await this.loadProgress();
        
        this.attachAutoSave();
        this.renderUI();
    }

    /**
     * Load application version from a top-level `VERSION` file if available.
     * This allows the server to ship a small text file containing a version string
     * that the client can display and link to a change log.
     */
    async loadVersion() {
        try {
            const tryPaths = ['./VERSION', '/VERSION', 'VERSION'];
            let v = null;
            for (const p of tryPaths) {
                try {
                    const res = await fetch(p);
                    if (!res.ok) continue;
                    v = (await res.text()).trim();
                    break;
                } catch (e) { /* try next */ }
            }
            this.version = v || 'unknown';
            this.versionUrl = '/CHANGELOG.md';
        } catch (e) {
            this.version = 'unknown';
            this.versionUrl = '/CHANGELOG.md';
        }
    }

    // Persist per-vocab learned ids under a namespaced key
    async saveVocabProgressForKey(vocabKey) {
        try {
            const set = this.vocabProgress.get(vocabKey) || new Set();
            const arr = Array.from(set);
            await this.storage.saveProgress(`${this.userId}:vocab:${vocabKey}`, { learnedIds: arr });
        } catch (e) {
            console.warn('saveVocabProgressForKey failed', e);
        }
    }

    async loadVocabProgressForPath(vocabPath) {
        // Try multiple candidate keys to be tolerant of path forms
        const candidates = [vocabPath];
        if (vocabPath.startsWith('src/')) candidates.push(vocabPath.replace(/^src\//, ''));
        else candidates.push(`src/${vocabPath}`);
        if (vocabPath.startsWith('./')) candidates.push(vocabPath.replace(/^\.\//, ''));
        if (vocabPath.startsWith('/')) candidates.push(vocabPath.replace(/^\//, ''));

        for (const c of candidates) {
            try {
                const data = await this.storage.loadProgress(`${this.userId}:vocab:${c}`);
                if (data && Array.isArray(data.learnedIds)) {
                    this.vocabProgress.set(vocabPath, new Set(data.learnedIds));
                    return;
                }
            } catch (e) {
                // ignore and continue
            }
        }
        // nothing found -> initialize empty set for this path
        this.vocabProgress.set(vocabPath, new Set());
    }

    async loadVocabSummaries() {
        try {
            // Try several relative/absolute paths because the app may be served from / or /src/
            const tryPaths = [
                './vocab/summaries.json',
                'vocab/summaries.json',
                '/src/vocab/summaries.json',
                '/vocab/summaries.json',
                'src/vocab/summaries.json'
            ];
            let data = null;
            for (const p of tryPaths) {
                try {
                    const res = await fetch(p);
                    if (!res.ok) continue;
                    data = await res.json();
                    break;
                } catch (e) {
                    // try next
                }
            }
            if (data) this.vocabSummaries = data.summaries || {};
            else throw new Error('No summaries found');
        } catch (e) {
            console.warn('Could not load vocab summaries:', e);
            this.vocabSummaries = {};
        }
    }


    /** Reset per-vocab and overall progress for this user (clears stored progress). */
    async resetAllProgress() {
        try {
            // clear in-memory
            this.userProgress = new UserProgress();
            this.vocabProgress = new Map();

            // remove keys from localStorage that match our namespace
            // We can't directly delete arbitrary keys from here in node; run in browser context
            try {
                // In browser: iterate localStorage and remove keys
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    if (key && key.startsWith(this.storage.prefix + 'progress_')) {
                        localStorage.removeItem(key);
                    }
                }
            } catch (e) {
                // fallback for environments where localStorage isn't available
                // also remove namespaced progress via storage API
                await this.storage.saveProgress(this.userId, this.userProgress.getStats());
            }

            this.renderUI();
            return { reset: true };
        } catch (e) {
            console.warn('resetAllProgress failed', e);
            return { reset: false, error: String(e) };
        }
    }

    // Lookup helper that tolerates different path forms between manifest and generated summaries
    getVocabSummary(requestPath) {
        if (!this.vocabSummaries) return null;
        const candidates = [requestPath];
        if (requestPath.startsWith('src/')) candidates.push(requestPath.replace(/^src\//, ''));
        else candidates.push(`src/${requestPath}`);
        // also try removing leading ./ or /
        if (requestPath.startsWith('./')) candidates.push(requestPath.replace(/^\.\//, ''));
        if (requestPath.startsWith('/')) candidates.push(requestPath.replace(/^\//, ''));
        for (const c of candidates) {
            if (this.vocabSummaries[c]) return this.vocabSummaries[c];
        }
        return null;
    }

    // Manifest-based vocab loading
    async loadVocabManifest(manifestPath = 'vocab/manifest.json') {
        try {
            const res = await fetch(manifestPath);
            if (!res.ok) throw new Error(`Manifest fetch failed: ${res.status}`);
            const manifest = await res.json();
            this.vocabManifest = manifest;
            // Load only the first entry by default
            if (manifest.sets && manifest.sets.length) {
                await this.loadVocabFile(manifest.sets[0]);
            }
        } catch (e) {
            console.warn('Could not load vocab manifest:', e);
        }
    }

    async loadVocabFile(path) {
        try {
            const res = await fetch(path);
            if (!res.ok) throw new Error(`Vocab fetch failed: ${res.status}`);
            const data = await res.json();
            const words = (data.words || []).map(w => {
                const wd = new Word(w.target, w.native, w.examples || [], w.tags || [], w.transliteration || '', w.image || '');
                // preserve id from source data if present
                wd.id = w.id || null;
                return wd;
            });
            const vocabSet = new VocabularySet(data.id || path, data.name || path, data.language || 'unknown', words);
            this.vocabSets.set(vocabSet.id, vocabSet);
            // remember original path for this vocab id so we can link progress by either id or path
            try { this.vocabPathForId.set(vocabSet.id, path); } catch (e) { /* ignore */ }
            // Track the currently loaded set by its id (not the file path)
            this.currentlyLoadedPath = vocabSet.id;
            // Try to load any saved progress for this vocab id/path
            try { await this.loadVocabProgressForPath(path); } catch (e) { /* ignore */ }
            // if loading progress by path populated a set, also map it under the vocab id
            try {
                const existing = this.vocabProgress.get(path);
                if (existing) this.vocabProgress.set(vocabSet.id, existing);
            } catch (e) { /* ignore */ }
            return vocabSet;
        } catch (e) {
            console.warn('Failed to load vocab file', path, e);
            return null;
        }
    }

    loadDefaultVocabulary() {
        const sampleWords = [new Word('hello', 'hola', ['¡Hola! ¿Cómo estás?', 'Hello! How are you?'], ['greeting']), new Word('thank you', 'gracias', ['Gracias por tu ayuda.'], ['politeness']), new Word('water', 'agua', ['¿Puedo tener agua?'], ['food'])];
        const spanishBasics = new VocabularySet('spanish-basics', 'Spanish Basics', 'es', sampleWords);
        this.vocabSets.set(spanishBasics.id, spanishBasics);
    }

    renderUI() {
        const mainContent = document.getElementById('main-content');
        // Update header area (site title/tagline and user controls) instead of injecting header HTML
        try {
            const header = document.getElementById('site-header');
            if (header) {
                const titleEl = document.getElementById('site-title');
                const tagEl = document.getElementById('site-tagline');
                if (titleEl) titleEl.textContent = 'VocabMaster';
                if (tagEl) tagEl.textContent = 'Self-Contained Vocabulary Learning';

                // user controls (copy user id) - do not include Reset button
                let userControls = document.getElementById('user-controls');
                if (!userControls) {
                    userControls = document.createElement('p');
                    userControls.id = 'user-controls';
                    userControls.className = 'muted';
                    header.appendChild(userControls);
                }
                userControls.innerHTML = `User ID: <code id="user-id">${this.userId}</code> <button onclick="app.copyUserIdToClipboard()">Copy</button>`;
            }
        } catch (e) { /* ignore header update errors */ }
        // Clean, modernized UI: show distributor link, current vocab, and quick switcher for other dicts
        const currentSet = this.vocabSets.get(this.currentlyLoadedPath ? (this.vocabSets.has(this.currentlyLoadedPath) ? this.currentlyLoadedPath : Array.from(this.vocabSets.keys())[0]) : Array.from(this.vocabSets.keys())[0]);
        const vocabListHtml = this.vocabManifest && this.vocabManifest.sets ? this.vocabManifest.sets.map(p => {
            const name = p.split('/').pop();
            const isActive = p === this.currentlyLoadedPath;
            let total = null;
            let learning = null;
            // If we've already loaded this vocab into memory, use that data
            if (this.vocabSets.has(p) || this.vocabSets.has(p.split('/').pop())) {
                const key = this.vocabSets.has(p) ? p : p.split('/').pop();
                const vs = this.vocabSets.get(key);
                if (vs && Array.isArray(vs.words)) {
                    total = vs.words.length;
                    learning = vs.words.reduce((acc, w) => {
                        if (!w) return acc;
                        if ((w.learning === true) || (Array.isArray(w.tags) && w.tags.includes('learning')) || (w.stats && w.stats.attempts > 0)) return acc + 1;
                        return acc;
                    }, 0);
                }
            }
            // Prefer per-vocab saved progress (learned ids) when available
            try {
                const prog = this.vocabProgress.get(p) || this.vocabProgress.get(p.replace(/^src\//, '')) || this.vocabProgress.get(`src/${p}`);
                if (prog instanceof Set) {
                    learning = prog.size;
                    // total may remain null if not loaded; try to use summaries for total
                    if (total === null) {
                        const summary = this.getVocabSummary(p);
                        if (summary) total = summary.total;
                    }
                }
            } catch (e) {
                // ignore
            }
            // Fallback to pre-generated summaries if available and still unknown
            if ((total === null || learning === null)) {
                const summary = this.getVocabSummary(p);
                if (summary) {
                    total = total === null ? summary.total : total;
                    learning = learning === null ? summary.learning : learning;
                }
            }

            // No migration/fallback: keep learning as discovered from per-vocab progress or summaries
            // Render count badge (fallbacks to '-' when unknown)
            const totalText = total !== null ? total : '-';
            const learningText = learning !== null ? learning : '-';
            return `<li><span class="dict-meta">${totalText} words (${learningText} learning)</span> <button class="link-btn" data-path="${p}" ${isActive ? 'disabled' : ''}>Load ${name}</button></li>`;
        }).join('') : '';

        mainContent.innerHTML = `
            <div class="card">
                <h2>Current Dictionary</h2>
                ${this.currentlyLoadedPath && this.vocabSets.size ? `<p><strong>${this.vocabSets.get(this.currentlyLoadedPath).name}</strong> — ${this.vocabSets.get(this.currentlyLoadedPath).words.length} words</p>` : `<p>No dictionary loaded.</p>`}
                <div style="margin-top:10px;">${this.currentlyLoadedPath ? `<button onclick="app.startSession('${this.vocabSets.get(this.currentlyLoadedPath).id}')">Start Learning</button> <button onclick="app.exportVocab('${this.vocabSets.get(this.currentlyLoadedPath).id}')">Export</button>` : ''}</div>
            </div>
            <div class="card">
                <h2>Other Dictionaries</h2>
                <ul class="dict-switcher">
                    ${vocabListHtml}
                </ul>
            </div>
            <div class="card">
                <h2>Progress</h2>
                <p>Words Learned: ${(() => {
                    // If we have per-vocab progress recorded, sum those values for display.
                    // Some vocab progress entries may reference the same Set (mapped by id and path),
                    // so deduplicate by identity to avoid double-counting.
                    try {
                        let any = false;
                        let sum = 0;
                        const seen = new Set();
                        for (const s of this.vocabProgress.values()) {
                            if (s && s.size && !seen.has(s)) {
                                any = true;
                                sum += s.size;
                                seen.add(s);
                            }
                        }
                        return any ? sum : this.userProgress.stats.wordsLearned;
                    } catch (e) { return this.userProgress.stats.wordsLearned; }
                })()}</p>
                <p>Accuracy: ${this.userProgress.getStats().accuracy.toFixed(2)}%</p>
            </div>
        `;

        // Ensure a simple footer is present with version and changelog link
        try {
            let footer = document.getElementById('site-footer');
            if (!footer) {
                footer = document.createElement('footer');
                footer.id = 'site-footer';
                footer.style.marginTop = '16px';
                footer.style.fontSize = '0.9em';
                footer.className = 'muted';
                document.body.appendChild(footer);
            }
            const ver = this.version || 'unknown';
            const changelog = this.versionUrl || '/CHANGELOG.md';
            footer.innerHTML = `Version ${ver} — <a href="${changelog}" target="_blank" rel="noopener noreferrer">Changelog</a>`;
        } catch (e) { /* ignore footer errors */ }

        // Attach listeners for load buttons
        const buttons = mainContent.querySelectorAll('.link-btn');
        buttons.forEach(b => b.addEventListener('click', async (ev) => {
            const path = ev.currentTarget.getAttribute('data-path');
            await this.loadVocabFile(path);
            this.renderUI();
        }));
    }

    startSession(vocabId) { const vocabSet = this.vocabSets.get(vocabId); if (!vocabSet) return; this.currentSession = new LearningSession(this, vocabSet); this.currentSession.start(); }

    exportVocab(vocabId) { const vocabSet = this.vocabSets.get(vocabId); if (!vocabSet) return; const exportData = { id: vocabSet.id, name: vocabSet.name, language: vocabSet.language, metadata: vocabSet.metadata, words: vocabSet.words.map(word => ({ target: word.target, native: word.native, transliteration: word.transliteration || '', image: word.image || '', examples: word.examples, tags: word.tags })) }; const dataStr = JSON.stringify(exportData, null, 2); const blob = new Blob([dataStr], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `${vocabSet.id}.json`; a.click(); URL.revokeObjectURL(url); }

    // Import/contribute UI removed for a cleaner interface per project guidelines.

    async saveProgress() {
        await this.storage.saveProgress(this.userId, this.userProgress.getStats());
        // also persist per-vocab progress for all known vocab keys
        try {
            for (const [vkey] of this.vocabProgress) {
                // don't await sequentially to avoid blocking too long
                // but keep it simple and await to ensure durability
                // eslint-disable-next-line no-await-in-loop
                await this.saveVocabProgressForKey(vkey);
            }
        } catch (e) {
            console.warn('Failed to persist vocabProgress map', e);
        }
    }

    async loadProgress() {
        const data = await this.storage.loadProgress(this.userId);
        if (data) { this.userProgress.stats = Object.assign(this.userProgress.stats, data); }
    }

    attachAutoSave() {
        // Save progress when the page is unloaded or hidden to persist across sessions/devices
        try {
            window.addEventListener('beforeunload', () => {
                // synchronous navigator storage unavailable for complex operations; keep it simple
                try { localStorage.setItem(`${this.storage.prefix}progress_${this.userId}`, JSON.stringify(this.userProgress.getStats())); } catch (e) { console.warn('Auto-save beforeunload failed', e); }
            });

            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'hidden') {
                    // save asynchronously
                    this.storage.saveProgress(this.userId, this.userProgress.getStats()).catch(() => { });
                }
            });
        } catch (e) {
            console.warn('attachAutoSave failed', e);
        }
    }

    /**
     * Show a modal confirmation dialog to reset all progress.
     * The dialog is appended to document.body and removed after action.
     */
    showResetConfirmation() {
        // Reset UI removed: keep a safe no-op to avoid errors from any lingering calls.
        try { this.showToast('Reset progress feature is disabled in this build.'); } catch (e) { /* noop */ }
    }
}

const app = new VocabMaster();
app.initialize();
window.app = app;
