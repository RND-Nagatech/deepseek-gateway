# Migrasi dari DeepSeek langsung ke gateway

Panduan ini menjelaskan cara mengalihkan aplikasi client dari endpoint DeepSeek langsung ke DeepSeek Monitor Gateway. API key DeepSeek client tetap digunakan; perubahan utamanya adalah mendaftarkan key, menyiapkan saldo, lalu mengganti base URL.

## Gambaran alur

Sebelum migrasi, aplikasi client mengirim request langsung ke DeepSeek:

```text
aplikasi client → https://api.deepseek.com → DeepSeek
```

Setelah migrasi, request melewati gateway:

```text
aplikasi client → https://deepseek.nagatech.id/api/proxy → DeepSeek Monitor → DeepSeek
```

Gateway mengenali client dari API key DeepSeek yang sudah didaftarkan, meneruskan key tersebut ke DeepSeek, mencatat penggunaan, lalu mengurangi biaya dari saldo key yang sama.

## Sebelum mulai

- Siapkan server gateway yang bisa dijangkau aplikasi client.
- Pastikan MongoDB terhubung dan gateway berstatus sehat di `/api/health`.
- Gunakan `npm run dev` untuk meneruskan request ke DeepSeek asli. `npm run dev:demo` memakai mock lokal dan hanya untuk uji coba.
- Siapkan nama client, API key DeepSeek yang sedang dipakai, serta saldo awal minimal Rp10 untuk setiap key.
- Tentukan harga token setiap client di halaman **Tarif per client**. Client baru memakai tarif awal Rp50.000 per 1 juta token.

Untuk penggunaan di satu komputer, alamat gateway bawaan adalah:

```text
http://127.0.0.1:3002/api/proxy
```

Untuk client di komputer lain, publikasikan domain melalui reverse proxy atau load balancer HTTPS. Jika reverse proxy berjalan pada host yang sama, pertahankan backend pada `HOST=127.0.0.1`; jika backend berada di host/container berbeda, bind ke interface privat yang dapat dijangkau reverse proxy dan batasi dengan firewall. Gateway backend sendiri melayani HTTP. Sesuaikan `MONGODB_URI` dengan server MongoDB yang digunakan.

## Hubungkan domain ke backend

Untuk domain yang Anda berikan, base URL aplikasi client adalah:

```text
https://deepseek.nagatech.id/api/proxy
```

Domain saja belum cukup. Reverse proxy di server domain harus meneruskan path `/api/proxy/` ke backend gateway, secara default pada `http://127.0.0.1:3002/api/proxy/`. Pastikan header `Authorization` diteruskan dan buffering respons dimatikan untuk mendukung streaming. Halaman root domain boleh dilayani terpisah dari API gateway.

Uji routing tanpa mengirim API key:

```sh
curl -i https://deepseek.nagatech.id/api/proxy/chat/completions
```

Respons `401` dari gateway menandakan route `/api/proxy` sudah sampai ke backend; `404` berarti reverse proxy atau route domain belum mengarah ke gateway. Jangan alihkan client sungguhan sebelum pemeriksaan ini lolos.

## 1. Siapkan konfigurasi gateway

Salin `backend/.env.example` menjadi `backend/.env`, lalu atur nilai lingkungan untuk server Anda. Contoh:

```dotenv
PORT=3002
HOST=127.0.0.1
MONGODB_URI=mongodb://127.0.0.1:27017/deepseek_monitor
DEEPSEEK_BASE_URL=https://api.deepseek.com
ADMIN_TOKEN=GANTI_DENGAN_TOKEN_ADMIN_YANG_KUAT
KEY_HASH_SECRET=GANTI_DENGAN_SECRET_RANDOM_YANG_STABIL
DEFAULT_PRICE_PER_MILLION_IDR=50000
```

