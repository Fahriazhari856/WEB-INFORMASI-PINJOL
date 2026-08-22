'use strict';

// Data awal ini dipindahkan apa adanya dari prototype statis. Data ini adalah
// contoh, bukan klaim bahwa perusahaan/nomor izin berikut nyata atau terverifikasi.
const companies = [
  {
    name: 'DanaAman',
    status: 'Legal',
    imageUrl: 'https://placehold.co/600x400/0284c7/ffffff?text=DanaAman%0A(Aplikasi+Legal)',
    ojkNumber: 'KEP-123/D.05/2021',
    likes: 12500,
    trustLevel: 98,
    limit: 'Rp 500.000 - Rp 20.000.000',
    tenor: '3 - 12 Bulan',
    interest: '0.2% per hari (Maks 0.4%)',
    adminFee: 'Mulai dari 1% - 3%',
    address: 'Jl. Jend. Sudirman Kav. 50, Jakarta Pusat, 10220',
    description: 'DanaAman adalah platform P2P lending berizin resmi OJK yang fokus memberikan pinjaman produktif dan konsumtif dengan bunga transparan.',
    featured: true,
    reviews: [
      { user: 'Budi S.', rating: 5, comment: 'Proses cepat, bunga sangat jelas dari awal. Mantap!', likes: 24 },
      { user: 'Siti A.', rating: 4, comment: 'Aplikasi mudah digunakan, pencairan cuma 1 jam.', likes: 8 }
    ]
  },
  {
    name: 'UangKilat (Ilegal)',
    status: 'Ilegal',
    imageUrl: 'https://placehold.co/600x400/991b1b/ffffff?text=UangKilat%0A(Aplikasi+Ilegal)',
    ojkNumber: null,
    likes: 45,
    trustLevel: 5,
    limit: 'Rp 1.000.000 - Rp 5.000.000',
    tenor: '7 Hari - 14 Hari',
    interest: 'Bisa mencapai 2% - 5% per hari',
    adminFee: 'Potongan di muka hingga 30%',
    address: 'Alamat Kantor Tidak Jelas / Fiktif',
    description: 'WASPADA: Entitas ini masuk dalam daftar pantauan Satgas Waspada Investasi. Sering melakukan penagihan dengan intimidasi dan penyebaran data pribadi.',
    featured: false,
    reviews: [
      { user: 'Anonim', rating: 1, comment: 'GILA! Pinjam 1 juta yang cair cuma 700 ribu, disuruh balikin 1.5 juta dalam 7 hari!', likes: 156 },
      { user: 'Korban P.', rating: 1, comment: 'Data kontak saya dihubungi semua padahal baru telat 1 hari. Tolong diberantas!', likes: 89 }
    ]
  },
  {
    name: 'PinjamKawan',
    status: 'Legal',
    imageUrl: 'https://placehold.co/600x400/059669/ffffff?text=PinjamKawan%0A(Aplikasi+Legal)',
    ojkNumber: 'KEP-456/D.05/2020',
    likes: 8400,
    trustLevel: 95,
    limit: 'Rp 1.000.000 - Rp 15.000.000',
    tenor: '3 - 6 Bulan',
    interest: '0.3% per hari',
    adminFee: 'Rp 50.000 flat',
    address: 'Gedung Cyber, Jl. Kuningan Barat Raya, Jakarta Selatan',
    description: 'Solusi pinjaman cepat untuk kebutuhan mendesak dengan perlindungan data konsumen berstandar ISO 27001.',
    featured: true,
    reviews: [
      { user: 'Agus W.', rating: 5, comment: 'Sangat menolong saat butuh dana darurat untuk biaya rumah sakit.', likes: 45 },
      { user: 'Rina M.', rating: 4, comment: 'Limit bertahap naiknya, tapi CS nya responsif.', likes: 12 }
    ]
  },
  {
    name: 'DanaCepat Cair',
    status: 'Ilegal',
    imageUrl: 'https://placehold.co/600x400/7f1d1d/ffffff?text=DanaCepat%0A(Aplikasi+Ilegal)',
    ojkNumber: null,
    likes: 120,
    trustLevel: 8,
    limit: 'Rp 500.000 - Rp 2.000.000',
    tenor: '5 Hari - 10 Hari',
    interest: 'Tidak transparan',
    adminFee: 'Potongan biaya admin sangat tinggi',
    address: 'Tidak Terdaftar di Indonesia',
    description: 'WASPADA: Aplikasi ini tidak terdaftar di OJK. Sering merubah nama aplikasi di PlayStore untuk menghindari blokir Kominfo.',
    featured: false,
    reviews: [
      { user: 'Dewi K.', rating: 1, comment: 'Jangan pernah install! Aplikasi ini menyedot data galeri dan kontak hp saya.', likes: 210 }
    ]
  },
  {
    name: 'ModalRakyat',
    status: 'Legal',
    imageUrl: 'https://placehold.co/600x400/4f46e5/ffffff?text=ModalRakyat%0A(Aplikasi+Legal)',
    ojkNumber: 'KEP-789/D.05/2019',
    likes: 21000,
    trustLevel: 99,
    limit: 'Rp 2.000.000 - Rp 50.000.000',
    tenor: '6 - 24 Bulan',
    interest: 'Mulai dari 1.5% per bulan',
    adminFee: '2% dari nilai pinjaman',
    address: 'Senayan City Office Tower Lt. 15, Jakarta Pusat',
    description: 'Fokus pada pendanaan UMKM dan personal dengan bunga kompetitif dan tenor panjang.',
    featured: true,
    reviews: [
      { user: 'Hendra', rating: 5, comment: 'Bantu banget buat modal tambahan warung kopi saya.', likes: 56 },
      { user: 'Maya', rating: 5, comment: 'Aman dan bunganya masuk akal dibanding pinjol lain.', likes: 34 }
    ]
  },
  {
    name: 'DompetSurga',
    status: 'Ilegal',
    imageUrl: 'https://placehold.co/600x400/be123c/ffffff?text=DompetSurga%0A(Aplikasi+Ilegal)',
    ojkNumber: null,
    likes: 10,
    trustLevel: 2,
    limit: 'Rp 200.000 - Rp 1.000.000',
    tenor: '7 Hari',
    interest: '3% per hari',
    adminFee: '40% potongan awal',
    address: 'Tidak Diketahui',
    description: 'WASPADA: Modus penipuan. Jangan tergiur nama yang baik. Entitas ini sering melakukan transfer dana tanpa persetujuan lalu menagih dengan paksa.',
    featured: false,
    reviews: [
      { user: 'Deni', rating: 1, comment: 'Saya tidak pernah ajukan pinjaman, tiba-tiba ada dana masuk dan disuruh bayar bunga gila-gilaan!', likes: 78 }
    ]
  }
];

const publicSettings = {
  siteName: 'CekPinjol.id',
  heroTitle: 'Cek Legalitas Pinjaman Online',
  heroSubtitle: 'Temukan informasi pinjaman online sebelum mengambil keputusan.',
  heroDescription: 'Kenali status, biaya, dan pengalaman pengguna sebelum menggunakan layanan pinjaman online.',
  announcement: 'Data awal pada versi pengembangan ini adalah data contoh dan bukan rujukan legalitas resmi.',
  contactEmail: '',
  contactPhone: '157',
  footerText: 'Selalu verifikasi informasi melalui kanal resmi OJK.',
  aboutTitle: 'Tentang CekPinjol.id',
  aboutDescription: 'Portal informasi komunitas untuk membantu masyarakat memahami risiko pinjaman online.',
  disclaimer: 'Informasi pada situs ini bukan nasihat keuangan. Verifikasi legalitas melalui sumber resmi.'
};

module.exports = { companies, publicSettings };
