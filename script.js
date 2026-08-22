        // Data utama selalu berasal dari API/database. Tidak ada lagi data akun,
        // ulasan, atau like yang dianggap tersimpan hanya karena ada di browser.
        let pinjolData = [];
        let searchTimer = null;

        const defaultSettings = {
            siteName: 'CekPinjol.id',
            heroTitle: 'Jangan Asal Pinjam! Cek Legalitas Pinjol Di Sini.',
            heroSubtitle: 'Lindungi data pribadi dan finansial Anda. Selalu cocokkan informasi dengan publikasi resmi OJK sebelum mengambil keputusan.',
            aboutDescription: 'Sistem informasi independen untuk membantu masyarakat memahami risiko pinjaman online.',
            footerText: 'Informasi pada situs ini bersifat edukatif dan harus diverifikasi kembali melalui kanal resmi OJK.',
            announcement: 'Data awal pada versi pengembangan ini adalah data contoh dan bukan rujukan legalitas resmi.',
            disclaimer: 'Informasi pada situs ini bukan nasihat keuangan. Verifikasi legalitas melalui sumber resmi.'
        };

        // --- GLOBAL STATE ---
        let state = {
            currentPage: 'Beranda',
            searchQuery: '',
            filterStatus: 'Semua',
            sortBy: 'Paling Banyak Disukai',
            selectedCompanyId: null,
            isMobileMenuOpen: false,
            currentUser: null,
            csrfToken: null,
            settings: { ...defaultSettings },
            isLoading: true,
            loadError: '',
            modalType: null,
            authMode: 'login',
            csrfPromise: null
        };

        function escapeHtml(value) {
            return String(value ?? '')
                .replaceAll('&', '&amp;')
                .replaceAll('<', '&lt;')
                .replaceAll('>', '&gt;')
                .replaceAll('"', '&quot;')
                .replaceAll("'", '&#039;');
        }

        function safeImageUrl(value) {
            if (!value) return 'https://placehold.co/600x400/e2e8f0/64748b?text=Tanpa+Gambar';
            try {
                const url = new URL(String(value), window.location.origin);
                if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Skema URL tidak aman');
                return escapeHtml(url.href);
            } catch (_) {
                return 'https://placehold.co/600x400/e2e8f0/64748b?text=Tanpa+Gambar';
            }
        }

        function safeLinkUrl(value) {
            if (!value) return '';
            try {
                const url = new URL(String(value), window.location.origin);
                if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Skema URL tidak aman');
                return escapeHtml(url.href);
            } catch (_) {
                return '';
            }
        }

        function getPayloadData(payload) {
            if (payload && Object.prototype.hasOwnProperty.call(payload, 'data')) return payload.data;
            return payload;
        }

        function formatDate(value) {
            if (!value) return 'Belum dicatat';
            const date = new Date(value);
            return Number.isNaN(date.getTime())
                ? String(value)
                : new Intl.DateTimeFormat('id-ID', { dateStyle: 'long' }).format(date);
        }

        async function ensureCsrfToken() {
            if (state.csrfToken) return state.csrfToken;
            if (state.csrfPromise) return state.csrfPromise;
            state.csrfPromise = (async () => {
                const response = await fetch('/api/csrf', {
                    method: 'GET',
                    headers: { Accept: 'application/json' },
                    credentials: 'same-origin',
                    cache: 'no-store'
                });
                const payload = await response.json().catch(() => null);
                if (!response.ok || !payload?.csrfToken) {
                    throw new Error(payload?.error?.message || 'Token keamanan tidak dapat dimuat.');
                }
                state.csrfToken = payload.csrfToken;
                return state.csrfToken;
            })().finally(() => {
                state.csrfPromise = null;
            });
            return state.csrfPromise;
        }

        async function apiFetch(path, options = {}) {
            const method = (options.method || 'GET').toUpperCase();
            const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(method);
            if (mutating && !state.csrfToken) await ensureCsrfToken();
            const headers = { Accept: 'application/json', ...(options.headers || {}) };
            let body = options.body;

            if (body && !(body instanceof FormData) && typeof body !== 'string') {
                headers['Content-Type'] = 'application/json';
                body = JSON.stringify(body);
            }
            if (mutating && state.csrfToken) {
                headers['X-CSRF-Token'] = state.csrfToken;
            }

            const response = await fetch(path, {
                ...options,
                method,
                headers,
                body,
                credentials: 'same-origin',
                cache: 'no-store'
            });
            const contentType = response.headers.get('content-type') || '';
            const payload = contentType.includes('application/json') ? await response.json() : null;

            if (!response.ok) {
                const errorCode = payload?.error?.code || payload?.code || '';
                const sessionEnded = response.status === 401 && errorCode === 'AUTH_REQUIRED';
                const accountBlocked = response.status === 423;
                if ((sessionEnded || accountBlocked) && !path.includes('/auth/login')) {
                    state.currentUser = null;
                    state.csrfToken = null;
                    updateAccountButtons();
                }
                const error = new Error(payload?.error?.message || payload?.message || 'Permintaan tidak dapat diproses.');
                error.status = response.status;
                error.code = errorCode;
                error.fields = payload?.error?.fields || payload?.fields || null;
                throw error;
            }
            return getPayloadData(payload);
        }

        function normalizeCompany(company) {
            return {
                ...company,
                id: Number(company.id),
                rating: Number(company.rating || 0),
                likes: Number(company.likes || 0),
                unlikes: Number(company.unlikes || 0),
                trustLevel: Number(company.trustLevel || 0),
                reviews: Array.isArray(company.reviews) ? company.reviews : []
            };
        }

        function showToast(message, type = 'success') {
            let container = document.getElementById('toast-container');
            if (!container) {
                container = document.createElement('div');
                container.id = 'toast-container';
                container.setAttribute('aria-live', 'polite');
                document.body.appendChild(container);
            }
            const toast = document.createElement('div');
            toast.className = `app-toast app-toast-${type}`;
            toast.textContent = message;
            container.appendChild(toast);
            window.setTimeout(() => toast.remove(), 4000);
        }

        // --- FILTER & SORT LOGIC ---
        function getFilteredAndSortedData() {
            let result = [...pinjolData];

            if (state.filterStatus !== "Semua") {
                result = result.filter(item => item.status === state.filterStatus);
            }

            if (state.searchQuery) {
                const lowerQuery = state.searchQuery.toLowerCase();
                result = result.filter(item => 
                    item.name.toLowerCase().includes(lowerQuery) || 
                    item.description.toLowerCase().includes(lowerQuery)
                );
            }

            result.sort((a, b) => {
                if (state.sortBy === "Rating Tertinggi") return b.rating - a.rating;
                if (state.sortBy === "Paling Banyak Disukai") return b.likes - a.likes;
                return 0;
            });

            return result;
        }

        // --- INTERACTION HANDLERS ---
        function setPage(page) {
            state.currentPage = page;
            
            // Update Desktop Nav Styling
            document.querySelectorAll('.nav-btn').forEach(btn => {
                if (btn.dataset.page === page) {
                    btn.className = "nav-btn px-3 py-5 font-semibold transition-colors border-b-2 text-blue-900 border-blue-900";
                } else {
                    btn.className = "nav-btn px-3 py-5 font-semibold transition-colors border-b-2 text-slate-500 border-transparent hover:text-blue-900 hover:border-blue-200";
                }
            });

            // Update Mobile Nav Styling
            document.querySelectorAll('.nav-btn-mobile').forEach(btn => {
                if (btn.dataset.page === page) {
                    btn.className = "nav-btn-mobile block w-full text-left px-3 py-3 rounded-md text-base font-medium text-blue-900 bg-blue-50";
                } else {
                    btn.className = "nav-btn-mobile block w-full text-left px-3 py-3 rounded-md text-base font-medium text-slate-600 hover:text-blue-900 hover:bg-slate-50";
                }
            });

            renderMain();
        }

        function handleSearch(val) {
            // Sync inputs
            ['desktop-search', 'mobile-search', 'directory-search'].forEach(id => {
                const input = document.getElementById(id);
                if (input && input.value !== val) input.value = val;
            });

            window.clearTimeout(searchTimer);
            searchTimer = window.setTimeout(() => {
                state.searchQuery = val;
                if (state.currentPage !== 'Daftar' && val !== "") {
                    setPage('Daftar');
                } else {
                    renderMain();
                }
            }, 160);
        }

        function setFilter(status) {
            state.filterStatus = status;
            renderMain();
        }

        function setSort(val) {
            state.sortBy = val;
            renderMain();
        }

        function toggleMobileMenu() {
            state.isMobileMenuOpen = !state.isMobileMenuOpen;
            const menu = document.getElementById('mobile-menu');
            const btn = document.getElementById('mobile-menu-btn');
            
            if (state.isMobileMenuOpen) {
                menu.classList.remove('hidden');
                btn.innerHTML = `<i data-lucide="x" class="w-6 h-6"></i>`;
            } else {
                menu.classList.add('hidden');
                btn.innerHTML = `<i data-lucide="menu" class="w-6 h-6"></i>`;
            }
            lucide.createIcons();
        }

        async function openModal(id) {
            state.selectedCompanyId = Number(id);
            state.modalType = 'company';
            document.body.style.overflow = 'hidden';
            renderModal();
            try {
                const detail = normalizeCompany(await apiFetch(`/api/companies/${Number(id)}`));
                const index = pinjolData.findIndex(item => item.id === detail.id);
                if (index >= 0) pinjolData[index] = { ...pinjolData[index], ...detail };
                else pinjolData.push(detail);
                renderModal();
            } catch (error) {
                showToast(error.message, 'error');
            }
        }

        function closeModal() {
            state.selectedCompanyId = null;
            state.modalType = null;
            document.body.style.overflow = 'unset';
            renderModal();
        }

        function requireLogin(message = 'Silakan masuk untuk menggunakan fitur ini.') {
            if (state.currentUser) return true;
            showToast(message, 'error');
            openAuthModal('login');
            return false;
        }

        async function submitCompanyReaction(event, id, action) {
            event.stopPropagation();
            if (!requireLogin('Silakan masuk untuk menyukai atau unlike aplikasi.')) return;
            const button = event.currentTarget;
            button.classList.add('pointer-events-none', 'opacity-60');
            try {
                const result = await apiFetch(`/api/companies/${Number(id)}/like`, {
                    method: 'POST',
                    body: { action }
                });
                const company = pinjolData.find(item => item.id === Number(id));
                if (company) {
                    company.hasLiked = Boolean(result?.hasLiked ?? result?.liked);
                    company.hasUnliked = Boolean(result?.hasUnliked);
                    if (Number.isFinite(Number(result?.likes))) company.likes = Number(result.likes);
                    if (Number.isFinite(Number(result?.unlikes))) company.unlikes = Number(result.unlikes);
                }
                updateCompanyReaction(Number(id), company);
            } catch (error) {
                showToast(error.message, 'error');
            } finally {
                button.classList.remove('pointer-events-none', 'opacity-60');
            }
        }

        function setCompanyLike(event, id) {
            return submitCompanyReaction(event, id, 'like');
        }

        function setCompanyUnlike(event, id) {
            return submitCompanyReaction(event, id, 'unlike');
        }

        function updateCompanyReaction(id, company) {
            document.querySelectorAll(`[data-company-reaction-id="${id}"]`).forEach((button) => {
                const action = button.dataset.action;
                const active = action === 'like' ? company.hasLiked : company.hasUnliked;
                button.setAttribute('aria-pressed', String(active));
                button.classList.toggle('text-blue-600', action === 'like' && active);
                button.classList.toggle('text-red-600', action === 'unlike' && active);
                button.classList.toggle('text-slate-400', !active);
                const icon = button.querySelector('[data-reaction-icon]');
                if (icon) icon.classList.toggle('fill-current', active);
                const count = button.querySelector('[data-reaction-count]');
                if (count) count.textContent = Number(action === 'like' ? company.likes : company.unlikes).toLocaleString('id-ID');
            });
        }

        async function submitLaporan(event) {
            event.preventDefault();
            const form = event.currentTarget;
            const button = document.getElementById('btn-submit-laporan');
            const originalContent = button.innerHTML;
            const formData = new FormData(form);
            button.disabled = true;
            button.innerHTML = `<i data-lucide="loader-2" class="w-5 h-5 animate-spin"></i> Mengirim...`;
            lucide.createIcons();
            try {
                await apiFetch('/api/reports', {
                    method: 'POST',
                    body: {
                        reporterName: formData.get('fullName'),
                        reporterEmail: formData.get('email'),
                        companyName: formData.get('appName'),
                        description: formData.get('description')
                    }
                });
                form.reset();
                showToast('Laporan tersimpan dan akan ditinjau admin.');
            } catch (error) {
                showToast(error.message, 'error');
            } finally {
                button.disabled = false;
                button.innerHTML = originalContent;
                lucide.createIcons();
            }
        }

        async function toggleReviewLike(event, reviewId) {
            event.stopPropagation();
            if (!requireLogin('Silakan masuk untuk menyukai ulasan.')) return;
            const button = event.currentTarget;
            button.classList.add('pointer-events-none', 'opacity-60');
            try {
                const result = await apiFetch(`/api/reviews/${Number(reviewId)}/like`, { method: 'POST' });
                const company = pinjolData.find(item => item.id === state.selectedCompanyId);
                const review = company?.reviews.find(item => Number(item.id) === Number(reviewId));
                if (review) {
                    review.hasLiked = Boolean(result?.hasLiked ?? result?.liked);
                    if (Number.isFinite(Number(result?.likes))) review.likes = Number(result.likes);
                }
                renderModal();
            } catch (error) {
                showToast(error.message, 'error');
            } finally {
                button.classList.remove('pointer-events-none', 'opacity-60');
            }
        }

        // --- FITUR RATING BINTANG KLIK ---
        function setReviewRating(val) {
            document.getElementById('review-rating').value = val;
            const wrapper = document.getElementById('rating-stars-wrapper');
            if (wrapper) {
                const stars = wrapper.querySelectorAll('svg');
                stars.forEach((star, index) => {
                    if (index < val) {
                        star.classList.add('text-yellow-400', 'fill-current');
                        star.classList.remove('text-slate-300');
                    } else {
                        star.classList.remove('text-yellow-400', 'fill-current');
                        star.classList.add('text-slate-300');
                    }
                });
            }
        }

        async function submitComment(event, companyId) {
            event.preventDefault();
            if (!requireLogin('Silakan masuk sebelum mengirim ulasan.')) return;
            const button = event.currentTarget.querySelector('button[type="submit"]');
            const rating = Number(document.getElementById('review-rating').value);
            const comment = document.getElementById('review-text').value.trim();
            button.disabled = true;
            try {
                await apiFetch('/api/reviews', {
                    method: 'POST',
                    body: { companyId: Number(companyId), rating, comment }
                });
                showToast('Ulasan terkirim dan menunggu persetujuan admin.');
                document.getElementById('review-text').value = '';
                setReviewRating(5);
            } catch (error) {
                showToast(error.message, 'error');
            } finally {
                button.disabled = false;
            }
        }

        // --- RENDER FUNCTIONS ---
        function renderCard(company, extraClasses = '') {
            const isLegal = company.status === 'Legal';
            const badgeBg = isLegal ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700';
            const badgeIcon = isLegal ? 'shield-check' : 'alert-triangle';
            const badgeText = isLegal ? 'Legal · Perlu Verifikasi' : 'Status: Ilegal';
            const trustClass = company.trustLevel > 50 ? 'text-blue-600' : 'text-red-600';
            
            // Logika class jika user sudah melike
            const likeColorClass = company.hasLiked ? 'text-blue-600' : 'text-slate-500 hover:text-blue-600';
            const likeFillClass = company.hasLiked ? 'fill-current text-blue-600' : '';
            const unlikeFillClass = company.hasUnliked ? 'fill-current text-red-600' : '';
            const visitUrl = safeLinkUrl(company.sourceUrl);

            return `
                <div onclick="openModal(${company.id})" class="company-card bg-white rounded-2xl border border-slate-200 overflow-hidden hover:shadow-xl hover:-translate-y-1 transition-all duration-300 cursor-pointer group flex flex-col h-full text-left ${extraClasses}">
                    <div class="h-2 w-full ${isLegal ? 'bg-green-500' : 'bg-red-500'}"></div>
                    
                    <!-- Thumbnail Aplikasi (Diperkecil di Mobile) -->
                    <div class="relative h-28 md:h-40 w-full overflow-hidden bg-slate-100 border-b border-slate-100 shrink-0">
                        <img src="${safeImageUrl(company.imageUrl)}" alt="Aplikasi ${escapeHtml(company.name)}" width="600" height="400" loading="lazy" decoding="async" fetchpriority="low" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" onerror="this.src='https://placehold.co/600x400/e2e8f0/64748b?text=Tanpa+Gambar'">
                    </div>

                    <div class="p-4 md:p-6">
                        <div class="flex justify-between items-start mb-3 md:mb-4">
                            <span class="inline-flex items-center gap-1.5 px-2.5 md:px-3 py-1 rounded-full text-[10px] md:text-xs font-bold ${badgeBg}">
                                <i data-lucide="${badgeIcon}" class="w-3 h-3 md:w-3.5 md:h-3.5"></i> ${badgeText}
                            </span>
                        </div>
                        <h3 class="text-lg md:text-xl font-bold text-slate-800 mb-1 group-hover:text-blue-600 transition-colors">
                            ${escapeHtml(company.name)}
                        </h3>
                        <div class="flex items-center gap-2 md:gap-4 mt-1 md:mt-2">
                            <div class="flex items-center gap-1" title="Rating">
                                <i data-lucide="star" class="w-3.5 h-3.5 md:w-4 md:h-4 text-yellow-400 fill-current star-anim"></i>
                                <span class="font-bold text-xs md:text-sm text-slate-700">${Number(company.rating || 0).toFixed(1)}</span>
                            </div>
                            <!-- Tombol Like dan Unlike -->
                            <button type="button" data-company-reaction-id="${company.id}" data-action="like" aria-pressed="${Boolean(company.hasLiked)}" class="reaction-button flex items-center gap-1 md:gap-1.5 transition-all duration-200 active:scale-90 cursor-pointer ${company.hasLiked ? 'text-blue-600' : 'text-slate-400 hover:text-blue-600'}" onclick="setCompanyLike(event, ${company.id})" title="Sukai aplikasi">
                                <i data-lucide="thumbs-up" data-reaction-icon class="w-3.5 h-3.5 md:w-4 md:h-4 transition-colors ${company.hasLiked ? likeFillClass : ''}"></i>
                                <span data-reaction-count class="text-xs md:text-sm font-medium">${Number(company.likes || 0).toLocaleString('id-ID')}</span>
                            </button>
                            <button type="button" data-company-reaction-id="${company.id}" data-action="unlike" aria-pressed="${Boolean(company.hasUnliked)}" class="reaction-button flex items-center gap-1 md:gap-1.5 transition-all duration-200 active:scale-90 cursor-pointer ${company.hasUnliked ? 'text-red-600' : 'text-slate-400 hover:text-red-600'}" onclick="setCompanyUnlike(event, ${company.id})" title="Unlike aplikasi">
                                <i data-lucide="thumbs-down" data-reaction-icon class="w-3.5 h-3.5 md:w-4 md:h-4 ${unlikeFillClass}"></i>
                                <span data-reaction-count class="text-xs md:text-sm font-medium">${Number(company.unlikes || 0).toLocaleString('id-ID')}</span>
                            </button>
                            <div class="ml-auto">
                                <span class="text-[10px] md:text-xs font-bold px-1.5 md:px-2 py-0.5 md:py-1 rounded bg-slate-100 ${trustClass}">
                                    ${Number(company.trustLevel || 0)}% Trust
                                </span>
                            </div>
                        </div>
                        ${visitUrl ? `<a href="${visitUrl}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()" class="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-blue-700"><i data-lucide="external-link" class="w-4 h-4"></i> Kunjungi</a>` : ''}
                    </div>
                </div>
            `;
        }

        function renderBeranda() {
            const topPinjol = pinjolData
                .filter(item => item.status === 'Legal')
                .sort((a, b) => Number(b.trustLevel) - Number(a.trustLevel))
                .slice(0, 3)
                .map(item => renderCard(item, ''))
                .join('');
            
            return `
                <div class="fade-in">
                    <div class="bg-blue-900 text-white pt-16 pb-20 px-4 sm:px-6 lg:px-8 relative overflow-hidden mt-[-1px]">
                        <div class="absolute top-0 right-0 -translate-y-12 translate-x-1/3 opacity-10">
                            <i data-lucide="shield-check" class="w-96 h-96"></i>
                        </div>
                        <div class="max-w-4xl mx-auto text-center relative z-10">
                            <h1 class="text-3xl md:text-5xl font-extrabold tracking-tight mb-6">
                                ${escapeHtml(state.settings.heroTitle)}
                            </h1>
                            <p class="text-lg md:text-xl text-blue-100 max-w-2xl mx-auto leading-relaxed mb-8">
                                ${escapeHtml(state.settings.heroSubtitle)}
                            </p>
                            <div class="flex flex-col sm:flex-row justify-center gap-4">
                                <button onclick="setPage('Daftar')" class="bg-white text-blue-900 px-6 py-3 rounded-full font-bold shadow-lg hover:bg-blue-50 transition-all hover:-translate-y-0.5">
                                    Lihat Daftar Pinjol
                                </button>
                                <button onclick="setPage('Edukasi')" class="bg-transparent border border-blue-200 text-white px-6 py-3 rounded-full font-semibold hover:bg-blue-800 transition-all">
                                    Pelajari Ciri Ilegal
                                </button>
                            </div>
                        </div>
                    </div>
                    
                    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 md:py-16 overflow-hidden">
                        <div class="text-center mb-8 md:mb-10">
                            <h2 class="text-2xl md:text-3xl font-bold text-slate-800 mb-2 md:mb-3">Data Berstatus Legal</h2>
                            <p class="text-sm md:text-base text-slate-500">Diurutkan berdasarkan skor kepercayaan. Tetap periksa sumber verifikasi sebelum menggunakan layanan.</p>
                        </div>
                        
                        <!-- Container Grid 2 Kolom untuk Mobile, 3 Kolom untuk Desktop -->
                        <div class="grid grid-cols-2 gap-4 md:grid-cols-3 -mx-4 px-4 sm:mx-0 sm:px-0">
                            ${topPinjol}
                        </div>

                        <div class="text-center mt-6 md:mt-10">
                            <button onclick="setPage('Daftar')" class="text-blue-600 font-semibold hover:text-blue-800 flex items-center gap-2 mx-auto transition-all hover:translate-x-1 text-sm md:text-base">
                                Lihat Semua Daftar <i data-lucide="arrow-right" class="w-4 h-4"></i>
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }

        function renderDaftar() {
            const data = getFilteredAndSortedData();
            const cardsHtml = data.length > 0 
                ? `<div class="grid grid-cols-1 tablet:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">${data.map(renderCard).join('')}</div>`
                : `<div class="text-center py-20 bg-white rounded-2xl border border-slate-200">
                     <i data-lucide="search" class="w-12 h-12 text-slate-300 mx-auto mb-4"></i>
                     <h3 class="text-lg font-bold text-slate-700 mb-1">Tidak ditemukan</h3>
                     <p class="text-slate-500">Kami tidak dapat menemukan pinjol dengan kata kunci tersebut.</p>
                   </div>`;

            const btnSemua = state.filterStatus === 'Semua' ? 'bg-white text-blue-900 shadow-sm ring-1 ring-slate-200' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50';
            const btnLegal = state.filterStatus === 'Legal' ? 'bg-white text-blue-900 shadow-sm ring-1 ring-slate-200' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50';
            const btnIlegal = state.filterStatus === 'Ilegal' ? 'bg-white text-blue-900 shadow-sm ring-1 ring-slate-200' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50';

            return `
                <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 fade-in">
                    <div class="mb-8">
                        <h1 class="text-3xl font-bold text-slate-800 mb-2">Direktori Pinjaman Online</h1>
                        <p class="text-slate-500">Gunakan filter untuk mencari platform yang sesuai dengan kebutuhan dan keamanan Anda.</p>
                        <div class="relative mt-4 md:hidden">
                            <input id="directory-search" value="${escapeHtml(state.searchQuery)}" oninput="handleSearch(this.value)" type="search" aria-label="Cari nama aplikasi" placeholder="Cari nama aplikasi..." class="w-full pl-10 pr-4 py-3 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500">
                            <i data-lucide="search" class="w-5 h-5 text-slate-400 absolute left-3 top-3"></i>
                        </div>
                    </div>

                    <div class="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 mb-8 flex flex-col md:flex-row justify-between items-center gap-4">
                        <div class="flex bg-slate-100 p-1 rounded-lg w-full md:w-auto">
                            <button onclick="setFilter('Semua')" class="flex-1 md:flex-none px-6 py-2 rounded-md text-sm font-medium transition-all ${btnSemua}">Semua</button>
                            <button onclick="setFilter('Legal')" class="flex-1 md:flex-none px-6 py-2 rounded-md text-sm font-medium transition-all ${btnLegal}">Legal</button>
                            <button onclick="setFilter('Ilegal')" class="flex-1 md:flex-none px-6 py-2 rounded-md text-sm font-medium transition-all ${btnIlegal}">Ilegal</button>
                        </div>
                        <div class="flex items-center gap-3 w-full md:w-auto">
                            <span class="text-sm text-slate-500 font-medium whitespace-nowrap">Urutkan:</span>
                            <div class="relative w-full md:w-56">
                                <select onchange="setSort(this.value)" class="w-full appearance-none bg-white border border-slate-300 text-slate-700 py-2 pl-4 pr-10 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm font-medium cursor-pointer">
                                    <option ${state.sortBy === 'Paling Banyak Disukai' ? 'selected' : ''}>Paling Banyak Disukai</option>
                                    <option ${state.sortBy === 'Rating Tertinggi' ? 'selected' : ''}>Rating Tertinggi</option>
                                </select>
                                <i data-lucide="chevron-down" class="w-4 h-4 text-slate-500 absolute right-3 top-2.5 pointer-events-none"></i>
                            </div>
                        </div>
                    </div>
                    ${cardsHtml}
                </div>
            `;
        }

        function renderEdukasi() {
            return `
                <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 fade-in">
                    <div class="text-center max-w-2xl mx-auto mb-12">
                        <h1 class="text-3xl font-bold text-slate-800 mb-4">Pusat Edukasi Finansial</h1>
                        <p class="text-slate-600">Pahami risikonya sebelum Anda meminjam. Jangan sampai terjebak dalam lingkaran hutang yang merugikan Anda dan keluarga.</p>
                    </div>
                    <div class="grid md:grid-cols-2 gap-8 mb-12">
                        <div class="bg-red-50 border border-red-100 rounded-2xl p-8 hover:-translate-y-1 transition-transform">
                            <div class="w-12 h-12 bg-red-100 text-red-600 rounded-full flex items-center justify-center mb-6">
                                <i data-lucide="alert-triangle" class="w-6 h-6"></i>
                            </div>
                            <h3 class="text-xl font-bold text-red-900 mb-4">Ciri-Ciri Pinjol Ilegal</h3>
                            <ul class="space-y-3">
                                <li class="flex gap-3 text-red-800"><i data-lucide="x" class="w-5 h-5 flex-shrink-0 mt-0.5"></i> <span>Tidak memiliki izin resmi dari OJK.</span></li>
                                <li class="flex gap-3 text-red-800"><i data-lucide="x" class="w-5 h-5 flex-shrink-0 mt-0.5"></i> <span>Suku bunga dan denda sangat tinggi & tidak transparan.</span></li>
                                <li class="flex gap-3 text-red-800"><i data-lucide="x" class="w-5 h-5 flex-shrink-0 mt-0.5"></i> <span>Meminta akses ke seluruh data HP (Kontak, Galeri, Lokasi).</span></li>
                                <li class="flex gap-3 text-red-800"><i data-lucide="x" class="w-5 h-5 flex-shrink-0 mt-0.5"></i> <span>Penawaran dilakukan melalui SMS atau WhatsApp pribadi.</span></li>
                                <li class="flex gap-3 text-red-800"><i data-lucide="x" class="w-5 h-5 flex-shrink-0 mt-0.5"></i> <span>Melakukan penagihan kasar, ancaman, dan penyebaran data.</span></li>
                            </ul>
                        </div>
                        <div class="bg-green-50 border border-green-100 rounded-2xl p-8 hover:-translate-y-1 transition-transform">
                            <div class="w-12 h-12 bg-green-100 text-green-600 rounded-full flex items-center justify-center mb-6">
                                <i data-lucide="shield-check" class="w-6 h-6"></i>
                            </div>
                            <h3 class="text-xl font-bold text-green-900 mb-4">Tips Aman Meminjam</h3>
                            <ul class="space-y-3">
                                <li class="flex gap-3 text-green-800"><i data-lucide="check-circle" class="w-5 h-5 flex-shrink-0 mt-0.5"></i> <span>Cek legalitas platform di website OJK atau CekPinjol.id.</span></li>
                                <li class="flex gap-3 text-green-800"><i data-lucide="check-circle" class="w-5 h-5 flex-shrink-0 mt-0.5"></i> <span>Pinjam hanya untuk kebutuhan produktif atau mendesak.</span></li>
                                <li class="flex gap-3 text-green-800"><i data-lucide="check-circle" class="w-5 h-5 flex-shrink-0 mt-0.5"></i> <span>Cicilan maksimal 30% dari total pendapatan bulanan.</span></li>
                                <li class="flex gap-3 text-green-800"><i data-lucide="check-circle" class="w-5 h-5 flex-shrink-0 mt-0.5"></i> <span>Baca syarat & ketentuan dengan teliti sebelum setuju.</span></li>
                                <li class="flex gap-3 text-green-800"><i data-lucide="check-circle" class="w-5 h-5 flex-shrink-0 mt-0.5"></i> <span>Pahami rincian bunga, denda, dan biaya admin.</span></li>
                            </ul>
                        </div>
                    </div>
                    <div class="bg-blue-900 text-white rounded-2xl p-8 md:p-12 text-center">
                        <h3 class="text-2xl font-bold mb-4">Terjerat Pinjol Ilegal? Jangan Panik!</h3>
                        <p class="text-blue-100 mb-8 max-w-2xl mx-auto">Segera blokir nomor penagih yang mengancam, laporkan ke Satgas Waspada Investasi (SWI), dan lapor polisi jika ada ancaman kekerasan atau penyebaran data pribadi.</p>
                        <a href="tel:157" class="inline-block bg-white text-blue-900 px-8 py-3 rounded-full font-bold shadow-lg hover:bg-slate-100 transition-all hover:scale-105">
                            Hubungi Layanan Pengaduan OJK (157)
                        </a>
                    </div>
                </div>
            `;
        }

        function renderTentang() {
            return `
                <div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12 fade-in">
                    <div class="text-center mb-12">
                        <h1 class="text-3xl font-bold text-slate-800 mb-4">Tentang ${escapeHtml(state.settings.siteName)}</h1>
                        <p class="text-slate-600 text-lg">${escapeHtml(state.settings.aboutDescription)}</p>
                    </div>
                    <div class="grid sm:grid-cols-3 gap-6 mb-12">
                        <div class="bg-white p-6 rounded-2xl border border-slate-200 text-center hover:border-blue-300 transition-colors">
                            <i data-lucide="target" class="w-10 h-10 text-blue-500 mx-auto mb-4"></i>
                            <h3 class="font-bold text-slate-800 mb-2">Visi Kami</h3>
                            <p class="text-sm text-slate-500">Memberantas kejahatan finansial digital dan pinjol ilegal melalui informasi publik.</p>
                        </div>
                        <div class="bg-white p-6 rounded-2xl border border-slate-200 text-center hover:border-green-300 transition-colors">
                            <i data-lucide="book-open" class="w-10 h-10 text-green-500 mx-auto mb-4"></i>
                            <h3 class="font-bold text-slate-800 mb-2">Data Terpercaya</h3>
                            <p class="text-sm text-slate-500">Setiap entitas dapat dilengkapi sumber dan tanggal pemeriksaan oleh admin untuk diverifikasi pengguna.</p>
                        </div>
                        <div class="bg-white p-6 rounded-2xl border border-slate-200 text-center hover:border-purple-300 transition-colors">
                            <i data-lucide="users" class="w-10 h-10 text-purple-500 mx-auto mb-4"></i>
                            <h3 class="font-bold text-slate-800 mb-2">Komunitas</h3>
                            <p class="text-sm text-slate-500">Mewadahi ulasan jujur dari masyarakat agar orang lain tidak salah langkah.</p>
                        </div>
                    </div>
                    <div class="bg-white border border-slate-200 rounded-2xl p-8">
                        <h3 class="text-xl font-bold text-slate-800 mb-6 flex items-center gap-2">
                            <i data-lucide="phone-call" class="w-5 h-5 text-blue-600"></i> Hubungi Kami
                        </h3>
                        <p class="text-slate-600 mb-6">Jika Anda menemukan pinjol ilegal baru yang belum ada di database kami, mari bantu laporkan!</p>
                        <form id="form-laporan" class="space-y-4" onsubmit="submitLaporan(event)">
                            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <input type="text" name="fullName" maxlength="100" required autocomplete="name" value="${escapeHtml(state.currentUser?.name || '')}" aria-label="Nama lengkap" placeholder="Nama Lengkap" class="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 transition-colors" />
                                <input type="email" name="email" maxlength="254" required autocomplete="email" value="${escapeHtml(state.currentUser?.email || '')}" aria-label="Email" placeholder="Email Anda" class="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 transition-colors" />
                            </div>
                            <input type="text" name="appName" maxlength="150" required aria-label="Nama aplikasi pinjol" placeholder="Nama Aplikasi Pinjol yang Dilaporkan" class="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 transition-colors" />
                            <textarea name="description" maxlength="3000" required aria-label="Uraian laporan" placeholder="Ceritakan pengalaman atau bukti indikasi ilegal..." rows="4" class="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 transition-colors"></textarea>
                            
                            <!-- Tombol Submit Dinamis -->
                            <button id="btn-submit-laporan" type="submit" class="bg-blue-600 text-white px-6 py-3 rounded-lg font-bold hover:bg-blue-700 w-full md:w-auto flex items-center justify-center gap-2 transition-all">
                                <i data-lucide="send" class="w-5 h-5"></i> Kirim Laporan
                            </button>
                        </form>
                    </div>
                </div>
            `;
        }

        function openAuthModal(mode = 'login') {
            state.modalType = 'auth';
            state.authMode = state.currentUser ? 'profile' : mode;
            document.body.style.overflow = 'hidden';
            renderModal();
        }

        function setAuthMode(mode) {
            state.authMode = mode;
            renderModal();
        }

        function updateAccountButtons() {
            const label = state.currentUser ? state.currentUser.name : 'Masuk';
            document.querySelectorAll('[data-account-label]').forEach(element => {
                element.textContent = label;
            });
        }

        function redirectAdminToPanel() {
            if (state.currentUser?.role !== 'admin') return false;
            window.location.assign('/admin/');
            return true;
        }

        async function refreshAuth() {
            try {
                const result = await apiFetch('/api/auth/me');
                state.currentUser = result?.user ?? null;
                state.csrfToken = result?.csrfToken || result?.csrf || null;
            } catch (error) {
                if (error.status !== 401) console.warn('Status sesi tidak dapat dimuat:', error.message);
                state.currentUser = null;
                state.csrfToken = null;
            }
            updateAccountButtons();
        }

        async function submitAuth(event, mode) {
            event.preventDefault();
            const form = event.currentTarget;
            const button = form.querySelector('button[type="submit"]');
            const values = Object.fromEntries(new FormData(form).entries());
            if (mode === 'register' && values.password !== values.passwordConfirmation) {
                showToast('Konfirmasi password tidak sama.', 'error');
                return;
            }
            button.disabled = true;
            try {
                const result = await apiFetch(`/api/auth/${mode}`, {
                    method: 'POST',
                    body: mode === 'register'
                        ? { name: values.name, email: values.email, password: values.password }
                        : { email: values.email, password: values.password }
                });
                if (mode === 'register') {
                    state.csrfToken = result?.csrfToken || result?.csrf || null;
                    await apiFetch('/api/auth/logout', { method: 'POST' });
                    state.currentUser = null;
                    state.csrfToken = null;
                    state.authMode = 'login';
                    renderModal();
                    showToast('Akun berhasil dibuat. Silakan masuk kembali.');
                    return;
                }
                state.currentUser = result?.user || null;
                state.csrfToken = result?.csrfToken || result?.csrf || null;
                if (!state.currentUser) await refreshAuth();
                if (mode === 'login' && redirectAdminToPanel()) return;
                await loadCompanies();
                updateAccountButtons();
                renderMain();
                if (state.currentUser?.forcePasswordChange) {
                    state.authMode = 'profile';
                    renderModal();
                    showToast('Ganti password sementara sebelum melanjutkan.', 'error');
                } else {
                    closeModal();
                    showToast(mode === 'login' ? 'Berhasil masuk.' : 'Akun berhasil dibuat.');
                }
            } catch (error) {
                showToast(error.message, 'error');
            } finally {
                button.disabled = false;
            }
        }

        async function submitProfile(event) {
            event.preventDefault();
            const form = event.currentTarget;
            const button = form.querySelector('button[type="submit"]');
            const values = Object.fromEntries(new FormData(form).entries());
            button.disabled = true;
            try {
                const result = await apiFetch('/api/auth/profile', {
                    method: 'PATCH',
                    body: { name: values.name, email: values.email }
                });
                state.currentUser = result?.user || result || state.currentUser;
                updateAccountButtons();
                renderModal();
                showToast('Profil diperbarui.');
            } catch (error) {
                showToast(error.message, 'error');
            } finally {
                button.disabled = false;
            }
        }

        async function changePassword(event) {
            event.preventDefault();
            const form = event.currentTarget;
            const button = form.querySelector('button[type="submit"]');
            const values = Object.fromEntries(new FormData(form).entries());
            if (values.newPassword !== values.passwordConfirmation) {
                showToast('Konfirmasi password baru tidak sama.', 'error');
                return;
            }
            button.disabled = true;
            try {
                const result = await apiFetch('/api/auth/change-password', {
                    method: 'POST',
                    body: { currentPassword: values.currentPassword, newPassword: values.newPassword }
                });
                form.reset();
                if (result?.reauthenticate) {
                    state.currentUser = null;
                    updateAccountButtons();
                    state.authMode = 'login';
                    renderModal();
                    await loadCompanies();
                    renderMain();
                    showToast('Password diperbarui. Silakan masuk kembali.');
                } else {
                    showToast('Password berhasil diperbarui.');
                }
            } catch (error) {
                showToast(error.message, 'error');
            } finally {
                button.disabled = false;
            }
        }

        async function logout() {
            try {
                await apiFetch('/api/auth/logout', { method: 'POST' });
            } catch (error) {
                if (error.status !== 401) showToast(error.message, 'error');
            }
            state.currentUser = null;
            state.csrfToken = null;
            await loadCompanies();
            updateAccountButtons();
            closeModal();
            renderMain();
            showToast('Anda telah keluar.', 'error');
        }

        function renderAuthModal(container) {
            const isProfile = state.authMode === 'profile' && state.currentUser;
            const isLogin = state.authMode === 'login';
            let content;

            if (isProfile) {
                const adminLink = state.currentUser.role === 'admin'
                    ? `<a href="/admin/" class="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-slate-900 text-white font-bold hover:bg-slate-800"><i data-lucide="layout-dashboard" class="w-4 h-4"></i> Buka Halaman Admin</a>`
                    : '';
                content = `
                    <div class="space-y-6">
                        <div>
                            <p class="text-sm text-slate-500">Masuk sebagai</p>
                            <h3 class="text-xl font-bold text-slate-800">${escapeHtml(state.currentUser.name)}</h3>
                            <p class="text-sm text-slate-500">${escapeHtml(state.currentUser.email)}</p>
                        </div>
                        ${adminLink}
                        <form onsubmit="submitProfile(event)" class="space-y-3">
                            <h4 class="font-bold text-slate-800">Informasi akun</h4>
                            <label class="block text-sm font-medium text-slate-700">Nama
                                <input name="name" maxlength="100" required autocomplete="name" value="${escapeHtml(state.currentUser.name)}" class="mt-1 w-full px-3 py-2.5 border border-slate-300 rounded-lg">
                            </label>
                            <label class="block text-sm font-medium text-slate-700">Email
                                <input name="email" type="email" maxlength="254" required autocomplete="email" value="${escapeHtml(state.currentUser.email)}" class="mt-1 w-full px-3 py-2.5 border border-slate-300 rounded-lg">
                            </label>
                            <button type="submit" class="w-full bg-blue-600 text-white py-2.5 rounded-lg font-bold hover:bg-blue-700">Simpan Profil</button>
                        </form>
                        <form onsubmit="changePassword(event)" class="space-y-3 border-t border-slate-200 pt-5">
                            <h4 class="font-bold text-slate-800">Ganti password</h4>
                            <input name="currentPassword" type="password" required autocomplete="current-password" placeholder="Password saat ini" class="w-full px-3 py-2.5 border border-slate-300 rounded-lg">
                            <input name="newPassword" type="password" minlength="12" maxlength="128" required autocomplete="new-password" placeholder="Password baru (minimal 12 karakter)" class="w-full px-3 py-2.5 border border-slate-300 rounded-lg">
                            <input name="passwordConfirmation" type="password" minlength="12" maxlength="128" required autocomplete="new-password" placeholder="Ulangi password baru" class="w-full px-3 py-2.5 border border-slate-300 rounded-lg">
                            <button type="submit" class="w-full bg-slate-100 text-slate-800 py-2.5 rounded-lg font-bold hover:bg-slate-200">Ubah Password</button>
                        </form>
                        <button onclick="logout()" class="w-full text-red-600 py-2 font-bold hover:bg-red-50 rounded-lg">Keluar dari akun</button>
                    </div>`;
            } else {
                content = `
                    <div class="flex bg-slate-100 rounded-lg p-1 mb-6">
                        <button onclick="setAuthMode('login')" class="flex-1 py-2 rounded-md font-bold ${isLogin ? 'bg-white text-blue-900 shadow-sm' : 'text-slate-500'}">Masuk</button>
                        <button onclick="setAuthMode('register')" class="flex-1 py-2 rounded-md font-bold ${!isLogin ? 'bg-white text-blue-900 shadow-sm' : 'text-slate-500'}">Daftar</button>
                    </div>
                    <form onsubmit="submitAuth(event, '${isLogin ? 'login' : 'register'}')" class="space-y-4">
                        ${isLogin ? '' : `<label class="block text-sm font-medium text-slate-700">Nama lengkap<input name="name" maxlength="100" required autocomplete="name" class="mt-1 w-full px-3 py-3 border border-slate-300 rounded-lg" placeholder="Nama Anda"></label>`}
                        <label class="block text-sm font-medium text-slate-700">Email<input name="email" type="email" maxlength="254" required autocomplete="email" class="mt-1 w-full px-3 py-3 border border-slate-300 rounded-lg" placeholder="nama@email.com"></label>
                        <label class="block text-sm font-medium text-slate-700">Password<input name="password" type="password" minlength="${isLogin ? '1' : '12'}" maxlength="128" required autocomplete="${isLogin ? 'current-password' : 'new-password'}" class="mt-1 w-full px-3 py-3 border border-slate-300 rounded-lg" placeholder="${isLogin ? 'Masukkan password' : 'Minimal 12 karakter'}"></label>
                        ${isLogin ? '' : `<label class="block text-sm font-medium text-slate-700">Konfirmasi password<input name="passwordConfirmation" type="password" minlength="12" maxlength="128" required autocomplete="new-password" class="mt-1 w-full px-3 py-3 border border-slate-300 rounded-lg" placeholder="Ulangi password"></label>`}
                        <button type="submit" class="w-full bg-blue-600 text-white py-3 rounded-lg font-bold hover:bg-blue-700">${isLogin ? 'Masuk' : 'Buat Akun'}</button>
                    </form>
                    <p class="text-xs text-slate-500 mt-4">Password wajib minimal 12 karakter dan diproses secara aman di server.</p>`;
            }

            container.innerHTML = `
                <div class="fixed inset-0 z-50 flex items-center justify-center px-4" role="dialog" aria-modal="true" aria-label="Akun">
                    <button class="fixed inset-0 bg-slate-900/60 backdrop-blur-sm" onclick="closeModal()" aria-label="Tutup"></button>
                    <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto relative z-10 zoom-in">
                        <div class="px-6 py-5 border-b border-slate-200 flex items-center justify-between">
                            <div><p class="text-xs font-bold text-blue-600 uppercase tracking-wide">CekPinjol.id</p><h2 class="text-2xl font-bold text-slate-800">${isProfile ? 'Akun Saya' : (isLogin ? 'Selamat Datang' : 'Buat Akun')}</h2></div>
                            <button onclick="closeModal()" class="p-2 rounded-full text-slate-400 hover:bg-slate-100" aria-label="Tutup"><i data-lucide="x" class="w-5 h-5"></i></button>
                        </div>
                        <div class="p-6">${content}</div>
                    </div>
                </div>`;
            lucide.createIcons();
        }

        function renderModal() {
            const container = document.getElementById('modal-container');

            if (state.modalType === 'auth') {
                renderAuthModal(container);
                return;
            }
            
            if (!state.selectedCompanyId || state.modalType !== 'company') {
                container.innerHTML = '';
                return;
            }

            const company = pinjolData.find(c => c.id === state.selectedCompanyId);
            if (!company) return;

            const isLegal = company.status === 'Legal';
            const headerBg = isLegal ? 'bg-green-50/90 border-green-100' : 'bg-red-50/90 border-red-100';
            const iconBg = isLegal ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700';
            const iconName = isLegal ? 'shield-check' : 'shield-alert';
            const textStatus = isLegal ? 'text-green-700' : 'text-red-700';

            const reviewsHtml = company.reviews.map((review) => {
                const stars = Array(5).fill(0).map((_, i) => 
                    `<i data-lucide="star" class="w-3.5 h-3.5 star-anim ${i < review.rating ? 'text-yellow-400 fill-current' : 'text-slate-300'}"></i>`
                ).join('');
                
                const reviewLikes = review.likes || 0;
                const hasLiked = review.hasLiked || false;
                const likeColorClass = hasLiked ? 'text-blue-600' : 'text-slate-400 hover:text-blue-600';
                const likeFillClass = hasLiked ? 'fill-current text-blue-600' : '';
                const moderationText = {
                    pending: 'Menunggu moderasi',
                    rejected: 'Ditolak admin',
                    hidden: 'Disembunyikan admin'
                }[review.status];
                const moderationLabel = moderationText
                    ? `<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">${moderationText}</span>`
                    : '';

                return `
                    <div class="bg-white border border-slate-200 p-4 rounded-xl flex gap-4 items-start">
                        <div class="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center font-bold text-slate-500 flex-shrink-0">
                            ${escapeHtml(String(review.user || '?').charAt(0).toUpperCase())}
                        </div>
                        <div class="flex-1">
                            <div class="flex items-center justify-between mb-1">
                                <div class="flex items-center gap-2">
                                    <span class="font-bold text-sm text-slate-800">${escapeHtml(review.user || 'Pengguna')}</span>
                                    ${moderationLabel}
                                    <div class="flex">${stars}</div>
                                </div>
                                <!-- Tombol Like Komentar -->
                                <button type="button" class="flex items-center gap-1 cursor-pointer transition-colors ${likeColorClass}" onclick="toggleReviewLike(event, ${Number(review.id)})" title="Sukai Ulasan">
                                    <i data-lucide="thumbs-up" class="w-3.5 h-3.5 transition-colors ${likeFillClass}"></i>
                                    <span class="text-xs font-semibold">${Number(reviewLikes)}</span>
                                </button>
                            </div>
                            <p class="text-sm text-slate-600 italic">“${escapeHtml(review.comment)}”</p>
                        </div>
                    </div>
                `;
            }).join('');

            container.innerHTML = `
                <div class="fixed inset-0 z-50 flex items-center justify-center px-4 sm:px-6" role="dialog" aria-modal="true" aria-label="Detail ${escapeHtml(company.name)}">
                    <div class="fixed inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity" onclick="closeModal()"></div>
                    
                    <div class="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto relative z-10 zoom-in">
                        <!-- Modal Header -->
                        <div class="sticky top-0 px-6 py-4 flex items-center justify-between border-b z-20 backdrop-blur ${headerBg}">
                            <div class="flex items-center gap-3">
                                <div class="p-2 rounded-full ${iconBg}">
                                    <i data-lucide="${iconName}" class="w-6 h-6"></i>
                                </div>
                                <div>
                                    <h2 class="text-2xl font-bold text-slate-800">${escapeHtml(company.name)}</h2>
                                    <span class="text-sm font-bold ${textStatus}">Status: ${escapeHtml(company.status.toUpperCase())}</span>
                                </div>
                            </div>
                            <button onclick="closeModal()" class="p-2 bg-white rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors shadow-sm">
                                <i data-lucide="x" class="w-5 h-5"></i>
                            </button>
                        </div>

                        <!-- Banner Gambar Aplikasi di Modal -->
                        <div class="w-full h-40 md:h-56 bg-slate-100 relative overflow-hidden shrink-0">
                            <img src="${safeImageUrl(company.imageUrl)}" alt="Banner ${escapeHtml(company.name)}" width="800" height="300" decoding="async" class="w-full h-full object-cover" onerror="this.src='https://placehold.co/800x300/e2e8f0/64748b?text=Tanpa+Gambar'">
                        </div>

                        <!-- Modal Body -->
                        <div class="p-6 md:p-8 space-y-8">
                            ${!isLegal ? `
                            <div class="bg-red-50 border border-red-200 rounded-xl p-4 flex gap-4 items-start">
                                <i data-lucide="alert-triangle" class="w-6 h-6 text-red-600 flex-shrink-0 mt-0.5"></i>
                                <div>
                                    <h4 class="text-red-800 font-bold mb-1">Peringatan Keamanan!</h4>
                                    <p class="text-sm text-red-700 leading-relaxed">Platform ini masuk daftar hitam atau tidak memiliki izin OJK. Meminjam di sini berisiko penyebaran data pribadi, bunga tidak wajar, dan teror penagihan. <strong>Sangat tidak disarankan.</strong></p>
                                </div>
                            </div>` : ''}

                            <div>
                                <h3 class="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                                    <i data-lucide="info" class="w-5 h-5 text-blue-600"></i> Profil Entitas
                                </h3>
                                <div class="bg-slate-50 rounded-xl p-5 border border-slate-100 space-y-4">
                                    <p class="text-slate-600 text-sm leading-relaxed">${escapeHtml(company.description)}</p>
                                    <div class="flex flex-col sm:flex-row sm:items-center gap-2 text-xs text-slate-500">
                                        <span><strong>Diperiksa:</strong> ${escapeHtml(formatDate(company.sourceCheckedAt))}</span>
                                        ${safeLinkUrl(company.sourceUrl) ? `<a href="${safeLinkUrl(company.sourceUrl)}" target="_blank" rel="noopener noreferrer" class="text-blue-600 font-semibold hover:underline">Buka sumber verifikasi</a>` : '<span>Sumber belum dicantumkan</span>'}
                                    </div>
                                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 pt-4 border-t border-slate-200">
                                        <div class="flex gap-3">
                                            <i data-lucide="building" class="w-5 h-5 text-slate-400 shrink-0"></i>
                                            <div>
                                                <span class="block text-xs font-semibold text-slate-400">Nomor Izin / Registrasi</span>
                                                <span class="text-sm font-bold text-slate-700">${escapeHtml(company.ojkNumber || 'TIDAK TERDAFTAR')}</span>
                                            </div>
                                        </div>
                                        <div class="flex gap-3">
                                            <i data-lucide="map-pin" class="w-5 h-5 text-slate-400 shrink-0"></i>
                                            <div>
                                                <span class="block text-xs font-semibold text-slate-400">Alamat Operasional</span>
                                                <span class="text-sm font-medium text-slate-700">${escapeHtml(company.address)}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div>
                                <h3 class="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                                    <i data-lucide="shield-check" class="w-5 h-5 text-blue-600"></i> Detail Pinjaman
                                </h3>
                                <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
                                    <div class="bg-white border border-slate-200 rounded-xl p-4 text-center">
                                        <span class="block text-xs text-slate-500 font-medium mb-1">Limit</span>
                                        <span class="text-sm font-bold text-blue-900">${escapeHtml(company.limit)}</span>
                                    </div>
                                    <div class="bg-white border border-slate-200 rounded-xl p-4 text-center">
                                        <span class="block text-xs text-slate-500 font-medium mb-1">Tenor</span>
                                        <span class="text-sm font-bold text-blue-900">${escapeHtml(company.tenor)}</span>
                                    </div>
                                    <div class="bg-white border border-slate-200 rounded-xl p-4 text-center">
                                        <span class="block text-xs text-slate-500 font-medium mb-1">Bunga</span>
                                        <span class="text-sm font-bold text-blue-900">${escapeHtml(company.interest)}</span>
                                    </div>
                                    <div class="bg-white border border-slate-200 rounded-xl p-4 text-center">
                                        <span class="block text-xs text-slate-500 font-medium mb-1">Admin</span>
                                        <span class="text-sm font-bold text-blue-900">${escapeHtml(company.adminFee)}</span>
                                    </div>
                                </div>
                            </div>

                            <div>
                                <h3 class="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                                    <i data-lucide="message-square" class="w-5 h-5 text-blue-600"></i> Ulasan Pengguna
                                </h3>
                                
                                <!-- Daftar Komentar -->
                                <div class="space-y-4 max-h-[400px] overflow-y-auto pr-2">
                                    ${reviewsHtml || '<p class="text-sm text-slate-500 py-4">Belum ada ulasan yang telah disetujui.</p>'}
                                </div>

                                <!-- Form Tulis Ulasan -->
                                <div class="mt-6 bg-slate-50 border border-slate-200 rounded-xl p-5">
                                    <h4 class="font-bold text-slate-800 mb-3 text-sm flex items-center gap-2">
                                        <i data-lucide="pen-tool" class="w-4 h-4 text-blue-600"></i> Tulis Ulasan Anda
                                    </h4>
                                    ${state.currentUser ? `
                                    <form onsubmit="submitComment(event, ${company.id})" class="space-y-3">
                                        <p class="text-xs text-slate-500">Ulasan dikirim sebagai <strong>${escapeHtml(state.currentUser.name)}</strong> dan akan tampil setelah disetujui admin.</p>
                                        <div class="flex items-center gap-2 w-full px-3 py-2 bg-white border border-slate-200 rounded-lg">
                                                <span class="text-sm text-slate-500">Rating:</span>
                                                <div class="flex gap-1" id="rating-stars-wrapper">
                                                    ${[1, 2, 3, 4, 5].map(num => `
                                                        <svg onclick="setReviewRating(${num})" class="w-6 h-6 cursor-pointer transition-transform hover:scale-110 text-yellow-400 fill-current" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                                                        </svg>
                                                    `).join('')}
                                                </div>
                                                <input type="hidden" id="review-rating" value="5">
                                        </div>
                                        <textarea id="review-text" maxlength="2000" required placeholder="Ceritakan pengalaman Anda dengan platform ini..." rows="3" class="w-full px-3 py-2.5 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 transition-colors"></textarea>
                                        <button type="submit" class="bg-blue-600 text-white px-5 py-2.5 rounded-lg text-sm font-bold hover:bg-blue-700 transition-colors w-full sm:w-auto flex justify-center items-center gap-2">
                                            Kirim Ulasan <i data-lucide="send" class="w-4 h-4"></i>
                                        </button>
                                    </form>` : `
                                    <button type="button" onclick="openAuthModal('login')" class="w-full bg-blue-600 text-white px-5 py-3 rounded-lg text-sm font-bold hover:bg-blue-700">
                                        Masuk untuk menulis ulasan
                                    </button>`}
                                </div>
                            </div>
                        </div>
                        
                        <div class="border-t border-slate-200 p-6 bg-slate-50 rounded-b-2xl flex justify-end">
                            <button onclick="closeModal()" class="px-6 py-2.5 bg-slate-200 text-slate-700 font-bold rounded-lg hover:bg-slate-300 transition-colors">
                                Tutup Jendela
                            </button>
                        </div>
                    </div>
                </div>
            `;
            lucide.createIcons();
        }

        async function loadCompanies() {
            const result = await apiFetch('/api/companies?limit=100');
            const items = Array.isArray(result) ? result : (result?.items || result?.companies || []);
            pinjolData = items.map(normalizeCompany);
        }

        async function loadSettings() {
            try {
                const result = await apiFetch('/api/public/settings');
                const settings = result?.settings || result || {};
                state.settings = {
                    ...defaultSettings,
                    ...settings,
                    heroSubtitle: settings.heroSubtitle || settings.heroDescription || defaultSettings.heroSubtitle
                };
            } catch (error) {
                state.settings = { ...defaultSettings };
                console.warn('Pengaturan publik memakai nilai bawaan:', error.message);
            }
            const footerText = document.getElementById('footer-description');
            if (footerText) footerText.textContent = state.settings.footerText;
            if (state.settings.siteName !== defaultSettings.siteName) {
                document.querySelectorAll('[data-site-name]').forEach(element => {
                    element.textContent = state.settings.siteName;
                });
            }
            document.title = `Sistem Informasi - ${state.settings.siteName}`;
        }

        async function initializeData() {
            state.isLoading = true;
            state.loadError = '';
            renderMain();
            try {
                await Promise.all([refreshAuth(), loadCompanies(), loadSettings()]);
                if (redirectAdminToPanel()) return;
            } catch (error) {
                state.loadError = error.message || 'Server tidak dapat dihubungi.';
            } finally {
                state.isLoading = false;
                renderMain();
                updateAccountButtons();
            }
        }

        function renderDataNotice() {
            const announcement = state.settings.announcement || state.settings.disclaimer;
            if (!announcement) return '';
            return `
                <div class="bg-amber-50 border-b border-amber-200 text-amber-900">
                    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-start gap-2 text-xs sm:text-sm">
                        <i data-lucide="info" class="w-4 h-4 shrink-0 mt-0.5"></i>
                        <p><strong>Catatan data:</strong> ${escapeHtml(announcement)}</p>
                    </div>
                </div>`;
        }

        function renderMain() {
            const mainContainer = document.getElementById('main-content');

            if (state.isLoading) {
                mainContainer.innerHTML = `
                    <div class="max-w-7xl mx-auto px-4 py-20" aria-live="polite">
                        <div class="flex flex-col items-center text-center text-slate-500">
                            <i data-lucide="loader-2" class="w-10 h-10 text-blue-600 animate-spin mb-4"></i>
                            <p class="font-semibold">Memuat data terbaru...</p>
                        </div>
                    </div>`;
                lucide.createIcons();
                return;
            }

            if (state.loadError) {
                mainContainer.innerHTML = `
                    <div class="max-w-xl mx-auto px-4 py-20 text-center">
                        <div class="bg-white border border-red-200 rounded-2xl p-8 shadow-sm">
                            <i data-lucide="server-off" class="w-12 h-12 text-red-500 mx-auto mb-4"></i>
                            <h1 class="text-xl font-bold text-slate-800 mb-2">Data belum dapat dimuat</h1>
                            <p class="text-slate-500 mb-6">${escapeHtml(state.loadError)}</p>
                            <button onclick="initializeData()" class="bg-blue-600 text-white px-6 py-3 rounded-lg font-bold hover:bg-blue-700">Coba Lagi</button>
                        </div>
                    </div>`;
                lucide.createIcons();
                return;
            }
            
            let pageContent = '';
            if (state.currentPage === 'Beranda') pageContent = renderBeranda();
            else if (state.currentPage === 'Daftar') pageContent = renderDaftar();
            else if (state.currentPage === 'Edukasi') pageContent = renderEdukasi();
            else if (state.currentPage === 'Tentang') pageContent = renderTentang();
            mainContainer.innerHTML = `${renderDataNotice()}${pageContent}`;
            
            // Re-inisialisasi ikon lucide setiap kali ada perubahan DOM
            lucide.createIcons();
        }

        // --- INIT APP ---
        // --- MOBILE BOTTOM NAVIGATION ---
        const initMobileBottomNav = () => {
            const body = document.body;
            const existingTopNav = document.querySelector('nav.sticky.top-0');
            const mainContent = document.querySelector('main#main-content');
            const footerElement = document.querySelector('footer');

            // Remove previously created bottom nav if it exists to avoid duplicates
            const oldBottomNav = document.getElementById('bottom-navbar');
            if (oldBottomNav) {
                oldBottomNav.remove();
            }

            // 1. Create the bottom navigation bar container
            const bottomNav = document.createElement('nav');
            bottomNav.id = 'bottom-navbar';
            bottomNav.className = 'fixed bottom-0 left-0 w-full bg-white shadow-lg rounded-t-xl flex justify-around items-center p-2 z-50 transition-transform duration-300 ease-out';

            const navItemsConfig = [
                { id: 'beranda', label: 'Beranda', page: 'Beranda', icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-home"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>' },
                { id: 'daftar', label: 'Daftar Aplikasi', page: 'Daftar', icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-layout-grid"><rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/></svg>' },
                { id: 'edukasi', label: 'Edukasi', page: 'Edukasi', icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-book-open"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>' },
                { id: 'tentang', label: 'Tentang', page: 'Tentang', icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-info"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>' },
                { id: 'account', label: 'Masuk', action: 'account', icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-user-round"><circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/></svg>' }
            ];

            navItemsConfig.forEach(item => {
                const link = document.createElement('a');
                link.href = '#';
                link.id = `nav-${item.id}`;
                link.className = 'flex flex-col items-center justify-center text-gray-600 hover:text-blue-500 p-2 rounded-lg transition-colors duration-200 flex-grow transition-transform duration-150';
                link.onclick = (e) => {
                    e.preventDefault();
                    // Micro-interaction
                    link.style.transform = 'scale(0.95)';
                    setTimeout(() => link.style.transform = '', 150);
                    if (item.action === 'account') openAuthModal();
                    else setPage(item.page);
                };
                link.innerHTML = `
                    <div class="mb-1">${item.icon}</div>
                    <span class="text-xs font-medium" ${item.action === 'account' ? 'data-account-label' : ''}>${item.label}</span>
                `;
                bottomNav.appendChild(link);
            });

            // Append the new bottom navigation to the body
            body.appendChild(bottomNav);

            // Set initial active state
            const setActiveNav = (page) => {
                bottomNav.querySelectorAll('a').forEach(link => {
                    link.classList.remove('active');
                    if (link.id === `nav-${page.toLowerCase()}`) {
                        link.classList.add('active');
                    }
                });
            };
            setActiveNav(state.currentPage);

            // 2. Hide the existing top navigation if it exists
            if (existingTopNav) {
                existingTopNav.style.display = 'none';
            }

            // 3. Adjust main content padding and footer padding to avoid overlap with the bottom navbar
            const adjustLayout = () => {
                const bottomNavHeight = bottomNav.offsetHeight;
                if (mainContent) {
                    // Use padding-bottom on body to ensure all content and the footer are pushed up
                    body.style.paddingBottom = `${bottomNavHeight + 20}px`; // Add extra 20px for safe area
                }
                // Ensure footer is not covered if it's present
                if (footerElement) {
                    // footerElement.style.marginBottom = `${bottomNavHeight + 20}px`;
                    // footerElement.style.paddingBottom = `calc(${footerElement.style.paddingBottom || '0px'} + ${bottomNavHeight + 20}px)`; // Adjust existing padding if needed
                }
            };

            // 4. Active state highlighting based on current page
            const highlightActiveLink = () => {
                const currentPage = state.currentPage;
                bottomNav.querySelectorAll('a').forEach(link => {
                    link.classList.remove('text-blue-600', 'bg-blue-50');
                    link.classList.add('text-gray-600');
                    const item = navItemsConfig.find(i => i.page === currentPage);
                    if (item && link.id === `nav-${item.id}`) {
                        link.classList.add('text-blue-600', 'bg-blue-50');
                        link.classList.remove('text-gray-600');
                    }
                });
            };

            // 5. Ensure responsiveness using a media query approach via JS for demonstration
            const applyResponsiveStyles = () => {
                if (window.innerWidth <= 760) {
                    bottomNav.style.display = 'flex'; // Show bottom nav
                    if (existingTopNav) existingTopNav.style.display = 'none'; // Hide top nav
                    adjustLayout(); // Adjust layout for bottom nav
                } else {
                    bottomNav.style.display = 'none'; // Hide bottom nav
                    if (existingTopNav) existingTopNav.style.display = ''; // Show top nav
                    if (mainContent) mainContent.style.paddingBottom = ''; // Reset padding
                    if (footerElement) {
                        footerElement.style.marginBottom = '';
                        // You might need to reset paddingBottom more carefully if it had a computed value
                    }
                    body.style.paddingBottom = '';
                }
                highlightActiveLink();
            };

            // Initial application and on resize
            applyResponsiveStyles();
            window.addEventListener('resize', applyResponsiveStyles);

            // Override setPage to update bottom nav
            const originalSetPage = setPage;
            setPage = (page) => {
                originalSetPage(page);
                setActiveNav(page);
                highlightActiveLink();
            };
        };

        const startApp = async () => {
            initMobileBottomNav();
            await initializeData();
            lucide.createIcons();
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', startApp, { once: true });
        } else {
            startApp();
        }

        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && state.modalType) closeModal();
        });

        // Service Worker Registration with error handling
        if ('serviceWorker' in navigator) {
            window.addEventListener('load', function() {
                navigator.serviceWorker.register('./sw.js')
                    .then(function(registration) {
                        console.log('ServiceWorker registration successful with scope: ', registration.scope);
                    })
                    .catch(function(error) {
                        console.log('ServiceWorker registration failed: ', error);
                    });
            });
        }
