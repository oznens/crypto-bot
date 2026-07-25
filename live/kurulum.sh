#!/bin/bash
# Vultr (Ubuntu 22.04/24.04) tek komut kurulum:
#   curl -sL https://raw.githubusercontent.com/oznens/crypto-bot/main/live/kurulum.sh | bash
set -e
echo "== DREYKO canli motor kurulumu =="

# Node 20
if ! command -v node >/dev/null || [ "$(node -v | cut -c2-3)" -lt 18 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs git
fi

# repo
mkdir -p /opt && cd /opt
if [ -d crypto-bot ]; then cd crypto-bot && git pull; else git clone https://github.com/oznens/crypto-bot.git && cd crypto-bot; fi

# bagimliliklar (sadece live/ icin)
cd live
npm init -y >/dev/null 2>&1 || true
npm install ccxt dotenv >/dev/null 2>&1
[ -f .env ] || cp .env.example .env

# systemd servisi (kurulur ama BASLATILMAZ — once .env doldurulacak)
cat > /etc/systemd/system/crypto-live.service <<'EOF'
[Unit]
Description=DREYKO canli islem motoru
After=network-online.target

[Service]
WorkingDirectory=/opt/crypto-bot/live
ExecStart=/usr/bin/node live_engine.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable crypto-live >/dev/null 2>&1

echo ""
echo "== KURULUM TAMAM =="
echo "Simdi sirayla:"
echo "  1) nano /opt/crypto-bot/live/.env   -> MEXC_KEY ve MEXC_SECRET yaz (cekim yetkisi KAPALI, IP kisitlamali)"
echo "  2) cd /opt/crypto-bot/live && node test_mexc.js   -> ciktiyi sohbete yapistir (vadeli emir yetkisi testi)"
echo "  3) systemctl start crypto-live   -> DRY_RUN modunda baslar"
echo "  4) Pano: http://$(curl -s ifconfig.me 2>/dev/null || echo SUNUCU_IP):8080"
echo "  Log: journalctl -u crypto-live -f"
