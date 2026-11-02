# Panduan client: melepas permintaan QRIS yang macet

Dokumen ini menjelaskan cara menambahkan aksi **Lepaskan QRIS macet** ke aplikasi client yang menggunakan DeepSeek Monitor Self-Service API.

Aksi ini membuka blokir top-up pada gateway ketika pembuatan QRIS gagal sebelum kode QR diterima. Riwayat pembayaran tetap tersimpan. Aksi ini tidak membatalkan transaksi pada SingaPay.

## Persiapan integrasi

- Base URL production: `https://deepseek.nagatech.id`
- Buat **integration API key** untuk key DeepSeek yang akan digunakan client melalui dashboard **Client & key**.
- Gunakan integration API key, bukan API key DeepSeek asli. Simpan credential di secret manager backend client; jangan kirimkan credential ini ke browser.
- Endpoint dapat diautentikasi dengan `Authorization: Bearer <INTEGRATION_API_KEY>` atau header `X-Integration-Key`.

Integration API key hanya dapat mengakses saldo, penggunaan, dan top-up milik key DeepSeek yang dipasangkan dengannya.

## Kapan tombol ditampilkan

Periksa top-up aktif melalui:

```http
GET /api/v1/me/topups/active
```

Tampilkan tombol **Lepaskan QRIS macet** hanya jika respons top-up memiliki:

```json
{
  "method": "qris",
  "status": "needs_review",
  "canRelease": true
}
```

`canRelease` hanya bernilai `true` jika metode pembayaran QRIS, statusnya `needs_review` atau `failed`, kode QR belum tersedia, dan permintaan belum pernah dilepas. Jangan tampilkan tombol untuk QRIS aktif yang sudah memiliki kode atau untuk Virtual Account.

Jika tidak ada top-up aktif, endpoint `GET /api/v1/me/topups/active` merespons `404`. Client dapat menampilkan form pembuatan top-up seperti biasa.

## Melepas permintaan

### Endpoint

```http
POST /api/v1/me/topups/{merchantRef}/release
```

Ganti `{merchantRef}` dengan referensi dari respons top-up sebelumnya. URL-encode nilai tersebut saat menyusun URL. Request ini tidak memerlukan body maupun `Idempotency-Key`.

### Contoh request

```bash
curl -X POST \
  "https://deepseek.nagatech.id/api/v1/me/topups/${MERCHANT_REF}/release" \
  -H "Authorization: Bearer ${INTEGRATION_API_KEY}" \
  -H "Accept: application/json"
```

Panggil endpoint dari backend client. Jika aplikasi memiliki frontend, frontend sebaiknya memanggil backend milik client sendiri agar integration API key tidak terekspos.

### Respons berhasil

HTTP `201 Created`. Contoh berikut menggambarkan QRIS yang sebelumnya perlu ditinjau dan belum menghasilkan kode:

```json
{
  "amountIdr": 100000,
  "currency": "IDR",
  "method": "qris",
  "source": "singapay",
  "status": "needs_review",
  "merchantRef": "DSMVQGSAMPLE20261027001",
  "providerReference": null,
  "qrData": null,
  "vaNumber": null,
  "bankCode": null,
  "bankName": null,
  "expiresAt": null,
  "createdAt": "2026-10-27T09:10:00.000Z",
  "paidAt": null,
  "reviewReason": "SingaPay menolak pembuatan QRIS (HTTP 503).",
  "releasedAt": "2026-10-27T09:15:00.000Z",
  "canRelease": false
}
```

Setelah dilepas, `status` dapat tetap `needs_review` atau `failed`. Gunakan `releasedAt` untuk mengetahui bahwa blokir sudah dilepas; `canRelease` akan bernilai `false`. Tutup tampilan pembayaran lama, perbarui riwayat, lalu aktifkan kembali form top-up.

Jika respons menunjukkan `status: "paid"`, pembayaran telah terkonfirmasi. Perbarui saldo client dan jangan membuat pembayaran pengganti untuk transaksi tersebut.

## Membuat top-up baru

Setelah respons pelepasan memuat `releasedAt`, client dapat membuat top-up baru. Untuk QRIS, gunakan endpoint pembuatan yang sama dengan **Idempotency-Key baru**:

```bash
curl -X POST "https://deepseek.nagatech.id/api/v1/me/topups" \
  -H "Authorization: Bearer ${INTEGRATION_API_KEY}" \
  -H "Idempotency-Key: qris-attempt-20261027-002" \
  -H "Content-Type: application/json" \
  -d '{"amountIdr":100000}'
```

Setiap percobaan pembayaran baru harus menggunakan `Idempotency-Key` yang unik. Untuk mengulang request yang timeout dan hasilnya belum diketahui, gunakan key idempotensi yang sama sampai status percobaan tersebut diketahui.

## Penanganan error

| HTTP | Arti | Tindakan client |
|---|---|---|
| `401` | Integration API key tidak valid atau tidak dikirim | Periksa credential server-side. Jangan menggantinya dengan API key DeepSeek. |
| `404` | Top-up tidak ditemukan atau bukan milik key yang dipasangkan | Periksa `merchantRef` dan integration API key yang digunakan. |
| `409` | Top-up belum aman untuk dilepas, misalnya QRIS masih aktif atau kode QR sudah tersedia | Perbarui status pembayaran. Jangan membuat pengganti sampai statusnya jelas. |
| `503` | Gateway atau layanan pembayaran sedang tidak tersedia | Perbarui status; request pelepasan yang diulang aman untuk referensi yang sama. |

Jika QRIS SingaPay sedang tidak tersedia, endpoint ini hanya melepas blokir lokal di gateway; endpoint ini tidak memulihkan layanan QRIS. Client dapat menawarkan Virtual Account jika metode tersebut aktif pada akun merchant.

## Catatan pembayaran

- Permintaan yang dilepas tidak dihapus dari riwayat.
- Pelepasan tidak membatalkan pembayaran pada SingaPay.
- Jika callback pembayaran lama yang terverifikasi datang terlambat, gateway tetap mengkredit saldo satu kali.
- Jangan menyimpulkan pelepasan gagal hanya karena `status` masih `needs_review` atau `failed`; periksa `releasedAt`.

Referensi kontrak lengkap tersedia di [`openapi.yaml`](openapi.yaml).