Ganti nilai token dan secret sebelum menjalankan server yang dapat diakses melalui jaringan. `DEFAULT_PRICE_PER_MILLION_IDR` menentukan tarif awal client baru. Tarif client lama dari pengaturan global sebelumnya akan disalin saat backend pertama kali dimulai setelah update. `ADMIN_TOKEN` dipakai untuk membuka dashboard dan API pengelolaannya; nilainya berbeda dari API key DeepSeek client. Buat `KEY_HASH_SECRET` sebelum mendaftarkan key pertama, lalu pertahankan nilainya; menggantinya membuat fingerprint key lama tidak cocok lagi. Jangan gunakan token contoh lokal jika dashboard dapat diakses dari jaringan.

Jalankan aplikasi dari direktori proyek:

```sh
npm install --include=optional
npm run dev
```

Dashboard tersedia di `http://127.0.0.1:5174` dan endpoint kesehatan di `http://127.0.0.1:3002/api/health`.

## 2. Daftarkan key dan isi saldo

1. Buka **Client & key** di dashboard dan masuk dengan token admin.
2. Pilih **Daftarkan client**, masukkan nama yang mudah dikenali, lalu masukkan API key DeepSeek client yang sudah dipakai aplikasi.
3. Buka **Tambah saldo** pada key tersebut dan isi saldo minimal Rp10. Setiap key mempunyai saldo sendiri.
4. Ulangi untuk setiap client atau key yang akan dimigrasikan.

Key yang didaftarkan adalah key provider milik client, bukan `ADMIN_TOKEN`. Gateway menyimpan fingerprint dan petunjuk key yang disamarkan, bukan nilai key mentah. Karena nilai mentah tidak dapat diambil kembali dari dashboard, simpan key di secret manager atau konfigurasi aman milik aplikasi client.

## 3. Ubah base URL aplikasi client

Pertahankan API key dan pengaturan request yang sudah ada. Ubah base URL dari `https://api.deepseek.com` menjadi `https://deepseek.nagatech.id/api/proxy`. Domain gateway yang Anda berikan adalah `https://deepseek.nagatech.id`; suffix `/api/proxy` diperlukan karena route API gateway berada di bawah path tersebut.

Gunakan API key DeepSeek yang sama dengan key yang didaftarkan pada pasangan client dan key. Gateway menerima key melalui `Authorization: Bearer <DEEPSEEK_API_KEY>` dan `X-Api-Key: <DEEPSEEK_API_KEY>`. Jangan mengganti key ini dengan integration API key.

### Contoh Python

```python
import os
from openai import OpenAI

client = OpenAI(
    api_key=os.environ["DEEPSEEK_API_KEY"],
    base_url=os.environ.get(
        "DEEPSEEK_CLIENT_BASE_URL",
        "https://api.deepseek.com",
    ),
)
```

Untuk migrasi, ubah nilai lingkungan aplikasi client `DEEPSEEK_CLIENT_BASE_URL`:

```dotenv
DEEPSEEK_CLIENT_BASE_URL=https://deepseek.nagatech.id/api/proxy
```

### Contoh Node.js

```js
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: process.env.DEEPSEEK_CLIENT_BASE_URL ?? "https://api.deepseek.com",
});
```

Atur `DEEPSEEK_CLIENT_BASE_URL=https://deepseek.nagatech.id/api/proxy` pada lingkungan aplikasi. SDK akan menambahkan path endpoint, misalnya `/chat/completions` atau `/responses`. Di sisi backend, `DEEPSEEK_BASE_URL` tetap menunjuk ke provider (`https://api.deepseek.com`); jangan ubah setting backend itu menjadi alamat gateway karena akan membuat proxy mengarah kembali ke dirinya sendiri.

`DEEPSEEK_CLIENT_BASE_URL` adalah nama variabel contoh untuk aplikasi client. Jika aplikasi memakai nama konfigurasi base URL lain, ubah nilai pada variabel yang memang dibaca aplikasi tersebut.

### Contoh curl

```sh
export DEEPSEEK_GATEWAY_URL="https://deepseek.nagatech.id/api/proxy"

curl "${DEEPSEEK_GATEWAY_URL}/chat/completions" \
  -H "Authorization: Bearer ${DEEPSEEK_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-chat",
    "messages": [{"role": "user", "content": "Halo"}]
  }'
```

