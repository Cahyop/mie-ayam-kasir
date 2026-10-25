# Roadmap — POS Mie Ayam

## Done
- (belum ada)

## In progress
- [ ] Migrasi database: products, customers, transactions, transaction_items, cash_flows, settings + RLS + GRANT + seed menu contoh per user baru
- [ ] Aktifkan email/password auth + Google + Sign in with Lovable

## TODO
- [ ] Halaman auth (masuk/daftar) + reset password
- [ ] Library lokal: Dexie (IndexedDB), mesin sinkronisasi (outbox + pull, LWW updated_at), format rupiah, status online
- [ ] Struk: komponen struk, gambar struk (canvas), cetak Bluetooth ESC/POS + fallback print browser, kirim WA (gambar + teks)
- [ ] Kasir (POS utama): grid menu, keranjang, pembayaran tunai/QRIS, kembalian, opsi struk
- [ ] Riwayat transaksi + detail + cetak ulang
- [ ] Produk & stok: CRUD menu, stok
- [ ] Kas: modal awal, kas masuk/keluar, ringkasan harian
- [ ] Pelanggan: CRUD
- [ ] Pengaturan: info toko, footer struk, lebar kertas, printer
- [ ] PWA: manifest + ikon + service worker (offline, ter-guard untuk preview)
- [ ] Verifikasi: build OK, alur kasir end-to-end via browser
