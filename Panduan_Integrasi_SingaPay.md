# Tahapan Integrasi SingaPay untuk Proyek SaaS

Tanggal penyusunan: 27 Oktober 2026  
Cakupan: autentikasi, Virtual Account (VA), QRIS penerimaan pembayaran, serta callback VA dan QRIS. Dokumen ini adalah panduan tahapan; detail kontrak API harus dicocokkan kembali dengan dokumentasi resmi dan diuji di sandbox.

## 1. Persiapan

1. Aktifkan akun merchant dan kanal VA/QRIS yang dibutuhkan. Catat `client_id`, `client_secret`, API key/partner ID, dan `account_id` terkait.
2. Siapkan backend HTTPS dan database. Simpan kredensial dalam secret manager atau environment server; jangan memasukkannya ke aplikasi frontend, repository, atau log.
3. Siapkan konfigurasi terpisah:

| Lingkungan | Base URL |
|---|---|
| Sandbox | `https://sandbox-payment-b2b.singapay.id` |
| Production | `https://payment-b2b.singapay.id` |

4. Daftarkan IP keluar server di dashboard bila diwajibkan. Untuk callback, minta daftar IP resmi SingaPay dan pastikan konfigurasi proxy meneruskan IP yang benar.
5. Daftarkan URL HTTPS publik untuk `transaction_notif_url`. VA dan QRIS dapat berbagi URL ini; backend menentukan jenis transaksi melalui `event`.
6. Pisahkan data berdasarkan `tenant_id` dan merchant/account yang sesuai. Pastikan setiap invoice memiliki referensi internal unik.

## 2. Autentikasi