Di konfigurasi client, base URL harus menunjuk ke root `/api/proxy`; jangan menambahkan `/chat/completions` ke nilai `baseURL` jika SDK sudah menambahkan path itu sendiri. Untuk `curl`, tambahkan path endpoint pada URL seperti contoh di atas.

## 4. Uji tanpa memanggil DeepSeek asli

Untuk uji lokal, hentikan server `npm run dev` yang sedang berjalan agar port tidak bentrok, lalu jalankan:

```sh
npm run dev:demo
```

Mode ini mengarahkan gateway ke mock lokal. Daftarkan key demo persis `sk-local-demo`, top-up Rp10, lalu panggil:

```sh
curl http://127.0.0.1:3002/api/proxy/chat/completions \
  -H 'Authorization: Bearer sk-local-demo' \
  -H 'Content-Type: application/json' \
  -d '{"model":"deepseek-chat","messages":[{"role":"user","content":"Halo"}]}'
```

Mock menghasilkan 200 token yang ditagihkan. Dengan tarif Rp50.000 per 1 juta token, biayanya Rp10 dan saldo key demo menjadi Rp0. Request berikutnya ditolak sebelum mock dipanggil. **Jangan daftarkan key DeepSeek asli sebagai key demo**; gunakan `npm run dev` untuk meneruskan request ke DeepSeek asli.

## 5. Verifikasi setelah dialihkan

Setelah client memakai base URL gateway:

1. Kirim satu request kecil dan pastikan aplikasi menerima respons DeepSeek.
2. Buka **Riwayat request** dan pastikan request tercatat dengan client, model, token, dan biaya yang benar.
3. Buka **Client & key** dan pastikan saldo key berkurang.
4. Pastikan request yang memakai streaming juga berfungsi jika aplikasi menggunakannya.

Gateway menghitung token input dan output. Cache hit dan cache miss ditampilkan sebagai rincian input, bukan token tambahan yang dihitung dua kali. Request yang dikirim langsung ke DeepSeek tanpa melewati `/api/proxy` tidak muncul di dashboard gateway dan tidak mengurangi saldo gateway.

## Ambil saldo dan penggunaan untuk dashboard client

Aplikasi client dapat menyediakan halaman saldo dan penggunaan sendiri tanpa memberi akses ke dashboard internal. Untuk itu, gunakan **integration API key** yang dibuat untuk masing-masing pasangan key DeepSeek di halaman **Client & key**. Salin secret saat dibuat dan simpan di secret manager backend aplikasi client. Secret hanya ditampilkan saat diterbitkan; membuat ulang akan mengganti credential lama.

Integration API key berbeda dari API key DeepSeek:

| Credential | Untuk | Endpoint |
| --- | --- | --- |
| API key DeepSeek client | Memanggil model melalui gateway | `/api/proxy/*` |
| Integration API key | Membaca saldo, usage, dan membuat top-up untuk satu key | `/api/v1/me/*` |
| Admin token | Mengelola dashboard internal | Endpoint admin `/api/*` |

Integration key hanya bisa membaca data key DeepSeek yang dipasangkan dengannya. Jangan gunakan API key DeepSeek untuk endpoint self-service, atau integration key untuk memanggil model. Jangan letakkan integration key atau admin token di JavaScript browser, aplikasi mobile, atau repositori. Browser client sebaiknya meminta data ke backend aplikasi client sendiri; backend itu yang meneruskan permintaan ke gateway.

Setiap request self-service menerima salah satu header berikut:

~~~http
Authorization: Bearer <INTEGRATION_API_KEY>
~~~

atau:

~~~http
X-Integration-Key: <INTEGRATION_API_KEY>
~~~

Contoh menyiapkan variabel pada server client:

~~~sh
export GATEWAY_URL="https://deepseek.nagatech.id"
export INTEGRATION_API_KEY="dsm_int_ganti_dengan_secret_yang_diterbitkan"
~~~

### Baca saldo key

Panggil endpoint ini untuk menampilkan saldo terkini, status key, batas minimum request, dan informasi top-up terakhir:

