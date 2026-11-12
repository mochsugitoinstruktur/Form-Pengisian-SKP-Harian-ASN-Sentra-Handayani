/* =========================================================
   Laporan Kinerja Harian ASN — Sentra Handayani Jakarta
   Logika aplikasi: data, formulir, kamera, paginasi, ekspor PDF
   ========================================================= */

'use strict';

const STORAGE_KEY = 'skp_sentra_handayani_v2';
const LEGACY_KEY = 'SKP_KEMENSOS_DATA_STORAGE';
const MAX_DOC_SIZE = 10 * 1024 * 1024;
const MAX_SIGN_SIZE = 5 * 1024 * 1024;
const MAX_SOURCE_IMAGE_SIZE = 15 * 1024 * 1024;

const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const BULAN_SINGKAT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const A4_WIDTH_PX = 793.7;
const A4_HEIGHT_PX = 1122.5;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const icon = (name, cls = 'icon') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;

const pad2 = (value) => String(value).padStart(2, '0');

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
}[char]));

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

/* =========================================================
   Data awal & penyimpanan
   ========================================================= */

function todayISO() {
    const now = new Date();
    return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

function demoPhoto(title, subtitle, from, to) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="820" height="540">
        <defs>
            <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stop-color="${from}"/>
                <stop offset="1" stop-color="${to}"/>
            </linearGradient>
        </defs>
        <rect width="820" height="540" fill="url(#g)"/>
        <g fill="none" stroke="rgba(255,255,255,.42)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
            <rect x="285" y="150" width="250" height="170" rx="16"/>
            <circle cx="410" cy="232" r="42"/>
            <path d="M285 282l62-46 48 36 34-26 56 42"/>
        </g>
        <text x="410" y="384" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="32" font-weight="600" fill="rgba(255,255,255,.95)">${title}</text>
        <text x="410" y="424" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="20" fill="rgba(255,255,255,.72)">${subtitle}</text>
    </svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function defaultState() {
    return {
        nama: 'Moch. Sugito S.T.',
        nip: '199205262025061002',
        pangkat: 'Penata Muda (III/a)',
        jabatan: 'Instruktur Ahli Pertama',
        tanggal: todayISO(),
        tanggalManual: false,
        tempat: 'Jakarta',
        signatureUrl: '',
        kegiatan: [
            {
                id: uid(),
                jamMulai: '07:30',
                jamSelesai: '12:30',
                deskripsi: 'Mengikuti rapat keanggotaan pokja di Sentra Handayani 2',
                type: 'photo',
                image: demoPhoto('Dokumentasi Rapat', 'Ruang rapat Sentra Handayani 2', '#9db2d3', '#5f7ba6'),
                doc: null
            },
            {
                id: uid(),
                jamMulai: '13:00',
                jamSelesai: '18:00',
                deskripsi: 'Bertugas sebagai admin WA Center konsultasi bantuan sosial',
                type: 'photo',
                image: demoPhoto('Dokumentasi WA Center', 'Layanan konsultasi bantuan sosial', '#a8c1bd', '#6f9893'),
                doc: null
            }
        ]
    };
}

function blankState() {
    return {
        nama: '',
        nip: '',
        pangkat: '',
        jabatan: '',
        tanggal: todayISO(),
        tanggalManual: false,
        tempat: 'Jakarta',
        signatureUrl: '',
        kegiatan: []
    };
}

function sanitizeTime(value) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
    if (!match) return '';
    const hours = clamp(Number(match[1]), 0, 23);
    const minutes = clamp(Number(match[2]), 0, 59);
    return `${pad2(hours)}:${pad2(minutes)}`;
}

function normalizeActivity(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const legacyPhoto = source.photoUrl;
    let image = typeof source.image === 'string' ? source.image : '';
    if (!image && typeof legacyPhoto === 'string' && legacyPhoto) image = legacyPhoto;

    let doc = null;
    if (source.doc && typeof source.doc === 'object' && source.doc.name) {
        doc = { name: String(source.doc.name), size: String(source.doc.size || '') };
    } else if (legacyPhoto && typeof legacyPhoto === 'object') {
        doc = {
            name: String(legacyPhoto.fileName || 'Lampiran'),
            size: String(legacyPhoto.fileSize || '')
        };
    }

    return {
        id: String(source.id || uid()),
        jamMulai: sanitizeTime(source.jamMulai),
        jamSelesai: sanitizeTime(source.jamSelesai),
        deskripsi: String(source.deskripsi || ''),
        type: ['photo', 'camera', 'document'].includes(source.type) ? source.type : 'photo',
        image: image || null,
        doc
    };
}

function normalizeState(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const tanggalManual = Boolean(source.tanggalManual);
    const storedDate = /^\d{4}-\d{2}-\d{2}$/.test(String(source.tanggal || '')) ? source.tanggal : '';
    const tanggal = tanggalManual && storedDate ? storedDate : todayISO();

    return {
        nama: String(source.nama || ''),
        nip: String(source.nip || '').replace(/\D/g, '').slice(0, 18),
        pangkat: String(source.pangkat || ''),
        jabatan: String(source.jabatan || ''),
        tanggal,
        tanggalManual,
        tempat: String(source.tempat || 'Jakarta'),
        signatureUrl: typeof source.signatureUrl === 'string' ? source.signatureUrl : '',
        kegiatan: Array.isArray(source.kegiatan) ? source.kegiatan.map(normalizeActivity) : []
    };
}

function loadState() {
    const keys = [STORAGE_KEY, LEGACY_KEY];
    for (const key of keys) {
        try {
            const raw = localStorage.getItem(key);
            if (!raw) continue;
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') {
                const normalized = normalizeState(parsed);
                try { localStorage.removeItem(LEGACY_KEY); } catch (error) { /* diabaikan */ }
                return normalized;
            }
        } catch (error) {
            console.warn('Data tersimpan tidak dapat dibaca:', error);
        }
    }
    return defaultState();
}

let state = loadState();
let editingId = null;
let tempAttachment = null;
let currentDocType = 'photo';
let zoomFactor = 0;
let saveTimer = null;
let docTimer = null;
let saveWarned = false;

/* =========================================================
   Util tanggal, waktu, NIP
   ========================================================= */

function parseLocalDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null;
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateLong(value) {
    const date = parseLocalDate(value);
    if (!date) return '-';
    return `${pad2(date.getDate())} ${BULAN[date.getMonth()]} ${date.getFullYear()}`;
}

function yearOf(value) {
    const date = parseLocalDate(value);
    return date ? date.getFullYear() : new Date().getFullYear();
}

function toDotTime(value) {
    const time = sanitizeTime(value);
    return time ? time.replace(':', '.') : '--.--';
}

function timeRange(act) {
    return `${toDotTime(act.jamMulai)} \u2013 ${toDotTime(act.jamSelesai)} WIB`;
}

function minutesOf(time) {
    const match = /^(\d{2}):(\d{2})$/.exec(time || '');
    if (!match) return null;
    return Number(match[1]) * 60 + Number(match[2]);
}

function durationMinutes(act) {
    const start = minutesOf(act.jamMulai);
    const end = minutesOf(act.jamSelesai);
    if (start === null || end === null || end <= start) return null;
    return end - start;
}

function durationText(minutes) {
    if (minutes === null || minutes === undefined) return '';
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    if (!hours) return `${rest} menit`;
    return rest ? `${hours} jam ${rest} menit` : `${hours} jam`;
}

function nipGroups(rawNip) {
    const digits = String(rawNip || '').replace(/\D/g, '');
    if (digits.length !== 18) return digits;
    return `${digits.slice(0, 8)} ${digits.slice(8, 14)} ${digits.slice(14, 15)} ${digits.slice(15)}`;
}

function nipWithPrefix(rawNip) {
    const groups = nipGroups(rawNip);
    return groups ? `NIP. ${groups}` : '';
}

