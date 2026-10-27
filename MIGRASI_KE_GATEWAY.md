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
- Tentukan harga token di halaman **Tarif**. Nilai awal proyek adalah Rp50.000 per 1 juta token.

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
PRICE_PER_MILLION_IDR=50000
```

Ganti kedua nilai contoh tersebut sebelum menjalankan server yang dapat diakses melalui jaringan. `ADMIN_TOKEN` dipakai untuk membuka dashboard dan API pengelolaannya; nilainya berbeda dari API key DeepSeek client. Buat `KEY_HASH_SECRET` sebelum mendaftarkan key pertama, lalu pertahankan nilainya; menggantinya membuat fingerprint key lama tidak cocok lagi. Jangan gunakan token contoh lokal jika dashboard dapat diakses dari jaringan.

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
