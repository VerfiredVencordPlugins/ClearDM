# ClearDM

DM'deki tüm mesajlarını silen Vencord plugin'i.

## Özellikler

- DM veya Grup DM'de sağ tıkla → "Tüm Mesajlarımı Sil"
- Rate limit koruması (yavaş siler ama ban yemezsin)
- İstediğin zaman durdurabilirsin
- Sadece kendi mesajlarını siler

## Uyarı

- Bu işlem geri alınamaz!
- Çok mesaj varsa uzun sürebilir
- Discord rate limit'i yüzünden saniyede ~1 mesaj silinir

## Kurulum

### UserpluginInstaller ile
```
https://github.com/VerfiredVencordPlugins/ClearDM
```

### Manuel
```bash
cd Vencord/src/userplugins
git clone https://github.com/VerfiredVencordPlugins/ClearDM.git
cd ../..
pnpm build
```

## Lisans

GPL-3.0-or-later