function formatBytes(bytes) {
    if (!bytes || bytes < 1024) return `${bytes || 0} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/* =========================================================
   Indikator simpan
   ========================================================= */

function setSaveState(mode) {
    const wrap = $('#save-state');
    const label = $('#save-state-text');
    if (!wrap || !label) return;
    wrap.classList.remove('is-saving', 'is-error');

    if (mode === 'saving') {
        wrap.classList.add('is-saving');
        label.textContent = 'Menyimpan\u2026';
        return;
    }
    if (mode === 'error') {
        wrap.classList.add('is-error');
        label.textContent = 'Belum tersimpan';
        return;
    }
    const now = new Date();
    label.textContent = `Tersimpan ${pad2(now.getHours())}.${pad2(now.getMinutes())}`;
}

function scheduleSave(immediate = false) {
    if (saveTimer) clearTimeout(saveTimer);
    if (immediate) {
        persistNow();
        return;
    }
    setSaveState('saving');
    saveTimer = setTimeout(persistNow, 550);
}

function persistNow() {
    if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
    }
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        saveWarned = false;
        setSaveState('saved');
    } catch (error) {
        console.warn('Gagal menyimpan data:', error);
        setSaveState('error');
        if (!saveWarned) {
            saveWarned = true;
            toast('Penyimpanan peramban penuh. Data tetap ada selama halaman terbuka \u2014 ekspor PDF atau hapus kegiatan lama.', 'error', 8000);
        }
    }
}

/* =========================================================
   Toast & dialog
   ========================================================= */

function toast(message, type = 'success', duration = 4500, action = null) {
    const stack = $('#toast-stack');
    if (!stack) return;

    const el = document.createElement('div');
    el.className = `toast toast--${type}`;
    const iconName = type === 'error' ? 'alert' : type === 'info' ? 'info' : 'check';

    el.innerHTML = `
        <span class="toast__icon">${icon(iconName)}</span>
        <span class="toast__body"></span>
        ${action ? `<button type="button" class="toast__action">${esc(action.label)}</button>` : ''}
        <button type="button" class="toast__close" aria-label="Tutup notifikasi">${icon('x')}</button>
    `;
    el.querySelector('.toast__body').textContent = message;

    const remove = () => {
        if (el.classList.contains('is-leaving')) return;
        el.classList.add('is-leaving');
        setTimeout(() => el.remove(), 220);
    };

    el.querySelector('.toast__close').addEventListener('click', remove);
    if (action) {
        el.querySelector('.toast__action').addEventListener('click', () => {
            remove();
            try { action.onClick(); } catch (error) { console.error(error); }
        });
    }

    stack.appendChild(el);
    if (duration > 0) setTimeout(remove, duration);
    return el;
}

function askConfirm({ title, message, confirmLabel = 'Ya, lanjutkan' }) {
    const dialog = $('#confirm-dialog');
    $('#confirm-title').textContent = title;
    $('#confirm-message').textContent = message;
    $('#confirm-ok').textContent = confirmLabel;

    return new Promise((resolve) => {
        const onClose = () => {
            dialog.removeEventListener('close', onClose);
            resolve(dialog.returnValue === 'ok');
        };
        dialog.addEventListener('close', onClose);
        dialog.returnValue = '';
        if (typeof dialog.showModal === 'function') dialog.showModal();
        else resolve(false);
    });
}

/* =========================================================
   Identitas pegawai
   ========================================================= */

function syncIdentityInputs() {
    $('#in-nama').value = state.nama;
    $('#in-nip').value = state.nip;
    $('#in-pangkat').value = state.pangkat;
    $('#in-jabatan').value = state.jabatan;
    $('#in-tanggal').value = state.tanggal || todayISO();
    $('#in-tempat').value = state.tempat;
    updateNipHint();
}

function updateNipHint() {
    const hint = $('#nip-hint');
    const digits = $('#in-nip').value.replace(/\D/g, '');
    if (!digits) {
        hint.textContent = 'Contoh: 19920526 202506 1 002';
        return;
    }
    if (digits.length === 18) {
        hint.textContent = `Format: ${nipGroups(digits)}`;
        return;
    }
    hint.textContent = `${digits.length} dari 18 digit`;
}

function scheduleDocRender() {
    if (docTimer) clearTimeout(docTimer);
    docTimer = setTimeout(() => {
        docTimer = null;
        renderDocument();
    }, 200);
}

function bindIdentityField(id, key, options = {}) {
    const input = document.getElementById(id);
    if (!input) return;

    const commit = () => {
        let value = input.value;
        if (options.digits) {
            value = value.replace(/\D/g, '').slice(0, 18);
            input.value = value;
            updateNipHint();
        }
        if (key === 'tanggal') {
            if (!value) {
                value = todayISO();
                input.value = value;
            }
            state.tanggalManual = value !== todayISO();
        }
        state[key] = value;
        scheduleDocRender();
        scheduleSave();
    };

    input.addEventListener('input', commit);
    input.addEventListener('change', commit);
}

function refreshAutoDate() {
    if (state.tanggalManual) return;

    const today = todayISO();
    if (state.tanggal === today) return;

    state.tanggal = today;
    const input = $('#in-tanggal');
    if (input) input.value = today;
    renderDocument();
    scheduleSave();
    toast('Tanggal kegiatan diperbarui ke hari ini.', 'info', 3000);
}

/* =========================================================
   Tanda tangan
   ========================================================= */

function renderSignature() {
    const empty = $('#sig-pick');
    const filled = $('#sig-preview');
    const img = $('#sig-img');
    const hasSignature = Boolean(state.signatureUrl);

    empty.hidden = hasSignature;
    filled.hidden = !hasSignature;

    if (hasSignature) {
        img.src = state.signatureUrl;
    } else {
        img.removeAttribute('src');
        $('#sig-file').value = '';
    }
}

async function handleSignatureFile(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
        toast('Tanda tangan harus berupa berkas gambar.', 'error');
        return;
    }
    if (file.size > MAX_SIGN_SIZE) {
        toast('Ukuran tanda tangan melebihi 5 MB.', 'error');
        return;
    }

    try {
        const keepAlpha = /png|webp/i.test(file.type);
        const result = await compressImage(file, 900, 0.92, keepAlpha);
        state.signatureUrl = result.dataUrl;
        renderSignature();
        renderDocument();
        scheduleSave(true);
        toast('Tanda tangan berhasil ditambahkan.');
    } catch (error) {
        console.error(error);
        toast('Tanda tangan tidak dapat diproses. Coba berkas lain.', 'error');
    }
}

function removeSignature() {
    state.signatureUrl = '';
    renderSignature();
    renderDocument();
    scheduleSave(true);
    toast('Tanda tangan dihapus.', 'info');
}

/* =========================================================
   Lampiran & gambar
   ========================================================= */

function showAttachment() {
    const box = $('#attachment');
    const thumb = $('#attach-thumb');
    const name = $('#attach-name');
    const meta = $('#attach-meta');

    if (!tempAttachment) {
        box.hidden = true;
        thumb.innerHTML = '';
        name.textContent = '-';
        meta.textContent = '-';
        return;
    }

    box.hidden = false;
    if (tempAttachment.kind === 'image') {
        thumb.innerHTML = `<img src="${esc(tempAttachment.dataUrl)}" alt="Pratinjau dokumentasi">`;
        name.textContent = tempAttachment.name || 'Foto dokumentasi';
        const dimension = tempAttachment.width && tempAttachment.height
            ? `${tempAttachment.width} \u00d7 ${tempAttachment.height} px`
            : '';
        meta.textContent = [dimension, tempAttachment.size ? formatBytes(tempAttachment.size) : '']
            .filter(Boolean).join(' \u00b7 ') || 'Gambar siap digunakan';
    } else {
        thumb.innerHTML = icon('file');
        name.textContent = tempAttachment.name;
        meta.textContent = tempAttachment.size ? formatBytes(tempAttachment.size) : 'Lampiran dokumen';
    }
}

function clearAttachment(resetInputs = true) {
    tempAttachment = null;
    showAttachment();
    if (resetInputs) {
        const photoFile = $('#photo-file');
        const docFile = $('#doc-file');
        const photoUrl = $('#photo-url');
        if (photoFile) photoFile.value = '';
        if (docFile) docFile.value = '';
        if (photoUrl) photoUrl.value = '';
    }
}

function loadBitmap(file) {
    if (typeof createImageBitmap === 'function') {
        return createImageBitmap(file).catch(() => loadViaObjectUrl(file));
    }
    return loadViaObjectUrl(file);
}

function loadViaObjectUrl(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(url);
            resolve(img);
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('Berkas gambar tidak dapat dibaca.'));
        };
        img.src = url;
    });
}

async function compressImage(file, maxDimension = 1200, quality = 0.82, keepAlpha = false) {
    const source = await loadBitmap(file);
    const sourceWidth = source.width || source.naturalWidth;
    const sourceHeight = source.height || source.naturalHeight;
    if (!sourceWidth || !sourceHeight) throw new Error('Dimensi gambar tidak terbaca.');

    const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    if (keepAlpha) {
        ctx.clearRect(0, 0, width, height);
    } else {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
    }

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, width, height);

    const dataUrl = keepAlpha ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', quality);
    return { dataUrl, width, height };
}

async function handlePhotoFile(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
        toast('Berkas dokumentasi harus berupa gambar.', 'error');
        return;
    }
    if (file.size > MAX_SOURCE_IMAGE_SIZE) {
        toast('Ukuran gambar melebihi 15 MB. Kompres berkas terlebih dahulu.', 'error');
        return;
    }

    try {
        const result = await compressImage(file, 1200, 0.82, false);
        tempAttachment = {
            kind: 'image',
            dataUrl: result.dataUrl,
            name: file.name || 'Foto dokumentasi',
            size: file.size,
            width: result.width,
            height: result.height
        };
        showAttachment();
        clearFormError();
        toast('Foto dokumentasi ditambahkan.', 'info', 2800);
    } catch (error) {
        console.error(error);
        toast('Foto tidak dapat diproses. Coba berkas lain.', 'error');
    }
}

async function handleDocumentFile(file) {
    if (!file) return;
    if (file.size > MAX_DOC_SIZE) {
        toast('Ukuran lampiran melebihi 10 MB.', 'error');
        return;
    }

    if (file.type.startsWith('image/')) {
        await handlePhotoFile(file);
        return;
    }

    const allowed = /\.(pdf|docx?|jpe?g|png)$/i.test(file.name);
    if (!allowed) {
        toast('Format lampiran harus PDF, Word, JPG, atau PNG.', 'error');
        return;
    }

    tempAttachment = {
        kind: 'file',
        name: file.name,
        size: file.size
    };
    showAttachment();
    clearFormError();
    toast('Lampiran dokumen ditambahkan.', 'info', 2800);
}

function imageUrlToAttachment(rawUrl) {
    return new Promise((resolve, reject) => {
        let url;
        try {
            url = new URL(rawUrl);
        } catch (error) {
            reject(new Error('Tautan gambar tidak valid.'));
            return;
        }
        if (!/^https?:$/.test(url.protocol)) {
            reject(new Error('Tautan gambar harus diawali http:// atau https://.'));
            return;
        }

        const img = new Image();
        img.crossOrigin = 'anonymous';
        let settled = false;
        const timer = setTimeout(() => finish(new Error('Waktu pemuatan gambar habis.')), 15000);

        function finish(error, result) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (error) reject(error);
            else resolve(result);
        }

        img.onload = () => {
            try {
                const maxDimension = 1200;
                const scale = Math.min(1, maxDimension / Math.max(img.naturalWidth, img.naturalHeight));
                const width = Math.max(1, Math.round(img.naturalWidth * scale));
                const height = Math.max(1, Math.round(img.naturalHeight * scale));
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, width, height);
                ctx.drawImage(img, 0, 0, width, height);
                finish(null, {
                    kind: 'image',
                    dataUrl: canvas.toDataURL('image/jpeg', 0.85),
                    name: 'Foto dari tautan',
                    size: 0,
                    width,
                    height
                });
            } catch (error) {
                finish(new Error('Gambar dari tautan diblokir kebijakan CORS. Unggah berkas gambar langsung.'));
            }
        };

        img.onerror = () => finish(new Error('Gambar tidak dapat dimuat. Periksa tautan atau unggah berkas langsung.'));
        img.src = url.href;
    });
}

/* =========================================================
   Dokumentasi: panel & jenis
   ========================================================= */

function setDocType(type) {
    currentDocType = ['photo', 'camera', 'document'].includes(type) ? type : 'photo';

    $$('.segmented__item').forEach((item) => {
        const active = item.dataset.type === currentDocType;
        item.classList.toggle('is-active', active);
        const radio = item.querySelector('input');
        if (radio) radio.checked = active;
    });

    $('#panel-photo').hidden = currentDocType !== 'photo';
    $('#panel-camera').hidden = currentDocType !== 'camera';
    $('#panel-document').hidden = currentDocType !== 'document';
}

/* =========================================================
   Formulir kegiatan
   ========================================================= */

function updateCharCount() {
    const value = $('#act-deskripsi').value;
    $('#desc-count').textContent = `${value.length} / 500`;
}

function clearFormError() {
    const el = $('#form-error');
    el.hidden = true;
    el.textContent = '';
}

function showFormError(message) {
    const el = $('#form-error');
    el.innerHTML = `${icon('alert')}<span></span>`;
    el.querySelector('span').textContent = message;
    el.hidden = false;
}

function showTimeError(message) {
    $('#time-error-text').textContent = message;
    $('#time-error').hidden = false;
    $('#act-mulai').classList.add('is-invalid');
    $('#act-selesai').classList.add('is-invalid');
}

function clearTimeError() {
    $('#time-error').hidden = true;
    $('#act-mulai').classList.remove('is-invalid');
    $('#act-selesai').classList.remove('is-invalid');
}

function validateForm() {
    clearFormError();
    clearTimeError();

    const mulai = $('#act-mulai').value;
    const selesai = $('#act-selesai').value;
    const deskripsi = $('#act-deskripsi').value.trim();

    if (!mulai || !selesai) {
        showTimeError('Lengkapi jam mulai dan jam selesai kegiatan.');
        $('#act-mulai').focus();
        return false;
    }

    const start = minutesOf(mulai);
    const end = minutesOf(selesai);
    if (start === null || end === null || end <= start) {
        showTimeError('Jam selesai harus lebih lambat daripada jam mulai.');
        $('#act-selesai').focus();
        return false;
    }

    if (!deskripsi) {
        $('#act-deskripsi').classList.add('is-invalid');
        showFormError('Uraian kegiatan wajib diisi.');
        $('#act-deskripsi').focus();
        return false;
    }
    $('#act-deskripsi').classList.remove('is-invalid');

    return true;
}

function setSubmitBusy(busy) {
    const button = $('#btn-add');
    const label = $('#btn-add-label');
    button.disabled = busy;
    if (busy) {
        label.textContent = 'Memproses\u2026';
    } else {
        label.textContent = editingId ? 'Simpan Perubahan' : 'Tambah ke Laporan';
    }
}

function resetActivityForm(options = {}) {
    $('#activity-form').reset();
    $('#act-deskripsi').value = '';
    updateCharCount();
    clearAttachment();
    clearFormError();
    clearTimeError();
    $('#act-deskripsi').classList.remove('is-invalid');
    if (!options.keepType) setDocType('photo');
    editingId = null;
    $('#btn-cancel-edit').hidden = true;
    $('#btn-add-label').textContent = 'Tambah ke Laporan';
    setSubmitBusy(false);
}

async function handleActivitySubmit(event) {
    event.preventDefault();
    if (!validateForm()) return;

    const jamMulai = $('#act-mulai').value;
    const jamSelesai = $('#act-selesai').value;
    const deskripsi = $('#act-deskripsi').value.trim();
    const type = currentDocType;

    setSubmitBusy(true);

    try {
        let attachment = tempAttachment;

        if (type === 'photo' && !attachment) {
            const url = $('#photo-url').value.trim();
            if (url) {
                attachment = await imageUrlToAttachment(url);
                tempAttachment = attachment;
                showAttachment();
            }
        }

        const record = {
            id: editingId || uid(),
            jamMulai,
            jamSelesai,
            deskripsi,
            type,
            image: attachment && attachment.kind === 'image' ? attachment.dataUrl : null,
            doc: attachment && attachment.kind === 'file'
                ? { name: attachment.name, size: formatBytes(attachment.size) }
                : null
        };

        if (editingId) {
            const index = state.kegiatan.findIndex((item) => item.id === editingId);
            if (index >= 0) state.kegiatan[index] = record;
            else state.kegiatan.push(record);
        } else {
            state.kegiatan.push(record);
        }

        const wasEditing = Boolean(editingId);
        resetActivityForm();
        renderAll();
        scheduleSave(true);

        toast(wasEditing ? 'Perubahan kegiatan berhasil disimpan.' : 'Kegiatan berhasil ditambahkan ke laporan.');
    } catch (error) {
        console.error(error);
        showFormError(error.message || 'Kegiatan tidak dapat disimpan.');
    } finally {
        setSubmitBusy(false);
    }

    // Pastikan pratinjau tetap sinkron setelah proses async.
    renderDocument();
}

function startEditActivity(id) {
    const act = state.kegiatan.find((item) => item.id === id);
    if (!act) return;

    editingId = id;
    $('#act-mulai').value = act.jamMulai;
    $('#act-selesai').value = act.jamSelesai;
    $('#act-deskripsi').value = act.deskripsi;
    updateCharCount();
    clearFormError();
    clearTimeError();

    if (act.image) {
        tempAttachment = {
            kind: 'image',
            dataUrl: act.image,
            name: 'Foto dokumentasi',
            size: 0,
            width: 0,
            height: 0
        };
    } else if (act.doc) {
        tempAttachment = { kind: 'file', name: act.doc.name, size: 0 };
    } else {
        tempAttachment = null;
    }

    setDocType(act.type || 'photo');
    showAttachment();
    $('#btn-cancel-edit').hidden = false;
    $('#btn-add-label').textContent = 'Simpan Perubahan';

    renderActivityList();

    const card = $('#activity-form').closest('.card');
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => $('#act-deskripsi').focus({ preventScroll: true }), 380);
    toast('Mode ubah aktif. Perbarui data lalu simpan.', 'info', 3200);
}

function deleteActivity(id) {
    const index = state.kegiatan.findIndex((item) => item.id === id);
    if (index < 0) return;

    const item = $(`.activity-item[data-id="${CSS.escape(id)}"]`);
    if (item) item.classList.add('is-removing');

    setTimeout(() => {
        const removed = state.kegiatan.splice(index, 1)[0];
        if (!removed) return;
        if (editingId === id) resetActivityForm();

        renderAll();
        scheduleSave(true);

        toast('Kegiatan dihapus dari laporan.', 'success', 7000, {
            label: 'Urungkan',
            onClick: () => {
                state.kegiatan.splice(Math.min(index, state.kegiatan.length), 0, removed);
                renderAll();
                scheduleSave(true);
                toast('Kegiatan dikembalikan.');
            }
        });
    }, 160);
}

function moveActivity(id, direction) {
    const index = state.kegiatan.findIndex((item) => item.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= state.kegiatan.length) return;

    const [moved] = state.kegiatan.splice(index, 1);
    state.kegiatan.splice(target, 0, moved);
    renderAll();
    scheduleSave(true);
}

/* =========================================================
   Daftar kegiatan
   ========================================================= */

function renderActivityList() {
    const list = $('#activity-list');
    const empty = $('#activity-empty');
    const badge = $('#activity-count');
    const summary = $('#list-summary');

    list.innerHTML = '';
    const total = state.kegiatan.length;

    empty.hidden = total > 0;
    badge.textContent = `${total} kegiatan`;

    const totalMinutes = state.kegiatan.reduce((sum, act) => sum + (durationMinutes(act) || 0), 0);
    summary.textContent = total
        ? `${total} kegiatan \u00b7 total ${durationText(totalMinutes) || '0 menit'}`
        : 'Belum ada kegiatan';

    state.kegiatan.forEach((act, index) => {
        const minutes = durationMinutes(act);
        const thumb = act.image
            ? `<img src="${esc(act.image)}" alt="Dokumentasi kegiatan ${index + 1}">`
            : icon(act.doc ? 'file' : 'image');

        const docLabel = act.image
            ? 'Foto dokumentasi'
            : act.doc
                ? act.doc.name
                : 'Tanpa dokumentasi';

        const item = document.createElement('div');
        item.className = `activity-item${editingId === act.id ? ' is-editing' : ''}`;
        item.dataset.id = act.id;
        item.innerHTML = `
            <div class="activity-item__main">
                <div class="activity-item__top">
                    <span class="activity-item__num">${index + 1}</span>
                    <span class="activity-item__time">${esc(timeRange(act))}</span>
                    ${minutes !== null ? `<span class="activity-item__duration">${icon('clock')}${esc(durationText(minutes))}</span>` : ''}
                </div>
                <p class="activity-item__desc">${esc(act.deskripsi || '-')}</p>
                <div class="activity-item__foot">
                    <span class="activity-item__doc">${icon(act.image ? 'image' : act.doc ? 'file' : 'info')}<span>${esc(docLabel)}</span></span>
                    <span class="activity-item__actions">
                        <button type="button" class="icon-btn" data-action="up" aria-label="Naikkan kegiatan" ${index === 0 ? 'disabled' : ''}>${icon('up')}</button>
                        <button type="button" class="icon-btn" data-action="down" aria-label="Turunkan kegiatan" ${index === total - 1 ? 'disabled' : ''}>${icon('down')}</button>
                        <button type="button" class="icon-btn" data-action="edit" aria-label="Ubah kegiatan">${icon('edit')}</button>
                        <button type="button" class="icon-btn icon-btn--danger" data-action="delete" aria-label="Hapus kegiatan">${icon('trash')}</button>
                    </span>
                </div>
            </div>
            <div class="activity-item__thumb">${thumb}</div>
        `;
        list.appendChild(item);
    });
}

/* =========================================================
   Dokumen A4 & paginasi
   ========================================================= */

function documentMeta() {
    return {
        nama: state.nama || '-',
        namaUpper: (state.nama || '-').toUpperCase(),
        nip: nipGroups(state.nip) || '-',
        nipSign: nipWithPrefix(state.nip),
        jabatan: state.jabatan || '-',
        pangkat: state.pangkat || '-',
        tanggal: formatDateLong(state.tanggal),
        tahun: yearOf(state.tanggal),
        tempat: state.tempat || 'Jakarta'
    };
}

function kopHtml() {
    return `
        <header class="doc-kop">
            <div class="doc-kop__logo">
                <img src="Kementerian_Sosial.png" alt="Logo Kementerian Sosial">
            </div>
            <div class="doc-kop__center">
                <span class="doc-kop__eyebrow">Kementerian Sosial Republik Indonesia</span>
                <span class="doc-kop__name">SENTRA HANDAYANI DI JAKARTA</span>
                <span class="doc-kop__addr">Jl. PPA No. 1 RT/RW 006/001, Bambu Apus, Kec. Cipayung, Kota Jakarta Timur, DKI Jakarta 13890</span>
            </div>
            <div></div>
        </header>
        <div class="doc-rule"></div>
    `;
}

function titleHtml(meta) {
    return `
        <div class="doc-title">
            <h2>Laporan Kinerja Harian ASN</h2>
            <span>Tahun ${meta.tahun}</span>
            <div class="doc-title__line"></div>
        </div>
    `;
}

function metaHtml(meta) {
    return `
        <div class="doc-meta">
            <div class="doc-meta__row">
                <span class="doc-meta__label">Nama Pegawai</span>
                <span class="doc-meta__sep">:</span>
                <span class="doc-meta__value">${esc(meta.nama)}</span>
            </div>
            <div class="doc-meta__row">
                <span class="doc-meta__label">Pangkat / Golongan</span>
                <span class="doc-meta__sep">:</span>
                <span class="doc-meta__value">${esc(meta.pangkat)}</span>
            </div>
            <div class="doc-meta__row">
                <span class="doc-meta__label">NIP</span>
                <span class="doc-meta__sep">:</span>
                <span class="doc-meta__value">${esc(meta.nip)}</span>
            </div>
            <div class="doc-meta__row">
                <span class="doc-meta__label">Tanggal Kegiatan</span>
                <span class="doc-meta__sep">:</span>
                <span class="doc-meta__value">${esc(meta.tanggal)}</span>
            </div>
            <div class="doc-meta__row">
                <span class="doc-meta__label">Jabatan</span>
                <span class="doc-meta__sep">:</span>
                <span class="doc-meta__value">${esc(meta.jabatan)}</span>
            </div>
            <div class="doc-meta__row">
                <span class="doc-meta__label">Unit Kerja</span>
                <span class="doc-meta__sep">:</span>
                <span class="doc-meta__value">Sentra Handayani Jakarta</span>
            </div>
        </div>
    `;
}

function continuedHtml(meta) {
    return `
        <div class="doc-continued">
            <img src="Kementerian_Sosial.png" alt="Logo Kementerian Sosial">
            <div class="doc-continued__copy">
                <strong>Lanjutan Laporan Kinerja Harian ASN</strong>
                <span>${esc(meta.nama)} &middot; ${esc(meta.tanggal)}</span>
            </div>
            <span class="doc-continued__right">Tahun ${meta.tahun}</span>
        </div>
    `;
}

function docCellHtml(act) {
    if (act.image) {
        return `<img class="doc-thumb" src="${esc(act.image)}" alt="Dokumentasi kegiatan">`;
    }
    if (act.doc) {
        return `
            <div class="doc-file">
                <svg class="doc-file__icon" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
                    <path d="M14 3.5v5h5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
                </svg>
                <span class="doc-file__name" title="${esc(act.doc.name)}">${esc(act.doc.name)}</span>
                <span class="doc-file__size">${esc(act.doc.size || 'Lampiran')}</span>
            </div>
        `;
    }
    return `<span class="doc-none">&mdash;</span>`;
}

function buildRow(act, index) {
    const row = document.createElement('tr');
    row.innerHTML = `
        <td class="doc-col-no">${index + 1}</td>
        <td>
            <div class="doc-row__time">${esc(timeRange(act))}</div>
            <div class="doc-row__desc">${esc(act.deskripsi || '-')}</div>
        </td>
        <td>${docCellHtml(act)}</td>
    `;
    return row;
}

function buildSignature(meta) {
    const signature = document.createElement('div');
    signature.className = 'doc-sign';
    signature.innerHTML = `
        <p class="doc-sign__place">Dibuat di ${esc(meta.tempat)}<br>pada tanggal ${esc(meta.tanggal)}</p>
        <p class="doc-sign__role">${esc(meta.jabatan)}</p>
        <div class="doc-sign__space">
            ${state.signatureUrl ? `<img src="${esc(state.signatureUrl)}" alt="Tanda tangan">` : ''}
        </div>
        <p class="doc-sign__name">${esc(meta.namaUpper)}</p>
        <p class="doc-sign__nip">${esc(meta.nipSign || 'NIP. -')}</p>
    `;
    return signature;
}

function createPage(index, meta, slotHost) {
    const pageEl = document.createElement('article');
    pageEl.className = 'page';

    const inner = document.createElement('div');
    inner.className = 'page__inner';
    inner.innerHTML = index === 1
        ? `${kopHtml()}${titleHtml(meta)}${metaHtml(meta)}`
        : continuedHtml(meta);

    const tableWrap = document.createElement('div');
    tableWrap.className = 'doc-table-wrap';
    tableWrap.innerHTML = `
        <table class="doc-table">
            <colgroup>
                <col style="width:10mm">
                <col>
                <col style="width:46mm">
            </colgroup>
            <thead>
                <tr>
                    <th>No</th>
                    <th>Tugas dan Kegiatan</th>
                    <th>Dokumentasi</th>
                </tr>
            </thead>
            <tbody></tbody>
        </table>
    `;
    inner.appendChild(tableWrap);

    const foot = document.createElement('div');
    foot.className = 'page__foot';

    pageEl.append(inner, foot);

    const slot = document.createElement('div');
    slot.className = 'page-slot';
    slot.appendChild(pageEl);
    slotHost.appendChild(slot);

    return {
        el: pageEl,
        inner,
        tbody: tableWrap.querySelector('tbody'),
        foot,
        rows: 0
    };
}

function pageOverflows(page) {
    return page.inner.scrollHeight > page.inner.clientHeight + 1;
}

function renderDocument() {
    const host = $('#document-pages');
    if (!host) return;

    const meta = documentMeta();
    host.innerHTML = '';

    const pages = [];
    const addPage = () => {
        const page = createPage(pages.length + 1, meta, host);
        pages.push(page);
        return page;
    };

    let page = addPage();

    if (!state.kegiatan.length) {
        page.tbody.innerHTML = `
            <tr>
                <td colspan="3" class="doc-empty">Belum ada kegiatan yang ditambahkan pada laporan ini.</td>
            </tr>
        `;
    } else {
        state.kegiatan.forEach((act, index) => {
            const row = buildRow(act, index);
            page.tbody.appendChild(row);

            if (pageOverflows(page) && page.rows > 0) {
                page.tbody.removeChild(row);
                page = addPage();
                page.tbody.appendChild(row);
            }
            page.rows += 1;
        });
    }

    const signature = buildSignature(meta);
    let lastPage = pages[pages.length - 1];
    lastPage.inner.appendChild(signature);

    if (pageOverflows(lastPage) && lastPage.rows > 0) {
        lastPage.inner.removeChild(signature);

        // Bawa satu kegiatan ke halaman tanda tangan agar halaman terakhir
        // tidak berisi tanda tangan saja.
        let carriedRow = null;
        if (lastPage.rows > 1) {
            carriedRow = lastPage.tbody.lastElementChild;
            lastPage.tbody.removeChild(carriedRow);
            lastPage.rows -= 1;
        }

        lastPage = addPage();

        if (carriedRow) {
            lastPage.tbody.appendChild(carriedRow);
            lastPage.rows = 1;
        } else {
            const tableWrap = lastPage.tbody.closest('.doc-table-wrap');
            if (tableWrap) tableWrap.remove();
        }

        lastPage.inner.appendChild(signature);
    }

    pages.forEach((item, index) => {
        item.foot.innerHTML = `
            <span>Sentra Handayani Jakarta</span>
            <span>Halaman ${index + 1} dari ${pages.length}</span>
        `;
    });

    const chip = $('#page-count');
    if (chip) chip.textContent = `${pages.length} halaman`;

    applyScale();
}

function renderAll() {
    renderActivityList();
    renderDocument();
    applyScale();
}

/* =========================================================
   Skala pratinjau
   ========================================================= */

function fitScale() {
    const viewport = $('#preview-viewport');
    if (!viewport) return 1;
    const available = Math.max(240, viewport.clientWidth - 44);
    return clamp(available / A4_WIDTH_PX, 0.32, 1);
}

function applyScale() {
    const stage = $('#preview-stage');
    const level = $('#zoom-fit');
    if (!stage) return;

    const scale = zoomFactor || fitScale();
    stage.style.setProperty('--s', String(Number(scale.toFixed(3))));
    if (level) level.textContent = `${Math.round(scale * 100)}%`;
}

/* =========================================================
   Kamera
   ========================================================= */

const camera = {
    stream: null,
    facing: 'user',
    geo: null,
    geoPending: null,
    busy: false
};

function mapSize(width, height) {
    const base = Math.min(width, height);
    const mapW = Math.round(clamp(base * 0.3, 150, 320));
    const mapH = Math.round(mapW * 0.72);
    return { mapW, mapH };
}

function mapUrl(geo, width, height) {
    const { mapW, mapH } = mapSize(width, height);
    return `https://static-maps.yandex.ru/1.x/?ll=${geo.lon},${geo.lat}&z=16&size=${mapW},${mapH}&l=map&pt=${geo.lon},${geo.lat},pm2rdm`;
}