~~~sh
curl "$GATEWAY_URL/api/v1/me/balance" -H "Authorization: Bearer $INTEGRATION_API_KEY"
~~~

Contoh respons:

~~~json
{
  "account": {
    "clientId": "665f00000000000000000001",
    "clientName": "Client Contoh",
    "keyId": "665f00000000000000000002",
    "keyHint": "sk-abcd…wxyz"
  },
  "balanceIdr": 99500,
  "currency": "IDR",
  "minimumBalanceForRequestIdr": 10,
  "canMakeRequest": true,
  "status": { "client": "active", "key": "active" },
  "topUps": {
    "count": 1,
    "last": { "amountIdr": 100000, "createdAt": "2026-11-03T03:00:00.000Z" }
  }
}
~~~

Saldo dapat menjadi negatif bila request dimulai saat saldo minimal Rp10 atau lebih, lalu biaya akhir request melebihi saldo. Top-up menambah saldo berjalan. Tampilkan `canMakeRequest` dan `balanceIdr` dari respons ini, bukan nilai yang disimpan permanen di aplikasi client.

### Ambil ringkasan untuk kartu dan grafik

`GET /api/v1/me/usage/summary` mengembalikan total request, error, token, biaya, status, dan seri harian. Tanpa filter tanggal, periode default adalah 30 hari terakhir. Kirim `from` dan `to` sebagai waktu ISO 8601 jika dashboard menyediakan pemilih periode. `from` termasuk dalam rentang, sedangkan `to` tidak termasuk. Rentang summary maksimal 366 hari. Seri harian memakai zona waktu `Asia/Jakarta`.

~~~sh
curl --get "$GATEWAY_URL/api/v1/me/usage/summary" -H "Authorization: Bearer $INTEGRATION_API_KEY" --data-urlencode "from=2026-11-01T00:00:00+07:00" --data-urlencode "to=2026-11-04T00:00:00+07:00"
~~~

Contoh ringkasan:

~~~json
{
  "period": {
    "from": "2026-10-31T17:00:00.000Z",
    "to": "2026-11-03T17:00:00.000Z",
    "timeZone": "Asia/Jakarta"
  },
  "totals": {
    "requests": 12,
    "errors": 1,
    "confirmedRequests": 11,
    "tokens": {
      "input": 4000,
      "cacheHit": 3000,
      "cacheMiss": 1000,
      "output": 1000,
      "billable": 5000
    },
    "costIdr": 250
  },
  "byStatus": {
    "pending": 0,
    "confirmed": 11,
    "unavailable": 0,
    "not_metered": 0,
    "insufficient_balance": 1
  },
  "series": [
    { "date": "2026-11-03", "requests": 12, "tokens": 5000, "costIdr": 250 }
  ]
}
~~~

Gunakan `totals` untuk kartu ringkasan dan `series` untuk grafik. `requests` dan `errors` menghitung semua event dalam periode; total token dan biaya hanya menjumlahkan event dengan status `confirmed`. `byStatus` membantu menjelaskan request yang belum atau tidak dapat dihitung.

### Ambil rincian request dan riwayat token

~~~sh
curl --get "$GATEWAY_URL/api/v1/me/usage" -H "Authorization: Bearer $INTEGRATION_API_KEY" --data-urlencode "from=2026-11-01T00:00:00+07:00" --data-urlencode "to=2026-11-04T00:00:00+07:00" --data-urlencode "limit=50"
~~~

Rute ini mengembalikan event terbaru lebih dulu. Nilai `limit` bisa 1 sampai 100 dan default-nya 50. Jika `pagination.nextCursor` bukan `null`, kirim nilainya sebagai `cursor` pada request berikutnya dan pertahankan filter `from`/`to` yang sama.

