# AKS Production Deployment Guide

## 📋 Prerequisites

- Ubuntu 24 LTS VPS (minimum 2GB RAM, 2 CPU cores recommended)
- Domain name pointed to your VPS IP
- MongoDB Atlas account (free tier works)
- API Keys:
  - OpenAI API key
  - ElevenLabs API key
  - (Optional) Deepgram API key

## 🚀 Quick Deployment

### 1. SSH into your VPS

```bash
ssh user@your-server-ip
```

### 2. Clone the repository

```bash
cd /opt
sudo git clone https://github.com/your-repo/aks.git
sudo chown -R $USER:$USER /opt/aks
cd /opt/aks
```

### 3. Run the setup script

```bash
./scripts/deploy-ubuntu.sh
```

This script will:
- Install Docker and Docker Compose
- Configure UFW firewall (ports 22, 80, 443)
- Setup Fail2Ban for security
- Create systemd service for auto-start
- Create helper scripts

### 4. Configure environment

```bash
cp .env.prod.example .env.prod
nano .env.prod
```

Fill in your values:
```env
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/aks
JWT_SECRET=your-64-char-random-string
JWT_REFRESH_SECRET=your-another-64-char-random-string
OPENAI_API_KEY=sk-...
ELEVENLABS_API_KEY=...
```

Generate secure secrets:
```bash
openssl rand -base64 64
```

### 5. Build and start

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

### 6. Verify deployment

```bash
./status.sh
# or
curl http://localhost/health
curl http://localhost/api/health
```

## 🔐 SSL/HTTPS Setup

### Option A: Let's Encrypt (Recommended)

```bash
# Point your domain to server first, then:
./setup-ssl.sh your-domain.com your@email.com
```

### Option B: Manual Certificates

1. Place certificates in `/opt/aks/docker/ssl/`:
   - `fullchain.pem`
   - `privkey.pem`

2. Edit `frontend-web/docker/nginx-site.prod.conf`:
   - Uncomment the HTTPS server block
   - Update `server_name`
   - Uncomment the HTTP->HTTPS redirect

3. Rebuild frontend:
   ```bash
   docker compose -f docker-compose.prod.yml up -d --build frontend
   ```

## 📊 Monitoring & Logs

### View logs
```bash
# All services
./logs.sh

# Specific service
./logs.sh backend
./logs.sh frontend
```

### Check status
```bash
./status.sh
```

### Docker commands
```bash
# List containers
docker compose -f docker-compose.prod.yml ps

# Restart a service
docker compose -f docker-compose.prod.yml restart backend

# Stop all
docker compose -f docker-compose.prod.yml down

# View resource usage
docker stats
```

## 🔄 Updates & Redeployment

### Pull and redeploy
```bash
./deploy.sh
```

### Manual rebuild
```bash
git pull origin main
docker compose -f docker-compose.prod.yml build --no-cache
docker compose -f docker-compose.prod.yml up -d
```

### Rollback
```bash
# List previous images
docker images

# Tag current as backup
docker tag aks-backend:latest aks-backend:backup

# Restore backup
docker tag aks-backend:backup aks-backend:latest
docker compose -f docker-compose.prod.yml up -d
```

## 🛡️ Security Checklist

- [ ] Change default JWT secrets
- [ ] Enable UFW firewall
- [ ] Setup Fail2Ban
- [ ] Enable SSL/HTTPS
- [ ] Regular system updates (`apt update && apt upgrade`)
- [ ] MongoDB Atlas IP whitelist
- [ ] Disable root SSH login
- [ ] Use SSH keys (disable password auth)

## 🔧 Troubleshooting

### Container won't start
```bash
docker compose -f docker-compose.prod.yml logs backend
```

### MongoDB connection issues
- Check MONGODB_URI is correct
- Verify IP is whitelisted in MongoDB Atlas
- Test connection: `mongosh "your-connection-string"`

### WebSocket not working
- Check nginx logs: `docker exec aks-frontend cat /var/log/nginx/error.log`
- Verify backend is healthy: `curl http://localhost:5001/health`

### High memory usage
```bash
# Prune unused Docker resources
docker system prune -a

# Check container memory
docker stats --no-stream
```

### SSL certificate renewal
```bash
# Auto-renewal should be setup, but manual:
sudo certbot renew
sudo cp /etc/letsencrypt/live/your-domain.com/*.pem /opt/aks/docker/ssl/
docker compose -f docker-compose.prod.yml restart frontend
```

## 📁 Directory Structure

```
/opt/aks/
├── docker-compose.prod.yml    # Production compose file
├── .env.prod                  # Environment variables
├── backend/                   # Backend source
├── frontend-web/              # Frontend source
├── docker/
│   ├── ssl/                   # SSL certificates
│   └── nginx-logs/            # Nginx access/error logs
├── scripts/
│   └── deploy-ubuntu.sh       # Setup script
├── deploy.sh                  # Quick redeploy
├── logs.sh                    # View logs
├── status.sh                  # Check status
└── setup-ssl.sh               # SSL configuration
```

## 💡 Performance Tips

1. **Enable swap** (for low-memory VPS):
   ```bash
   sudo fallocate -l 2G /swapfile
   sudo chmod 600 /swapfile
   sudo mkswap /swapfile
   sudo swapon /swapfile
   echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
   ```

2. **Tune Docker logging**:
   Already configured in docker-compose.prod.yml with log rotation

3. **Monitor resources**:
   ```bash
   htop
   docker stats
   ```

## 📞 Support

For issues, check:
1. Container logs: `./logs.sh`
2. Nginx logs: `docker exec aks-frontend cat /var/log/nginx/error.log`
3. System logs: `journalctl -u aks.service`