function loadImageSafe(src, timeout = 5000) {
    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        let settled = false;
        const finish = (value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            img.onload = null;
            img.onerror = null;
            resolve(value);
        };
        const timer = setTimeout(() => finish(null), timeout);
        img.onload = () => finish(img);
        img.onerror = () => finish(null);
        img.src = src;
    });
}

function roundRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
}

function setCameraLoading(text) {
    const box = $('#camera-loading');
    const label = $('#camera-loading-text');
    if (label) label.textContent = text;
    if (box) box.hidden = false;
}

function hideCameraLoading() {
    const box = $('#camera-loading');
    if (box) box.hidden = true;
}

function showCameraError(message) {
    const el = $('#camera-error');
    if (!el) return;
    el.textContent = message;
    el.hidden = false;
}

function clearCameraError() {
    const el = $('#camera-error');
    if (!el) return;
    el.textContent = '';
    el.hidden = true;
}

async function startCameraStream() {
    const video = $('#camera-video');
    if (!video) return;

    stopCameraStream();
    clearCameraError();
    setCameraLoading('Menyalakan kamera\u2026');
    setCameraChip('orientation', 'Menyiapkan kamera', 'camera');

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        hideCameraLoading();
        showCameraError('Kamera tidak tersedia. Buka halaman melalui HTTPS atau localhost agar peramban mengizinkan akses kamera.');
        return;
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: camera.facing,
                width: { ideal: 1280 },
                height: { ideal: 960 }
            },
            audio: false
        });

        camera.stream = stream;
        video.srcObject = stream;
        video.classList.toggle('is-mirrored', camera.facing === 'user');

        try { await video.play(); } catch (error) { /* autoplay dapat ditunda */ }
        await waitForVideo(video);

        const frame = $('#camera-frame');
        if (frame && video.videoWidth && video.videoHeight) {
            frame.style.setProperty('--cam-ar', `${video.videoWidth} / ${video.videoHeight}`);
            const landscape = video.videoWidth >= video.videoHeight;
            setCameraChip('orientation', landscape ? 'Mode lanskap' : 'Mode potret', 'camera');
        }

        hideCameraLoading();
    } catch (error) {
        console.error(error);
        hideCameraLoading();
        showCameraError(cameraErrorMessage(error));
    }
}