~~~json
{
  "data": [
    {
      "id": "665f00000000000000000003",
      "requestId": "a9f47f20-8c07-4a57-94da-2bf54a198c36",
      "path": "/chat/completions",
      "method": "POST",
      "model": "deepseek-chat",
      "statusCode": 200,
      "usageStatus": "confirmed",
      "inputTokens": 4000,
      "cacheHitTokens": 3000,
      "cacheMissTokens": 1000,
      "outputTokens": 1000,
      "totalTokens": 5000,
      "billableTokens": 5000,
      "costIdr": 250,
      "pricePerMillionIdr": 50000,
      "startedAt": "2026-11-03T03:10:00.000Z",
      "finishedAt": "2026-11-03T03:10:02.100Z",
      "latencyMs": 2100
    }
  ],
  "pagination": { "limit": 50, "nextCursor": null }
}
~~~

Status usage yang mungkin muncul:

| `usageStatus` | Arti untuk dashboard |
| --- | --- |
| `confirmed` | Provider mengembalikan usage; token dan biaya tercatat. |
| `pending` | Request sedang diproses atau pencatatan belum selesai. |
| `unavailable` | Usage tidak tersedia, misalnya provider tidak mengirim rincian token. `costIdr` dapat bernilai `null` dan tidak ada pemotongan saldo untuk biaya yang tidak diketahui. |
| `not_metered` | Endpoint non-usage tidak mengembalikan rincian token; tidak ada biaya token yang dicatat. |
| `insufficient_balance` | Gateway menolak request sebelum meneruskannya karena saldo di bawah Rp10. |

Simpan nilai `costIdr` sebagai angka, jangan membulatkan sebelum melakukan agregasi. Nilainya bisa pecahan rupiah. Untuk event yang belum memiliki hasil usage, `inputTokens`, `outputTokens`, `billableTokens`, `costIdr`, atau tarif dapat bernilai `null`.

Untuk request streaming, gateway membaca rincian usage dari event SSE provider. Gateway tidak memperkirakan token dari teks yang terlihat. Jika stream tidak menyertakan rincian usage, event akan berstatus `unavailable` dan biayanya tidak dipotong.

### Rumus token dan biaya

Gateway memakai nilai input dan output yang dikembalikan provider:

~~~text
billableTokens = inputTokens + outputTokens
costIdr = billableTokens / 1.000.000 × pricePerMillionIdr milik client
~~~

Cache hit dan cache miss merupakan rincian dari input, bukan token tambahan di luar input. Contoh tarif Rp50.000 per 1 juta token:

~~~text
input                 = 4.000 token
  cache hit           = 3.000 token  (bagian dari input)
  cache miss          = 1.000 token  (bagian dari input)
output                = 1.000 token
billable              = 4.000 + 1.000 = 5.000 token
biaya                 = 5.000 / 1.000.000 × Rp50.000 = Rp250
~~~

Tarif disetel per client, sementara saldo dan usage dipisahkan per key. Jika satu client mempunyai beberapa key DeepSeek, masing-masing key memiliki saldo dan integration API key sendiri, tetapi memakai tarif client yang sama. Tarif yang berlaku saat request dimulai disimpan pada event tersebut; perubahan tarif hanya memengaruhi request selanjutnya.

### Membuat dashboard penggunaan

Pola integrasi yang disarankan:

1. Saat halaman akun dibuka, backend aplikasi client mengambil `/balance` dan `/usage/summary`.
2. Gunakan `totals` untuk angka ringkasan seperti jumlah request, token tertagih, total biaya, dan error.
3. Gunakan `series` untuk grafik harian.
4. Gunakan `/usage` untuk tabel riwayat. Terapkan tanggal dan paginasi memakai `from`, `to`, `limit`, dan `cursor`.
5. Setelah request model selesai, refresh saldo atau ringkasan di backend client agar biaya yang baru selesai diproses terlihat.
6. Tampilkan status `unavailable` dengan jelas. Jangan menganggap token atau biaya yang `null` sebagai nol token yang sudah terkonfirmasi.

API ini hanya menampilkan request yang melewati gateway. Pemakaian yang langsung dikirim ke `api.deepseek.com` tetap berada di dashboard DeepSeek dan tidak ada di data gateway.

### Top-up dari aplikasi client