1. Minta token di `POST /api/v1.1/access-token/b2b` dengan `grant_type=client_credentials`.
2. Materi autentikasi yang diberikan menjelaskan `Authorization: Basic base64(client_id:client_secret)`, `X-PARTNER-ID`, dan `Content-Type`. Namun [halaman signature resmi](https://docs.singapay.id/api-reference/building-x-signature) juga menyatakan endpoint v1.1 menggunakan `X-CLIENT-ID` dan `X-Signature`:

   ```text
   payload = client_id + '_' + client_secret + '_' + YYYYMMDD
   signature = HMAC-SHA512(payload, client_secret) dalam lowercase hex
   ```

   `YYYYMMDD` memakai tanggal Asia/Jakarta. **Kedua halaman tidak menjelaskan persyaratan header secara konsisten. Konfirmasi kombinasi header yang berlaku dengan SingaPay dan verifikasi di sandbox sebelum implementasi produksi.** Jangan menganggap contoh tanggal UTC sebagai tanggal WIB.
3. Simpan token dan masa kedaluwarsanya secara aman; gunakan kembali hingga mendekati kedaluwarsa, lalu minta token baru. Hindari banyak refresh bersamaan.
4. Untuk panggilan API setelahnya, kirim `Authorization: Bearer <access_token>`, `X-PARTNER-ID`, dan `Content-Type: application/json` sesuai endpoint. Jangan tampilkan token ke pengguna.

## 3. Persiapan data pembayaran

1. Backend memvalidasi tenant, hak akses, invoice, nominal dari sumber server, dan status invoice.
2. Buat catatan `payment_attempt` sebelum menghubungi SingaPay: `tenant_id`, `invoice_id`, referensi unik, metode, nominal, mata uang, status internal, dan waktu pembuatan. Referensi harus menghindari benturan lintas tenant dan project.
3. Simpan ID account/merchant, ID transaksi dari provider, tanggal kedaluwarsa dan data tampilan yang dikembalikan. Lindungi data pribadi dan jangan mencatat rahasia.
4. Model status internal yang disarankan: `creating`, `pending`, `paid`, `expired`, `failed`, dan `needs_review`. Petakan status provider sesuai dokumentasi; simpan juga status asli. `paid` dan `settled` bukan hal yang sama.

## 4. Pembuatan Virtual Account

1. Pilih bank dan model VA sesuai kebutuhan: temporary atau permanent; `closed` untuk nominal tetap dan `open` untuk nominal fleksibel. Untuk invoice SaaS satu kali, evaluasi temporary dan nominal tetap sesuai dukungan merchant.
2. Buka [dokumentasi Virtual Account](https://docs.singapay.id/api-reference/virtual-account/introduction), lalu bagian **POST Create**. Verifikasi URL, field wajib, batas nominal, waktu kedaluwarsa, dan aturan keunikan untuk bank/merchant Anda. Detail endpoint create belum diverifikasi dalam dokumen ini; jangan menebaknya.
3. Backend mengirim request create menggunakan token dan menyimpan respons beserta ID/nomor VA dan kaitan ke invoice.
4. Tampilkan nomor VA, bank, jumlah dan tenggat kepada pelanggan. Anggap pembuatan VA sukses sebagai **menunggu pembayaran**, bukan pembayaran lunas.
5. VA adalah instrumen, sedangkan VA Transaction adalah catatan pembayaran. Satu VA dapat menerima lebih dari satu transaksi; cocokkan pembayaran menggunakan ID transaksi, nominal, account, serta invoice. Jangan mendeduplikasi semua pembayaran berdasarkan nomor VA saja.
6. Untuk timeout saat pembuatan, periksa hasil dan kemampuan pencarian/idempotensi berdasarkan kontrak VA resmi sebelum mencoba ulang. Jika hasil masih tidak pasti, tandai `needs_review`.

## 5. Pembuatan QRIS dinamis

1. Pastikan account aktif, kanal QRIS tersedia, dan nominal memenuhi batas merchant. Sub-account terkelola yang belum selesai KYB tidak dapat membuat QRIS.
2. Backend mengirim `POST /api/v1.0/qris-dynamic/{account_id}/generate-qr` dengan Bearer token dan partner ID. Contoh bentuk body:

   ```json
   {
     "amount": 10000,
     "expired_at": "2027-01-01T12:00:00+07:00",
     "merchant_reff_no": "INV-UNIK-001"
   }
   ```

   Nilai contoh harus diganti. `expired_at` opsional; halaman endpoint menyebut default satu jam dan waktu tanpa offset diinterpretasikan sebagai WIB. Gunakan waktu dengan offset eksplisit.
3. Simpan ID QRIS dari respons, referensi, nominal, expiry dan status. Render `qr_data` sebagai gambar QR dan tampilkan nominal serta tenggat. Status `open` berarti menunggu pembayaran.
4. QRIS ini untuk satu transaksi, nominal tetap, dan satu kali pembayaran. Buat QR baru untuk transaksi lain.
5. **Endpoint generate tidak idempoten:** `merchant_reff_no` tidak dijamin unik oleh SingaPay. Jangan mengirim ulang secara otomatis setelah timeout. Cari transaksi dengan `GET /api/v1.0/qris-dynamic/{account_id}`, filter rentang `created_at_from`/`created_at_to` dan `amount`, lalu cocokkan `merchant_reff_no` pada hasil. Tangani pagination dan jika lebih dari satu hasil cocok, lakukan review.
6. Sumber resmi overview dan endpoint berbeda mengenai default expiry; gunakan ketentuan spesifik endpoint di atas, tetapkan expiry eksplisit, dan konfirmasi di sandbox.

## 6. Callback VA dan QRIS

1. SingaPay mengirim HTTP `POST` JSON ke `transaction_notif_url`. Routing berdasarkan `event`:

   | Event | Penanganan |
   |---|---|
   | `va-transaction` | Pembayaran VA |
   | `qris-acquirer-transaction` | Pembayaran QRIS masuk |

2. Pertahankan raw body dan header yang diterima. Validasi `X-PARTNER-ID`, timestamp, dan `X-Signature` sesuai [Security and Signature Validation](https://docs.singapay.id/api-reference/webhooks/security-and-signature). Gunakan path **publik** yang didaftarkan, termasuk query string jika ada, meskipun reverse proxy mengubah path menuju backend. Cocokkan signature secara constant-time. Batasi IP sumber apabila daftar resmi tersedia.
3. Dokumentasi menyebut HMAC-SHA512 dengan client secret atas `METHOD:ENDPOINT:ACCESS_TOKEN:HASHED_BODY:TIMESTAMP`; hash body SHA-256. Dokumen juga menyebut normalisasi JSON dengan pengurutan key rekursif, tetapi di bagian lain menyebut hash raw body langsung. **Ini perlu dikonfirmasi dengan SingaPay dan diuji menggunakan contoh callback nyata/test vector sebelum production**; jangan menerima callback tanpa validasi hanya untuk mengatasi mismatch.
4. Setelah signature valid, simpan event secara durable sebelum membalas sukses; gunakan unique constraint atas identitas event/transaksi yang stabil, termasuk account/merchant dan tipe event. Balas HTTP 2xx dengan cepat setelah tersimpan atau setelah diketahui duplikat. Gagal signature: 401. Bila penyimpanan gagal, berikan error agar pengiriman dapat dicoba kembali.
5. Worker memproses event secara idempoten: cari payment attempt yang tepat, pastikan tenant, account, jenis, status dan nominal sesuai; bila tidak cocok, masukkan antrean investigasi. Update invoice dan aktivasi layanan tepat satu kali dalam transaksi database atau pola outbox.
6. Jangan menurunkan status `paid` akibat event lama. Tangani pembayaran terlambat, transaksi yang tidak ditemukan, overpayment/underpayment VA terbuka dan dua pembayaran untuk invoice yang sama melalui alur review/refund sesuai kebijakan merchant.
7. Event tidak dikenal dicatat untuk investigasi dan direspons sesuai kontrak callback; jangan mengubah invoice. Jangan mengandalkan redirect browser sebagai bukti pembayaran.

## 7. Rekonsiliasi dan operasional

1. Sediakan job berkala untuk mengecek transaksi pending atau hasil request yang tidak pasti melalui endpoint status/list yang sesuai. Cocokkan hasil dengan transaksi provider dan catatan internal.
2. Bedakan status pembayaran, settlement, dan aktivasi subscription. Pastikan proses aktivasi aman dijalankan ulang; proses koreksi atau pengembalian dana harus memiliki jejak audit.
3. Catat metrik request gagal, callback tidak valid, antrean gagal, pembayaran tidak cocok dan transaksi yang terlalu lama pending. Jangan mencatat token, secret, nomor VA lengkap, atau payload sensitif secara sembarangan.
4. Isolasi secret, token, callback, dan account untuk sandbox dan produksi. Lakukan rotasi secret dan siapkan prosedur penanganan insiden.

## 8. Checklist sebelum produksi

- [ ] Klarifikasi perbedaan dokumentasi token v1.1 dan uji kombinasi header.
- [ ] Verifikasi endpoint dan seluruh field Create VA dengan dokumentasi resmi terbaru.
- [ ] Klarifikasi normalisasi signature webhook dengan test vector resmi; uji request yang dimodifikasi dan signature palsu.
- [ ] Uji VA dan QRIS: pembayaran berhasil, kedaluwarsa, duplikat, timeout create, callback terlambat/tidak berurutan, nominal tidak cocok, dan callback yang dikirim ulang.
- [ ] Uji isolasi tenant, penguncian transaksi, invoice dibayar tepat satu kali, serta recovery worker.
- [ ] Verifikasi callback publik HTTPS, pengaturan proxy/path, IP whitelist dan jam server.
- [ ] Uji rekonsiliasi dengan data provider serta prosedur review dan pemulihan.
- [ ] Verifikasi kredensial, account, batas nominal, biaya, serta pengaturan settlement untuk merchant produksi.

## Referensi resmi

- [Indeks dokumentasi](https://docs.singapay.id/llms.txt) — tidak dapat diakses saat penyusunan; halaman lain ditemukan melalui pencarian.
- [Authentication](https://docs.singapay.id/api-reference/authentication) dan [Building X-Signature](https://docs.singapay.id/api-reference/building-x-signature).
- [Virtual Account overview](https://docs.singapay.id/api-reference/virtual-account/introduction).
- [Generate QRIS](https://docs.singapay.id/api-reference/qris-money-in/generate) dan [QRIS list](https://docs.singapay.id/api-reference/qris-money-in/list).
- [VA webhook](https://docs.singapay.id/api-reference/webhooks/va-transaction), [QRIS webhook](https://docs.singapay.id/api-reference/webhooks/qris-acquirer), [shared endpoints](https://docs.singapay.id/api-reference/webhooks/shared-endpoints), dan [webhook security](https://docs.singapay.id/api-reference/webhooks/security-and-signature).