function waitForVideo(video) {
    if (video.readyState >= 1 && video.videoWidth) return Promise.resolve();
    return new Promise((resolve) => {
        const done = () => {
            video.removeEventListener('loadedmetadata', done);
            video.removeEventListener('loadeddata', done);
            resolve();
        };
        video.addEventListener('loadedmetadata', done);
        video.addEventListener('loadeddata', done);
        setTimeout(done, 4000);
    });
}

function cameraErrorMessage(error) {
    const name = error && error.name;
    if (name === 'NotAllowedError') return 'Izin kamera ditolak. Aktifkan izin kamera pada peramban, lalu coba lagi.';
    if (name === 'NotFoundError') return 'Kamera tidak ditemukan pada perangkat ini.';
    if (name === 'NotReadableError') return 'Kamera sedang dipakai aplikasi lain. Tutup aplikasi tersebut lalu coba lagi.';
    return `Kamera tidak dapat dibuka: ${error && error.message ? error.message : 'kesalahan tidak diketahui'}.`;
}

function stopCameraStream() {
    if (camera.stream) {
        camera.stream.getTracks().forEach((track) => track.stop());
        camera.stream = null;
    }
    const video = $('#camera-video');
    if (video) video.srcObject = null;
}

function setCameraChip(kind, text, iconName) {
    const chip = kind === 'gps' ? $('#camera-gps') : $('#camera-orientation');
    if (!chip) return;
    chip.innerHTML = `${icon(iconName)}<span>${esc(text)}</span>`;
}

