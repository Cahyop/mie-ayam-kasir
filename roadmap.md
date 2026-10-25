# Roadmap — POS Mie Ayam

## Done

- [x] Halaman auth (masuk/daftar) + reset password
- [x] Library lokal: Dexie (IndexedDB), mesin sinkronisasi (outbox + pull, LWW updated_at), format rupiah, status online
- [x] Struk: komponen struk (`receipt-dialog.tsx`), gambar struk (canvas), cetak Bluetooth ESC/POS + fallback print browser, kirim WA (gambar + teks)
- [x] Kasir (POS utama): grid menu, keranjang, pembayaran tunai/QRIS, kembalian, opsi struk
- [x] Riwayat transaksi + detail + cetak ulang
- [x] Produk & stok: CRUD menu, stok
- [x] Kas: modal awal, kas masuk/keluar, ringkasan harian
- [x] Pelanggan: CRUD (`pelanggan.tsx`)
- [x] Pengaturan: info toko, footer struk, lebar kertas, printer (`pengaturan.tsx`)
- [x] Menu Lainnya (`lainnya.tsx`)
- [x] PWA: manifest + ikon + service worker (offline, ter-guard untuk preview)
- [x] Verifikasi: build produksi Vite & Nitro OK, tes vitest lolos 100%

## In progress

- [ ] Migrasi database: products, customers, transactions, transaction_items, cash_flows, settings + RLS + GRANT + seed menu contoh per user baru
- [ ] Aktifkan email/password auth + Google + Sign in with Lovable
- [ ] Uji alur fisik printer Bluetooth & pengujian end-to-end langsung pada perangkat HP
