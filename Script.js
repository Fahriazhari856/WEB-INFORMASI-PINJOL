 // --- DUMMY DATA ---
        const pinjolData = [
            { id: 1, name: "DanaAman", status: "Legal", imageUrl: "https://placehold.co/600x400/0284c7/ffffff?text=DanaAman\n(Aplikasi+Legal)", ojkNumber: "KEP-123/D.05/2021", rating: 4.8, likes: 12500, hasLiked: false, trustLevel: 98, limit: "Rp 500.000 - Rp 20.000.000", tenor: "3 - 12 Bulan", interest: "0.2% per hari (Maks 0.4%)", adminFee: "Mulai dari 1% - 3%", address: "Jl. Jend. Sudirman Kav. 50, Jakarta Pusat, 10220", description: "DanaAman adalah platform P2P lending berizin resmi OJK yang fokus memberikan pinjaman produktif dan konsumtif dengan bunga transparan.", reviews: [{ user: "Budi S.", rating: 5, comment: "Proses cepat, bunga sangat jelas dari awal. Mantap!", likes: 24, hasLiked: false }, { user: "Siti A.", rating: 4, comment: "Aplikasi mudah digunakan, pencairan cuma 1 jam.", likes: 8, hasLiked: false }] },
            { id: 2, name: "UangKilat (Ilegal)", status: "Ilegal", imageUrl: "https://placehold.co/600x400/991b1b/ffffff?text=UangKilat\n(Aplikasi+Ilegal)", ojkNumber: null, rating: 1.2, likes: 45, hasLiked: false, trustLevel: 5, limit: "Rp 1.000.000 - Rp 5.000.000", tenor: "7 Hari - 14 Hari", interest: "Bisa mencapai 2% - 5% per hari", adminFee: "Potongan di muka hingga 30%", address: "Alamat Kantor Tidak Jelas / Fiktif", description: "WASPADA: Entitas ini masuk dalam daftar pantauan Satgas Waspada Investasi. Sering melakukan penagihan dengan intimidasi dan penyebaran data pribadi.", reviews: [{ user: "Anonim", rating: 1, comment: "GILA! Pinjam 1 juta yang cair cuma 700 ribu, disuruh balikin 1.5 juta dalam 7 hari!", likes: 156, hasLiked: false }, { user: "Korban P.", rating: 1, comment: "Data kontak saya dihubungi semua padahal baru telat 1 hari. Tolong diberantas!", likes: 89, hasLiked: false }] },
            { id: 3, name: "PinjamKawan", status: "Legal", imageUrl: "https://placehold.co/600x400/059669/ffffff?text=PinjamKawan\n(Aplikasi+Legal)", ojkNumber: "KEP-456/D.05/2020", rating: 4.6, likes: 8400, hasLiked: false, trustLevel: 95, limit: "Rp 1.000.000 - Rp 15.000.000", tenor: "3 - 6 Bulan", interest: "0.3% per hari", adminFee: "Rp 50.000 flat", address: "Gedung Cyber, Jl. Kuningan Barat Raya, Jakarta Selatan", description: "Solusi pinjaman cepat untuk kebutuhan mendesak dengan perlindungan data konsumen berstandar ISO 27001.", reviews: [{ user: "Agus W.", rating: 5, comment: "Sangat menolong saat butuh dana darurat untuk biaya rumah sakit.", likes: 45, hasLiked: false }, { user: "Rina M.", rating: 4, comment: "Limit bertahap naiknya, tapi CS nya responsif.", likes: 12, hasLiked: false }] },
            { id: 4, name: "DanaCepat Cair", status: "Ilegal", imageUrl: "https://placehold.co/600x400/7f1d1d/ffffff?text=DanaCepat\n(Aplikasi+Ilegal)", ojkNumber: null, rating: 1.5, likes: 120, hasLiked: false, trustLevel: 8, limit: "Rp 500.000 - Rp 2.000.000", tenor: "5 Hari - 10 Hari", interest: "Tidak transparan", adminFee: "Potongan biaya admin sangat tinggi", address: "Tidak Terdaftar di Indonesia", description: "WASPADA: Aplikasi ini tidak terdaftar di OJK. Sering merubah nama aplikasi di PlayStore untuk menghindari blokir Kominfo.", reviews: [{ user: "Dewi K.", rating: 1, comment: "Jangan pernah install! Aplikasi ini menyedot data galeri dan kontak hp saya.", likes: 210, hasLiked: false }] },
            { id: 5, name: "ModalRakyat", status: "Legal", imageUrl: "https://placehold.co/600x400/4f46e5/ffffff?text=ModalRakyat\n(Aplikasi+Legal)", ojkNumber: "KEP-789/D.05/2019", rating: 4.9, likes: 21000, hasLiked: false, trustLevel: 99, limit: "Rp 2.000.000 - Rp 50.000.000", tenor: "6 - 24 Bulan", interest: "Mulai dari 1.5% per bulan", adminFee: "2% dari nilai pinjaman", address: "Senayan City Office Tower Lt. 15, Jakarta Pusat", description: "Fokus pada pendanaan UMKM dan personal dengan bunga kompetitif dan tenor panjang.", reviews: [{ user: "Hendra", rating: 5, comment: "Bantu banget buat modal tambahan warung kopi saya.", likes: 56, hasLiked: false }, { user: "Maya", rating: 5, comment: "Aman dan bunganya masuk akal dibanding pinjol lain.", likes: 34, hasLiked: false }] },
            { id: 6, name: "DompetSurga", status: "Ilegal", imageUrl: "https://placehold.co/600x400/be123c/ffffff?text=DompetSurga\n(Aplikasi+Ilegal)", ojkNumber: null, rating: 1.1, likes: 10, hasLiked: false, trustLevel: 2, limit: "Rp 200.000 - Rp 1.000.000", tenor: "7 Hari", interest: "3% per hari", adminFee: "40% potongan awal", address: "Tidak Diketahui", description: "WASPADA: Modus penipuan. Jangan tergiur nama yang baik. Entitas ini sering melakukan transfer dana tanpa persetujuan lalu menagih dengan paksa.", reviews: [{ user: "Deni", rating: 1, comment: "Saya tidak pernah ajukan pinjaman, tiba-tiba ada dana masuk dan disuruh bayar bunga gila-gilaan!", likes: 78, hasLiked: false }] }
        ];

        // --- GLOBAL STATE ---
        let state = {
            currentPage: 'Beranda',
            searchQuery: '',
            filterStatus: 'Semua',
            sortBy: 'Paling Banyak Disukai',
            selectedCompanyId: null,
            isMobileMenuOpen: false
        };

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
            state.searchQuery = val;
            
            // Sync inputs
            document.getElementById('desktop-search').value = val;
            document.getElementById('mobile-search').value = val;

            if (state.currentPage !== 'Daftar' && val !== "") {
                setPage('Daftar');
            } else {
                renderMain();
            }
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

        function openModal(id) {
            state.selectedCompanyId = id;
            document.body.style.overflow = 'hidden';
            renderModal();
        }

        function closeModal() {
            state.selectedCompanyId = null;
            document.body.style.overflow = 'unset';
            renderModal();
        }

        // --- FITUR LIKE DENGAN ANIMASI INTERAKTIF ---
        function toggleLike(event, id) {
            event.stopPropagation(); // Mencegah buka modal saat klik tombol like
            const company = pinjolData.find(c => c.id === id);
            
            if (company) {
                // Update State
                company.hasLiked = !company.hasLiked;
                company.likes += company.hasLiked ? 1 : -1;
                
                // Update DOM Langsung (Tanpa merender ulang seluruh page agar animasi tidak terputus)
                const btnContainer = event.currentTarget;
                const svgIcon = btnContainer.querySelector('svg');
                const textSpan = btnContainer.querySelector('span');

                // Restart animasi pop dengan menghapus lalu memasang class lagi
                svgIcon.classList.remove('animate-pop');
                void svgIcon.offsetWidth; // Trigger reflow CSS
                svgIcon.classList.add('animate-pop');

                // Update text jumlah
                textSpan.innerText = company.likes.toLocaleString();

                // Ubah warna
                if (company.hasLiked) {
                    btnContainer.classList.remove('text-slate-500', 'hover:text-blue-600');
                    btnContainer.classList.add('text-blue-600');
                    svgIcon.classList.add('fill-current', 'text-blue-600');
                } else {
                    btnContainer.classList.remove('text-blue-600');
                    btnContainer.classList.add('text-slate-500', 'hover:text-blue-600');
                    svgIcon.classList.remove('fill-current', 'text-blue-600');
                }
            }
        }

        // --- ANIMASI PENGIRIMAN PESAN FORMULIR ---
        function submitLaporan(e) {
            e.preventDefault(); // Mencegah reload halaman
            const btn = document.getElementById('btn-submit-laporan');
            const originalContent = btn.innerHTML;
            
            // 1. Status Loading
            btn.innerHTML = `<i data-lucide="loader-2" class="w-5 h-5 animate-spin"></i> Mengirim...`;
            btn.classList.add('opacity-80', 'cursor-not-allowed');
            lucide.createIcons(); // render ulang icon khusus button ini

            // 2. Simulasi Request Network (1.5 detik)
            setTimeout(() => {
                // Status Sukses
                btn.innerHTML = `<i data-lucide="check-circle" class="w-5 h-5"></i> Laporan Terkirim!`;
                btn.classList.remove('bg-blue-600', 'hover:bg-blue-700', 'opacity-80', 'cursor-not-allowed');
                btn.classList.add('bg-green-600', 'hover:bg-green-700');
                lucide.createIcons();
                
                // Reset form input
                document.getElementById('form-laporan').reset();

                // 3. Kembalikan tombol seperti semula setelah 3 detik
                setTimeout(() => {
                    btn.innerHTML = originalContent;
                    btn.classList.remove('bg-green-600', 'hover:bg-green-700');
                    btn.classList.add('bg-blue-600', 'hover:bg-blue-700');
                    lucide.createIcons();
                }, 3000);

            }, 1500);
        }

        // --- FITUR LIKE PADA KOMENTAR/ULASAN ---
        function toggleReviewLike(event, companyId, reviewIndex) {
            event.stopPropagation();
            const company = pinjolData.find(c => c.id === companyId);
            
            if (company && company.reviews[reviewIndex]) {
                const review = company.reviews[reviewIndex];
                review.hasLiked = !review.hasLiked;
                review.likes += review.hasLiked ? 1 : -1;

                // Update DOM (animasi pop & warna)
                const btnContainer = event.currentTarget;
                const svgIcon = btnContainer.querySelector('svg');
                const textSpan = btnContainer.querySelector('span');

                svgIcon.classList.remove('animate-pop');
                void svgIcon.offsetWidth; 
                svgIcon.classList.add('animate-pop');

                textSpan.innerText = review.likes;

                if (review.hasLiked) {
                    btnContainer.classList.remove('text-slate-400', 'hover:text-blue-600');
                    btnContainer.classList.add('text-blue-600');
                    svgIcon.classList.add('fill-current', 'text-blue-600');
                } else {
                    btnContainer.classList.remove('text-blue-600');
                    btnContainer.classList.add('text-slate-400', 'hover:text-blue-600');
                    svgIcon.classList.remove('fill-current', 'text-blue-600');
                }
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

        // --- FITUR MENGIRIM KOMENTAR BARU ---
        function submitComment(e, companyId) {
            e.preventDefault();
            const name = document.getElementById('review-name').value;
            const rating = parseInt(document.getElementById('review-rating').value);
            const text = document.getElementById('review-text').value;

            const company = pinjolData.find(c => c.id === companyId);
            if(company) {
                // Tambahkan ulasan baru di baris paling atas (unshift)
                company.reviews.unshift({
                    user: name,
                    rating: rating,
                    comment: text,
                    likes: 0,
                    hasLiked: false
                });
                
                // Update rata-rata rating (opsional, untuk membuatnya semakin realistis)
                const totalRating = company.reviews.reduce((sum, rev) => sum + rev.rating, 0);
                company.rating = totalRating / company.reviews.length;
                
                // Render ulang modal untuk menampilkan komentar yang baru masuk
                renderModal();
                // Render ulang halaman di belakang layar (jika rating berubah)
                renderMain(); 
            }
        }

        // --- RENDER FUNCTIONS ---
        function renderCard(company, extraClasses = '') {
            const isLegal = company.status === 'Legal';
            const badgeBg = isLegal ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700 animate-pulse';
            const badgeIcon = isLegal ? 'shield-check' : 'alert-triangle';
            const badgeText = isLegal ? 'Legal OJK' : 'Ilegal / Bahaya';
            const trustClass = company.trustLevel > 50 ? 'text-blue-600' : 'text-red-600';
            
            // Logika class jika user sudah melike
            const likeColorClass = company.hasLiked ? 'text-blue-600' : 'text-slate-500 hover:text-blue-600';
            const likeFillClass = company.hasLiked ? 'fill-current text-blue-600' : '';

            return `
                <div onclick="openModal(${company.id})" class="bg-white rounded-2xl border border-slate-200 overflow-hidden hover:shadow-xl hover:-translate-y-1 transition-all duration-300 cursor-pointer group flex flex-col h-full text-left ${extraClasses}">
                    <div class="h-2 w-full ${isLegal ? 'bg-green-500' : 'bg-red-500'}"></div>
                    
                    <!-- Thumbnail Aplikasi (Diperkecil di Mobile) -->
                    <div class="relative h-28 md:h-40 w-full overflow-hidden bg-slate-100 border-b border-slate-100 shrink-0">
                        <img src="${company.imageUrl}" alt="Aplikasi ${company.name}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" onerror="this.src='https://placehold.co/600x400/e2e8f0/64748b?text=Tanpa+Gambar'">
                    </div>

                    <div class="p-4 md:p-6 flex-1 flex flex-col">
                        <div class="flex justify-between items-start mb-3 md:mb-4">
                            <span class="inline-flex items-center gap-1.5 px-2.5 md:px-3 py-1 rounded-full text-[10px] md:text-xs font-bold ${badgeBg}">
                                <i data-lucide="${badgeIcon}" class="w-3 h-3 md:w-3.5 md:h-3.5"></i> ${badgeText}
                            </span>
                        </div>
                        <h3 class="text-lg md:text-xl font-bold text-slate-800 mb-1 group-hover:text-blue-600 transition-colors">
                            ${company.name}
                        </h3>
                        <div class="flex items-center gap-2 md:gap-4 mb-3 md:mb-4 mt-1 md:mt-2 border-b border-slate-100 pb-3 md:pb-4">
                            <div class="flex items-center gap-1" title="Rating">
                                <i data-lucide="star" class="w-3.5 h-3.5 md:w-4 md:h-4 text-yellow-400 fill-current star-anim"></i>
                                <span class="font-bold text-xs md:text-sm text-slate-700">${company.rating.toFixed(1)}</span>
                            </div>
                            <!-- Tombol Like -->
                            <div class="flex items-center gap-1 md:gap-1.5 transition-colors cursor-pointer ${likeColorClass}" onclick="toggleLike(event, ${company.id})" title="Sukai/Batal Suka">
                                <i data-lucide="thumbs-up" class="w-3.5 h-3.5 md:w-4 md:h-4 transition-colors ${likeFillClass}"></i>
                                <span class="text-xs md:text-sm font-medium">${company.likes.toLocaleString()}</span>
                            </div>
                            <div class="ml-auto">
                                <span class="text-[10px] md:text-xs font-bold px-1.5 md:px-2 py-0.5 md:py-1 rounded bg-slate-100 ${trustClass}">
                                    ${company.trustLevel}% Trust
                                </span>
                            </div>
                        </div>
                        <div class="space-y-2 md:space-y-3 flex-1">
                            <div>
                                <span class="block text-[10px] md:text-xs text-slate-400 font-medium mb-0.5">Limit Pinjaman</span>
                                <span class="text-xs md:text-sm font-semibold text-slate-700">${company.limit}</span>
                            </div>
                            <div>
                                <span class="block text-[10px] md:text-xs text-slate-400 font-medium mb-0.5">Tenor Waktu</span>
                                <span class="text-xs md:text-sm font-semibold text-slate-700">${company.tenor}</span>
                            </div>
                        </div>
                        <div class="mt-4 md:mt-6 pt-3 md:pt-4 border-t border-slate-100 flex items-center justify-between text-blue-600 font-medium text-xs md:text-sm">
                            Lihat Detail
                            <i data-lucide="external-link" class="w-3.5 h-3.5 md:w-4 md:h-4 opacity-0 group-hover:opacity-100 transition-opacity -translate-x-2 group-hover:translate-x-0"></i>
                        </div>
                    </div>
                </div>
            `;
        }

        function renderBeranda() {
            // Tambahkan class extra w-[85vw] dan snap-center untuk scroll horizontal di mobile
            const topPinjol = pinjolData.filter(p => p.status === 'Legal').slice(0, 3).map(p => renderCard(p, 'w-[85vw] sm:w-[300px] md:w-auto shrink-0 snap-center md:snap-align-none')).join('');
            
            return `
                <div class="fade-in">
                    <div class="bg-blue-900 text-white pt-16 pb-20 px-4 sm:px-6 lg:px-8 relative overflow-hidden mt-[-1px]">
                        <div class="absolute top-0 right-0 -translate-y-12 translate-x-1/3 opacity-10">
                            <i data-lucide="shield-check" class="w-96 h-96"></i>
                        </div>
                        <div class="max-w-4xl mx-auto text-center relative z-10">
                            <h1 class="text-3xl md:text-5xl font-extrabold tracking-tight mb-6">
                                Jangan Asal Pinjam! <br class="hidden md:block"/> Cek Legalitas Pinjol Disini.
                            </h1>
                            <p class="text-lg md:text-xl text-blue-100 max-w-2xl mx-auto leading-relaxed mb-8">
                                Lindungi data pribadi dan finansial Anda. Pastikan Anda hanya meminjam pada platform yang telah berizin dan diawasi oleh Otoritas Jasa Keuangan (OJK).
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
                            <h2 class="text-2xl md:text-3xl font-bold text-slate-800 mb-2 md:mb-3">Pilihan Aman & Terverifikasi</h2>
                            <p class="text-sm md:text-base text-slate-500">Platform dengan tingkat kepercayaan tertinggi bulan ini.</p>
                        </div>
                        
                        <!-- Container Scroll Horizontal untuk Mobile (Swipeable) -->
                        <div class="flex overflow-x-auto snap-x snap-mandatory gap-4 pb-6 md:grid md:grid-cols-3 md:overflow-visible -mx-4 px-4 sm:mx-0 sm:px-0 scrollbar-hide">
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
                ? `<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">${data.map(renderCard).join('')}</div>`
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
                        <button class="bg-white text-blue-900 px-8 py-3 rounded-full font-bold shadow-lg hover:bg-slate-100 transition-all hover:scale-105">
                            Hubungi Layanan Pengaduan OJK (157)
                        </button>
                    </div>
                </div>
            `;
        }

        function renderTentang() {
            return `
                <div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12 fade-in">
                    <div class="text-center mb-12">
                        <h1 class="text-3xl font-bold text-slate-800 mb-4">Tentang CekPinjol.id</h1>
                        <p class="text-slate-600 text-lg">Misi kami adalah menciptakan ekosistem finansial yang aman bagi seluruh masyarakat Indonesia.</p>
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
                            <p class="text-sm text-slate-500">Data kami disinkronisasi secara berkala dari rilis resmi Otoritas Jasa Keuangan (OJK).</p>
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
                                <input type="text" required placeholder="Nama Lengkap" class="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 transition-colors" />
                                <input type="email" required placeholder="Email Anda" class="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 transition-colors" />
                            </div>
                            <input type="text" required placeholder="Nama Aplikasi Pinjol yang Dilaporkan" class="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 transition-colors" />
                            <textarea required placeholder="Ceritakan pengalaman atau bukti indikasi ilegal..." rows="4" class="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 transition-colors"></textarea>
                            
                            <!-- Tombol Submit Dinamis -->
                            <button id="btn-submit-laporan" type="submit" class="bg-blue-600 text-white px-6 py-3 rounded-lg font-bold hover:bg-blue-700 w-full md:w-auto flex items-center justify-center gap-2 transition-all">
                                <i data-lucide="send" class="w-5 h-5"></i> Kirim Laporan
                            </button>
                        </form>
                    </div>
                </div>
            `;
        }

        function renderModal() {
            const container = document.getElementById('modal-container');
            
            if (!state.selectedCompanyId) {
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

            const reviewsHtml = company.reviews.map((review, index) => {
                const stars = Array(5).fill(0).map((_, i) => 
                    `<i data-lucide="star" class="w-3.5 h-3.5 star-anim ${i < review.rating ? 'text-yellow-400 fill-current' : 'text-slate-300'}"></i>`
                ).join('');
                
                const reviewLikes = review.likes || 0;
                const hasLiked = review.hasLiked || false;
                const likeColorClass = hasLiked ? 'text-blue-600' : 'text-slate-400 hover:text-blue-600';
                const likeFillClass = hasLiked ? 'fill-current text-blue-600' : '';

                return `
                    <div class="bg-white border border-slate-200 p-4 rounded-xl flex gap-4 items-start">
                        <div class="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center font-bold text-slate-500 flex-shrink-0">
                            ${review.user.charAt(0).toUpperCase()}
                        </div>
                        <div class="flex-1">
                            <div class="flex items-center justify-between mb-1">
                                <div class="flex items-center gap-2">
                                    <span class="font-bold text-sm text-slate-800">${review.user}</span>
                                    <div class="flex">${stars}</div>
                                </div>
                                <!-- Tombol Like Komentar -->
                                <div class="flex items-center gap-1 cursor-pointer transition-colors ${likeColorClass}" onclick="toggleReviewLike(event, ${company.id}, ${index})" title="Sukai Ulasan">
                                    <i data-lucide="thumbs-up" class="w-3.5 h-3.5 transition-colors ${likeFillClass}"></i>
                                    <span class="text-xs font-semibold">${reviewLikes}</span>
                                </div>
                            </div>
                            <p class="text-sm text-slate-600 italic">"${review.comment}"</p>
                        </div>
                    </div>
                `;
            }).join('');

            container.innerHTML = `
                <div class="fixed inset-0 z-50 flex items-center justify-center px-4 sm:px-6">
                    <div class="fixed inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity" onclick="closeModal()"></div>
                    
                    <div class="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto relative z-10 zoom-in">
                        <!-- Modal Header -->
                        <div class="sticky top-0 px-6 py-4 flex items-center justify-between border-b z-20 backdrop-blur ${headerBg}">
                            <div class="flex items-center gap-3">
                                <div class="p-2 rounded-full ${iconBg}">
                                    <i data-lucide="${iconName}" class="w-6 h-6"></i>
                                </div>
                                <div>
                                    <h2 class="text-2xl font-bold text-slate-800">${company.name}</h2>
                                    <span class="text-sm font-bold ${textStatus}">Status: ${company.status.toUpperCase()}</span>
                                </div>
                            </div>
                            <button onclick="closeModal()" class="p-2 bg-white rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors shadow-sm">
                                <i data-lucide="x" class="w-5 h-5"></i>
                            </button>
                        </div>

                        <!-- Banner Gambar Aplikasi di Modal -->
                        <div class="w-full h-40 md:h-56 bg-slate-100 relative overflow-hidden shrink-0">
                            <img src="${company.imageUrl}" alt="Banner ${company.name}" class="w-full h-full object-cover" onerror="this.src='https://placehold.co/800x300/e2e8f0/64748b?text=Tanpa+Gambar'">
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
                                    <p class="text-slate-600 text-sm leading-relaxed">${company.description}</p>
                                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 pt-4 border-t border-slate-200">
                                        <div class="flex gap-3">
                                            <i data-lucide="building" class="w-5 h-5 text-slate-400 shrink-0"></i>
                                            <div>
                                                <span class="block text-xs font-semibold text-slate-400">Nomor Izin / Registrasi</span>
                                                <span class="text-sm font-bold text-slate-700">${company.ojkNumber || 'TIDAK TERDAFTAR'}</span>
                                            </div>
                                        </div>
                                        <div class="flex gap-3">
                                            <i data-lucide="map-pin" class="w-5 h-5 text-slate-400 shrink-0"></i>
                                            <div>
                                                <span class="block text-xs font-semibold text-slate-400">Alamat Operasional</span>
                                                <span class="text-sm font-medium text-slate-700">${company.address}</span>
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
                                        <span class="text-sm font-bold text-blue-900">${company.limit}</span>
                                    </div>
                                    <div class="bg-white border border-slate-200 rounded-xl p-4 text-center">
                                        <span class="block text-xs text-slate-500 font-medium mb-1">Tenor</span>
                                        <span class="text-sm font-bold text-blue-900">${company.tenor}</span>
                                    </div>
                                    <div class="bg-white border border-slate-200 rounded-xl p-4 text-center">
                                        <span class="block text-xs text-slate-500 font-medium mb-1">Bunga</span>
                                        <span class="text-sm font-bold text-blue-900">${company.interest}</span>
                                    </div>
                                    <div class="bg-white border border-slate-200 rounded-xl p-4 text-center">
                                        <span class="block text-xs text-slate-500 font-medium mb-1">Admin</span>
                                        <span class="text-sm font-bold text-blue-900">${company.adminFee}</span>
                                    </div>
                                </div>
                            </div>

                            <div>
                                <h3 class="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                                    <i data-lucide="message-square" class="w-5 h-5 text-blue-600"></i> Ulasan Pengguna
                                </h3>
                                
                                <!-- Daftar Komentar -->
                                <div class="space-y-4 max-h-[400px] overflow-y-auto pr-2">
                                    ${reviewsHtml}
                                </div>

                                <!-- Form Tulis Ulasan -->
                                <div class="mt-6 bg-slate-50 border border-slate-200 rounded-xl p-5">
                                    <h4 class="font-bold text-slate-800 mb-3 text-sm flex items-center gap-2">
                                        <i data-lucide="pen-tool" class="w-4 h-4 text-blue-600"></i> Tulis Ulasan Anda
                                    </h4>
                                    <form onsubmit="submitComment(event, ${company.id})" class="space-y-3">
                                        <div class="flex flex-col sm:flex-row gap-3">
                                            <input type="text" id="review-name" required placeholder="Nama Anda" class="w-full sm:w-1/2 px-3 py-2.5 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 transition-colors">
                                            
                                            <!-- Rating Bintang Interaktif (Klik) -->
                                            <div class="flex items-center gap-2 w-full sm:w-1/2 px-3 py-2 bg-white border border-slate-200 rounded-lg">
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
                                        </div>
                                        <textarea id="review-text" required placeholder="Ceritakan pengalaman Anda dengan platform ini..." rows="3" class="w-full px-3 py-2.5 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 transition-colors"></textarea>
                                        <button type="submit" class="bg-blue-600 text-white px-5 py-2.5 rounded-lg text-sm font-bold hover:bg-blue-700 transition-colors w-full sm:w-auto flex justify-center items-center gap-2">
                                            Kirim Ulasan <i data-lucide="send" class="w-4 h-4"></i>
                                        </button>
                                    </form>
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

        function renderMain() {
            const mainContainer = document.getElementById('main-content');
            
            if (state.currentPage === 'Beranda') mainContainer.innerHTML = renderBeranda();
            else if (state.currentPage === 'Daftar') mainContainer.innerHTML = renderDaftar();
            else if (state.currentPage === 'Edukasi') mainContainer.innerHTML = renderEdukasi();
            else if (state.currentPage === 'Tentang') mainContainer.innerHTML = renderTentang();
            
            // Re-inisialisasi ikon lucide setiap kali ada perubahan DOM
            lucide.createIcons();
        }

        // --- INIT APP ---
        window.onload = () => {
            renderMain();
            lucide.createIcons(); // Init icon diluar div main-content (seperti header marquee)
        };