function openCameraModal() {
    const modal = $('#camera-modal');
    if (!modal) return;
    modal.hidden = false;
    document.body.classList.add('no-scroll');
    clearCameraError();
    camera.geo = null;
    camera.geoPending = null;
    startCameraStream();
    detectLocation();
    setTimeout(() => $('#camera-capture').focus(), 80);
}

function closeCameraModal() {
    stopCameraStream();
    hideCameraLoading();
    const modal = $('#camera-modal');
    if (modal) modal.hidden = true;
    document.body.classList.remove('no-scroll');
    camera.busy = false;
    const shutter = $('#camera-capture');
    if (shutter) shutter.disabled = false;
}

function reverseGeocode(lat, lon) {
    return new Promise((resolve) => {
        if (!window.fetch) { resolve(null); return; }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 7000);
        fetch(`https://nominatim.openstreetmap.org/reverse?format=json&zoom=18&addressdetails=1&accept-language=id&lat=${lat}&lon=${lon}`, {
            signal: controller.signal,
            headers: { Accept: 'application/json' }
        })
            .then((response) => (response.ok ? response.json() : null))
            .then((data) => {
                if (!data || !data.address) { resolve(null); return; }
                const addr = data.address;
                const parts = [
                    addr.village || addr.suburb || addr.hamlet || addr.neighbourhood || addr.quarter,
                    addr.subdistrict || addr.district || addr.city_district || addr.county,
                    addr.city || addr.town || addr.municipality,
                    addr.state || addr.region
                ].filter(Boolean);
                resolve([...new Set(parts)].slice(0, 4));
            })
            .catch(() => resolve(null))
            .finally(() => clearTimeout(timer));
    });
}

