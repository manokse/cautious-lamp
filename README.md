# Browserless Auto Generator

Website + serverless API untuk generate API key Browserless secara batch.

Fitur utama:

- Pilih jumlah API key yang ingin digenerate
- Mode eksekusi sequential atau async pool (worker/thread)
- Atur jumlah worker/thread secara custom
- Tombol stop untuk membatalkan proses yang sedang berjalan
- Opsi proxy on/off
- Proxy pool (multi proxy) dengan auto-retry antar proxy
- Parser proxy multi-format (host:port, user:pass@host:port, ip:port:user:pass, JSON, template URL)
- Auto temp mail provider emailfake.com
- Domain email otomatis dari domain.txt
- OTP parser untuk format inbox seperti:
  - Subject: [Action required] Verify your email address
  - Body yang berisi kode 6 digit verifikasi
- Export hasil report ke TXT
- Export khusus API key ke format TXT/CSV/JSON
- UI responsive untuk desktop, tablet, dan mobile (termasuk hasil tabel adaptif di layar kecil)

## Struktur

- index.html
- styles.css
- app.js
- domain.txt
- shared/browserless-generator.js
- api/generate.js (Vercel)
- functions/api/generate.js (Cloudflare Pages Functions)
- _routes.json (Cloudflare routing hints)
- worker.js, wrangler.toml (Cloudflare Workers)
- test_browserless_flow.py (diagnostic tester)

## Cara jalan lokal

Jalankan static server:

```bash
python -m http.server 8080
```

Buka:

- http://localhost:8080

Catatan:

- Endpoint /api/generate tidak akan berjalan dari python -m http.server karena ini tidak menjalankan serverless runtime.
- Untuk test penuh alur generate, gunakan deploy Vercel atau Cloudflare Pages.

## Deploy Vercel

1. Import folder/repo ke Vercel.
2. Framework: Other.
3. Build command: kosong.
4. Output directory: .
5. Deploy.

Opsional environment variable:

- BROWSERLESS_SUPABASE_ANON_KEY

Jika tidak diisi, sistem memakai default anon key yang terekam dari HAR.

## Deploy Cloudflare Pages

1. Create project di Cloudflare Pages.
2. Connect repository.
3. Build command: kosong.
4. Build output directory: .
5. Deploy.

Cloudflare akan memakai file functions/api/generate.js sebagai endpoint serverless.

File _routes.json sudah disiapkan agar path /api/* diarahkan ke Functions.

## Deploy Cloudflare Workers (workers.dev)

Jika Anda deploy ke domain *.workers.dev (bukan *.pages.dev), gunakan runtime Worker ini:

- worker.js
- wrangler.toml

Langkah cepat:

1. Pastikan Worker memakai `worker.js` sebagai entrypoint.
2. Pastikan static assets binding aktif (`ASSETS`) sesuai wrangler.toml.
3. Set environment variable `BROWSERLESS_SUPABASE_ANON_KEY` di Worker settings (opsional, fallback sudah ada di kode).
4. Deploy ulang.

Setelah deploy, cek health endpoint:

- GET /api/generate

Jika aktif, response akan berisi `ok: true`.

Opsional environment variable:

- BROWSERLESS_SUPABASE_ANON_KEY

## Catatan Proxy

Mode proxy aktif bila toggle proxy dinyalakan dan Proxy URL diisi.

Khusus emailfake.com: request setup inbox dan polling OTP selalu direct (tanpa proxy), meskipun mode proxy aktif. Proxy hanya dipakai untuk request ke endpoint Browserless.

Anda juga bisa isi `Proxy Pool` (satu proxy per baris). Sistem akan mencoba proxy satu per satu jika attempt sebelumnya gagal.

Format yang didukung:

- https://proxy.example/fetch?url={url}
- https://proxy.example/fetch?target={url}
- 1.2.3.4:8080
- user:pass@proxy.example:8080
- 1.2.3.4:8080:user:pass
- {"host":"1.2.3.4","port":8080,"username":"u","password":"p"}

Jika placeholder URL tidak disediakan, aplikasi akan mencoba menambahkan parameter target (`url`, `target`, `destination`, dll) secara otomatis.

## Catatan keamanan

- Gunakan hanya untuk akun dan aktivitas yang Anda miliki izinnya.
- Jangan commit token sensitif hasil generate ke repository publik.

## Troubleshooting HTTP 405

Jika UI menampilkan HTTP 405 pada Start Generate:

- Pastikan project dijalankan di runtime serverless (Vercel/Cloudflare), bukan static server biasa.
- Cek endpoint health dengan membuka /api/generate di browser. Jika aktif, akan muncul JSON ok true.
- Re-deploy setelah update terbaru karena frontend sekarang mencoba fallback /api/generate dan /api/generate/.

## Troubleshooting HTTP 404 di workers.dev

Jika di workers.dev muncul:

- `/api/generate -> HTTP 404`

Berarti Worker Anda masih mode static-only tanpa route API. Solusi:

- Deploy dengan `worker.js` (runtime Worker), bukan hanya upload aset statis.

## Troubleshooting verify 403

Jika log menunjukkan:

- `data.browserless.io /auth/v1/verify failed: 403`

Itu biasanya berarti kode OTP yang terbaca tidak cocok / kadaluarsa, bukan masalah route API.

Checklist:

- Naikkan `OTP Timeout / akun` (misalnya 90-120 detik).
- Jalankan batch kecil dulu (1-2 akun) untuk validasi.
- Pastikan domain email di `domain.txt` masih valid di emailfake.
- Redeploy agar parser OTP terbaru aktif (parser sekarang mencoba banyak kandidat OTP sebelum gagal).

## Troubleshooting GraphQL signup 400 / IP limit

Jika log berisi pesan seperti:

- `You can only create 2 free accounts per IP address`

Berarti Anda kena limit akun free per-IP dari Browserless.

Solusi:

- Aktifkan proxy (IP berbeda) di UI.
- Gunakan residential/static proxy yang stabil.
- Turunkan concurrency (set mode `sequential` atau kecilkan `Worker / Thread Count`).
- Pertimbangkan akun berbayar Browserless jika butuh volume tinggi.