Integration API key yang sama juga dapat membuat dan memeriksa top-up untuk key yang dipasangkan:

| Kebutuhan | Rute |
| --- | --- |
| Buat QRIS | `POST /api/v1/me/topups` |
| Buat Virtual Account | `POST /api/v1/me/topups/va` |
| Lihat riwayat top-up | `GET /api/v1/me/topups?limit=50` |
| Lihat top-up aktif atau perlu ditinjau | `GET /api/v1/me/topups/active` |
| Periksa status berdasarkan referensi | `GET /api/v1/me/topups/{merchantRef}` |
| Minta pemeriksaan status ke penyedia | `POST /api/v1/me/topups/{merchantRef}/reconcile` |
| Pulihkan permintaan QRIS gagal yang tidak mempunyai data QR/VA | `POST /api/v1/me/topups/{merchantRef}/release` |
| Cari ulang dan, bila aman, buat pengganti | `POST /api/v1/me/topups/{merchantRef}/retry` |

Setiap pembuatan top-up harus mengirim `Idempotency-Key` unik sepanjang 8 sampai 128 karakter. Jika request timeout, ulangi dengan key idempotensi yang sama. QRIS menggunakan nominal rupiah bulat dari Rp1 sampai Rp1.000.000.000. VA menerima nominal minimal Rp10.000 dan memerlukan `bankCode`, misalnya `BCA`; bank yang dapat dipakai mengikuti aktivasi akun merchant SingaPay.

Contoh membuat QRIS:

~~~sh
curl "$GATEWAY_URL/api/v1/me/topups" -X POST -H "Authorization: Bearer $INTEGRATION_API_KEY" -H "Idempotency-Key: topup-qris-20261103-client01" -H "Content-Type: application/json" -d '{"amountIdr":50000}'
~~~

Contoh membuat VA:

~~~sh
curl "$GATEWAY_URL/api/v1/me/topups/va" -X POST -H "Authorization: Bearer $INTEGRATION_API_KEY" -H "Idempotency-Key: topup-va-20261103-client01" -H "Content-Type: application/json" -d '{"amountIdr":50000,"bankCode":"BCA"}'
~~~

Respons pembuatan pembayaran bukan bukti saldo bertambah. Tampilkan `qrData` sebagai QRIS atau `bankName`, `bankCode`, `vaNumber`, nominal, dan `expiresAt` sebagai instruksi VA. Saldo baru bertambah setelah callback SingaPay terverifikasi. Jika callback terlambat, periksa status top-up atau panggil `reconcile`, lalu baca ulang `/balance`. Jangan membuat transaksi pengganti selama pembayaran lama masih mungkin dibayar. Operasi `release` hanya membuka kembali alur di gateway; operasi ini tidak membatalkan pembayaran di SingaPay atau menghapus riwayat. Pembayaran lama yang masuk terlambat tetap dapat menambah saldo. Operasi `retry` hanya membuat pengganti setelah pencarian provider selesai dan menyatakan pembayaran lama tidak ada atau sudah kedaluwarsa. Ketersediaan QRIS sandbox mengikuti kondisi acquirer SingaPay; bila provider mengembalikan maintenance, periksa transaksi lama sebelum mencoba pengganti.

Detail semua field, bank code, status, dan respons error ada di [openapi.yaml](openapi.yaml).

Error self-service yang umum:

| HTTP | Arti | Tindakan |
| --- | --- | --- |
| `400` | Tanggal, cursor, nominal, bank code, atau header idempotensi tidak valid | Periksa format dan batas field di OpenAPI. |
| `401` | Integration API key hilang, salah, dicabut, atau tidak aktif | Terbitkan credential baru dari dashboard internal dan perbarui secret backend client. |
| `404` | Referensi top-up tidak dimiliki key tersebut atau tidak ada top-up aktif untuk dipulihkan | Pastikan memakai `merchantRef` dari respons key yang sama. |
| `409` | Idempotency key dipakai ulang dengan nominal berbeda atau pencarian pembayaran belum meyakinkan | Periksa status dan riwayat dahulu; jangan membuat permintaan baru secara otomatis. |
| `503` | Database atau layanan pembayaran sementara tidak tersedia | Tampilkan kegagalan dan izinkan pengguna memeriksa ulang status sebelum retry. |
| `500` | Kesalahan internal yang tidak dapat dipulihkan oleh client | Simpan request ID bila tersedia dan hubungi operator gateway. |