function detectLocation() {
    camera.geo = null;
    camera.geoPending = null;

    if (!('geolocation' in navigator)) {
        setCameraChip('gps', 'Lokasi tidak didukung', 'map-pin');
        return;
    }

    setCameraChip('gps', 'Mendeteksi lokasi\u2026', 'gps');

    camera.geoPending = new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(async (position) => {
            const geo = {
                lat: position.coords.latitude,
                lon: position.coords.longitude,
                lines: null
            };
            camera.geo = geo;
            setCameraChip('gps', 'Lokasi ditemukan', 'map-pin');

            const lines = await reverseGeocode(geo.lat, geo.lon);
            if (lines && lines.length) {
                geo.lines = lines;
                setCameraChip('gps', lines.slice(0, 2).join(', '), 'map-pin');
            }
            resolve(geo);
        }, () => {
            setCameraChip('gps', 'Izin lokasi tidak aktif', 'map-pin');
            resolve(null);
        }, {
            enableHighAccuracy: true,
            timeout: 9000,
            maximumAge: 30000
        });
    });
}

function drawWatermark(ctx, width, height, geo) {
    const base = Math.min(width, height) / 720;
    const fontSize = Math.round(19 * base);
    const lineHeight = Math.round(25 * base);
    const padX = Math.round(34 * base);
    const padBottom = Math.round(42 * base);

    const lines = [];
    if (geo) {
        const now = new Date();
        lines.push(`${pad2(now.getDate())} ${BULAN_SINGKAT[now.getMonth()]} ${now.getFullYear()} ${pad2(now.getHours())}.${pad2(now.getMinutes())}.${pad2(now.getSeconds())} WIB`);
        const location = geo.lines && geo.lines.length ? geo.lines : ['Lokasi terdeteksi'];
        lines.push(...location.slice(0, 4));
    } else {
        lines.push('GPS tidak aktif');
        lines.push('Aktifkan izin lokasi untuk menandai tempat');
    }

    ctx.save();
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.shadowColor = 'rgba(0, 0, 0, .8)';
    ctx.shadowBlur = Math.round(8 * base);
    ctx.shadowOffsetX = Math.round(2 * base);
    ctx.shadowOffsetY = Math.round(2 * base);
    ctx.fillStyle = '#ffffff';

    const startY = height - padBottom - (lines.length - 1) * lineHeight;
    lines.forEach((line, index) => {
        const isTime = index === 0 && geo;
        ctx.font = `${isTime ? 700 : 500} ${isTime ? fontSize : Math.round(fontSize * 0.92)}px "Plus Jakarta Sans", "Segoe UI", Arial, sans-serif`;
        ctx.fillText(line, width - padX, startY + index * lineHeight);
    });
    ctx.restore();
}

