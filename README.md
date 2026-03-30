# Browserless Auto Generator

Website + serverless API untuk generate API key Browserless secara batch.

Fitur utama:

- Pilih jumlah API key yang ingin digenerate
- Opsi proxy on/off
- Auto temp mail provider emailfake.com
- Domain email otomatis dari domain.txt
- OTP parser untuk format inbox seperti:
  - Subject: [Action required] Verify your email address
  - Body yang berisi kode 6 digit verifikasi
- Export hasil ke TXT

## Struktur

- index.html
- styles.css
- app.js
- domain.txt
- shared/browserless-generator.js
- api/generate.js (Vercel)
- functions/api/generate.js (Cloudflare Pages Functions)
- _routes.json (Cloudflare routing hints)

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

Opsional environment variable:

- BROWSERLESS_SUPABASE_ANON_KEY

## Catatan Proxy

Mode proxy aktif bila toggle proxy dinyalakan dan Proxy URL diisi.

Format yang didukung:

- https://proxy.example/fetch?url={url}

Jika placeholder {url} tidak disediakan, aplikasi akan otomatis menambahkan query parameter url=encodedTarget.

## Catatan keamanan

- Gunakan hanya untuk akun dan aktivitas yang Anda miliki izinnya.
- Jangan commit token sensitif hasil generate ke repository publik.

## Troubleshooting HTTP 405

Jika UI menampilkan HTTP 405 pada Start Generate:

- Pastikan project dijalankan di runtime serverless (Vercel/Cloudflare), bukan static server biasa.
- Cek endpoint health dengan membuka /api/generate di browser. Jika aktif, akan muncul JSON ok true.
- Re-deploy setelah update terbaru karena frontend sekarang mencoba fallback /api/generate dan /api/generate/.