### Rute khusus dashboard internal

Rute berikut ditujukan untuk dashboard operator, bukan untuk dibagikan ke aplikasi client:

| Rute | Data |
| --- | --- |
| `GET /api/overview?days=30` | Ringkasan lintas client untuk 1 sampai 90 hari. |
| `GET /api/clients` | Daftar client, tarif per client, saldo per key, dan statistik pemakaian. |
| `GET /api/usage?limit=100` | Riwayat terbaru lintas client; dapat difilter dengan `clientId`. |
| `PATCH /api/clients/{clientId}/pricing` | Mengubah tarif per 1 juta token milik satu client. |

Semua rute internal ini memerlukan header `X-Admin-Token`. Simpan token hanya di server operator. Gunakan API self-service `/api/v1/me/*` untuk dashboard client agar data hanya mengacu pada key yang dipasangkan.

## Aturan saldo dan error

- Saldo minimal **Rp10** diperlukan sebelum request diteruskan ke DeepSeek.
- Jika saldo kurang dari Rp10, gateway menolak request dengan HTTP `402 Payment Required` dan kode `INSUFFICIENT_PREPAID_BALANCE`.
- Request yang dimulai dengan saldo Rp10 atau lebih tetap diteruskan, walaupun biaya akhirnya melebihi saldo. Contohnya, saldo Rp100 dengan biaya Rp120 menjadi -Rp20.
- Top-up ditambahkan ke saldo saat ini. Dari -Rp20, top-up Rp30 menghasilkan Rp10 sehingga key dapat dipakai lagi. Saldo harus mencapai Rp10 untuk membuka request berikutnya.
- Biaya dihitung setelah DeepSeek mengembalikan jumlah penggunaan token. Request dengan penggunaan yang tidak dikembalikan provider tercatat sebagai tidak dapat dihitung dan tidak mengurangi saldo.

Contoh respons saat saldo di bawah batas:

```http
HTTP/1.1 402 Payment Required
Content-Type: application/json

{"error":{"message":"API key balance is below Rp10. Top up this key to at least Rp10 before retrying.","type":"insufficient_balance","code":"INSUFFICIENT_PREPAID_BALANCE"}}
```

Error yang umum ditemui:

| HTTP | Arti | Tindakan |
| --- | --- | --- |
| `401` | API key tidak terdaftar, dicabut, atau tidak dikirim | Daftarkan key yang sama dengan yang dipakai client dan pastikan statusnya aktif. |
| `402` | Saldo key di bawah Rp10 | Top-up sampai saldo sekurangnya Rp10. Periksa `error.code: INSUFFICIENT_PREPAID_BALANCE`. |
| `502` | Gateway tidak dapat menghubungi DeepSeek | Periksa koneksi server, konfigurasi `DEEPSEEK_BASE_URL` backend, dan status layanan DeepSeek. |
| `503` | Database atau pencatatan request bermasalah | Periksa koneksi MongoDB dan log backend. Request tidak diteruskan jika pencatatan awal gagal. |

## Rollback

Jika ada masalah saat migrasi, kembalikan `DEEPSEEK_CLIENT_BASE_URL` ke `https://api.deepseek.com`, lalu restart aplikasi client. Gunakan API key DeepSeek yang sama. Request yang kembali dikirim langsung ke DeepSeek tidak tercatat di dashboard gateway dan tidak memotong saldo prabayar; penggunaan tetap tercatat dan ditagihkan oleh DeepSeek.

Jika key DeepSeek perlu diganti, daftarkan key baru di client yang sama, top-up hingga saldo minimal Rp10, ubah secret aplikasi ke key baru, uji request melalui gateway, lalu cabut key lama dari dashboard.