function drawMapBox(ctx, width, height, geo, mapImage) {
    const { mapW, mapH } = mapSize(width, height);
    const base = Math.min(width, height) / 720;
    const x = Math.round(34 * base);
    const y = height - mapH - Math.round(42 * base);

    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, .5)';
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 4;
    ctx.fillStyle = '#ffffff';
    roundRect(ctx, x - 4, y - 4, mapW + 8, mapH + 8, 8);
    ctx.fill();
    ctx.restore();

    ctx.save();
    roundRect(ctx, x, y, mapW, mapH, 5);
    ctx.clip();

    if (mapImage) {
        ctx.drawImage(mapImage, x, y, mapW, mapH);
    } else {
        const gradient = ctx.createLinearGradient(x, y, x + mapW, y + mapH);
        gradient.addColorStop(0, '#e8eff9');
        gradient.addColorStop(1, '#c6d6e9');
        ctx.fillStyle = gradient;
        ctx.fillRect(x, y, mapW, mapH);

        ctx.strokeStyle = 'rgba(18, 53, 104, .12)';
        ctx.lineWidth = 1;
        for (let gx = x; gx < x + mapW; gx += 20) {
            ctx.beginPath();
            ctx.moveTo(gx, y);
            ctx.lineTo(gx, y + mapH);
            ctx.stroke();
        }
        for (let gy = y; gy < y + mapH; gy += 20) {
            ctx.beginPath();
            ctx.moveTo(x, gy);
            ctx.lineTo(x + mapW, gy);
            ctx.stroke();
        }

        const cx = x + mapW / 2;
        const cy = y + mapH / 2;
        ctx.fillStyle = '#c0392b';
        ctx.beginPath();
        ctx.arc(cx, cy - 8, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(cx - 8, cy - 3);
        ctx.lineTo(cx, cy + 12);
        ctx.lineTo(cx + 8, cy - 3);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(cx, cy - 8, 2.6, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = 'rgba(11, 34, 70, .82)';
        ctx.font = `600 ${Math.round(Math.min(width, height) * .019)}px "Plus Jakarta Sans", Arial, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(geo ? 'PETA LOKASI' : 'LOKASI TIDAK TERSEDIA', cx, y + mapH - 10);
    }
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, .95)';
    ctx.lineWidth = 2;
    roundRect(ctx, x, y, mapW, mapH, 5);
    ctx.stroke();
    ctx.restore();
}

async function composeCameraPhoto(video, geo) {
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) throw new Error('Kamera belum siap.');

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    const mapImage = geo ? await loadImageSafe(mapUrl(geo, width, height), 5000) : null;

    const paint = (map) => {
        ctx.clearRect(0, 0, width, height);

        ctx.save();
        if (camera.facing === 'user') {
            ctx.translate(width, 0);
            ctx.scale(-1, 1);
        }
        ctx.drawImage(video, 0, 0, width, height);
        ctx.restore();

        const gradient = ctx.createLinearGradient(0, height * 0.55, 0, height);
        gradient.addColorStop(0, 'rgba(4, 10, 20, 0)');
        gradient.addColorStop(1, 'rgba(4, 10, 20, .78)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, height * 0.55, width, height * 0.45);

        drawWatermark(ctx, width, height, geo);
        drawMapBox(ctx, width, height, geo, map);
    };

    paint(mapImage);

    try {
        return canvas.toDataURL('image/jpeg', 0.92);
    } catch (error) {
        paint(null);
        return canvas.toDataURL('image/jpeg', 0.92);
    }
}

async function captureCameraPhoto() {
    if (camera.busy) return;

    const video = $('#camera-video');
    if (!video || !video.videoWidth) {
        showCameraError('Kamera belum siap. Tunggu sebentar lalu coba lagi.');
        return;
    }

    camera.busy = true;
    const shutter = $('#camera-capture');
    if (shutter) shutter.disabled = true;
    clearCameraError();
    setCameraLoading('Memproses foto & lokasi\u2026');

    try {
        let geo = camera.geo;
        if (!geo && camera.geoPending) {
            geo = await Promise.race([camera.geoPending, sleep(4000).then(() => null)]);
        }

        const dataUrl = await composeCameraPhoto(video, geo);
        const dimensions = await imageDimensions(dataUrl);

        tempAttachment = {
            kind: 'image',
            dataUrl,
            name: 'Foto kamera',
            size: Math.round((dataUrl.length * 3) / 4),
            width: dimensions.width,
            height: dimensions.height
        };

        setDocType('camera');
        showAttachment();
        closeCameraModal();
        toast('Foto kamera berhasil dilampirkan.');
    } catch (error) {
        console.error(error);
        hideCameraLoading();
        showCameraError(`Gagal mengambil foto: ${error.message || 'kesalahan tidak diketahui'}.`);
    } finally {
        camera.busy = false;
        if (shutter) shutter.disabled = false;
    }
}

function imageDimensions(src) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
        img.onerror = () => resolve({ width: 0, height: 0 });
        img.src = src;
    });
}

/* =========================================================
   Ekspor PDF & cetak
   ========================================================= */

async function waitForImages(root) {
    const images = $$('img', root);
    await Promise.all(images.map((img) => {
        if (img.complete && img.naturalWidth) {
            return typeof img.decode === 'function' ? img.decode().catch(() => {}) : Promise.resolve();
        }
        return new Promise((resolve) => {
            img.addEventListener('load', resolve, { once: true });
            img.addEventListener('error', resolve, { once: true });
        });
    }));
}

function setExportProgress(done, total) {
    const status = $('#export-status');
    const bar = $('#export-progress');
    if (status) status.textContent = done >= total ? 'Menyimpan berkas PDF\u2026' : `Merender halaman ${done + 1} dari ${total}\u2026`;
    if (bar) bar.style.width = `${Math.round((done / Math.max(total, 1)) * 100)}%`;
}

function sanitizeFileName(value) {
    return String(value || '')
        .replace(/[\\/:*?"<>|]+/g, '-')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120) || 'Laporan Kinerja Harian';
}

async function exportToPdf() {
    if (!window.html2canvas || !window.jspdf || !window.jspdf.jsPDF) {
        toast('Pustaka PDF tidak tersedia. Gunakan tombol Cetak sebagai alternatif.', 'error', 6500);
        return;
    }

    const host = $('#document-pages');
    const stage = $('#preview-stage');
    const viewport = $('#preview-viewport');
    const overlay = $('#export-overlay');

    renderDocument();
    overlay.hidden = false;
    setExportProgress(0, 1);

    const previousScale = stage.style.getPropertyValue('--s');
    const previousScroll = viewport ? viewport.scrollTop : 0;

    try {
        if (document.fonts && document.fonts.ready) await document.fonts.ready;
        await waitForImages(host);
        await nextFrame();

        stage.style.setProperty('--s', '1');
        stage.classList.add('is-exporting');
        await nextFrame();

        const pages = $$('.page', host);
        if (!pages.length) throw new Error('Dokumen belum siap.');

        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });

        for (let index = 0; index < pages.length; index += 1) {
            setExportProgress(index, pages.length);
            await nextFrame();

            const canvas = await window.html2canvas(pages[index], {
                scale: 2,
                backgroundColor: '#ffffff',
                useCORS: true,
                logging: false,
                imageTimeout: 15000
            });

            const imageData = canvas.toDataURL('image/jpeg', 0.94);
            if (index > 0) pdf.addPage('a4', 'portrait');
            pdf.addImage(imageData, 'JPEG', 0, 0, 210, 297, undefined, 'FAST');

            setExportProgress(index + 1, pages.length);
            await nextFrame();
        }

        const meta = documentMeta();
        const filename = sanitizeFileName(`Laporan Kinerja Harian - ${meta.nama === '-' ? 'Pegawai' : meta.nama} - ${meta.tanggal}`);
        pdf.save(`${filename}.pdf`);

        toast(`PDF berhasil dibuat (${pages.length} halaman).`);
    } catch (error) {
        console.error('PDF export error:', error);
        toast('Gagal membuat PDF. Coba tombol Cetak lalu pilih "Simpan sebagai PDF".', 'error', 7000);
    } finally {
        stage.classList.remove('is-exporting');
        stage.style.setProperty('--s', previousScale || String(fitScale()));
        if (viewport) viewport.scrollTop = previousScroll;
        overlay.hidden = true;
        setExportProgress(0, 1);
        applyScale();
    }
}

/* =========================================================
   Reset
   ========================================================= */

async function resetAllData() {
    const confirmed = await askConfirm({
        title: 'Reset seluruh data laporan?',
        message: 'Nama, NIP, jabatan, tanda tangan, dan seluruh daftar kegiatan akan dikosongkan. Tindakan ini tidak dapat dibatalkan.',
        confirmLabel: 'Ya, reset data'
    });
    if (!confirmed) return;

    state = blankState();
    editingId = null;
    zoomFactor = 0;
    syncIdentityInputs();
    renderSignature();
    resetActivityForm();
    renderAll();
    scheduleSave(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    toast('Data laporan telah direset.', 'info');
}

/* =========================================================
   Event binding
   ========================================================= */

function bindEvents() {
    bindIdentityField('in-nama', 'nama');
    bindIdentityField('in-nip', 'nip', { digits: true });
    bindIdentityField('in-pangkat', 'pangkat');
    bindIdentityField('in-jabatan', 'jabatan');
    bindIdentityField('in-tanggal', 'tanggal');
    bindIdentityField('in-tempat', 'tempat');

    $('#sig-pick').addEventListener('click', () => $('#sig-file').click());
    $('#sig-replace').addEventListener('click', () => $('#sig-file').click());
    $('#sig-file').addEventListener('change', (event) => {
        const file = event.target.files && event.target.files[0];
        if (file) handleSignatureFile(file);
    });
    $('#sig-remove').addEventListener('click', removeSignature);

    $$('input[name="doc-type"]').forEach((radio) => {
        radio.addEventListener('change', () => {
            clearAttachment();
            setDocType(radio.value);
        });
    });

    $('#photo-file').addEventListener('change', (event) => {
        const file = event.target.files && event.target.files[0];
        if (file) handlePhotoFile(file);
    });

    $('#doc-file').addEventListener('change', (event) => {
        const file = event.target.files && event.target.files[0];
        if (file) handleDocumentFile(file);
    });

    $$('.dropzone').forEach((zone) => {
        const kind = zone.dataset.dropzone;
        const input = kind === 'photo' ? $('#photo-file') : $('#doc-file');

        zone.addEventListener('click', (event) => {
            if (!input || event.target === input) return;
            input.click();
        });
        zone.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                if (input) input.click();
            }
        });

        ['dragenter', 'dragover'].forEach((type) => {
            zone.addEventListener(type, (event) => {
                event.preventDefault();
                zone.classList.add('is-dragover');
            });
        });
        ['dragleave', 'dragend', 'drop'].forEach((type) => {
            zone.addEventListener(type, (event) => {
                event.preventDefault();
                zone.classList.remove('is-dragover');
            });
        });
        zone.addEventListener('drop', (event) => {
            const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
            if (!file) return;
            if (kind === 'photo') handlePhotoFile(file);
            else handleDocumentFile(file);
        });
    });

    $('#attach-remove').addEventListener('click', () => clearAttachment());

    $('#act-deskripsi').addEventListener('input', () => {
        updateCharCount();
        if ($('#act-deskripsi').value.trim()) {
            $('#act-deskripsi').classList.remove('is-invalid');
            clearFormError();
        }
    });

    ['act-mulai', 'act-selesai'].forEach((id) => {
        document.getElementById(id).addEventListener('input', () => {
            clearTimeError();
        });
    });

    $('#activity-form').addEventListener('submit', handleActivitySubmit);
    $('#btn-cancel-edit').addEventListener('click', () => {
        resetActivityForm();
        renderActivityList();
        toast('Mode ubah dibatalkan.', 'info', 2600);
    });

    $('#activity-list').addEventListener('click', (event) => {
        const button = event.target.closest('button[data-action]');
        if (!button || button.disabled) return;
        const item = button.closest('.activity-item');
        const id = item && item.dataset.id;
        if (!id) return;

        const action = button.dataset.action;
        if (action === 'edit') startEditActivity(id);
        else if (action === 'delete') deleteActivity(id);
        else if (action === 'up') moveActivity(id, -1);
        else if (action === 'down') moveActivity(id, 1);
    });

    $('#btn-reset').addEventListener('click', resetAllData);
    $('#btn-export').addEventListener('click', exportToPdf);
    $('#btn-print').addEventListener('click', () => window.print());

    $('#zoom-in').addEventListener('click', () => {
        const current = zoomFactor || fitScale();
        zoomFactor = clamp(Number((current + 0.1).toFixed(2)), 0.4, 1.6);
        applyScale();
    });
    $('#zoom-out').addEventListener('click', () => {
        const current = zoomFactor || fitScale();
        zoomFactor = clamp(Number((current - 0.1).toFixed(2)), 0.4, 1.6);
        applyScale();
    });
    $('#zoom-fit').addEventListener('click', () => {
        zoomFactor = 0;
        applyScale();
    });

    $('#btn-open-camera').addEventListener('click', openCameraModal);
    $('#camera-close').addEventListener('click', closeCameraModal);
    $('#camera-switch').addEventListener('click', () => {
        camera.facing = camera.facing === 'user' ? 'environment' : 'user';
        startCameraStream();
        detectLocation();
    });
    $('#camera-capture').addEventListener('click', captureCameraPhoto);

    const modal = $('#camera-modal');
    modal.addEventListener('click', (event) => {
        if (event.target === modal) closeCameraModal();
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !modal.hidden) closeCameraModal();
    });

    const viewport = $('#preview-viewport');
    if (typeof ResizeObserver === 'function' && viewport) {
        new ResizeObserver(() => {
            if (!zoomFactor) applyScale();
        }).observe(viewport);
    }
    window.addEventListener('resize', () => {
        if (!zoomFactor) applyScale();
    });

    window.addEventListener('pagehide', () => {
        if (camera.stream) stopCameraStream();
        persistNow();
    });

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') persistNow();
        else refreshAutoDate();
    });

    window.addEventListener('focus', refreshAutoDate);
    setInterval(refreshAutoDate, 60000);
}

/* =========================================================
   Inisialisasi
   ========================================================= */

function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (!/^https?:$/.test(location.protocol)) return;
    if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) return;

    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch((error) => {
            console.warn('Service worker tidak dapat didaftarkan:', error);
        });
    });
}

function init() {
    syncIdentityInputs();
    renderSignature();
    updateCharCount();
    setDocType('photo');
    renderActivityList();
    renderDocument();
    applyScale();
    bindEvents();
    setSaveState('saved');
    registerServiceWorker();

    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => renderDocument()).catch(() => {});
    }

    // Render ulang sekali setelah aset gambar selesai dimuat agar paginasi stabil.
    setTimeout(() => renderDocument(), 500);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
