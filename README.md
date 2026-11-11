# Form Pengisian SKP Harian ASN — Sentra Handayani Jakarta

Aplikasi web statis untuk menyusun Laporan Kinerja Harian ASN, melengkapi identitas
pegawai dan tanda tangan, menambahkan dokumentasi kegiatan, lalu mengunduh laporan
dalam format A4 (PDF) atau mencetaknya langsung.

## Fitur

- Formulir identitas pegawai dengan format NIP otomatis dan pratinjau dokumen real-time.
- Tanggal kegiatan otomatis mengikuti tanggal hari ini; tanggal khusus yang dipilih
  manual tetap tersimpan.
- Daftar kegiatan: tambah, ubah, hapus (dengan urungkan), dan geser urutan.
- Dokumentasi kegiatan berupa foto, kamera langsung (dengan watermark waktu dan lokasi),
  atau lampiran dokumen.
- Tanda tangan digital dari berkas PNG/JPEG, disimpan di peramban.
- Pratinjau A4 dengan paginasi otomatis; blok tanda tangan selalu berada di sudut
  kanan bawah halaman terakhir dan halaman lanjutan membawa minimal satu kegiatan.
- Ekspor PDF multi-halaman dan mode cetak khusus dokumen.
- Data tersimpan otomatis di `localStorage` peramban; tidak ada data yang dikirim ke server.

## Menjalankan

Tidak perlu build atau server khusus. Buka `index.html` di peramban.

Untuk fitur kamera, gunakan alamat `localhost` atau HTTPS karena peramban membatasi
akses kamera pada berkas `file://`. Contoh server lokal:

```bash
npx serve .
# atau
python -m http.server 8000
```

## Publikasi ke GitHub Pages

1. Unggah seluruh isi folder ini ke repositori GitHub.
2. Buka **Settings → Pages**, pilih branch `main` dan folder `/ (root)`.
3. Situs siap diakses melalui `https://<pengguna>.github.io/<repositori>/`.

Berkas `.nojekyll` disertakan agar folder `vendor/` tetap disajikan apa adanya.

## Struktur

```
index.html          Struktur halaman dan ikon SVG
styles.css          Desain antarmuka, dokumen A4, responsif, dan gaya cetak
app.js              Data, formulir, kamera, paginasi, ekspor PDF
vendor/             html2canvas dan jsPDF (lokal, tanpa CDN)
Kementerian_Sosial.png
.nojekyll
```

## Catatan

- Data laporan hanya tersimpan di peramban yang digunakan. Gunakan tombol **Reset**
  untuk mengosongkan data.
- Ekspor PDF memakai html2canvas dan jsPDF yang disertakan secara lokal sehingga tetap
  berfungsi tanpa koneksi internet. Peta lokasi pada kamera memerlukan koneksi; bila
  gagal, foto tetap dibuat dengan keterangan lokasi teks.
- Tombol **Cetak** menjadi alternatif jika ekspor PDF dibatasi oleh peramban.
